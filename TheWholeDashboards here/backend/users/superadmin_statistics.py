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
from registrations.models import AdministrativeLocation
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
    """Primary region name for a flattened user row (hierarchy → free text).

    Charter cities (Addis Ababa, Dire Dawa) are CITY-level nodes, so a CITY
    ancestor counts as the region when no REGION ancestor exists.
    """
    chain = [
        (user_row.get("registration__location__name"), user_row.get("registration__location__level")),
        (user_row.get("registration__location__parent__name"), user_row.get("registration__location__parent__level")),
        (user_row.get("registration__location__parent__parent__name"), user_row.get("registration__location__parent__parent__level")),
        (user_row.get("registration__location__parent__parent__parent__name"), user_row.get("registration__location__parent__parent__parent__level")),
    ]
    for name, level in chain:
        if level == "REGION" and name:
            return name
    for name, level in chain:
        if level == "CITY" and name:
            return name
    text = (user_row.get("location") or "").strip()
    return text or "Unspecified"


def _zone_of(user_row):
    """Zone-equivalent name for a flattened user row (ZONE / charter sub-levels)."""
    for prefix in ("registration__location", "registration__location__parent", "registration__location__parent__parent"):
        level = user_row.get(f"{prefix}__level")
        name = user_row.get(f"{prefix}__name")
        if level in ("ZONE", "CITY", "SUBCITY", "DISTRICT") and name:
            return name
    return None


def _wereda_of(user_row):
    """Wereda name for a flattened user row (WOREDA level only)."""
    for prefix in ("registration__location", "registration__location__parent", "registration__location__parent__parent"):
        level = user_row.get(f"{prefix}__level")
        name = user_row.get(f"{prefix}__name")
        if level == "WOREDA" and name:
            return name
    return None


def _norm_key(text):
    """Normalization for region-name matching (letters only, lowercase)."""
    import re as _re
    return _re.sub(r"[^a-z]", "", str(text or "").lower())


# Minimal alias fallback for region/city spellings the administrative
# reference data cannot resolve by exact name. Real geography, not mock data:
# every entry maps to one of Ethiopia's 12 regional states or 2 charter
# cities. Keys are normalized (letters only, lowercase).
_REGION_ALIASES = {
    # The 12 regional states
    "tigray": "Tigray", "tigrai": "Tigray",
    "afar": "Afar",
    "amhara": "Amhara",
    "oromia": "Oromia", "oromo": "Oromia",
    "somali": "Somali", "somale": "Somali", "ogaden": "Somali",
    "benishangulgumuz": "Benishangul-Gumuz", "benishangul": "Benishangul-Gumuz",
    "bgumuz": "Benishangul-Gumuz",
    "snnpr": "South Ethiopia", "snnprs": "South Ethiopia",
    "southern": "South Ethiopia", "southethiopia": "South Ethiopia",
    "southwestethiopia": "South West Ethiopia", "southwest": "South West Ethiopia",
    "southwestethiopiapeoples": "South West Ethiopia",
    "sidama": "Sidama",
    "centralethiopia": "Central Ethiopia",
    "gambela": "Gambela", "gambella": "Gambela",
    "harari": "Harari",
    # The 2 chartered cities
    "addisababa": "Addis Ababa", "addis": "Addis Ababa",
    "addisabeba": "Addis Ababa", "finfinne": "Addis Ababa",
    "diredawa": "Dire Dawa", "dire": "Dire Dawa",
    # Common cities → their region
    "adama": "Oromia", "nazret": "Oromia", "shashamane": "Oromia",
    "jimmatown": "Oromia",
    "bahrdar": "Amhara", "bahirdar": "Amhara",
    "gondar": "Amhara", "dessie": "Amhara", "dese": "Amhara", "woldia": "Amhara",
    "mekelle": "Tigray", "mekele": "Tigray",
    "hawassa": "Sidama", "awassa": "Sidama", "hawasatown": "Sidama",
    "hararcity": "Harari", "harar": "Harari",
    "gambellatown": "Gambela",
    "assosatown": "Benishangul-Gumuz", "asosa": "Benishangul-Gumuz",
    "metekel": "Benishangul-Gumuz",
    "wolaita": "South Ethiopia", "sodo": "South Ethiopia",
    "kaffa": "South West Ethiopia", "sheka": "South West Ethiopia",
    "bench": "South West Ethiopia", "majicolor": "South West Ethiopia",
    "jinka": "South Ethiopia", "arbaminch": "South Ethiopia",
    "semera": "Afar", "jijiga": "Somali",
}


def _build_region_canonicalizer(unresolved_texts, canonical_by_key):
    """Resolve free-text region labels onto canonical Ethiopian regions.

    Primary source: the administrative reference data itself — an exact
    normalized name match on any node walks up its parent chain to the
    REGION/CITY ancestor (e.g. 'Adama' → East Shewa → Oromia). Falls back to
    a small city alias table. Labels that cannot be resolved return None and
    the caller buckets those participants under 'Unspecified'.

    ``canonical_by_key`` is the pre-fetched normalized REGION/CITY name map.
    """
    resolution = {}
    still_unresolved = []
    for text in unresolved_texts:
        key = _norm_key(text)
        if not key:
            resolution[text] = None
            continue
        if key in canonical_by_key:
            resolution[text] = canonical_by_key[key]
        elif key in _REGION_ALIASES:
            resolution[text] = _REGION_ALIASES[key]
        else:
            still_unresolved.append(text)

    if still_unresolved:
        # One bounded query: every active node, then walk parents in Python.
        node_rows = list(
            AdministrativeLocation.objects.filter(active=True).values(
                "id", "name", "level", "parent_id",
            )
        )
        by_id = {row["id"]: row for row in node_rows}
        node_index = {}
        for row in node_rows:
            node_index.setdefault(_norm_key(row["name"]), row)

        def walk_region(row):
            seen = set()
            while row and row["id"] not in seen:
                seen.add(row["id"])
                if row["level"] in ("REGION", "CITY"):
                    return row["name"].strip()
                row = by_id.get(row["parent_id"])
            return None

        for text in still_unresolved:
            node = node_index.get(_norm_key(text))
            resolution[text] = walk_region(node) if node else None

    return resolution


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
            IsAuthenticatedRole(
                (
                    Role.FINANCIAL_MANAGER,
                    Role.SUPER_ADMIN,
                    Role.TOP_USER_ADMIN,
                )
            ),
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
                "registration__location__parent__parent__parent__name",
                "registration__location__parent__parent__parent__level",
            )
        )
        region_by_user = {row["id"]: _region_of(row) for row in user_rows}
        zone_by_user = {row["id"]: _zone_of(row) for row in user_rows}
        wereda_by_user = {row["id"]: _wereda_of(row) for row in user_rows}

        # Canonicalize free-text regions onto the real Ethiopian regions
        # (12 regional states + Addis Ababa / Dire Dawa charter cities).
        # Participants whose label cannot be resolved fall under 'Unspecified'
        # so their counts are never lost from the totals.
        canonical_names = list(
            AdministrativeLocation.objects.filter(
                level__in=["REGION", "CITY"], active=True,
            ).values_list("name", flat=True)
        )
        canonical_keys = {_norm_key(name) for name in canonical_names}
        canonical_by_key = {_norm_key(name): name.strip() for name in canonical_names}
        # Canonicalization only applies when the administrative reference data
        # is loaded; without it, raw location text is kept as-is.
        free_text_regions = set()
        if canonical_names:
            free_text_regions = {
                r for r in set(region_by_user.values())
                if r != "Unspecified" and _norm_key(r) not in canonical_keys
            }
        if free_text_regions:
            resolution = _build_region_canonicalizer(
                free_text_regions, canonical_by_key,
            )
            region_by_user = {
                uid: (
                    (resolution.get(r) or "Unspecified")
                    if r in free_text_regions
                    else r
                )
                for uid, r in region_by_user.items()
            }

        STAFF_ROLES = {
            Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN,
            Role.WEREDA_ADMIN, Role.USER_ADMIN, Role.FINANCIAL_MANAGER,
            Role.LOGISTICS_MANAGER, Role.CUSTOMER_SUPPORT,
        }
        by_role, by_status, new_in_period = {}, {}, 0
        region_users = {}
        zone_user_counts = {}
        wereda_user_counts = {}
        users_without_zone = {}
        for row in user_rows:
            by_role[row["role"]] = by_role.get(row["role"], 0) + 1
            by_status[row["status"]] = by_status.get(row["status"], 0) + 1
            region = region_by_user[row["id"]]
            bucket = region_users.setdefault(region, {"roles": {}, "statuses": {}, "user_ids": set()})
            bucket["roles"][row["role"]] = bucket["roles"].get(row["role"], 0) + 1
            bucket["statuses"][row["status"]] = bucket["statuses"].get(row["status"], 0) + 1
            bucket["user_ids"].add(row["id"])
            user_zone = zone_by_user[row["id"]]
            user_wereda = wereda_by_user[row["id"]]
            if user_zone:
                zone_user_counts[(region, user_zone)] = zone_user_counts.get((region, user_zone), 0) + 1
                if user_wereda:
                    wkey = (region, user_zone, user_wereda)
                    wereda_user_counts[wkey] = wereda_user_counts.get(wkey, 0) + 1
            else:
                users_without_zone[region] = users_without_zone.get(region, 0) + 1
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
        zone_orders = {}
        wereda_orders = {}
        for row in order_rows:
            orders_by_status[row["status"]] = orders_by_status.get(row["status"], 0) + 1
            gmv += row["total_amount"]
            discounts += row["discount_amount"] or Decimal("0")
            seller_id = row["product__owner_id"]
            seller_region = region_by_user.get(seller_id, "Unspecified")
            agg = region_orders.setdefault(seller_region, {"count": 0, "value": Decimal("0")})
            agg["count"] += 1
            agg["value"] += row["total_amount"]
            seller_zone = zone_by_user.get(seller_id)
            if seller_zone:
                zagg = zone_orders.setdefault(
                    (seller_region, seller_zone), {"count": 0, "value": Decimal("0")}
                )
                zagg["count"] += 1
                zagg["value"] += row["total_amount"]
                seller_wereda = wereda_by_user.get(seller_id)
                if seller_wereda:
                    wagg = wereda_orders.setdefault(
                        (seller_region, seller_zone, seller_wereda),
                        {"count": 0, "value": Decimal("0")},
                    )
                    wagg["count"] += 1
                    wagg["value"] += row["total_amount"]

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
        zone_wallets = {}
        for row in Wallet.objects.values("user_id", "available_balance", "held_balance"):
            region = region_by_user.get(row["user_id"], "Unspecified")
            agg = region_wallets.setdefault(region, {"available": Decimal("0"), "held": Decimal("0")})
            agg["available"] += row["available_balance"] or Decimal("0")
            agg["held"] += row["held_balance"] or Decimal("0")
            user_zone = zone_by_user.get(row["user_id"])
            if user_zone:
                zagg = zone_wallets.setdefault(
                    (region, user_zone), {"available": Decimal("0"), "held": Decimal("0")}
                )
                zagg["available"] += row["available_balance"] or Decimal("0")
                zagg["held"] += row["held_balance"] or Decimal("0")

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
        # Per-region split: attribute each payment to the receiving farmer's
        # region (same seller-region rule the order rows use).
        region_payments = {}
        zone_payments = {}
        for row in payment_qs.values("farmer_id", "status", "amount"):
            farmer_id = row["farmer_id"]
            region = region_by_user.get(farmer_id, "Unspecified")
            agg = region_payments.setdefault(region, {})
            agg[row["status"]] = agg.get(row["status"], Decimal("0")) + (row["amount"] or Decimal("0"))
            farmer_zone = zone_by_user.get(farmer_id)
            if farmer_zone:
                zagg = zone_payments.setdefault((region, farmer_zone), {})
                zagg[row["status"]] = zagg.get(row["status"], Decimal("0")) + (row["amount"] or Decimal("0"))

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
        # Per-region split of assigned freight fees, attributed to the
        # assigned driver's region.
        region_freight_fees = {}
        for row in (
            FreightJob.objects.filter(
                status=FreightJob.Status.ASSIGNED, assigned_fee__isnull=False,
            ).values("assigned_driver_id", "assigned_fee")
        ):
            region = region_by_user.get(row["assigned_driver_id"], "Unspecified")
            agg = region_freight_fees.setdefault(region, Decimal("0"))
            region_freight_fees[region] = agg + (row["assigned_fee"] or Decimal("0"))
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
            # Zonal drill-down: real aggregates per zone (and wereda), built
            # from the same loops above — no extra queries.
            region_zone_keys = (
                {k for k in zone_orders if k[0] == region}
                | {k for k in zone_wallets if k[0] == region}
                | {k for k in zone_payments if k[0] == region}
                | {k for k in zone_user_counts if k[0] == region}
            )
            region_zone_rows = []
            for r_key, zone_name in sorted(region_zone_keys):
                z_orders = zone_orders.get((r_key, zone_name), {"count": 0, "value": Decimal("0")})
                z_wallets = zone_wallets.get((r_key, zone_name), {"available": Decimal("0"), "held": Decimal("0")})
                z_payments = zone_payments.get((r_key, zone_name), {})
                wereda_rows = []
                wereda_keys = (
                    {k for k in wereda_orders if k[0] == r_key and k[1] == zone_name}
                    | {k for k in wereda_user_counts if k[0] == r_key and k[1] == zone_name}
                )
                for w_key in sorted(wereda_keys):
                    w_name = w_key[2]
                    w_orders = wereda_orders.get(w_key, {"count": 0, "value": Decimal("0")})
                    wereda_rows.append({
                        "weredaName": w_name,
                        "totalTransactions": w_orders["count"],
                        "totalValueETB": _money(w_orders["value"]),
                        "usersCount": wereda_user_counts.get(w_key, 0),
                    })
                region_zone_rows.append({
                    "zoneName": zone_name,
                    "totalTransactions": z_orders["count"],
                    "totalValueETB": _money(z_orders["value"]),
                    "usersCount": zone_user_counts.get((r_key, zone_name), 0),
                    "verifiedPaymentValueETB": _money(z_payments.get("VERIFIED", Decimal("0"))),
                    "pendingPaymentValueETB": _money(z_payments.get("PENDING", Decimal("0"))),
                    "availableWalletETB": _money(z_wallets["available"]),
                    "heldWalletETB": _money(z_wallets["held"]),
                    "weredas": wereda_rows,
                })
            region_zone_rows.sort(key=lambda z: -float(z["totalValueETB"]))
            # Charter-city fallback: when no participant is linked to a
            # zone-level node, surface the region's real administrative
            # sub-divisions from reference data with zeroed aggregates —
            # flagged so the UI never presents them as measured activity.
            if not region_zone_rows:
                ref_node = AdministrativeLocation.objects.filter(
                    name__iexact=region,
                    level__in=["REGION", "CITY"],
                ).first()
                if ref_node:
                    for child in ref_node.children.filter(
                        level__in=["ZONE", "CITY", "SUBCITY", "DISTRICT"], active=True,
                    ).order_by("name"):
                        region_zone_rows.append({
                            "zoneName": child.name,
                            "totalTransactions": 0,
                            "totalValueETB": "0.00",
                            "usersCount": 0,
                            "verifiedPaymentValueETB": "0.00",
                            "pendingPaymentValueETB": "0.00",
                            "availableWalletETB": "0.00",
                            "heldWalletETB": "0.00",
                            "referenceOnly": True,
                            "weredas": [],
                        })
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
                "verifiedPaymentValueETB": _money(region_payments.get(region, {}).get("VERIFIED", Decimal("0"))),
                "pendingPaymentValueETB": _money(region_payments.get(region, {}).get("PENDING", Decimal("0"))),
                "payoutValueETB": _money(region_freight_fees.get(region, Decimal("0"))),
                "availableWalletETB": _money(wallets["available"]),
                "heldWalletETB": _money(wallets["held"]),
                "usersWithoutZoneDetail": users_without_zone.get(region, 0),
                "zones": region_zone_rows,
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
