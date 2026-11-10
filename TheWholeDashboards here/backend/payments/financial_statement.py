"""Consolidated, source-backed financial statement (read-only).

The Financial Manager needs one institutional view of the platform's money.
Every figure here is aggregated from a persisted table or a POSTED journal
entry; when the platform has no trustworthy source the value is ``None`` and
the reason is listed under ``unavailable``. Escrow, seller proceeds and driver
compensation are reported as liabilities, never as platform revenue.
"""

from datetime import date
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .financial_api import FinancialBaseView
from .financial_models import (
    DeliveryFeePayment,
    FinancialJournalEntry,
    FinancialOperatingExpense,
    FinancialOrderSnapshot,
    FinancialPayrollRecord,
    FinancialRefundRequest,
)
from .models import Order, OrderPaymentStatus, Wallet


def _money(value):
    """Two-decimal string, or ``None`` when the source has no data at all."""
    if value is None:
        return None
    return str(Decimal(value).quantize(Decimal("0.01")))


def _bucket(queryset, field="amount"):
    row = queryset.aggregate(total=Sum(field), count=Count("pk"))
    return {"amount": _money(row["total"]), "count": row["count"] or 0}


class FinancialStatementView(FinancialBaseView):
    """GET /payments/financial/statement/?start&end — one consolidated statement."""

    def get(self, request):
        try:
            start = request.query_params.get("start")
            end = request.query_params.get("end")
            if start:
                date.fromisoformat(start)
            if end:
                date.fromisoformat(end)
        except ValueError as exc:
            raise ValidationError("start and end must be ISO dates.") from exc

        posted = FinancialJournalEntry.objects.filter(
            status=FinancialJournalEntry.Status.POSTED
        )
        if start:
            posted = posted.filter(created_at__date__gte=start)
        if end:
            posted = posted.filter(created_at__date__lte=end)

        commission = posted.filter(category="MARKETPLACE_COMMISSION").aggregate(
            s=Sum("amount")
        )["s"]
        delivery_revenue = posted.filter(category="DELIVERY_SERVICE_REVENUE").aggregate(
            s=Sum("amount")
        )["s"]
        revenue_total = None
        if commission is not None or delivery_revenue is not None:
            revenue_total = (commission or Decimal("0")) + (
                delivery_revenue or Decimal("0")
            )
        tax_posted = posted.filter(category="TAX_LIABILITY").aggregate(s=Sum("amount"))["s"]

        escrow_states = (
            OrderPaymentStatus.RESERVED,
            OrderPaymentStatus.HELD,
            OrderPaymentStatus.RELEASE_PENDING,
            OrderPaymentStatus.DISPUTED,
        )
        escrow = Order.objects.filter(payment_status__in=escrow_states).aggregate(
            total=Sum("total_amount"), count=Count("pk")
        )
        released = Order.objects.filter(
            payment_status=OrderPaymentStatus.RELEASED
        ).aggregate(total=Sum("total_amount"), count=Count("pk"))
        wallets = Wallet.objects.aggregate(
            available=Sum("available_balance"),
            held=Sum("held_balance"),
            count=Count("pk"),
        )

        settled = FinancialOrderSnapshot.objects.filter(
            order__payment_status=OrderPaymentStatus.RELEASED
        )
        settled_proceeds = settled.aggregate(
            total=Sum("seller_proceeds"), count=Count("pk")
        )
        tax_collected = FinancialOrderSnapshot.objects.aggregate(
            total=Sum("tax_amount")
        )["total"]

        verified_delivery = DeliveryFeePayment.objects.filter(
            status=DeliveryFeePayment.Status.VERIFIED
        )
        compensation_payable = _bucket(
            verified_delivery.filter(compensation_paid_at__isnull=True), "driver_charge"
        )
        compensation_paid = _bucket(
            verified_delivery.filter(compensation_paid_at__isnull=False), "driver_charge"
        )
        delivery_verified = _bucket(verified_delivery, "customer_amount")
        platform_fees = _bucket(verified_delivery, "platform_fee")

        expenses = FinancialOperatingExpense.objects
        payroll = FinancialPayrollRecord.objects
        payroll_row = payroll.aggregate(
            base=Sum("base_amount"),
            allowances=Sum("allowances"),
            count=Count("pk"),
        )
        payroll_net = None
        if payroll_row["count"]:
            payroll_net = (payroll_row["base"] or Decimal("0")) + (
                payroll_row["allowances"] or Decimal("0")
            )

        def _payroll_net(status):
            row = payroll.filter(status=status).aggregate(
                base=Sum("base_amount"),
                allowances=Sum("allowances"),
                deductions=Sum("deductions"),
                tax=Sum("tax_amount"),
                count=Count("pk"),
            )
            if not row["count"]:
                return {"amount": None, "count": 0}
            net = (
                (row["base"] or Decimal("0"))
                + (row["allowances"] or Decimal("0"))
                - (row["deductions"] or Decimal("0"))
                - (row["tax"] or Decimal("0"))
            )
            return {"amount": _money(net), "count": row["count"]}

        refunds = FinancialRefundRequest.objects

        reconciliation = None
        try:
            from .financial_services import reconcile_financial_sources

            result = reconcile_financial_sources()
            reconciliation = {
                "complete": result["complete"],
                "issue_count": result["issue_count"],
            }
        except Exception:  # reconciliation must never take the statement down
            reconciliation = None

        unavailable = [
            {
                "field": "seller_payables.pending_release",
                "reason": (
                    "Commission and seller proceeds are snapshotted only when an "
                    "order is released, so pre-release payables cannot be stated."
                ),
            },
            {
                "field": "tax.paid",
                "reason": "No verified tax-payment journal category exists yet.",
            },
            {
                "field": "cash.bank_position",
                "reason": "Bank balances are not reconciled to the ledger.",
            },
        ]

        return Response(
            {
                "currency": "ETB",
                "as_of": timezone.now().isoformat(),
                "period": {"start": start, "end": end},
                "platform_revenue": {
                    "marketplace_commission": _money(commission),
                    "delivery_service_fees": _money(delivery_revenue),
                    "total": _money(revenue_total),
                    "basis": "POSTED ledger entries",
                },
                "customer_funds": {
                    "wallet_available": _money(wallets["available"]),
                    "wallet_held": _money(wallets["held"]),
                    "wallet_total": _money(
                        (wallets["available"] or Decimal("0"))
                        + (wallets["held"] or Decimal("0"))
                    )
                    if wallets["count"]
                    else None,
                    "wallet_accounts": wallets["count"] or 0,
                    "escrow_held": _money(escrow["total"]),
                    "escrow_orders": escrow["count"] or 0,
                    "released_order_value": _money(released["total"]),
                    "released_orders": released["count"] or 0,
                },
                "seller_payables": {
                    "settled_proceeds": _money(settled_proceeds["total"]),
                    "settled_orders": settled_proceeds["count"] or 0,
                    "pending_release": None,
                },
                "driver_compensation": {
                    "payable": compensation_payable["amount"],
                    "payable_count": compensation_payable["count"],
                    "paid": compensation_paid["amount"],
                    "paid_count": compensation_paid["count"],
                },
                "delivery_collections": {
                    "verified": delivery_verified["amount"],
                    "verified_count": delivery_verified["count"],
                    "platform_fee": platform_fees["amount"],
                    "outstanding": _bucket(
                        DeliveryFeePayment.objects.filter(
                            status=DeliveryFeePayment.Status.PENDING
                        ),
                        "customer_amount",
                    )["amount"],
                    "failed": _bucket(
                        DeliveryFeePayment.objects.filter(
                            status=DeliveryFeePayment.Status.FAILED
                        ),
                        "customer_amount",
                    )["amount"],
                },
                "operating_expenses": {
                    "pending": _bucket(
                        expenses.filter(status=FinancialOperatingExpense.Status.PENDING)
                    ),
                    "approved_outstanding": _bucket(
                        expenses.filter(status=FinancialOperatingExpense.Status.APPROVED)
                    ),
                    "paid": _bucket(
                        expenses.filter(status=FinancialOperatingExpense.Status.PAID)
                    ),
                    "rejected": _bucket(
                        expenses.filter(status=FinancialOperatingExpense.Status.REJECTED)
                    ),
                },
                "payroll": {
                    "draft": _payroll_net(FinancialPayrollRecord.Status.DRAFT),
                    "pending": _payroll_net(FinancialPayrollRecord.Status.PENDING),
                    "approved_outstanding": _payroll_net(
                        FinancialPayrollRecord.Status.APPROVED
                    ),
                    "paid": _payroll_net(FinancialPayrollRecord.Status.PAID),
                    "recorded": {
                        "amount": _money(payroll_net),
                        "count": payroll_row["count"] or 0,
                    },
                },
                "tax": {
                    "collected_on_settlements": _money(tax_collected),
                    "posted_liability": _money(tax_posted),
                },
                "refunds": {
                    "pending": _bucket(
                        refunds.filter(status=FinancialRefundRequest.Status.PENDING)
                    ),
                    "approved": _bucket(
                        refunds.filter(status=FinancialRefundRequest.Status.APPROVED)
                    ),
                    "paid": _bucket(
                        refunds.filter(status=FinancialRefundRequest.Status.PAID)
                    ),
                    "failed": _bucket(
                        refunds.filter(status=FinancialRefundRequest.Status.FAILED)
                    ),
                },
                "reconciliation": reconciliation,
                "unavailable": unavailable,
            }
        )
