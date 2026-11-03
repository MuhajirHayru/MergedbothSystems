"""Part 22/34 — comprehensive admin overview for the Super Admin dashboard.

Aggregates data from every subsystem into one response: users, orders,
wallets, freight, support, discounts, audit, payroll, and financials.
All values come from real database queries — no mock data.
"""

from django.db.models import Count, Q, Sum
from django.utils import timezone
from datetime import timedelta

from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AuditLog, Role, User
from users.permissions import IsSuperAdmin
from payments.models import Order, OrderStatus, WishlistItem
from payments.freight_models import FreightBid, FreightJob
from payments.financial_models import (
    DeliveryFeePayment,
    EmployeeProfile,
    FinancialJournalEntry,
)
from support.models import SupportTicket
from registrations.models import AdministrativeLocation


class AdminOverviewView(APIView):
    def get_permissions(self):
        return [IsSuperAdmin()]

    def get(self, request):
        now = timezone.now()
        last_30d = now - timedelta(days=30)
        last_7d = now - timedelta(days=7)

        # -- Users
        all_users = User.objects.filter(is_active=True)
        users_by_role = dict(
            all_users.values_list("role").annotate(c=Count("id")).values_list("role", "c")
        )
        pending_users = all_users.filter(status="PENDING").count()

        # -- Orders
        orders = Order.objects.all()
        orders_total = orders.count()
        orders_completed = orders.filter(status=OrderStatus.COMPLETED).count()
        orders_pending = orders.filter(
            status__in=[OrderStatus.PENDING_SELLER_APPROVAL, OrderStatus.ACCEPTED, OrderStatus.PROCESSING]
        ).count()
        orders_disputed = orders.filter(status=OrderStatus.DISPUTED).count()
        gmv = orders.filter(status=OrderStatus.COMPLETED).aggregate(
            t=Sum("total_amount")
        )["t"] or 0

        # -- Freight / Logistics
        freight_jobs = FreightJob.objects.all()
        freight_open = freight_jobs.filter(status=FreightJob.Status.OPEN).count()
        freight_assigned = freight_jobs.filter(status=FreightJob.Status.ASSIGNED).count()
        freight_completed = freight_jobs.filter(status=FreightJob.Status.COMPLETED).count()
        freight_bids_pending = FreightBid.objects.filter(
            status=FreightBid.Status.SUBMITTED,
            job__status=FreightJob.Status.OPEN,
        ).count()

        # -- Wallet / Financials
        from payments.models import Wallet
        wallet_agg = Wallet.objects.aggregate(
            available=Sum("available_balance"), held=Sum("held_balance")
        )
        journal_revenue = FinancialJournalEntry.objects.filter(
            category__in=["MARKETPLACE_COMMISSION", "DELIVERY_SERVICE_REVENUE"]
        ).aggregate(s=Sum("amount"))["s"] or 0
        journal_expenses = FinancialJournalEntry.objects.filter(
            category__in=["PROMOTION_EXPENSE", "OPERATING_EXPENSE"]
        ).aggregate(s=Sum("amount"))["s"] or 0
        payroll_total = FinancialJournalEntry.objects.filter(
            category__startswith="PAYROLL"
        ).aggregate(s=Sum("amount"))["s"] or 0

        # -- Support
        support_open = SupportTicket.objects.filter(
            status=SupportTicket.Status.OPEN
        ).count()
        support_unanswered = SupportTicket.objects.filter(unanswered=True).count()
        support_urgent = SupportTicket.objects.filter(
            priority=SupportTicket.Priority.URGENT,
            status__in=[SupportTicket.Status.OPEN, SupportTicket.Status.IN_PROGRESS],
        ).count()

        # -- Discounts
        from payments.discount_models import DiscountCampaign, DiscountRedemption
        campaigns_active = DiscountCampaign.objects.filter(
            is_active=True,
            ends_at__gt=now,
            starts_at__lte=now,
        ).count()
        redemptions_total = DiscountRedemption.objects.count()
        redemptions_amount = DiscountRedemption.objects.aggregate(
            s=Sum("discount_amount")
        )["s"] or 0

        # -- Wishlist
        wishlist_count = WishlistItem.objects.count()

        # -- Audit (recent activity)
        recent_audit = list(
            AuditLog.objects.order_by("-created_at")
            .values("action", "detail", "created_at")[:10]
        )

        # -- Trends (last 7 days)
        new_users_7d = all_users.filter(created_at__gte=last_7d).count()
        new_orders_7d = orders.filter(created_at__gte=last_7d).count()

        return Response({
            "success": True,
            "users": {
                "total": all_users.count(),
                "pending": pending_users,
                "by_role": users_by_role,
                "new_7d": new_users_7d,
            },
            "orders": {
                "total": orders_total,
                "completed": orders_completed,
                "pending": orders_pending,
                "disputed": orders_disputed,
                "gmv": str(gmv),
                "new_7d": new_orders_7d,
            },
            "wallet": {
                "available": str(wallet_agg["available"] or 0),
                "held": str(wallet_agg["held"] or 0),
            },
            "financials": {
                "revenue": str(journal_revenue),
                "expenses": str(journal_expenses),
                "payroll": str(payroll_total),
            },
            "freight": {
                "open": freight_open,
                "assigned": freight_assigned,
                "completed": freight_completed,
                "pending_bids": freight_bids_pending,
            },
            "support": {
                "open": support_open,
                "unanswered": support_unanswered,
                "urgent": support_urgent,
            },
            "discounts": {
                "active_campaigns": campaigns_active,
                "total_redemptions": redemptions_total,
                "total_discount_amount": str(redemptions_amount),
            },
            "wishlist_count": wishlist_count,
            "recent_audit": recent_audit,
        })
