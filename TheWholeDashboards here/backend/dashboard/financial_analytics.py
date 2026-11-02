"""Read-only financial analytics for the Financial Manager dashboard.

Aggregates only persisted wallet, funding, payout, order and delivery-fee
records. No values are invented and no financial state is mutated.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Avg, Count, Sum
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.models import (
    FundingStatus,
    MarketplaceDeliveryFeeAgreement,
    PayoutStatus,
    Wallet,
    WalletFundingRequest,
    WalletPayoutRequest,
    WalletTransaction,
    WalletTransactionType,
)
from users.models import Role
from users.permissions import IsFinancialManager


def _amount(value):
    return float(value if value is not None else Decimal("0.00"))


def _month_start(value, offset):
    month_index = value.year * 12 + (value.month - 1) + offset
    return date(month_index // 12, month_index % 12 + 1, 1)


def _next_month(value):
    return _month_start(value, 1)


def _month_label(value):
    return value.strftime("%b %Y")


class FinancialAnalyticsView(APIView):
    """GET /api/v1/dashboard/financial-analytics/?days=30."""

    permission_classes = [IsFinancialManager]

    def get(self, request):
        today = timezone.localdate()
        try:
            days = int(request.query_params.get("days", 30))
        except (TypeError, ValueError):
            days = 30
        days = max(1, min(days, 90))
        start = today - timedelta(days=days - 1)

        transactions = WalletTransaction.objects.filter(
            created_at__date__gte=start
        )
        funding = WalletFundingRequest.objects.filter(submitted_at__date__gte=start)
        payouts = WalletPayoutRequest.objects.filter(submitted_at__date__gte=start)

        participant_roles = (Role.FARMER, Role.WHOLESALER, Role.RETAILER)
        platform_wallets = Wallet.objects.filter(user__role__in=participant_roles)
        wallet_totals = platform_wallets.aggregate(
            available=Sum("available_balance"),
            held=Sum("held_balance"),
        )
        pending_payout_total = WalletPayoutRequest.objects.filter(
            wallet__user__role__in=participant_roles,
            status=PayoutStatus.PENDING,
        ).aggregate(total=Sum("amount"), count=Count("id"))
        pending_funding = WalletFundingRequest.objects.filter(
            wallet__user__role__in=participant_roles,
            status__in=(
                FundingStatus.PENDING,
                FundingStatus.AWAITING_PAYMENT,
                FundingStatus.PAYMENT_VERIFICATION_PENDING,
                FundingStatus.AWAITING_APPROVAL,
            ),
        ).aggregate(total=Sum("amount"), count=Count("id"))

        daily_rows = {
            row["day"]: row
            for row in transactions.annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(volume=Sum("amount"), count=Count("id"))
        }
        daily_trend = []
        for offset in range(days):
            current = start + timedelta(days=offset)
            row = daily_rows.get(current)
            daily_trend.append(
                {
                    "date": current.isoformat(),
                    "day": current.strftime("%d %b"),
                    "volumeETB": _amount(row["volume"]) if row else 0.0,
                    "transactions": row["count"] if row else 0,
                }
            )

        week_start = start - timedelta(days=start.weekday())
        weekly_rows = {
            row["week"]: row
            for row in transactions.annotate(week=TruncWeek("created_at"))
            .values("week")
            .annotate(
                deposits=Sum(
                    "amount", filter=models_q_type(WalletTransactionType.FUNDING)
                ),
                payouts=Sum(
                    "amount", filter=models_q_type(WalletTransactionType.PAYOUT)
                ),
                escrow=Sum(
                    "amount",
                    filter=models_q_type(WalletTransactionType.ESCROW_RELEASE),
                ),
            )
        }
        weekly_performance = []
        current_week = week_start
        while current_week <= today:
            row = weekly_rows.get(current_week)
            weekly_performance.append(
                {
                    "week": current_week.strftime("Week of %d %b"),
                    "deposits": _amount(row["deposits"]) if row else 0.0,
                    "payouts": _amount(row["payouts"]) if row else 0.0,
                    "escrowVolume": _amount(row["escrow"]) if row else 0.0,
                }
            )
            current_week += timedelta(days=7)

        current_month = today.replace(day=1)
        monthly_performance = []
        deposit_payout_comparison = []
        for offset in range(-5, 1):
            month_start = _month_start(current_month, offset)
            month_end = _next_month(month_start)
            month_tx = WalletTransaction.objects.filter(
                created_at__date__gte=month_start,
                created_at__date__lt=month_end,
            )
            monthly_performance.append(
                {
                    "month": _month_label(month_start),
                    "grossVolumeETB": _amount(
                        month_tx.filter(
                            transaction_type__in=(
                                WalletTransactionType.FUNDING,
                                WalletTransactionType.ESCROW_RELEASE,
                            )
                        ).aggregate(total=Sum("amount"))["total"]
                    ),
                    "netSettlementETB": _amount(
                        month_tx.filter(
                            transaction_type=WalletTransactionType.ESCROW_RELEASE
                        ).aggregate(total=Sum("amount"))["total"]
                    ),
                }
            )
            deposit_payout_comparison.append(
                {
                    "month": month_start.strftime("%b"),
                    "deposits": _amount(
                        WalletFundingRequest.objects.filter(
                            submitted_at__date__gte=month_start,
                            submitted_at__date__lt=month_end,
                        ).aggregate(total=Sum("amount"))["total"]
                    ),
                    "payouts": _amount(
                        WalletPayoutRequest.objects.filter(
                            submitted_at__date__gte=month_start,
                            submitted_at__date__lt=month_end,
                        ).aggregate(total=Sum("amount"))["total"]
                    ),
                }
            )

        regional_distribution = [
            {
                "region": row["wallet__user__location"] or "Unspecified",
                "volumeM": round(_amount(row["volume"]) / 1_000_000, 2),
                "volumeETB": _amount(row["volume"]),
            }
            for row in transactions.values("wallet__user__location")
            .annotate(volume=Sum("amount"))
            .order_by("-volume")[:8]
        ]

        funding_status = funding.values("status").annotate(
            count=Count("id"), amount=Sum("amount")
        )
        pending_verified = {
            "Verified Settlements": 0.0,
            "Pending Verification": 0.0,
            "Flagged for Review": 0.0,
        }
        for row in funding_status:
            status = row["status"]
            if status in (FundingStatus.VERIFIED, FundingStatus.APPROVED):
                bucket = "Verified Settlements"
            elif status in (FundingStatus.FLAGGED, FundingStatus.REJECTED):
                bucket = "Flagged for Review"
            else:
                bucket = "Pending Verification"
            pending_verified[bucket] += _amount(row["amount"])

        payment_methods = [
            {
                "name": row["payment_method"] or "Unspecified",
                "value": _amount(row["amount"]),
                "count": row["count"],
            }
            for row in funding.values("payment_method")
            .annotate(amount=Sum("amount"), count=Count("id"))
            .order_by("-amount")
        ]

        role_totals = {}
        for row in transactions.values(
            "wallet__user__role", "transaction_type"
        ).annotate(total=Sum("amount")):
            role = row["wallet__user__role"]
            entry = role_totals.setdefault(
                role, {"grossSettlement": 0.0, "payoutsClaimed": 0.0}
            )
            if row["transaction_type"] in (
                WalletTransactionType.ESCROW_RELEASE,
                WalletTransactionType.DELIVERY_FEE_EARNING,
            ):
                entry["grossSettlement"] += _amount(row["total"])
            elif row["transaction_type"] == WalletTransactionType.PAYOUT:
                entry["payoutsClaimed"] += _amount(row["total"])
        role_performance = [
            {
                "role": Role(role).label if role in Role.values else role,
                **values,
            }
            for role, values in role_totals.items()
        ]

        delivery_fee_data = [
            {
                "corridor": row["order__shipment_details__destination_region__name"]
                or "Unspecified",
                "volumeETB": _amount(row["volume"]),
                "avgRate": _amount(row["average"]),
            }
            for row in MarketplaceDeliveryFeeAgreement.objects.filter(
                recorded_at__date__gte=start
            )
            .values("order__shipment_details__destination_region__name")
            .annotate(volume=Sum("amount"), average=Avg("amount"))
            .order_by("-volume")
        ]

        return Response(
            {
                "success": True,
                "generated_at": timezone.now().isoformat(),
                "range": {"days": days, "start": start.isoformat(), "end": today.isoformat()},
                "summary": {
                    "totalVolumeETB": _amount(
                        transactions.aggregate(total=Sum("amount"))["total"]
                    ),
                    "availableBalanceETB": _amount(wallet_totals["available"]),
                    "heldBalanceETB": _amount(wallet_totals["held"]),
                    "pendingDeposits": pending_funding["count"] or 0,
                    "pendingDepositsETB": _amount(pending_funding["total"]),
                    "pendingPayouts": pending_payout_total["count"] or 0,
                    "pendingPayoutsETB": _amount(pending_payout_total["total"]),
                },
                "daily_trend": daily_trend,
                "weekly_performance": weekly_performance,
                "monthly_performance": monthly_performance,
                "regional_distribution": regional_distribution,
                "wallet_distribution": [
                    {
                        "name": "Available Cash Balances",
                        "value": _amount(wallet_totals["available"]),
                        "color": "#15803D",
                    },
                    {
                        "name": "Held in Platform Escrow",
                        "value": _amount(wallet_totals["held"]),
                        "color": "#D97706",
                    },
                    {
                        "name": "Pending Disbursal",
                        "value": _amount(pending_payout_total["total"]),
                        "color": "#2563EB",
                    },
                ],
                "deposit_payout_comparison": deposit_payout_comparison,
                "pending_vs_verified": [
                    {
                        "name": name,
                        "value": value,
                        "color": color,
                    }
                    for name, value, color in (
                        ("Verified Settlements", pending_verified["Verified Settlements"], "#10B981"),
                        ("Pending Verification", pending_verified["Pending Verification"], "#F59E0B"),
                        ("Flagged for Review", pending_verified["Flagged for Review"], "#EF4444"),
                    )
                ],
                "payment_methods": payment_methods,
                "role_performance": role_performance,
                "delivery_fees": delivery_fee_data,
            }
        )


def models_q_type(transaction_type):
    """Small helper kept local so the aggregation stays readable."""
    from django.db.models import Q

    return Q(transaction_type=transaction_type)
