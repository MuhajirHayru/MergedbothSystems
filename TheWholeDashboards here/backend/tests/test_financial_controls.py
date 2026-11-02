from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone

from payments.financial_models import (
    FinancialAccount,
    FinancialConfiguration,
    FinancialJournalEntry,
    FinancialOperatingExpense,
    FinancialPayrollRecord,
    DeliveryPricingConfiguration,
    DeliveryFeePayment,
)
from users.models import AuditLog, Role

pytestmark = pytest.mark.django_db


def test_configuration_draft_is_versioned_and_super_admin_approves(api, financial_manager, super_admin):
    api.force_authenticate(financial_manager)
    response = api.post("/api/v1/payments/financial/configurations/", {
        "kind": "COMMISSION", "name": "Commission draft", "rules": {"rate": "PROVISIONAL"},
        "reason": "Needs approval", "effective_from": timezone.now().isoformat(),
    }, format="json")
    assert response.status_code == 201
    assert response.data["version"] == 1
    assert response.data["status"] == "DRAFT"
    config = FinancialConfiguration.objects.get(pk=response.data["id"])
    api.force_authenticate(super_admin)
    approved = api.post(f"/api/v1/payments/financial/configurations/{config.pk}/approve/", {}, format="json")
    assert approved.status_code == 200
    config.refresh_from_db()
    assert config.status == FinancialConfiguration.Status.APPROVED
    assert config.approved_by == super_admin
    assert AuditLog.objects.filter(action="FINANCIAL_CONFIGURATION_APPROVED", target=str(config.pk)).exists()


def test_tax_configuration_requires_authoritative_source_and_url(api, financial_manager, super_admin):
    api.force_authenticate(financial_manager)
    response = api.post("/api/v1/payments/financial/configurations/", {
        "kind": "TAX", "name": "Tax proposal", "rules": {"rate": "PROVISIONAL"},
        "reason": "Awaiting verified law", "effective_from": timezone.now().isoformat(),
    }, format="json")
    assert response.status_code == 201
    api.force_authenticate(super_admin)
    approved = api.post(f"/api/v1/payments/financial/configurations/{response.data['id']}/approve/", {}, format="json")
    assert approved.status_code == 400


def test_financial_controls_deny_regular_marketplace_user(api, wholesaler):
    api.force_authenticate(wholesaler)
    response = api.get("/api/v1/payments/financial/ledger/")
    assert response.status_code == 403


def test_expense_review_requires_reason_and_pay_creates_idempotent_journal(api, financial_manager, super_admin):
    expense = FinancialOperatingExpense.objects.create(
        category="OFFICE", amount=Decimal("125.00"), description="Office materials",
        incurred_on=date.today(), submitted_by=financial_manager,
    )
    api.force_authenticate(super_admin)
    rejected = api.post(f"/api/v1/payments/financial/expenses/{expense.pk}/review/", {"action": "reject"}, format="json")
    assert rejected.status_code == 400
    approved = api.post(f"/api/v1/payments/financial/expenses/{expense.pk}/review/", {"action": "approve"}, format="json")
    assert approved.status_code == 200
    paid = api.post(f"/api/v1/payments/financial/expenses/{expense.pk}/review/", {"action": "pay", "payment_reference": "verified-payment-001"}, format="json")
    assert paid.status_code == 200, paid.data
    expense.refresh_from_db()
    assert expense.status == FinancialOperatingExpense.Status.PAID
    assert FinancialJournalEntry.objects.filter(idempotency_key=f"expense:{expense.pk}").count() == 1
    assert paid.data["journal_entry"]


def test_payroll_needs_separate_super_admin_approval_then_payment(api, financial_manager, super_admin, farmer):
    payroll = FinancialPayrollRecord.objects.create(
        employee=farmer, period_start=date.today() - timedelta(days=30), period_end=date.today(),
        base_amount=Decimal("1000.00"), prepared_by=financial_manager,
    )
    api.force_authenticate(financial_manager)
    submitted = api.post(f"/api/v1/payments/financial/payroll/{payroll.pk}/action/", {"action": "submit"}, format="json")
    assert submitted.status_code == 200
    api.force_authenticate(super_admin)
    approved = api.post(f"/api/v1/payments/financial/payroll/{payroll.pk}/action/", {"action": "approve"}, format="json")
    assert approved.status_code == 200
    paid = api.post(f"/api/v1/payments/financial/payroll/{payroll.pk}/action/", {"action": "pay", "payment_reference": "payroll-ref-001"}, format="json")
    assert paid.status_code == 200
    payroll.refresh_from_db()
    assert payroll.status == FinancialPayrollRecord.Status.PAID
    assert payroll.journal_entry.amount == Decimal("1000.00")


@pytest.fixture
def priced_agreement(order, super_admin):
    import uuid
    from payments.financial_models import DeliveryPricingConfiguration
    from payments.models import MarketplaceDeliveryFeeAgreement, OrderShipmentDetails
    from registrations.models import AdministrativeLocation, LocationLevel
    region = AdministrativeLocation.objects.create(source_id="pricing-region", name="Pricing Region", level=LocationLevel.REGION)
    from django.utils import timezone
    OrderShipmentDetails.objects.create(order=order, pickup_region=region, pickup_address_line="P", destination_region=region, destination_address_line="D", cargo_weight_kg="2", packaging_details="Crate", delivery_fee_proposal_amount="250.00", delivery_fee_proposal_version=1, buyer_confirmed_revision=1, seller_confirmed_revision=1, authorized_at=timezone.now(), driver_shipment_id=7)
    agreement = MarketplaceDeliveryFeeAgreement.objects.create(order=order, source_event_id=uuid.uuid4(), driver_shipment_id=7, driver_proposal_version=1, amount="250.00", currency="ETB", buyer_accepted_at=timezone.now(), driver_accepted_at=timezone.now())
    from django.utils import timezone
    config = DeliveryPricingConfiguration.objects.create(
        name="Verified delivery fee split", pricing_model=DeliveryPricingConfiguration.Model.PLATFORM_RETAINED,
        fee_type=DeliveryPricingConfiguration.FeeType.FIXED, fee_value="25.00", maximum_fee="50.00",
        region=region, effective_from=timezone.now() - timezone.timedelta(minutes=1), created_by=super_admin, approved_by=super_admin, approved_at=timezone.now(),
    )
    return agreement, config


def test_delivery_provider_verification_checks_reference_amount_currency_and_mode(monkeypatch, priced_agreement, settings):
    from payments.chapa import verify_delivery_transaction
    agreement, config = priced_agreement
    payment = DeliveryFeePayment.objects.create(agreement=agreement, pricing_configuration=config, pricing_model=config.pricing_model, fee_type=config.fee_type, fee_value=config.fee_value, customer_amount=Decimal("250.00"), driver_charge=Decimal("225.00"), platform_fee=Decimal("25.00"), payment_reference="DELIVERY-PROVIDER-001")
    settings.CHAPA_TEST_MODE = True
    settings.CHAPA_SECRET_KEY = "CHASECK_TEST-unit-test-key"
    valid = {"status": "success", "data": {"status": "success", "tx_ref": payment.payment_reference, "amount": "250.00", "currency": "ETB", "mode": "test", "id": "txn-1"}}
    monkeypatch.setattr("payments.chapa._chapa_request", lambda method, path: valid)
    assert verify_delivery_transaction(payment)["evidence_reference"] == "chapa:txn-1"
    for key, value in (("tx_ref", "another-ref"), ("currency", "USD"), ("mode", "live"), ("status", "pending")):
        invalid = {"status": "success", "data": {**valid["data"], key: value}}
        monkeypatch.setattr("payments.chapa._chapa_request", lambda method, path, response=invalid: response)
        assert verify_delivery_transaction(payment) is None


def test_model_a_delivery_payment_verification_posts_balanced_components(api, financial_manager, super_admin, priced_agreement, monkeypatch):
    from payments.financial_services import create_delivery_payment
    agreement, config = priced_agreement
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-A-001")
    assert payment.customer_amount == Decimal("250.00")
    assert payment.driver_charge == Decimal("225.00")
    assert payment.platform_fee == Decimal("25.00")
    assert payment.status == DeliveryFeePayment.Status.PENDING
    monkeypatch.setattr("payments.chapa.verify_delivery_transaction", lambda item: {"amount": item.customer_amount, "evidence_reference": "chapa:txn-1"})
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-A-001", evidence_reference="chapa-verify")
    assert payment.status == DeliveryFeePayment.Status.VERIFIED
    entries = FinancialJournalEntry.objects.filter(source_reference="DELIVERY-A-001")
    assert set(entries.values_list("category", flat=True)) == {"DELIVERY_CUSTOMER_PAYMENT", "DELIVERY_DRIVER_COMPENSATION", "DELIVERY_SERVICE_REVENUE"}
    assert sum((entry.amount for entry in entries if entry.category != "DELIVERY_CUSTOMER_PAYMENT"), Decimal("0")) == payment.customer_amount
    assert payment.tax_configuration is None
    assert payment.tax_amount is None


def test_delivery_pricing_snapshot_is_immutable_after_rule_change(financial_manager, priced_agreement):
    from payments.financial_services import create_delivery_payment
    agreement, config = priced_agreement
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-SNAPSHOT")
    agreement.refresh_from_db()
    assert agreement.pricing_model_snapshot == DeliveryPricingConfiguration.Model.PLATFORM_RETAINED
    assert agreement.driver_charge_snapshot == Decimal("225.00")
    config.pricing_model = DeliveryPricingConfiguration.Model.SEPARATE_FEE
    with pytest.raises(DjangoValidationError, match="immutable"):
        config.save(update_fields=["pricing_model"])
    payment.refresh_from_db()
    assert payment.customer_amount == Decimal("250.00")


def test_model_b_delivery_price_separates_customer_fee(api, financial_manager, super_admin, priced_agreement):
    from payments.financial_services import create_delivery_payment
    agreement, config = priced_agreement
    config.pricing_model = DeliveryPricingConfiguration.Model.SEPARATE_FEE
    config.save(update_fields=["pricing_model"])
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-B-001")
    assert payment.driver_charge == Decimal("250.00")
    assert payment.platform_fee == Decimal("25.00")
    assert payment.customer_amount == Decimal("275.00")


def test_delivery_pricing_respects_effective_date_and_scope(financial_manager, priced_agreement, super_admin):
    from payments.financial_services import resolve_delivery_pricing
    from payments.financial_models import DeliveryPricingConfiguration
    from payments.models import MarketplaceDeliveryFeeAgreement
    agreement, config = priced_agreement
    config.effective_from = agreement.buyer_accepted_at + timezone.timedelta(days=1)
    config.save()
    with pytest.raises(ValueError, match="No approved effective"):
        resolve_delivery_pricing(agreement=agreement, actor=super_admin)
    config.effective_from = agreement.buyer_accepted_at - timezone.timedelta(minutes=1)
    config.save()
    details = agreement.order.shipment_details
    assert resolve_delivery_pricing(agreement=agreement, actor=super_admin).pk == config.pk
    DeliveryPricingConfiguration.objects.create(name="Same scope conflict", pricing_model=config.pricing_model, fee_type=config.fee_type, fee_value="10.00", maximum_fee="50.00", region=config.region, effective_from=config.effective_from, created_by=super_admin, approved_by=super_admin, approved_at=timezone.now())
    with pytest.raises(ValueError, match="equal precedence"):
        resolve_delivery_pricing(agreement=agreement, actor=super_admin)


def test_delivery_pricing_uses_fixed_and_percentage_with_minimum_and_maximum(financial_manager, priced_agreement, super_admin):
    from payments.financial_services import resolve_delivery_pricing
    from payments.financial_models import DeliveryPricingConfiguration
    agreement, config = priced_agreement
    config.fee_type = DeliveryPricingConfiguration.FeeType.PERCENTAGE
    config.fee_value = Decimal("20.0000")
    config.minimum_fee = Decimal("30.00")
    config.maximum_fee = Decimal("40.00")
    config.save()
    resolved = resolve_delivery_pricing(agreement=agreement, actor=super_admin)
    assert resolved.pk == config.pk
    fee = min(config.maximum_fee, max(config.minimum_fee, (agreement.amount * config.fee_value / Decimal("100")).quantize(Decimal("0.01"))))
    assert fee == Decimal("40.00")
    config.fee_value = Decimal("1.0000")
    config.save()
    fee = min(config.maximum_fee, max(config.minimum_fee, (agreement.amount * config.fee_value / Decimal("100")).quantize(Decimal("0.01"))))
    assert fee == Decimal("30.00")


def test_duplicate_delivery_payment_reference_is_idempotent(financial_manager, priced_agreement):
    from payments.financial_services import create_delivery_payment
    agreement, _ = priced_agreement
    first = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-DUPLICATE")
    second = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-DUPLICATE")
    assert first.pk == second.pk
    assert DeliveryFeePayment.objects.filter(payment_reference="DELIVERY-DUPLICATE").count() == 1


def test_delivery_compensation_payment_is_idempotent_and_auditable(api, financial_manager, super_admin, priced_agreement, monkeypatch):
    from payments.financial_services import create_delivery_payment, pay_delivery_compensation
    agreement, config = priced_agreement
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-PAYOUT-COLLECT")
    monkeypatch.setattr("payments.chapa.verify_delivery_transaction", lambda item: {"amount": item.customer_amount, "evidence_reference": "chapa:paid"})
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-PAYOUT-COLLECT", evidence_reference="chapa-verify")
    with pytest.raises(ValueError, match="Super Admin"):
        pay_delivery_compensation(payment.pk, actor=financial_manager, payment_reference="bank-payout-001")
    paid = pay_delivery_compensation(payment.pk, actor=super_admin, payment_reference="bank-payout-001")
    assert paid.compensation_journal_entry.amount == Decimal("225.00")
    assert pay_delivery_compensation(payment.pk, actor=super_admin, payment_reference="bank-payout-001").pk == payment.pk
    with pytest.raises(ValueError, match="different reference"):
        pay_delivery_compensation(payment.pk, actor=super_admin, payment_reference="bank-payout-002")
    assert FinancialJournalEntry.objects.filter(source="DELIVERY_DRIVER_PAYOUT", source_reference=payment.payment_reference).count() == 1
    api.force_authenticate(financial_manager)
    report = api.get("/api/v1/payments/financial/report/")
    assert report.data["delivery_driver_payable"] == "0"
    assert Decimal(report.data["delivery_driver_paid"]) == Decimal("225.00")


def test_delivery_payment_cannot_be_manually_verified(financial_manager, priced_agreement):
    from payments.financial_services import create_delivery_payment
    agreement, _ = priced_agreement
    with pytest.raises(ValueError, match="Chapa|caller-supplied"):
        create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-MANUAL", verified_amount="250.00", evidence_reference="forged")
    assert not FinancialJournalEntry.objects.filter(source_reference="DELIVERY-MANUAL").exists()


def test_delivery_partial_payment_does_not_post_revenue(financial_manager, priced_agreement, monkeypatch):
    from payments.financial_services import create_delivery_payment
    agreement, _ = priced_agreement
    monkeypatch.setattr("payments.chapa.verify_delivery_transaction", lambda item: {"amount": Decimal("100.00"), "evidence_reference": "chapa:partial"})
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-PARTIAL", evidence_reference="chapa-verify")
    assert payment.status == DeliveryFeePayment.Status.PARTIAL
    assert not FinancialJournalEntry.objects.filter(source_reference="DELIVERY-PARTIAL").exists()


def test_delivery_tax_uses_approved_source_backed_configuration(financial_manager, super_admin, priced_agreement):
    from payments.financial_services import create_delivery_payment
    agreement, config = priced_agreement
    tax = FinancialConfiguration.objects.create(kind=FinancialConfiguration.Kind.TAX, name="Approved delivery tax", version=1, status=FinancialConfiguration.Status.APPROVED, rules={"rules": [{"seller_role": "DRIVER", "product_type": agreement.order.product.product_type, "region_id": str(agreement.order.shipment_details.pickup_region_id), "rate": "0.10", "tax_base": "25.00"}]}, source="Tax authority", source_url="https://tax.example/rule", reason="Approved tax rule", effective_from=agreement.buyer_accepted_at - timezone.timedelta(days=1), created_by=super_admin, approved_by=super_admin, approved_at=timezone.now())
    from payments.financial_services import snapshot_delivery_pricing
    snapshot_delivery_pricing(agreement)
    from payments.models import MarketplaceDeliveryFeeAgreement
    agreement.refresh_from_db()
    assert agreement.pricing_configuration_snapshot["tax_rule"]["tax_base"] == "25.00"
    payment = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-TAX-001")
    assert payment.tax_configuration == tax
    assert payment.tax_amount == Decimal("2.50")
    assert payment.platform_fee == Decimal("22.50")
    assert payment.driver_charge + payment.platform_fee + payment.tax_amount == payment.customer_amount
    assert agreement.pricing_configuration_snapshot["tax_configuration_id"] == str(tax.pk)
    assert agreement.pricing_configuration_snapshot["tax_amount"] == "2.50"
    tax.rules = {"rules": []}
    tax.save(update_fields=["rules"])
    second = create_delivery_payment(agreement=agreement, actor=financial_manager, payment_reference="DELIVERY-TAX-002")
    assert second.tax_amount == Decimal("2.50")
    assert second.tax_configuration_id == tax.pk


def test_refund_workflow_covers_partial_failure_duplicate_and_total_limit(api, order, financial_manager, super_admin):
    from payments.financial_models import FinancialOrderSnapshot, FinancialRefundRequest
    from payments.financial_services import process_financial_refund
    snapshot = FinancialOrderSnapshot.objects.create(order=order, gross_order_value=Decimal("1000.00"), seller_proceeds=Decimal("1000.00"))
    original = FinancialJournalEntry.objects.create(reference="refund-source-escrow", idempotency_key="refund-source-escrow", category="ESCROW_RELEASE", amount=Decimal("1000.00"), debit_account=FinancialAccount.objects.create(code="REFUND-SRC-ASSET", name="Clearing", category="ASSET"), credit_account=FinancialAccount.objects.create(code="REFUND-SRC-LIAB", name="Seller", category="LIABILITY"), source="ORDER_ESCROW", source_reference=order.reference, order_reference=order.reference, actor=super_admin)
    failed = FinancialRefundRequest.objects.create(order=order, amount=Decimal("200.00"), reason="Partial failure", submitted_by=financial_manager)
    process_financial_refund(failed.pk, actor=super_admin, action="approve")
    process_financial_refund(failed.pk, actor=super_admin, action="execute", reference="refund-failed-1", successful=False)
    failed.refresh_from_db()
    assert failed.status == FinancialRefundRequest.Status.FAILED
    with pytest.raises(ValueError, match="Only pending"):
        process_financial_refund(failed.pk, actor=super_admin, action="approve")
    first = FinancialRefundRequest.objects.create(order=order, amount=Decimal("600.00"), reason="First partial refund", submitted_by=financial_manager)
    process_financial_refund(first.pk, actor=super_admin, action="approve")
    paid = process_financial_refund(first.pk, actor=super_admin, action="execute", reference="refund-paid-1", successful=True)
    assert paid.status == FinancialRefundRequest.Status.PAID
    assert FinancialJournalEntry.objects.filter(source_reference=str(first.pk), category="ORDER_REFUND").count() == 1
    with pytest.raises(ValueError, match="Approved refunds"):
        process_financial_refund(first.pk, actor=super_admin, action="execute", reference="refund-paid-1", successful=True)
    second = FinancialRefundRequest.objects.create(order=order, amount=Decimal("500.00"), reason="Exceeds balance", submitted_by=financial_manager)
    with pytest.raises(ValueError, match="remaining settled"):
        process_financial_refund(second.pk, actor=super_admin, action="approve")


def test_financial_report_marks_unknown_tax_and_profit_unavailable(api, financial_manager):
    api.force_authenticate(financial_manager)
    response = api.get("/api/v1/payments/financial/report/")
    assert response.status_code == 200
    assert response.data["tax_collected"] == "0"
    assert response.data["tax_payable"] == "0"
    assert response.data["gross_profit"] is None
    assert response.data["net_profit"] is None
    assert "cost_of_goods_sold" in response.data["unavailable_figures"]


def test_journal_entries_are_immutable_and_balanced_debits_credits(api, super_admin):
    debit = FinancialAccount.objects.create(code="TEST-ASSET", name="Test asset", category="ASSET")
    credit = FinancialAccount.objects.create(code="TEST-REV", name="Test revenue", category="REVENUE")
    entry = FinancialJournalEntry.objects.create(
        reference="test-entry-immutable", idempotency_key="test-entry-immutable",
        category="TEST", amount=Decimal("10.00"), debit_account=debit,
        credit_account=credit, source="TEST", source_reference="test-source", actor=super_admin,
    )
    assert entry.amount == Decimal("10.00")
    assert entry.debit_account_id != entry.credit_account_id
    entry.amount = Decimal("20.00")
    with pytest.raises(DjangoValidationError):
        entry.save()
    with pytest.raises(DjangoValidationError):
        entry.delete()
