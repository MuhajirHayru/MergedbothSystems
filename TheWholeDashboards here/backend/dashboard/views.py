"""Role dashboard aggregation endpoints (doc 5.1.5, FR-F-06, FR-W-07, FR-R-05, FR-SA-05)."""
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, Max, Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from chat.models import Message
from notifications.models import Notification
from payments.models import (
    BankAccount,
    FundingStatus,
    Order,
    OrderStatus,
    PaymentRecord,
    PaymentStatus,
    PayoutStatus,
    Wallet,
    WalletFundingRequest,
    WalletPayoutRequest,
)
from products.geo import annotate_distance_km
from products.models import Product, ProductStatus, ProductType
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from users.models import AccountStatus, Role, User
from users.permissions import (
    IsFarmer,
    IsFinancialManager,
    IsRetailer,
    IsUserAdmin,
    IsWholesaler,
)
from registrations.services import users_visible_to_admin


def _unread_message_count(user):
    return Message.objects.filter(
        channel__participants=user, is_read=False
    ).exclude(sender=user).count()


def _recent_activity(user, fallback=None, limit=6):
    """Newest notifications, falling back to domain events when empty."""
    items = [
        {
            "type": n.type,
            "text": n.message,
            "time": _relative(n.created_at),
        }
        for n in Notification.objects.filter(recipient=user)[:limit]
    ]
    if not items and fallback:
        items = fallback()
    return items


def _relative(dt):
    if not dt:
        return ""
    seconds = int((timezone.now() - dt).total_seconds())
    if seconds < 60:
        return "Just now"
    if seconds < 3600:
        return f"{seconds // 60} min ago"
    if seconds < 86400:
        hours = seconds // 3600
        return f"{hours} hour{'s' if hours > 1 else ''} ago"
    days = seconds // 86400
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} days ago"
    return dt.strftime("%d %b %Y")


@extend_schema(responses=OpenApiTypes.OBJECT)
class FarmerDashboardView(APIView):
    """GET /api/v1/dashboard/farmer/ (FR-F-06)."""

    permission_classes = [IsFarmer]

    def get(self, request):
        user = request.user
        listings = Product.objects.filter(
            owner=user, product_type=ProductType.FARMER_LISTING
        )
        orders_received = Order.objects.filter(farmer=user)
        payments = PaymentRecord.objects.filter(farmer=user)
        pending_order_statuses = (
            OrderStatus.PENDING_SELLER_APPROVAL,
            OrderStatus.ACCEPTED,
            OrderStatus.PROCESSING,
            OrderStatus.CONFIRMED,
            OrderStatus.SHIPPED,
            OrderStatus.DELIVERED,
            OrderStatus.AWAITING_QUALITY_CONFIRMATION,
            OrderStatus.AWAITING_PAYMENT_RELEASE,
            OrderStatus.DISPUTED,
        )
        listing_stats = listings.aggregate(
            total_active=Count("id", filter=Q(status=ProductStatus.ACTIVE)),
            total=Count("id"),
        )
        order_stats = orders_received.aggregate(
            total_products_sold=Sum(
                "quantity", filter=~Q(status=OrderStatus.CANCELLED)
            ),
            pending=Count("id", filter=Q(status__in=pending_order_statuses)),
        )
        payment_stats = payments.aggregate(
            total_earned=Sum("amount", filter=Q(status=PaymentStatus.VERIFIED)),
            pending=Count("id", filter=Q(status=PaymentStatus.PENDING)),
        )

        def fallback():
            return [
                {
                    "type": "ORDER",
                    "text": f"Order {o.reference} from {o.wholesaler.full_name}",
                    "time": _relative(o.created_at),
                }
                for o in orders_received.select_related("wholesaler")[:5]
            ]

        return Response(
            {
                "success": True,
                "stats": {
                    "total_active_listings": listing_stats["total_active"],
                    "total_products_sold": int(
                        order_stats["total_products_sold"] or 0
                    ),
                    "unread_messages": _unread_message_count(user),
                    "total_listings": listing_stats["total"],
                    "pending_orders": order_stats["pending"],
                    "total_earned": int(payment_stats["total_earned"] or 0),
                    "pending_payments": payment_stats["pending"],
                },
                "listings": [
                    {
                        "id": str(p.id),
                        "title": p.title,
                        "quantity": str(p.quantity),
                        "unit": p.unit_of_measure,
                        "price_per_unit": str(p.price_per_unit),
                        "status": p.status,
                    }
                    for p in listings.filter(status=ProductStatus.ACTIVE)[:20]
                ],
                "recent_activity": _recent_activity(user, fallback),
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class WholesalerDashboardView(APIView):
    """GET /api/v1/dashboard/wholesaler/ (FR-W-07)."""

    permission_classes = [IsWholesaler]

    def get(self, request):
        user = request.user
        orders = Order.objects.filter(wholesaler=user).select_related(
            "farmer", "retailer", "product", "wholesaler"
        )
        purchases = orders.filter(retailer__isnull=True)
        payments = PaymentRecord.objects.filter(submitted_by=user)

        def fallback():
            return [
                {
                    "type": "ORDER",
                    "text": f"Order {o.reference} - {o.get_status_display()}",
                    "time": _relative(o.created_at),
                }
                for o in orders[:5]
            ]

        seller_totals = (
            purchases.open()
            .exclude(farmer__isnull=True)
            .values("farmer_id", "farmer__full_name", "farmer__location")
            .annotate(
                order_count=Count("id"),
                total_spent=Sum("total_amount"),
                last_order=Max("created_at"),
            )
            .order_by("-total_spent", "-last_order")
        )

        return Response(
            {
                "success": True,
                "stats": {
                    "total_orders": orders.count(),
                    "total_spent": int(
                        purchases.open().aggregate(t=Sum("total_amount"))["t"] or 0
                    ),
                    "favorite_sellers": seller_totals.count(),
                    "unread_messages": _unread_message_count(user),
                    "active_listings": Product.objects.filter(
                        owner=user, status=ProductStatus.ACTIVE
                    ).count(),
                    "pending_orders": orders.filter(
                        status__in=(
                            OrderStatus.PENDING_SELLER_APPROVAL,
                            OrderStatus.ACCEPTED,
                            OrderStatus.PROCESSING,
                            OrderStatus.CONFIRMED,
                            OrderStatus.SHIPPED,
                            OrderStatus.DELIVERED,
                            OrderStatus.AWAITING_QUALITY_CONFIRMATION,
                            OrderStatus.AWAITING_PAYMENT_RELEASE,
                            OrderStatus.DISPUTED,
                        )
                    ).count(),
                    "pending_payments": payments.filter(
                        status=PaymentStatus.PENDING
                    ).count(),
                    "verified_payments": payments.filter(
                        status=PaymentStatus.VERIFIED
                    ).count(),
                },
                "orders": [
                    {
                        "id": str(o.id),
                        "reference": o.reference,
                        "seller": o.seller.full_name,
                        "product": o.product.title,
                        "total": f"{o.total_amount:,.0f} ETB",
                        "status": o.status,
                        "date": o.created_at.strftime("%b %d, %Y"),
                    }
                    for o in orders[:10]
                ],
                "favorite_sellers": [
                    {
                        "id": str(row["farmer_id"]),
                        "name": row["farmer__full_name"],
                        "location": row["farmer__location"] or "",
                        "orders": row["order_count"],
                        "total_spent": int(row["total_spent"] or 0),
                        "last_order": (
                            row["last_order"].strftime("%b %d, %Y")
                            if row["last_order"]
                            else ""
                        ),
                    }
                    for row in seller_totals
                ],
                "recent_activity": _recent_activity(user, fallback),
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class RetailerDashboardView(APIView):
    """GET /api/v1/dashboard/retailer/ (FR-R-05).

    Surfaces browsing activity and active communications, plus the nearest
    wholesaler listings the retailer can discover (FR-R-02).
    """
    permission_classes = [IsRetailer]

    def get(self, request):
        user = request.user
        channels = Message.objects.filter(channel__participants=user)
        listings = Product.objects.filter(
            product_type=ProductType.WHOLESALER_LISTING,
            status=ProductStatus.ACTIVE,
        ).select_related("owner")

        ranked, has_origin = annotate_distance_km(listings, user)
        if has_origin:
            ranked = ranked.order_by("distance_km", "-created_at")[:8]
        else:
            ranked = ranked.order_by("-created_at")[:8]

        nearby = [
            {
                "id": str(p.id),
                "title": p.title,
                "wholesaler": p.owner.full_name,
                "location": p.owner.location,
                "price_per_unit": str(p.price_per_unit),
                "unit": p.unit_of_measure,
                "distance_km": round(float(p.distance_km), 2)
                if getattr(p, "distance_km", None) is not None
                else None,
            }
            for p in ranked
        ]

        active_channels = (
            channels.values("channel")
            .distinct()
            .count()
        )

        return Response(
            {
                "success": True,
                "stats": {
                    "active_communications": active_channels,
                    "unread_messages": _unread_message_count(user),
                    "total_wholesalers": User.objects.filter(
                        role=Role.WHOLESALER, status=AccountStatus.APPROVED
                    ).count(),
                    "available_listings": listings.count(),
                    "nearby_listings": len(nearby),
                    "location_available": has_origin,
                },
                "nearby_listings": nearby,
                "recent_activity": _recent_activity(user),
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class AdminDashboardView(APIView):
    """GET /api/v1/dashboard/admin/ — User Admin / Financial Manager overview."""

    permission_classes = [IsUserAdmin | IsFinancialManager]

    def get(self, request):
        visible_users = User.objects.all()
        if request.user.role == Role.USER_ADMIN:
            visible_users = users_visible_to_admin(request.user, visible_users)
        visible_ids = visible_users.values("pk")
        user_rows = list(
            visible_users.values("role").annotate(
                total=Count("id"),
                pending=Count("id", filter=Q(status=AccountStatus.PENDING)),
                active=Count("id", filter=Q(status=AccountStatus.APPROVED)),
                approved_role_count=Count(
                    "id", filter=Q(status=AccountStatus.APPROVED)
                ),
            )
        )
        by_role = {
            row["role"]: row["approved_role_count"]
            for row in user_rows
            if row["approved_role_count"]
        }
        active_listings = Product.objects.filter(owner_id__in=visible_ids)
        orders = Order.objects.all()
        payments = PaymentRecord.objects.all()
        if request.user.role == Role.USER_ADMIN:
            orders = orders.filter(
                Q(farmer_id__in=visible_ids)
                | Q(wholesaler_id__in=visible_ids)
                | Q(retailer_id__in=visible_ids)
            )
            payments = payments.filter(
                Q(farmer_id__in=visible_ids) | Q(submitted_by_id__in=visible_ids)
            )
        payment_stats = payments.aggregate(
            pending=Count("id", filter=Q(status=PaymentStatus.PENDING)),
            verified=Count("id", filter=Q(status=PaymentStatus.VERIFIED)),
            flagged=Count("id", filter=Q(status=PaymentStatus.FLAGGED)),
        )
        return Response(
            {
                "success": True,
                "stats": {
                    "pending_users": sum(row["pending"] for row in user_rows),
                    "total_users": sum(row["total"] for row in user_rows),
                    "active_users": sum(row["active"] for row in user_rows),
                    "farmers": by_role.get(Role.FARMER, 0),
                    "wholesalers": by_role.get(Role.WHOLESALER, 0),
                    "retailers": by_role.get(Role.RETAILER, 0),
                    "active_listings": active_listings.filter(
                        status=ProductStatus.ACTIVE
                    ).count(),
                    "pending_payments": payment_stats["pending"],
                    "verified_payments": payment_stats["verified"],
                    "flagged_payments": payment_stats["flagged"],
                    "total_orders": orders.count(),
                },
            }
        )


@extend_schema(responses=OpenApiTypes.OBJECT)
class PaymentSummaryView(APIView):
    """GET /api/v1/dashboard/payments/ — Payment Management tab summary (FR-FM-01)."""

    permission_classes = [IsFinancialManager]

    def get(self, request):
        now = timezone.now()
        pending = PaymentRecord.objects.pending()
        verified = PaymentRecord.objects.verified().filter(
            verified_at__year=now.year, verified_at__month=now.month
        )
        flagged = PaymentRecord.objects.flagged()

        return Response(
            {
                "success": True,
                "summary": {
                    "pending_amount": int(pending.aggregate(t=Sum("amount"))["t"] or 0),
                    "pending_count": pending.count(),
                    "verified_amount": int(verified.aggregate(t=Sum("amount"))["t"] or 0),
                    "verified_count": verified.count(),
                    "flagged_count": flagged.count(),
                    "flagged_amount": int(flagged.aggregate(t=Sum("amount"))["t"] or 0),
                },
                "tabs": {
                    "PENDING": pending.count(),
                    "VERIFIED": PaymentRecord.objects.verified().count(),
                    "FLAGGED": flagged.count(),
                    "DISPUTED": PaymentRecord.objects.filter(
                        status=PaymentStatus.DISPUTED
                    ).count(),
                },
            }
        )


def _parse_period(request, default_days=30):
    """Resolve the reporting window without inventing data outside it."""
    today = timezone.localdate()
    raw_from = (request.query_params.get("date_from") or "").strip()
    raw_to = (request.query_params.get("date_to") or "").strip()
    if raw_from or raw_to:
        try:
            start = (
                date.fromisoformat(raw_from)
                if raw_from
                else today - timedelta(days=default_days - 1)
            )
            end = date.fromisoformat(raw_to) if raw_to else today
        except ValueError:
            raise ValidationError({"date_from": "Use ISO dates (YYYY-MM-DD)."})
        if start > end:
            raise ValidationError(
                {"date_from": "The start date must be on or before the end date."}
            )
    else:
        try:
            days = int(request.query_params.get("days", default_days))
        except (TypeError, ValueError):
            days = default_days
        days = max(1, min(days, 366))
        start = today - timedelta(days=days - 1)
        end = today
    return start, end


@extend_schema(responses=OpenApiTypes.OBJECT)
class FinancialOperationsSummaryView(APIView):
    """Read-only wallet, funding, payout and GMV aggregates for the Financial Manager.

    Wallet balances are current point-in-time totals. Funding, payout, order and
    payment activity is restricted to the requested period (``days`` or
    ``date_from``/``date_to``). Recognized revenue comes from posted journal
    entries; unresolved orders and missing product costs are reported separately
    so one incomplete order does not hide revenue already recognized in the ledger.
    """

    permission_classes = [IsFinancialManager]

    @staticmethod
    def _money(value):
        amount = value if value is not None else Decimal("0.00")
        return str(amount.quantize(Decimal("0.01")))

    @classmethod
    def _bucket(cls, queryset):
        totals = queryset.aggregate(count=Count("id"), amount=Sum("amount"))
        return {
            "count": totals["count"] or 0,
            "amount": cls._money(totals["amount"]),
        }

    @classmethod
    def _by_status(cls, queryset):
        return {
            row["status"]: {
                "count": row["count"],
                "amount": cls._money(row["amount"]),
            }
            for row in queryset.values("status").annotate(
                count=Count("id"), amount=Sum("amount")
            )
        }

    def get(self, request):
        start, end = _parse_period(request)
        participant_roles = (Role.FARMER, Role.WHOLESALER, Role.RETAILER)
        wallets = Wallet.objects.filter(user__role__in=participant_roles)
        wallet_totals = wallets.aggregate(
            count=Count("id"),
            available=Sum("available_balance"),
            held=Sum("held_balance"),
        )
        wallet_by_role = {
            row["user__role"]: {
                "count": row["count"],
                "available_balance": self._money(row["available"]),
                "held_balance": self._money(row["held"]),
            }
            for row in wallets.values("user__role").annotate(
                count=Count("id"),
                available=Sum("available_balance"),
                held=Sum("held_balance"),
            )
        }

        funding = WalletFundingRequest.objects.filter(
            wallet__user__role__in=participant_roles
        )
        payouts = WalletPayoutRequest.objects.filter(
            wallet__user__role__in=participant_roles
        )
        period_funding = funding.filter(
            submitted_at__date__gte=start, submitted_at__date__lte=end
        )
        period_payouts = payouts.filter(
            submitted_at__date__gte=start, submitted_at__date__lte=end
        )
        approved_funding = funding.filter(
            reviewed_at__date__gte=start,
            reviewed_at__date__lte=end,
            status__in=(FundingStatus.VERIFIED, FundingStatus.APPROVED),
        )
        rejected_funding = funding.filter(
            reviewed_at__date__gte=start,
            reviewed_at__date__lte=end,
            status=FundingStatus.REJECTED,
        )
        paid_payouts_period = payouts.filter(
            reviewed_at__date__gte=start,
            reviewed_at__date__lte=end,
            status=PayoutStatus.PAID,
        )
        rejected_payouts_period = payouts.filter(
            reviewed_at__date__gte=start,
            reviewed_at__date__lte=end,
            status=PayoutStatus.REJECTED,
        )
        pending_funding_statuses = (
            FundingStatus.PENDING,
            FundingStatus.AWAITING_PAYMENT,
            FundingStatus.PAYMENT_VERIFICATION_PENDING,
            FundingStatus.AWAITING_APPROVAL,
        )
        funding_review = funding.filter(status__in=pending_funding_statuses)
        pending_payouts = payouts.filter(status=PayoutStatus.PENDING)
        paid_payouts = payouts.filter(status=PayoutStatus.PAID)

        completed_orders = Order.objects.filter(
            status=OrderStatus.COMPLETED,
            updated_at__date__gte=start,
            updated_at__date__lte=end,
        )
        order_totals = completed_orders.aggregate(
            count=Count("id"), amount=Sum("total_amount")
        )

        payments = PaymentRecord.objects.filter(
            submitted_at__date__gte=start, submitted_at__date__lte=end
        )
        verified_payments = payments.filter(status=PaymentStatus.VERIFIED)
        verified_payment_totals = verified_payments.aggregate(
            count=Count("id"), amount=Sum("amount")
        )
        payment_by_status = self._by_status(payments)

        escrow_statuses = (
            OrderStatus.AWAITING_PAYMENT_RELEASE,
            OrderStatus.DISPUTED,
        )
        escrow = Order.objects.filter(status__in=escrow_statuses).values(
            "status"
        ).annotate(count=Count("id"), amount=Sum("total_amount"))
        escrow_by_status = {
            row["status"]: {
                "count": row["count"],
                "amount": self._money(row["amount"]),
            }
            for row in escrow
        }

        beneficiary_accounts = BankAccount.objects.filter(
            user__role__in=participant_roles
        )
        from payments.financial_models import (
            FinancialOrderSnapshot,
            FinancialJournalEntry,
            FinancialOperatingExpense,
            FinancialPayrollRecord,
        )
        financial_entries = FinancialJournalEntry.objects.filter(
            status=FinancialJournalEntry.Status.POSTED,
            created_at__date__gte=start,
            created_at__date__lte=end,
        )
        revenue_categories = (
            "MARKETPLACE_COMMISSION",
            "MARKETPLACE_BUYER_FEE",
            "MARKETPLACE_TRANSACTION_FEE",
            "INSPECTION_REVENUE",
            "DELIVERY_SERVICE_REVENUE",
            "SUBSCRIPTION_REVENUE",
            "ADVERTISING_REVENUE",
            "OTHER_REVENUE",
        )
        recognized_revenue_entries = financial_entries.filter(category__in=revenue_categories)
        revenue_by_category = {
            row["category"]: row["total"] or Decimal("0.00")
            for row in recognized_revenue_entries.values("category").annotate(total=Sum("amount"))
        }
        recognized_revenue = sum(revenue_by_category.values(), Decimal("0.00"))
        commission_total = revenue_by_category.get("MARKETPLACE_COMMISSION", Decimal("0.00"))
        delivery_revenue = revenue_by_category.get("DELIVERY_SERVICE_REVENUE", Decimal("0.00"))
        driver_total = financial_entries.filter(category="DELIVERY_DRIVER_COMPENSATION").aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
        expense_total = FinancialOperatingExpense.objects.filter(status=FinancialOperatingExpense.Status.PAID, incurred_on__gte=start, incurred_on__lte=end).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
        payroll_total = FinancialPayrollRecord.objects.filter(status=FinancialPayrollRecord.Status.PAID, period_start__lte=end, period_end__gte=start).aggregate(total=Sum("base_amount"))["total"] or Decimal("0.00")
        unresolved_snapshots = FinancialOrderSnapshot.objects.filter(
            status=FinancialOrderSnapshot.Status.TAX_UNRESOLVED,
            created_at__date__gte=start,
            created_at__date__lte=end,
        ).filter(Q(commission_amount__gt=0) | Q(configuration__isnull=False))
        unresolved_order_count = unresolved_snapshots.count()
        unresolved_order_gross = unresolved_snapshots.aggregate(total=Sum("gross_order_value"))["total"] or Decimal("0.00")
        unresolved_orders = []
        for row in unresolved_snapshots.select_related("order").order_by("created_at").values(
            "order__reference", "gross_order_value", "created_at",
            "configuration_id", "tax_amount", "order__agreement",
        ):
            reasons = []
            if row["configuration_id"] is None:
                reasons.append("No commission rule was snapshotted at settlement")
            if row["tax_amount"] is None:
                reasons.append("No matching approved tax treatment was snapshotted at settlement")
            if row["order__agreement"] is None:
                reasons.append("No participant agreement is attached; retrospective fee collection is blocked")
            unresolved_orders.append({
                "order_reference": row["order__reference"],
                "gross_order_value": self._money(row["gross_order_value"]),
                "settled_at": row["created_at"].isoformat(),
                "reasons": reasons,
            })
        has_revenue_entries = recognized_revenue_entries.exists()
        revenue_missing = ["product acquisition cost / cost of goods sold"]
        if delivery_revenue <= 0:
            revenue_missing.insert(0, "delivery service revenue")
        if unresolved_order_count:
            revenue_missing.append("commission/tax treatment for unresolved completed orders")
        revenue_reason = (
            f"Recognized revenue is calculated from posted ledger entries. {unresolved_order_count} completed order(s) "
            f"with {self._money(unresolved_order_gross)} ETB gross value remain excluded because commission or tax "
            "was not approved when those transactions settled. Profit is incomplete until product cost is recorded."
            if unresolved_order_count
            else "Recognized revenue is calculated from posted ledger entries. Profit is incomplete until product cost is recorded."
        )

        return Response(
            {
                "success": True,
                "generated_at": timezone.now().isoformat(),
                "period": {
                    "days": (end - start).days + 1,
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "label": f"{start.strftime('%d %b %Y')} - {end.strftime('%d %b %Y')}",
                },
                "wallets": {
                    "count": wallet_totals["count"] or 0,
                    "available_balance": self._money(wallet_totals["available"]),
                    "held_balance": self._money(wallet_totals["held"]),
                    "total_balance": self._money(
                        (wallet_totals["available"] or Decimal("0.00"))
                        + (wallet_totals["held"] or Decimal("0.00"))
                    ),
                    "by_role": wallet_by_role,
                },
                "funding": {
                    "by_status": self._by_status(funding),
                    "awaiting_review_count": funding_review.aggregate(
                        count=Count("id")
                    )["count"]
                    or 0,
                    "awaiting_review_amount": self._bucket(funding_review)["amount"],
                    "pending_count": funding_review.aggregate(count=Count("id"))[
                        "count"
                    ]
                    or 0,
                    "pending_amount": self._bucket(funding_review)["amount"],
                },
                "payouts": {
                    "by_status": self._by_status(payouts),
                    "pending_count": pending_payouts.aggregate(count=Count("id"))[
                        "count"
                    ]
                    or 0,
                    "pending_amount": self._bucket(pending_payouts)["amount"],
                    "paid_count": paid_payouts.aggregate(count=Count("id"))["count"]
                    or 0,
                    "paid_amount": self._bucket(paid_payouts)["amount"],
                },
                "activity": {
                    "funding": {
                        "requested": self._bucket(period_funding),
                        "approved": self._bucket(approved_funding),
                        "rejected": self._bucket(rejected_funding),
                        "flagged_current": self._bucket(
                            funding.filter(status=FundingStatus.FLAGGED)
                        ),
                        "pending_current": self._bucket(funding_review),
                    },
                    "payouts": {
                        "requested": self._bucket(period_payouts),
                        "paid": self._bucket(paid_payouts_period),
                        "rejected": self._bucket(rejected_payouts_period),
                        "pending_current": self._bucket(pending_payouts),
                    },
                    "orders": {
                        "completed_count": order_totals["count"] or 0,
                        "gmv": self._money(order_totals["amount"]),
                        "currency": "ETB",
                    },
                    "payments": {
                        "count": payments.aggregate(count=Count("id"))["count"] or 0,
                        "verified_count": verified_payment_totals["count"] or 0,
                        "verified_amount": self._money(
                            verified_payment_totals["amount"]
                        ),
                        "by_status": payment_by_status,
                    },
                },
                "revenue": {
                    "available": has_revenue_entries,
                    "revenue_complete": unresolved_order_count == 0,
                    "profit_available": False,
                    "reason": revenue_reason,
                    "revenue": self._money(recognized_revenue) if has_revenue_entries else None,
                    "recognized_revenue": self._money(recognized_revenue) if has_revenue_entries else None,
                    "gross_profit": None,
                    "net_profit": None,
                    "commission_revenue": self._money(commission_total),
                    "delivery_service_revenue": self._money(delivery_revenue),
                    "other_platform_revenue": self._money(recognized_revenue - commission_total - delivery_revenue),
                    "unresolved_order_count": unresolved_order_count,
                    "unresolved_order_gross": self._money(unresolved_order_gross),
                    "unresolved_orders": unresolved_orders,
                    "driver_compensation": self._money(driver_total),
                    "operating_expenses": self._money(expense_total),
                    "payroll_expenses": self._money(payroll_total),
                    "missing": revenue_missing,
                },
                "beneficiaries": {
                    "count": beneficiary_accounts.count(),
                    "requires_review_count": beneficiary_accounts.filter(
                        status="REQUIRES_REVIEW"
                    ).count(),
                },
                "escrow": escrow_by_status,
            }
        )
