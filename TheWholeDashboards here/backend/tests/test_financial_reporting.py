from decimal import Decimal

import pytest
from django.utils import timezone

from payments.financial_models import (
    FinancialAccount,
    FinancialConfiguration,
    FinancialJournalEntry,
    FinancialOrderSnapshot,
)
from payments.models import Order, OrderStatus

pytestmark = pytest.mark.django_db


def _posted_entry(*, reference, category, amount, debit, credit, actor, configuration=None):
    debit_account, _ = FinancialAccount.objects.get_or_create(
        code=debit, defaults={"name": debit, "category": "LIABILITY"}
    )
    credit_account, _ = FinancialAccount.objects.get_or_create(
        code=credit, defaults={"name": credit, "category": "REVENUE"}
    )
    return FinancialJournalEntry.objects.create(
        reference=reference,
        category=category,
        amount=Decimal(amount),
        currency="ETB",
        debit_account=debit_account,
        credit_account=credit_account,
        status=FinancialJournalEntry.Status.POSTED,
        source="QA_REPORT_TEST",
        source_reference=reference,
        idempotency_key=f"qa-report:{reference}",
        actor=actor,
        configuration=configuration,
    )


def test_report_keeps_posted_revenue_visible_and_counts_incomplete_snapshots(
    api, financial_manager, super_admin, order, farmer_product, wholesaler
):
    now = timezone.now()
    order.status = OrderStatus.COMPLETED
    order.updated_at = now
    order.save(update_fields=["status", "updated_at"])
    FinancialOrderSnapshot.objects.create(
        order=order,
        gross_order_value=Decimal("1250.00"),
        seller_role="FARMER",
        seller_user=farmer_product.owner,
        commission_amount=Decimal("10.00"),
        seller_proceeds=Decimal("1250.00"),
        tax_amount=None,
        status=FinancialOrderSnapshot.Status.TAX_UNRESOLVED,
    )

    configuration = FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.COMMISSION,
        name="Report test approved commission",
        version=1,
        status=FinancialConfiguration.Status.APPROVED,
        rules={"rules": []},
        reason="Approved test fixture",
        effective_from=now,
        created_by=super_admin,
        approved_by=super_admin,
        approved_at=now,
    )
    accounted_order = Order.objects.create(
        reference="#ORD900002",
        wholesaler=wholesaler,
        farmer=farmer_product.owner,
        product=farmer_product,
        quantity=20,
        total_amount=Decimal("500.00"),
        status=OrderStatus.COMPLETED,
    )
    FinancialOrderSnapshot.objects.create(
        order=accounted_order,
        configuration=configuration,
        gross_order_value=Decimal("500.00"),
        seller_role="FARMER",
        seller_user=farmer_product.owner,
        commission_amount=Decimal("12.00"),
        seller_proceeds=Decimal("488.00"),
        tax_amount=Decimal("0.00"),
    )
    no_fee_order = Order.objects.create(
        reference="#ORD900003",
        wholesaler=wholesaler,
        farmer=farmer_product.owner,
        product=farmer_product,
        quantity=10,
        total_amount=Decimal("1250.00"),
        status=OrderStatus.COMPLETED,
    )
    FinancialOrderSnapshot.objects.create(
        order=no_fee_order,
        gross_order_value=Decimal("1250.00"),
        seller_role="FARMER",
        seller_user=farmer_product.owner,
        commission_amount=Decimal("0.00"),
        seller_proceeds=Decimal("1250.00"),
        tax_amount=Decimal("0.00"),
        status=FinancialOrderSnapshot.Status.SETTLED,
    )
    _posted_entry(
        reference="qa-report-commission",
        category="MARKETPLACE_COMMISSION",
        amount="12.00",
        debit="LIABILITY:SELLER_WALLET",
        credit="REVENUE:COMMISSION",
        actor=financial_manager,
    )
    _posted_entry(
        reference="qa-report-delivery",
        category="DELIVERY_SERVICE_REVENUE",
        amount="5.00",
        debit="LIABILITY:DELIVERY_SETTLEMENT",
        credit="REVENUE:DELIVERY",
        actor=financial_manager,
    )
    _posted_entry(
        reference="qa-report-advertising",
        category="ADVERTISING_REVENUE",
        amount="300.00",
        debit="LIABILITY:BUYER_WALLET",
        credit="REVENUE:ADVERTISING",
        actor=financial_manager,
    )

    api.force_authenticate(financial_manager)
    response = api.get("/api/v1/payments/financial/report/")

    assert response.status_code == 200
    assert response.data["complete"] is False
    assert response.data["unresolved_completed_orders"] == 1
    assert Decimal(response.data["gmv"]) == Decimal("1750.00")
    assert Decimal(response.data["commission_revenue"]) == Decimal("12.00")
    assert Decimal(response.data["farmer_service_fee_revenue"]) == Decimal("12.00")
    assert Decimal(response.data["wholesaler_service_fee_revenue"]) == Decimal("0.00")
    assert Decimal(response.data["delivery_service_revenue"]) == Decimal("5.00")
    assert Decimal(response.data["platform_revenue"]) == Decimal("317.00")
    assert Decimal(response.data["other_platform_revenue"]) == Decimal("300.00")
    assert response.data["gross_profit"] is None
    assert "gross_profit" in response.data["unavailable_figures"]

    operations = api.get("/api/v1/dashboard/financial-operations/?days=30")
    assert operations.status_code == 200
    assert operations.data["revenue"]["unresolved_order_count"] == 1
    assert Decimal(operations.data["activity"]["orders"]["gmv"]) == Decimal("3000.00")


def test_qa_tax_entries_are_not_reported_as_verified_tax(api, financial_manager, super_admin):
    now = timezone.now()
    qa_tax = FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.TAX,
        name="QA ONLY synthetic tax",
        version=1,
        status=FinancialConfiguration.Status.APPROVED,
        rules={"rules": []},
        reason="QA-only test fixture",
        source="QA ONLY; not an authoritative source",
        source_url="https://example.invalid/qa-tax",
        effective_from=now,
        created_by=super_admin,
        approved_by=super_admin,
        approved_at=now,
    )
    _posted_entry(
        reference="qa-tax-report-test",
        category="TAX_LIABILITY",
        amount="2.00",
        debit="LIABILITY:BUYER_WALLET",
        credit="LIABILITY:TAX_PAYABLE",
        actor=financial_manager,
        configuration=qa_tax,
    )
    api.force_authenticate(financial_manager)
    response = api.get("/api/v1/payments/financial/report/")

    assert response.status_code == 200
    assert response.data["tax_collected"] is None
    assert response.data["tax_payable"] is None
    assert "QA or non-authoritative" in response.data["tax_status_message"]
