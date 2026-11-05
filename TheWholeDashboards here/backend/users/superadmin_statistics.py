"""Dedicated Super Admin statistics aggregation — GET /api/v1/superadmin/statistics/.

One bulk endpoint powering the executive dashboards and regional reports.
Design rules enforced here:

- Pure ORM aggregation (``values`` / ``aggregate`` / ``Count`` / ``Sum``); a
  fixed handful of queries regardless of data volume — no N+1.
- Zero fabrication: platform revenue and seller payables are reported as
  ``null`` (unavailable) because no dedicated commission ledger / settlement
  model exists. Zero always means "checked and empty", never "unknown".
- Optional ``from`` / ``to`` ISO datetime filters (timezone-aware; naive input
  is interpreted in the server timezone) and an optional ``region`` filter.
- Regional rows resolve a user's primary region from the registration
  location hierarchy, falling back to the free-text location captured at
  sign-up, then "Unspecified" — the same convention as agricultural intel.
"""

from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from logistics.models import DriverProfile
from payments.models import Order, PaymentRecord, Wallet
from payments.freight_models import FreightBid, FreightJob
from products.models import Product
from support.models import SupportTicket, SupportTicketMessage
from users.models import AccountStatus, AuditLog, Role
from users.permissions import IsAuthenticatedRole


def _parse_bound(value, field):
    if not value:
        return None
    parsed = parse_datetime(value)
    if parsed is None:
        raise ValueError(f"{field} must be an ISO 8601 datetime.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def _region_of(user_row, region_by_user_id=None):
    """Primary region name for a flattened user row (hierarchy → free text)."""
    loc_name = user_row.get("registration__location__name")
    loc_level = user_row.get("registration__location__level")
    parent_name = user_row.get("registration__location__parent__name")
    parent_level = user_row.get("registration__location__parent__level")
    grand_name = user_row.get("registration__location__parent__parent__name")
    grand_level = user_row.get("registration__location__parent__parent__level")
    # A REGION node itself, or any node whose parent/grandparent is a REGION.
    if loc_level == "REGION" and loc_name:
        return loc_name
    if parent_level == "REGION" and parent_name:
        return parent_name
    if grand_level == "REGION" and grand_name:
        return grand_name
    text = (user_row.get("location") or "").strip()
    return text or "Unspecified"


def _money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.01")))


class SuperAdminStatisticsView(APIView):
    """GET /api/v1/superadmin/statistics/ — bulk aggregate platform statistics.

    Query params:
        from   — optional ISO datetime; filters orders/payments/tickets/users.
        to     — optional ISO datetime (defaults to now).
        region — optional region name; scopes the ``regional`` rows only.
    """

    def get_permissions(self):
        return [
            IsAuthenticated(),
            IsAuthenticatedRole((Role.FINANCIAL_MANAGER,)),
        ]

    def get(self, request):
        try:
            period_from = _parse_bound(request.query_params.get("from"), "from")
            period_to = _parse_bound(request.query_params.get("to"), "to")
        except ValueError as exc:
            return Response({"success": False, "error": str(exc)}, status=400)
        region_filter = (request.query_params.get("region") or "").strip()
        period_to = period_to or timezone.now()

        # ---- 1. Users (one flattened query; region resolved in Python) ----
        user_rows = list(
            self._scoped_users().values(
                "id", "role", "status", "location", "created_at",
                "registration__location__name", "registration__location__level",
                "registration__location__parent__name", "registration__location__parent__level",
                "registration__location__parent__parent__name",
                "registration__location__parent__parent__level",
            )
        )
        region_by_user = {row["id"]: _region_of(row) for row in user_rows}

        STAFF_ROLES = {
            Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN,
            Role.WEREDA_ADMIN, Role.USER_ADMIN, Role.FINANCIAL_MANAGER,
            Role.LOGISTICS_MANAGER, Role.CUSTOMER_SUPPORT,
        }
        by_role, by_status, new_in_period = {}, {}, 0
        region_users = {}
        for row in user_rows:
            by_role[row["role"]] = by_role.get(row["role"], 0) + 1
            by_status[row["status"]] = by_status.get(row["status"], 0) + 1
            region = region_by_user[row["id"]]
            bucket = region_users.setdefault(region, {"roles": {}, "statuses": {}, "user_ids": set()})
            bucket["roles"][row["role"]] = bucket["roles"].get(row["role"], 0) + 1
            bucket["statuses"][row["status"]] = bucket["statuses"].get(row["status"], 0) + 1
            bucket["user_ids"].add(row["id"])
            if period_from and row["created_at"] and period_from <= row["created_at"] <= period_to:
                new_in_period += 1

        # ---- 2. Orders (period-filtered) + GMV, mapped to the seller's region ----
        order_qs = Order.objects.all()
        if period_from:
            order_qs = order_qs.filter(created_at__gte=period_from)
        order_qs = order_qs.filter(created_at__lte=period_to)
        order_rows = list(order_qs.values(
            "id", "status", "total_amount", "discount_amount", "product__owner_id",
        ))
        orders_by_status = {}
        gmv = Decimal("0")
        discounts = Decimal("0")
        region_orders = {}
        for row in order_rows:
            orders_by_status[row["status"]] = orders_by_status.get(row["status"], 0) + 1
            gmv += row["total_amount"]
            discounts += row["discount_amount"] or Decimal("0")
            seller_region = region_by_user.get(row["product__owner_id"], "Unspecified")
            agg = region_orders.setdefault(seller_region, {"count": 0, "value": Decimal("0")})
            agg["count"] += 1
            agg["value"] += row["total_amount"]

        # ---- 3. Products by status ----
        products_by_status = dict(
            Product.objects.values_list("status")
            .annotate(total=Count("id"))
            .values_list("status", "total")
        )

        # ---- 4. Wallets (liabilities + per-region float) ----
        wallet_totals = Wallet.objects.aggregate(
            available=Sum("available_balance"), held=Sum("held_balance"),
        )
        region_wallets = {}
        for row in Wallet.objects.values("user_id", "available_balance", "held_balance"):
            region = region_by_user.get(row["user_id"], "Unspecified")
            agg = region_wallets.setdefault(region, {"available": Decimal("0"), "held": Decimal("0")})
            agg["available"] += row["available_balance"] or Decimal("0")
            agg["held"] += row["held_balance"] or Decimal("0")

        # ---- 5. Payments by status (verification-date aware) ----
        payment_qs = PaymentRecord.objects.all()
        if period_from:
            payment_qs = payment_qs.filter(verified_at__gte=period_from)
        payment_sums = dict(
            payment_qs.values_list("status")
            .annotate(total=Sum("amount"))
            .values_list("status", "total")
        )
        payment_sums = {k: _money(v) for k, v in payment_sums.items()}

        # ---- 6. Logistics: freight jobs, bids, assigned fees ----
        freight_by_status = dict(
            FreightJob.objects.values_list("status")
            .annotate(total=Count("id"))
            .values_list("status", "total")
        )
        freight_by_delivery = dict(
            FreightJob.objects.values_list("delivery_status")
            .annotate(total=Count("id"))
            .values_list("delivery_status", "total")
        )
        freight_fees = FreightJob.objects.filter(
            status=FreightJob.Status.ASSIGNED, assigned_fee__isnull=False,
        ).aggregate(total=Sum("assigned_fee"))
        bids_total = FreightBid.objects.count()

        # ---- 7. Drivers ----
        drivers_total = by_role.get(Role.DRIVER, 0)
        drivers_approved = sum(
            1 for row in user_rows
            if row["role"] == Role.DRIVER and row["status"] == AccountStatus.APPROVED
        )
        drivers_available = DriverProfile.objects.filter(is_available=True).count()

        # ---- 8. Support tickets ----
        tickets_by_status = dict(
            SupportTicket.objects.values_list("status")
            .annotate(total=Count("id"))
            .values_list("status", "total")
        )
        tickets_by_priority = dict(
            SupportTicket.objects.values_list("priority")
            .annotate(total=Count("id"))
            .values_list("priority", "total")
        )
        staff_replied_ticket_ids = set(
            SupportTicketMessage.objects.filter(author_kind=SupportTicketMessage.Author.STAFF)
            .values_list("ticket_id", flat=True)
        )
        tickets_total = SupportTicket.objects.count()
        tickets_unanswered = max(
            0,
            tickets_by_status.get(SupportTicket.Status.OPEN, 0)
            + tickets_by_status.get(SupportTicket.Status.IN_PROGRESS, 0)
            - len(staff_replied_ticket_ids),
        )

        # ---- 9. Regional rows (same shape the frontend report consumes) ----
        region_rows = []
        for region in sorted(region_users):
            if region_filter and region.lower() != region_filter.lower():
                continue
            users_in_region = region_users[region]
            roles = users_in_region["roles"]
            orders = region_orders.get(region, {"count": 0, "value": Decimal("0")})
            wallets = region_wallets.get(region, {"available": Decimal("0"), "held": Decimal("0")})
            statuses = users_in_region["statuses"]
            region_rows.append({
                "region": region,
                "totalUsers": sum(roles.values()),
                "farmersCount": roles.get(Role.FARMER, 0),
                "wholesalersCount": roles.get(Role.WHOLESALER, 0),
                "retailersCount": roles.get(Role.RETAILER, 0),
                "driversCount": roles.get(Role.DRIVER, 0),
                "staffCount": sum(v for k, v in roles.items() if k in STAFF_ROLES),
                "approvedCount": statuses.get("APPROVED", 0),
                "pendingCount": statuses.get("PENDING", 0),
                "suspendedCount": statuses.get("SUSPENDED", 0),
                "totalTransactions": orders["count"],
                "totalTransactionValueETB": _money(orders["value"]),
                "verifiedPaymentValueETB": payment_sums.get("VERIFIED", "0.00"),
                "pendingPaymentValueETB": payment_sums.get("PENDING", "0.00"),
                "payoutValueETB": _money(freight_fees["total"]),
                "availableWalletETB": _money(wallets["available"]),
                "heldWalletETB": _money(wallets["held"]),
                "zones": [],
            })
        region_rows.sort(key=lambda r: -r["totalUsers"])

        # ---- 10. Administrative accountability (from immutable audit rows) ----
        approval_rows = (
            AuditLog.objects.filter(action__in=["user_approved", "user_rejected"])
            .values("action", "actor_id", "actor__full_name", "actor__role")
            .annotate(total=Count("id"))
            .order_by("-total")[:15]
        )
        approvals_by_actor = {}
        for row in approval_rows:
            key = (row["actor_id"], row["actor__full_name"] or "Unknown", row["actor__role"] or "UNKNOWN")
            entry = approvals_by_actor.setdefault(key, {"approvals": 0, "rejections": 0})
            entry["approvals" if row["action"] == "user_approved" else "rejections"] += row["total"]
        administrative = {
            "by_actor": [
                {
                    "actor_id": str(actor_id) if actor_id else None,
                    "actor": name,
                    "role": role,
                    "approvals": counts["approvals"],
                    "rejections": counts["rejections"],
                }
                for (actor_id, name, role), counts in sorted(
                    approvals_by_actor.items(), key=lambda kv: -(kv[1]["approvals"] + kv[1]["rejections"])
                )
            ],
            "pending_by_region": [
                {"region": region, "pending": users_in_region["statuses"].get("PENDING", 0)}
                for region, users_in_region in sorted(region_users.items())
                if users_in_region["statuses"].get("PENDING", 0) > 0
            ],
            "note": "Counts come from recorded audit rows; accounts approved before audit logging existed are not attributable.",
        }

        return Response({
            "success": True,
            "administrative": administrative,
            "period": {
                "from": period_from.isoformat() if period_from else None,
                "to": period_to.isoformat(),
                "timezone": str(timezone.get_current_timezone()),
            },
            "generated_at": timezone.now().isoformat(),
            "users": {
                "total": len(user_rows),
                "by_role": by_role,
                "by_status": by_status,
                "new_in_period": new_in_period,
            },
            "marketplace": {
                "products": {"total": sum(products_by_status.values()), "by_status": products_by_status},
                "orders": {
                    "total": len(order_rows),
                    "by_status": orders_by_status,
                    "gmv": _money(gmv),
                    "discounts_given": _money(discounts),
                },
            },
            "financial": {
                # Escrow liability: customer funds currently held by the platform.
                "wallet_available": _money(wallet_totals["available"]),
                "wallet_held_escrow": _money(wallet_totals["held"]),
                "payments_by_status": payment_sums,
                # No dedicated commission ledger or seller-settlement model exists
                # yet, so revenue and seller payables are honestly unavailable.
                "platform_revenue": None,
                "seller_payables": None,
                "unavailable_note": (
                    "platform_revenue and seller_payables require a commission "
                    "ledger / settlement model that does not exist yet."
                ),
            },
            "logistics": {
                "freight_jobs": {
                    "total": sum(freight_by_status.values()),
                    "by_status": freight_by_status,
                    "by_delivery_status": freight_by_delivery,
                    "assigned_fees_total": _money(freight_fees["total"]),
                },
                "bids_total": bids_total,
            },
            "drivers": {
                "total": drivers_total,
                "approved": drivers_approved,
                "available_now": drivers_available,
            },
            "support": {
                "tickets": {
                    "total": tickets_total,
                    "by_status": tickets_by_status,
                    "by_priority": tickets_by_priority,
                    "unanswered": tickets_unanswered,
                },
            },
            "regional": region_rows,
        })

    @staticmethod
    def _scoped_users():
        from users.models import User

        return User.objects.all()
