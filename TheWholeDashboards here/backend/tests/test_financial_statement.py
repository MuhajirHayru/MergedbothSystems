"""Consolidated financial statement: only real sources, never invented money."""

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from payments.financial_models import (
    DeliveryFeePayment,
    FinancialJournalEntry,
    FinancialOperatingExpense,
    FinancialOrderSnapshot,
    FinancialPayrollRecord,
    FinancialRefundRequest,
)
from payments.models import (
    MarketplaceDeliveryFeeAgreement,
    Order,
    OrderPaymentStatus,
    OrderShipmentDetails,
    Wallet,
)
from registrations.models import AdministrativeLocation, LocationLevel

pytestmark = pytest.mark.django_db


@pytest.fixture
def delivery_agreement(order, financial_manager):
    region = AdministrativeLocation.objects.create(
        source_id="statement-region", name="Statement Region", level=LocationLevel.REGION
    )
    OrderShipmentDetails.objects.create(
        order=order,
        pickup_region=region,
        pickup_address_line="Pickup",
        destination_region=region,
        destination_address_line="Drop",
        cargo_weight_kg="2",
        packaging_details="Crate",
        delivery_fee_proposal_amount="250.00",
        delivery_fee_proposal_version=1,
        buyer_confirmed_revision=1,
        seller_confirmed_revision=1,
        authorized_at=timezone.now(),
        driver_shipment_id=11,
    )
    return MarketplaceDeliveryFeeAgreement.objects.create(
        order=order,
        source_event_id=uuid.uuid4(),
        driver_shipment_id=11,
        driver_proposal_version=1,
        amount="250.00",
        currency="ETB",
        buyer_accepted_at=timezone.now(),
        driver_accepted_at=timezone.now(),
    )


def _journal(amount, category, reference, actor):
    from payments.financial_models import FinancialAccount

    debit, _ = FinancialAccount.objects.get_or_create(
        code=f"DEBIT:{reference}", defaults={"name": "Debit", "category": "ASSET"}
    )
    credit, _ = FinancialAccount.objects.get_or_create(
        code=f"CREDIT:{reference}", defaults={"name": "Credit", "category": "REVENUE"}
    )
    return FinancialJournalEntry.objects.create(
        reference=reference,
        category=category,
        amount=Decimal(amount),
        currency="ETB",
        debit_account=debit,
        credit_account=credit,
        status=FinancialJournalEntry.Status.POSTED,
        source="TEST",
        source_reference=reference,
        idempotency_key=f"test:{reference}",
        actor=actor,
    )


def test_statement_reports_unavailable_instead_of_zero_when_nothing_exists(
    api, financial_manager
):
    api.force_authenticate(financial_manager)
    response = api.get("/api/v1/payments/financial/statement/")

    assert response.status_code == 200
    body = response.data
    assert body["currency"] == "ETB"
    revenue = body["platform_revenue"]
    assert revenue["marketplace_commission"] is None
    assert revenue["delivery_service_fees"] is None
    assert revenue["total"] is None
    assert body["customer_funds"]["wallet_total"] is None
    assert body["customer_funds"]["wallet_accounts"] == 0
    assert body["customer_funds"]["escrow_orders"] == 0
    assert body["driver_compensation"]["payable"] is None
    assert body["operating_expenses"]["pending"] == {"amount": None, "count": 0}
    assert body["payroll"]["recorded"] == {"amount": None, "count": 0}
    assert body["tax"]["posted_liability"] is None
    reasons = {row["field"] for row in body["unavailable"]}
    assert {"seller_payables.pending_release", "tax.paid", "cash.bank_position"} <= reasons


def test_statement_separates_revenue_escrow_and_liabilities(
    api, financial_manager, wholesaler, order, delivery_agreement
):
    wallet = Wallet.objects.get(user=wholesaler)
    wallet.available_balance = Decimal("1000.00")
    wallet.held_balance = Decimal("200.00")
    wallet.save(update_fields=["available_balance", "held_balance"])
    order.payment_status = OrderPaymentStatus.HELD
    order.total_amount = Decimal("1250.00")
    order.save(update_fields=["payment_status", "total_amount"])

    released = Order.objects.create(
        reference="#ORD900777",
        wholesaler=wholesaler,
        product=order.product,
        quantity=10,
        total_amount=Decimal("500.00"),
        status="Completed",
        payment_status=OrderPaymentStatus.RELEASED,
    )
    FinancialOrderSnapshot.objects.create(
        order=released,
        gross_order_value=Decimal("500.00"),
        seller_role="farmer",
        seller_user=order.product.owner,
        commission_amount=Decimal("25.00"),
        seller_proceeds=Decimal("475.00"),
        tax_amount=Decimal("2.50"),
    )
    _journal("25.00", "MARKETPLACE_COMMISSION", "commission:1", financial_manager)
    _journal("7.50", "DELIVERY_SERVICE_REVENUE", "delivery-fee:1", financial_manager)
    _journal("2.50", "TAX_LIABILITY", "tax:1", financial_manager)

    DeliveryFeePayment.objects.create(
        agreement=delivery_agreement,
        pricing_model="A",
        fee_type="FIXED",
        fee_value=Decimal("25.00"),
        customer_amount=Decimal("250.00"),
        driver_charge=Decimal("225.00"),
        platform_fee=Decimal("25.00"),
        payment_reference="STMT-DELIVERY-1",
        status=DeliveryFeePayment.Status.VERIFIED,
    )

    api.force_authenticate(financial_manager)
    body = api.get("/api/v1/payments/financial/statement/").data

    # Revenue is ledger-backed and never includes escrow or seller money.
    assert body["platform_revenue"]["marketplace_commission"] == "25.00"
    assert body["platform_revenue"]["delivery_service_fees"] == "7.50"
    assert body["platform_revenue"]["total"] == "32.50"

    # Customer-held funds are separate.
    assert body["customer_funds"]["wallet_available"] == "1000.00"
    assert body["customer_funds"]["wallet_held"] == "200.00"
    assert body["customer_funds"]["wallet_total"] == "1200.00"
    assert body["customer_funds"]["escrow_held"] == "1250.00"
    assert body["customer_funds"]["escrow_orders"] == 1
    assert body["customer_funds"]["released_order_value"] == "500.00"

    # Seller proceeds are a liability, driver compensation is an expense.
    assert body["seller_payables"]["settled_proceeds"] == "475.00"
    assert body["seller_payables"]["pending_release"] is None
    assert body["driver_compensation"]["payable"] == "225.00"
    assert body["driver_compensation"]["payable_count"] == 1
    assert body["driver_compensation"]["paid"] is None
    assert body["delivery_collections"]["verified"] == "250.00"
    assert body["delivery_collections"]["platform_fee"] == "25.00"

    assert body["tax"]["posted_liability"] == "2.50"
    assert body["tax"]["collected_on_settlements"] == "2.50"


def test_statement_aggregates_expenses_payroll_and_refunds(
    api, financial_manager, order
):
    FinancialOperatingExpense.objects.create(
        category="FUEL", amount=Decimal("100.00"), description="Fuel",
        incurred_on=timezone.localdate(), submitted_by=financial_manager,
    )
    FinancialOperatingExpense.objects.create(
        category="RENT", amount=Decimal("300.00"), description="Rent",
        incurred_on=timezone.localdate(), submitted_by=financial_manager,
        status=FinancialOperatingExpense.Status.APPROVED,
    )
    FinancialPayrollRecord.objects.create(
        employee=financial_manager, period_start=timezone.localdate() - timedelta(days=30),
        period_end=timezone.localdate(), base_amount=Decimal("1000.00"),
        allowances=Decimal("100.00"), deductions=Decimal("50.00"),
        tax_amount=Decimal("30.00"), prepared_by=financial_manager,
        status=FinancialPayrollRecord.Status.PENDING,
    )
    FinancialRefundRequest.objects.create(
        order=order, amount=Decimal("75.00"), reason="Damaged", submitted_by=financial_manager,
    )

    api.force_authenticate(financial_manager)
    body = api.get("/api/v1/payments/financial/statement/").data

    assert body["operating_expenses"]["pending"] == {"amount": "100.00", "count": 1}
    assert body["operating_expenses"]["approved_outstanding"] == {"amount": "300.00", "count": 1}
    assert body["payroll"]["pending"] == {"amount": "1020.00", "count": 1}
    assert body["payroll"]["recorded"] == {"amount": "1100.00", "count": 1}
    assert body["refunds"]["pending"] == {"amount": "75.00", "count": 1}
    assert body["refunds"]["paid"] == {"amount": None, "count": 0}


def test_statement_is_finance_only_and_validates_dates(api, wholesaler, financial_manager):
    api.force_authenticate(wholesaler)
    assert api.get("/api/v1/payments/financial/statement/").status_code == 403

    api.force_authenticate(financial_manager)
    bad = api.get("/api/v1/payments/financial/statement/", {"start": "not-a-date"})
    assert bad.status_code == 400
    assert bad.data["success"] is False
    ok = api.get("/api/v1/payments/financial/statement/", {"start": "2026-01-01", "end": "2026-12-31"})
    assert ok.status_code == 200
    assert ok.data["period"] == {"start": "2026-01-01", "end": "2026-12-31"}
