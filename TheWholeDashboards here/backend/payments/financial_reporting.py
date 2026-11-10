from datetime import date
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import Role
from users.permissions import IsAuthenticatedRole
from .financial_models import FinancialJournalEntry, FinancialOperatingExpense, FinancialOrderSnapshot, FinancialPayrollRecord, DeliveryFeePayment, RevenueCharge
from .models import Order, OrderStatus


class FinancialReportView(APIView):
    permission_classes = [IsAuthenticatedRole]
    allowed_roles = (Role.SUPER_ADMIN, Role.FINANCIAL_MANAGER)

    def get_permissions(self):
        return [IsAuthenticatedRole(self.allowed_roles)]

    def get(self, request):
        period = request.query_params.get("period", "monthly")
        start_param, end_param = request.query_params.get("start"), request.query_params.get("end")
        try:
            today = timezone.localdate()
            start = date.fromisoformat(start_param) if start_param else today.replace(day=1)
            end = date.fromisoformat(end_param) if end_param else today
        except ValueError as exc:
            raise ValidationError("start and end must be ISO dates.") from exc
        if end < start:
            raise ValidationError("end must be on or after start.")
        if period not in ("daily", "weekly", "monthly", "quarterly", "annual"):
            raise ValidationError("period must be daily, weekly, monthly, quarterly, or annual.")
        entries = FinancialJournalEntry.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        region_id = request.query_params.get("region")
        if region_id:
            entries = entries.filter(location_id=region_id)
        data = list(entries.values("category", "debit_account__code", "credit_account__code", "currency").annotate(amount=Sum("amount")))
        totals = {}
        for row in data:
            category = row["category"]
            totals[category] = totals.get(category, Decimal("0")) + (row["amount"] or Decimal("0"))
        order_qs = FinancialOrderSnapshot.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        if region_id:
            order_qs = order_qs.filter(order__shipment_details__pickup_region_id=region_id)
        completed_orders = Order.objects.filter(status=OrderStatus.COMPLETED, updated_at__date__gte=start, updated_at__date__lte=end)
        if region_id:
            completed_orders = completed_orders.filter(shipment_details__pickup_region_id=region_id)
        unsupported_orders = completed_orders.exclude(pk__in=order_qs.values("order_id"))
        # A missing rule is unresolved only when the snapshot records a
        # positive commission that needs tax treatment. Zero commission has
        # no tax base and must not make a completed order disappear from GMV.
        unresolved_snapshot_terms = (
            Q(commission_amount__gt=0) & (
                Q(configuration__isnull=True)
                | Q(tax_amount__isnull=True)
                | Q(status=FinancialOrderSnapshot.Status.TAX_UNRESOLVED)
            )
        ) | (
            Q(status=FinancialOrderSnapshot.Status.TAX_UNRESOLVED)
            & Q(configuration__isnull=False)
        )
        incomplete_snapshots = order_qs.filter(unresolved_snapshot_terms)
        unresolved_completed_orders = unsupported_orders.count() + incomplete_snapshots.filter(
            order__in=completed_orders
        ).count()
        accounted_order_qs = order_qs.exclude(unresolved_snapshot_terms)
        order_totals = accounted_order_qs.aggregate(
            gmv=Sum("gross_order_value"), commissions=Sum("commission_amount")
        )
        commission_by_role = {
            row["seller_role"]: row["total"] or Decimal("0")
            for row in accounted_order_qs.values("seller_role").annotate(total=Sum("commission_amount"))
        }
        operating = FinancialOperatingExpense.objects.filter(status=FinancialOperatingExpense.Status.PAID, incurred_on__gte=start, incurred_on__lte=end)
        payroll = FinancialPayrollRecord.objects.filter(status=FinancialPayrollRecord.Status.PAID, period_start__lte=end, period_end__gte=start)
        if region_id:
            operating = operating.filter(location_id=region_id)
        operating_total = operating.aggregate(total=Sum("amount"))["total"] or Decimal("0")
        payroll_total = payroll.aggregate(total=Sum("base_amount"))["total"] or Decimal("0")
        tax_complete = unresolved_completed_orders == 0
        revenue = totals.get("MARKETPLACE_COMMISSION", Decimal("0"))
        delivery_revenue = totals.get("DELIVERY_SERVICE_REVENUE", Decimal("0"))
        platform_revenue_categories = (
            "MARKETPLACE_COMMISSION", "MARKETPLACE_BUYER_FEE",
            "MARKETPLACE_TRANSACTION_FEE", "INSPECTION_REVENUE",
            "DELIVERY_SERVICE_REVENUE", "SUBSCRIPTION_REVENUE",
            "ADVERTISING_REVENUE", "OTHER_REVENUE",
        )
        other_platform_revenue = sum(
            (totals.get(category, Decimal("0")) for category in platform_revenue_categories
             if category not in {"MARKETPLACE_COMMISSION", "DELIVERY_SERVICE_REVENUE"}),
            Decimal("0"),
        )
        driver_expenses = totals.get("DELIVERY_FEE_EARNING", Decimal("0"))
        tax_liabilities = totals.get("TAX_LIABILITY", Decimal("0"))
        unverified_tax_entries = entries.filter(category="TAX_LIABILITY").filter(
            Q(configuration__isnull=True)
            | Q(configuration__source_url__icontains="example.invalid")
            | Q(configuration__source__icontains="QA")
            | Q(configuration__name__icontains="QA ONLY")
        )
        tax_source_complete = not unverified_tax_entries.exists()
        delivery_payments = DeliveryFeePayment.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        if region_id:
            delivery_payments = delivery_payments.filter(agreement__order__shipment_details__pickup_region_id=region_id)
        delivery_collections_collected = delivery_payments.filter(status=DeliveryFeePayment.Status.VERIFIED).aggregate(total=Sum("customer_amount"))["total"] or Decimal("0")
        delivery_driver_payable = delivery_payments.filter(status=DeliveryFeePayment.Status.VERIFIED, compensation_paid_at__isnull=True).aggregate(total=Sum("driver_charge"))["total"] or Decimal("0")
        delivery_driver_paid = delivery_payments.filter(status=DeliveryFeePayment.Status.VERIFIED, compensation_paid_at__isnull=False).aggregate(total=Sum("driver_charge"))["total"] or Decimal("0")
        # Only posted delivery revenue is recognized. The payment allocation is
        # the supporting source detail, while the append-only journal is the
        # financial reporting authority.
        delivery_service_revenue = delivery_revenue
        delivery_tax = delivery_payments.filter(status=DeliveryFeePayment.Status.VERIFIED, tax_amount__isnull=False).aggregate(total=Sum("tax_amount"))["total"] or Decimal("0")
        delivery_tax_complete = not delivery_payments.filter(status=DeliveryFeePayment.Status.VERIFIED, tax_amount__isnull=True).exists() and not delivery_payments.filter(status=DeliveryFeePayment.Status.VERIFIED, tax_amount__gt=0, tax_configuration__isnull=True).exists()
        tax_complete = unresolved_completed_orders == 0 and tax_source_complete
        complete = tax_complete
        outstanding_delivery = delivery_payments.filter(status=DeliveryFeePayment.Status.PENDING).count()
        partial_delivery = delivery_payments.filter(status=DeliveryFeePayment.Status.PARTIAL).count()
        failed_delivery = delivery_payments.filter(status=DeliveryFeePayment.Status.FAILED).count()
        driver_expenses_complete = not FinancialJournalEntry.objects.filter(
            category="DELIVERY_FEE_EARNING",
            created_at__date__gte=start,
            created_at__date__lte=end,
            reverses__isnull=True,
        ).exclude(source="DELIVERY_FEE_AGREEMENT").exists()
        gross_profit = revenue + delivery_revenue

        net_profit = gross_profit - driver_expenses - operating_total - payroll_total
        profit_complete = False
        return Response({
            "currency": "ETB",
            "period": period,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "filters": {"region": region_id},
            "complete": complete,
            "gmv": str(order_totals["gmv"] or Decimal("0")),
            "platform_revenue": str(revenue + delivery_revenue + other_platform_revenue),
            "commission_revenue": str(revenue),
            "other_platform_revenue": str(other_platform_revenue),
            "farmer_service_fee_revenue": str(commission_by_role.get("FARMER", Decimal("0"))),
            "wholesaler_service_fee_revenue": str(commission_by_role.get("WHOLESALER", Decimal("0"))),
            "retailer_service_fee_revenue": str(commission_by_role.get("RETAILER", Decimal("0"))),
            # Drivers receive freight compensation; the company's freight margin
            # is reported as delivery service revenue, never driver revenue.
            "driver_service_fee_revenue": "0.00",
            "delivery_service_revenue": str(delivery_service_revenue),
            "delivery_collections_collected": str(delivery_collections_collected),
            "delivery_driver_payable": str(delivery_driver_payable),
            "delivery_driver_paid": str(delivery_driver_paid),
            "delivery_tax_collected": str(delivery_tax) if delivery_tax_complete else None,
            "delivery_collections_outstanding": outstanding_delivery + partial_delivery,
            "delivery_collections_partial": partial_delivery,
            "delivery_collections_failed": failed_delivery,
            "delivery_refunds": str(totals.get("ORDER_REFUND", Decimal("0"))),
            "driver_compensation": str(driver_expenses) if driver_expenses_complete else None,
            "driver_expenses": str(driver_expenses) if driver_expenses_complete else None,
            "operating_expenses": str(operating_total),
            "payroll_expenses": str(payroll_total),
            "cost_of_goods_sold": None,
            "tax_collected": None if not tax_complete else str(tax_liabilities),
            "tax_payable": str(tax_liabilities) if tax_complete else None,
            "tax_status_message": (
                "Tax figures include QA or non-authoritative rule postings and are withheld from statutory totals pending Super Admin review."
                if not tax_source_complete else (
                    "Tax treatment is unresolved for completed orders with a positive commission."
                    if unresolved_completed_orders else ""
                )
            ),
            "gross_profit": str(gross_profit) if profit_complete else None,
            "net_profit": str(net_profit) if profit_complete and complete else None,
            "unavailable_figures": ["gross_profit", "net_profit", "cost_of_goods_sold"] + (["tax_collected", "tax_payable"] if not tax_complete else []) + (["driver_compensation"] if not driver_expenses_complete else []) + (["delivery_tax_collected"] if not delivery_tax_complete else []),
            "limitations": ["Gross and net profit remain unavailable until product acquisition costs / cost of goods sold are recorded.", "Driver compensation is a third-party payable until payout; driver payments are not company revenue.", "Delivery service revenue is the approved platform margin from verified delivery collections; customer freight collections and driver compensation are reported separately.", "Tax is reported only where an approved, effective rule applies; no statutory applicability or rate is inferred."],
            "commission_by_seller_role": {key: str(value) for key, value in commission_by_role.items()},
            "unsupported_completed_orders": unresolved_completed_orders,
            "unresolved_completed_orders": unresolved_completed_orders,
            "detail_available": True,
            "transactions": list(entries.select_related("debit_account", "credit_account", "related_user", "payer_user").values("reference", "category", "amount", "currency", "source", "source_reference", "order_reference", "created_at", "debit_account__code", "credit_account__code", "related_user__full_name", "revenue_method", "payer_party", "payer_user__full_name")),
            "orders": list(order_qs.select_related("order", "seller_user").values("order__reference", "seller_role", "seller_user__full_name", "gross_order_value", "commission_rate", "commission_fixed_fee", "commission_amount", "tax_amount", "seller_proceeds", "status", "created_at")),
            # Every fee event in the period: which method charged, what generated
            # it, who paid, what was collected, company earnings and any payable.
            "revenue_charges": list(
                RevenueCharge.objects.filter(
                    created_at__date__gte=start, created_at__date__lte=end
                ).select_related("payer_user", "generating_user", "third_party_payee").values(
                    "reference", "method", "transaction_type", "source_type", "source_reference",
                    "generating_user__full_name", "payer_party", "payer_user__full_name",
                    "amount_charged", "amount_collected", "amount_company_earned",
                    "third_party_payable", "third_party_payee__full_name",
                    "settlement_status", "created_at",
                )
            ),
        })
