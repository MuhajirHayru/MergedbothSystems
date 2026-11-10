"""Revenue methods engine — payer responsibility, earnings and third-party payables."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from payments.financial_models import (
    AdvertisingPackage,
    DeliveryFeePayment,
    FinancialConfiguration,
    FinancialJournalEntry,
    FinancialOrderSnapshot,
    RevenueCharge,
    RevenueMethod,
    RevenueSourceConfig,
    SubscriptionPlan,
    UserSubscription,
)
from payments.financial_services import post_completed_order
from payments.models import (
    BusinessAgreement,
    MarketplaceDeliveryFeeAgreement,
    Order,
    OrderPaymentStatus,
    OrderStatus,
)
from payments.revenue_engine import (
    active_methods,
    apply_freight_revenue,
    apply_order_revenue_methods,
    apply_subscription_revenue,
    freight_settlement_row,
    purchase_advertising_package,
    quintals,
    record_charge,
)
from tests.conftest import make_user
from users.models import Role

pytestmark = pytest.mark.django_db

METHODS_URL = "/api/v1/payments/financial/revenue-methods/"
CHARGES_URL = "/api/v1/payments/financial/revenue-charges/"
SOURCES_URL = "/api/v1/payments/financial/revenue-sources/"


def _source(source, *, enabled=True, percentage="0", fixed="0"):
    config, _ = RevenueSourceConfig.objects.update_or_create(
        source=source,
        defaults={
            "enabled": enabled,
            "default_percentage_rate": Decimal(percentage),
            "default_fixed_fee": Decimal(fixed),
        },
    )
    return config


def _method(super_admin, *, transaction_type, method, payer, calculation="PERCENTAGE",
            rate="0", fixed_fee="0", unit_fee="0", seller_rate="0", seller_fixed_fee="0",
            buyer_rate="0", buyer_fixed_fee="0", company_share="100", requires_agreement=True):
    now = timezone.now()
    return RevenueMethod.objects.create(
        transaction_type=transaction_type, method=method,
        name=f"{method} · {payer}", payer=payer, calculation=calculation,
        rate=Decimal(rate), fixed_fee=Decimal(fixed_fee), unit_fee=Decimal(unit_fee),
        seller_rate=Decimal(seller_rate), seller_fixed_fee=Decimal(seller_fixed_fee),
        buyer_rate=Decimal(buyer_rate), buyer_fixed_fee=Decimal(buyer_fixed_fee),
        company_share_percentage=Decimal(company_share),
        requires_agreement=requires_agreement,
        effective_from=now - timedelta(days=1),
        created_by=super_admin, approved_by=super_admin, approved_at=now,
    )


def _commission_config(super_admin, *, rate="0.02", buyer_rate="0.01"):
    now = timezone.now()
    return FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.COMMISSION,
        name="Revenue method commission", version=int(now.timestamp()) % 100000,
        status=FinancialConfiguration.Status.APPROVED,
        rules={"rules": [{
            "rule_id": "rm-base", "enabled": True, "calculation": "percentage",
            "rate": rate, "buyer_fee_calculation": "percentage", "buyer_fee_rate": buyer_rate,
            "fee_payer": "buyer",
        }]},
        reason="Revenue method tests", effective_from=now - timedelta(days=1),
        created_by=super_admin, approved_by=super_admin, approved_at=now,
    )


def _settled_order(wholesaler, farmer_product, *, reference="#ORD-RM-1", with_agreement=True):
    order = Order.objects.create(
        reference=reference, wholesaler=wholesaler, farmer=farmer_product.owner,
        product=farmer_product, quantity=100, total_amount=300000, status="Processing",
    )
    if with_agreement:
        BusinessAgreement.objects.create(order=order, terms="Approved marketplace terms")
    Order.objects.filter(pk=order.pk).update(
        status=OrderStatus.COMPLETED, payment_status=OrderPaymentStatus.RELEASED,
        quality_confirmed_at=timezone.now(),
    )
    order.refresh_from_db()
    return order


def _settled_resale_order(wholesaler, retailer, wholesaler_product, *, reference="#ORD-RM-B"):
    """Wholesaler -> retailer/reseller: the wholesaler is now the seller."""
    order = Order.objects.create(
        reference=reference, wholesaler=wholesaler, retailer=retailer,
        product=wholesaler_product, quantity=100, total_amount=200000, status="Processing",
    )
    BusinessAgreement.objects.create(order=order, terms="Approved resale terms")
    Order.objects.filter(pk=order.pk).update(
        status=OrderStatus.COMPLETED, payment_status=OrderPaymentStatus.RELEASED,
        quality_confirmed_at=timezone.now(),
    )
    order.refresh_from_db()
    return order


def _freight_payment(order, driver, *, platform_fee="60.00", driver_charge="200.00"):
    agreement = MarketplaceDeliveryFeeAgreement.objects.create(
        order=order, source_event_id=uuid.uuid4(), driver_shipment_id=41,
        driver_payee=driver, driver_proposal_version=1, amount=Decimal("200.00"),
        buyer_accepted_at=timezone.now(), driver_accepted_at=timezone.now(),
        pricing_model_snapshot="A",
        platform_fee_snapshot=Decimal(platform_fee), driver_charge_snapshot=Decimal(driver_charge),
    )
    return DeliveryFeePayment.objects.create(
        agreement=agreement, pricing_model="A", fee_type="FIXED", fee_value=Decimal("60.0000"),
        customer_amount=Decimal(platform_fee) + Decimal(driver_charge),
        driver_charge=Decimal(driver_charge), platform_fee=Decimal(platform_fee),
        payment_reference=f"DLV-{uuid.uuid4().hex[:8]}", status=DeliveryFeePayment.Status.VERIFIED,
    )


# ------------------------------------------------------------------ seller pays

def test_seller_commission_is_recorded_with_payer_and_not_double_posted(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="SELLER")
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)

    charges = RevenueCharge.objects.filter(source_reference=order.reference)
    commission = charges.get(method="SELLER_COMMISSION")
    assert commission.payer_party == RevenueCharge.PayerParty.SELLER
    assert commission.payer_user_id == farmer_product.owner_id
    assert commission.generating_user_id == farmer_product.owner_id
    assert commission.amount_charged == Decimal("6000.00")
    assert commission.amount_collected == Decimal("6000.00")
    assert commission.amount_company_earned == Decimal("6000.00")
    assert commission.third_party_payable == Decimal("0.00")
    assert commission.settlement_status == RevenueCharge.SettlementStatus.COLLECTED
    assert commission.agreement_reference
    # No duplicate ledger posting for the same commission.
    assert FinancialJournalEntry.objects.filter(category="MARKETPLACE_COMMISSION").count() == 1
    entry = commission.journal_entry
    assert entry.revenue_method == "SELLER_COMMISSION"
    assert entry.payer_party == "SELLER"


# ------------------------------------------------------------------- buyer pays

def test_buyer_commission_assigns_buyer_as_payer(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="BUYER_COMMISSION", payer="BUYER")
    from payments.models import Wallet
    wallet = Wallet.objects.get(user=wholesaler)
    balance_before = wallet.available_balance
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)

    charge = RevenueCharge.objects.get(method="BUYER_COMMISSION")
    assert charge.payer_party == RevenueCharge.PayerParty.BUYER
    assert charge.payer_user_id == wholesaler.id
    assert charge.amount_charged == Decimal("3000.00")
    assert charge.amount_collected == Decimal("3000.00")
    wallet.refresh_from_db()
    assert wallet.available_balance == balance_before - Decimal("3000.00")
    assert FinancialJournalEntry.objects.filter(category="MARKETPLACE_BUYER_FEE").count() == 1


def test_commission_payer_controls_the_wallet_debited_and_ledger_payer(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="BUYER")
    from payments.models import Wallet
    wallet = Wallet.objects.get(user=wholesaler)
    balance_before = wallet.available_balance
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-PAYER")
    post_completed_order(order, actor=super_admin)

    charge = RevenueCharge.objects.get(method="SELLER_COMMISSION")
    assert charge.payer_user_id == wholesaler.id
    assert charge.payer_party == RevenueCharge.PayerParty.BUYER
    assert charge.journal_entry.debit_account.code == "LIABILITY:BUYER_WALLET"
    assert charge.journal_entry.related_user_id == wholesaler.id
    assert charge.journal_entry.payer_user_id == wholesaler.id
    wallet.refresh_from_db()
    assert wallet.available_balance == balance_before - Decimal("6000.00")


def test_revenue_method_overrides_legacy_buyer_fee_payer_flag(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="BUYER_COMMISSION", payer="SELLER")
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-BUYER-FEE-PAYER")
    post_completed_order(order, actor=super_admin)

    charge = RevenueCharge.objects.get(method="BUYER_COMMISSION")
    assert charge.amount_charged == Decimal("3000.00")
    assert charge.payer_party == RevenueCharge.PayerParty.SELLER
    assert charge.payer_user_id == farmer_product.owner_id
    assert charge.journal_entry.debit_account.code == "LIABILITY:SELLER_WALLET"
    assert charge.journal_entry.payer_user_id == farmer_product.owner_id


def test_commission_tax_follows_the_commission_payer(super_admin, wholesaler, farmer_product):
    from datetime import timedelta
    from payments.financial_models import FinancialConfiguration
    from payments.models import Wallet

    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="BUYER")
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-TAX-PAYER")
    tax_effective_at = order.quality_confirmed_at
    FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.TAX, name="Approved test tax", version=1,
        status=FinancialConfiguration.Status.APPROVED,
        rules={"rules": [{"seller_role": "FARMER", "buyer_role": "WHOLESALER", "rate": "0.10"}]},
        source="Test authority", source_url="https://tax.example.test/rule", reason="Test only",
        effective_from=tax_effective_at - timedelta(days=1), created_by=super_admin,
        approved_by=super_admin, approved_at=tax_effective_at - timedelta(seconds=1),
    )
    wallet = Wallet.objects.get(user=wholesaler)
    balance_before = wallet.available_balance
    post_completed_order(order, actor=super_admin)

    tax_entry = FinancialJournalEntry.objects.get(category="TAX_LIABILITY", source_reference=order.reference)
    assert tax_entry.amount == Decimal("600.00")
    assert tax_entry.debit_account.code == "LIABILITY:BUYER_WALLET"
    assert tax_entry.payer_user_id == wholesaler.id
    wallet.refresh_from_db()
    assert wallet.available_balance == balance_before - Decimal("6600.00")


def test_insufficient_non_seller_payer_balance_rolls_back_commission(super_admin, wholesaler, farmer_product):
    from payments.models import Wallet
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="BUYER")
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-INSUFFICIENT")
    Wallet.objects.filter(user=wholesaler).update(available_balance=Decimal("5.00"))

    with pytest.raises(ValueError, match="insufficient available wallet funds"):
        post_completed_order(order, actor=super_admin)

    assert not FinancialOrderSnapshot.objects.filter(order=order).exists()
    assert not RevenueCharge.objects.filter(source_reference=order.reference).exists()
    assert not FinancialJournalEntry.objects.filter(source_reference=order.reference, category="MARKETPLACE_COMMISSION").exists()
    assert Wallet.objects.get(user=wholesaler).available_balance == Decimal("5.00")


def test_commission_rule_without_revenue_method_does_not_charge(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-NOMETHOD")
    snapshot = post_completed_order(order, actor=super_admin)
    assert snapshot.commission_amount == Decimal("0.00")
    assert not FinancialJournalEntry.objects.filter(source_reference=order.reference, category="MARKETPLACE_COMMISSION").exists()
    assert not RevenueCharge.objects.filter(source_reference=order.reference).exists()


def test_settlement_receipt_shows_order_fee_payer_and_ledger(api, super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="SELLER")
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="BUYER_COMMISSION", payer="BUYER")
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-RECEIPT")
    snapshot = post_completed_order(order, actor=super_admin)

    api.force_authenticate(user=wholesaler)
    response = api.get(f"/api/v1/orders/{order.pk}/receipt/")

    assert response.status_code == 200, response.data
    receipt = response.data["receipt"]
    assert receipt["receipt_id"] == "ORDER-ORD-RM-RECEIPT"
    assert receipt["order_reference"] == order.reference
    assert receipt["buyer"]["id"] == str(wholesaler.pk)
    assert receipt["seller"]["id"] == str(farmer_product.owner.pk)
    assert receipt["commission"] == "6000.00"
    assert receipt["buyer_fee"] == "3000.00"
    assert receipt["seller_proceeds"] == str(snapshot.seller_proceeds)
    assert {fee["payer"] for fee in receipt["fees"]} == {"SELLER", "BUYER"}
    assert all(fee["ledger_reference"] for fee in receipt["fees"])


def test_revenue_method_approved_after_order_event_is_not_applied_retroactively(
    super_admin, wholesaler, farmer_product,
):
    """Backdated effective dates cannot make later approvals charge old orders."""
    _commission_config(super_admin)
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-LATE-APPROVAL")
    # The method's effective_from is backdated by _method, but its approved_at
    # timestamp is after the order's quality-confirmation event.
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER",
        method="SELLER_COMMISSION", payer="SELLER",
    )

    snapshot = post_completed_order(order, actor=super_admin)

    assert snapshot.commission_amount == Decimal("0.00")
    assert not RevenueCharge.objects.filter(source_reference=order.reference).exists()


# ---------------------------------------------------------------- both pay

def test_both_parties_pay_separately_configured_amounts(super_admin, wholesaler, farmer_product):
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BOTH", calculation="FIXED", seller_fixed_fee="100", buyer_fixed_fee="250",
    )
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)

    charges = {c.payer_party: c for c in RevenueCharge.objects.filter(method="FIXED_TRANSACTION_FEE")}
    assert set(charges) == {RevenueCharge.PayerParty.SELLER, RevenueCharge.PayerParty.BUYER}
    assert charges[RevenueCharge.PayerParty.SELLER].amount_charged == Decimal("100.00")
    assert charges[RevenueCharge.PayerParty.BUYER].amount_charged == Decimal("250.00")
    assert charges[RevenueCharge.PayerParty.BUYER].payer_user_id == wholesaler.id


# ------------------------------------------------------ requesting party pays

def test_requesting_party_pays_the_inspection_fee(super_admin, wholesaler, farmer_product):
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="INSPECTION_FEE",
        payer="REQUESTING_PARTY", calculation="FIXED", fixed_fee="175",
    )
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)

    charge = RevenueCharge.objects.get(method="INSPECTION_FEE")
    assert charge.payer_party == RevenueCharge.PayerParty.REQUESTING_PARTY
    assert charge.payer_user_id == wholesaler.id
    assert charge.amount_charged == Decimal("175.00")


# ----------------------------------------------------- contractual party pays

def test_contractual_party_named_in_the_agreement_pays(super_admin, wholesaler, retailer, farmer_product):
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-CONTRACT")
    agreement = order.agreement
    agreement.contractual_payer = retailer
    agreement.save(update_fields=["contractual_payer"])
    method = _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="PER_QUINTAL_FEE",
        payer="CONTRACTUAL_PARTY", calculation="PER_UNIT", unit_fee="50",
    )
    agreement.activated_at = method.approved_at + timedelta(seconds=1)
    agreement.save(update_fields=["activated_at"])
    Order.objects.filter(pk=order.pk).update(
        quality_confirmed_at=method.approved_at + timedelta(seconds=2)
    )
    order.refresh_from_db()
    post_completed_order(order, actor=super_admin)

    charge = RevenueCharge.objects.get(method="PER_QUINTAL_FEE")
    assert charge.payer_party == RevenueCharge.PayerParty.CONTRACTUAL_PARTY
    assert charge.payer_user_id == retailer.id
    # 100 kg = 1 quintal × 50 ETB
    assert charge.amount_charged == Decimal("50.00")
    assert quintals(100, "kg") == Decimal("1")


# -------------------------------------------------------- agreement enforcement

def test_marketplace_fees_cannot_be_configured_without_an_agreement(super_admin):
    from django.core.exceptions import ValidationError as DjangoValidationError

    with pytest.raises(DjangoValidationError, match="approved agreement"):
        _method(
            super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
            payer="BUYER", calculation="FIXED", fixed_fee="100", requires_agreement=False,
        )


def test_no_charge_without_an_approved_agreement(super_admin, wholesaler, farmer_product):
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BUYER", calculation="FIXED", fixed_fee="100",
    )
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-NOAGR", with_agreement=False)
    with pytest.raises(ValueError, match="requires an active approved agreement"):
        post_completed_order(order, actor=super_admin)
    assert RevenueCharge.objects.count() == 0


# ------------------------------------------------------------- idempotency

def test_repeated_settlement_never_charges_twice(super_admin, wholesaler, farmer_product):
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BUYER", calculation="FIXED", fixed_fee="100",
    )
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)
    apply_order_revenue_methods(order, actor=super_admin)
    apply_order_revenue_methods(order, actor=super_admin)
    assert RevenueCharge.objects.filter(method="FIXED_TRANSACTION_FEE").count() == 1
    assert FinancialJournalEntry.objects.filter(category="MARKETPLACE_TRANSACTION_FEE").count() == 1


# ------------------------------------------------------------------ freight

def test_freight_margin_is_revenue_and_driver_payment_is_a_payable(super_admin, wholesaler, driver, farmer_product):
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-FREIGHT")
    payment = _freight_payment(order, driver)
    _method(
        super_admin, transaction_type="FREIGHT", method="FREIGHT_MARGIN",
        payer="BUYER", calculation="FIXED", fixed_fee="60",
    )
    charge = apply_freight_revenue(payment, actor=super_admin)
    assert charge is not None
    assert charge.payer_party == RevenueCharge.PayerParty.SHIPPER
    assert charge.payer_user_id == order.buyer.id
    assert charge.amount_company_earned == Decimal("60.00")
    assert charge.third_party_payable == Decimal("200.00")
    assert charge.third_party_payee_id == driver.id
    assert charge.journal_entry.category == "DELIVERY_SERVICE_REVENUE"
    row = freight_settlement_row(payment)
    assert row["counts_as_company_revenue"] is False
    assert row["transport_cost"] == "200.00"
    assert row["company_freight_margin"] == "60.00"
    assert row["freight_payer"] == order.buyer.full_name


# ------------------------------------------------------------- subscriptions

def test_subscriber_pays_for_their_own_plan(super_admin, wholesaler):
    plan = SubscriptionPlan.objects.create(
        name="Wholesaler Pro", participant_role="WHOLESALER", price=Decimal("500.00"),
        duration_days=30, created_by=super_admin,
    )
    subscription = UserSubscription.objects.create(
        user=wholesaler, plan=plan, expires_at=timezone.now() + timedelta(days=30),
    )
    _method(
        super_admin, transaction_type="SUBSCRIPTION", method="SUBSCRIPTION_FEE",
        payer="BUYER", calculation="FIXED", fixed_fee="500",
    )
    charge = apply_subscription_revenue(subscription, actor=super_admin)
    assert charge.payer_party == RevenueCharge.PayerParty.SUBSCRIBER
    assert charge.payer_user_id == wholesaler.id
    assert charge.amount_charged == Decimal("500.00")
    assert charge.journal_entry.category == "SUBSCRIPTION_REVENUE"


# -------------------------------------------------------------- advertising

def test_advertiser_pays_and_only_wholesalers_or_retailers_are_eligible(super_admin, retailer, user_admin):
    package = AdvertisingPackage.objects.create(
        name="Featured listing", price=Decimal("1200.00"), duration_days=14, created_by=super_admin,
    )
    _method(
        super_admin, transaction_type="ADVERTISING", method="ADVERTISING_FEE",
        payer="BUYER", calculation="PERCENTAGE", rate="1",
    )
    purchase, charge = purchase_advertising_package(package, retailer, actor=super_admin)
    assert charge.payer_party == RevenueCharge.PayerParty.ADVERTISER
    assert charge.payer_user_id == retailer.id
    assert charge.amount_charged == Decimal("1200.00")
    assert purchase.journal_entry_id == charge.journal_entry_id

    with pytest.raises(ValueError, match="wholesalers and retailers only"):
        purchase_advertising_package(package, user_admin, actor=super_admin)


# ----------------------------------------------------------------- guards

def test_non_participant_can_never_be_charged(super_admin, user_admin):
    with pytest.raises(ValueError, match="cannot pay platform fees"):
        record_charge(
            reference="RC:GUARD:1", rule=None, method="FIXED_TRANSACTION_FEE",
            transaction_type="FARMER_WHOLESALER", source_type="ORDER", source_reference="GUARD",
            service_amount=Decimal("10"), generating_user=None,
            payer_party=RevenueCharge.PayerParty.SELLER, payer_user=user_admin,
            amount_charged=Decimal("10"), actor=super_admin,
        )


def test_charge_amounts_and_parties_are_immutable(super_admin, wholesaler, farmer_product):
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BUYER", calculation="FIXED", fixed_fee="100",
    )
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)
    charge = RevenueCharge.objects.get(method="FIXED_TRANSACTION_FEE")
    charge.amount_charged = Decimal("999.00")
    with pytest.raises(Exception):
        charge.save()


# -------------------------------------------------------------------- API

def test_super_admin_configures_payer_and_finance_manager_cannot(api, super_admin, financial_manager):
    api.force_authenticate(user=financial_manager)
    payload = {"transaction_type": "FARMER_WHOLESALER", "method": "FIXED_TRANSACTION_FEE", "name": "Fee", "payer": "BUYER"}
    assert api.post(METHODS_URL, payload, format="json").status_code == 403

    api.force_authenticate(user=super_admin)
    created = api.post(METHODS_URL, payload, format="json")
    assert created.status_code == 201
    method_id = created.data["id"]
    approved = api.post(f"{METHODS_URL}{method_id}/action/", {"action": "APPROVE"}, format="json")
    assert approved.status_code == 200
    assert approved.data["approved_by"] is not None

    listing = api.get(METHODS_URL)
    assert listing.status_code == 200
    assert any(row["payer"] == "BUYER" for row in listing.data["methods"])


def test_deactivating_latest_method_does_not_reactivate_older_method(api, super_admin):
    old = _method(
        super_admin, transaction_type="FARMER_WHOLESALER",
        method="FIXED_TRANSACTION_FEE", payer="BUYER", calculation="FIXED", fixed_fee="10",
    )
    newer = _method(
        super_admin, transaction_type="FARMER_WHOLESALER",
        method="FIXED_TRANSACTION_FEE", payer="SELLER", calculation="FIXED", fixed_fee="20",
    )
    newer.effective_from = old.effective_from + timedelta(seconds=1)
    newer.save(update_fields=["effective_from"])
    before_deactivation = timezone.now()
    assert before_deactivation >= newer.approved_at
    assert active_methods("FARMER_WHOLESALER", at=before_deactivation)["FIXED_TRANSACTION_FEE"].pk == newer.pk

    api.force_authenticate(user=super_admin)
    response = api.post(f"{METHODS_URL}{newer.pk}/action/", {"action": "DEACTIVATE"}, format="json")

    assert response.status_code == 200, response.data
    newer.refresh_from_db()
    assert newer.disabled_at is not None
    assert active_methods("FARMER_WHOLESALER", at=before_deactivation)["FIXED_TRANSACTION_FEE"].pk == newer.pk
    assert "FIXED_TRANSACTION_FEE" not in active_methods(
        "FARMER_WHOLESALER", at=newer.disabled_at + timedelta(seconds=1)
    )


def test_charge_api_exposes_every_required_field(api, financial_manager, super_admin, wholesaler, farmer_product):
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BUYER", calculation="FIXED", fixed_fee="100",
    )
    order = _settled_order(wholesaler, farmer_product)
    post_completed_order(order, actor=super_admin)
    api.force_authenticate(user=financial_manager)
    response = api.get(CHARGES_URL)
    assert response.status_code == 200
    assert response.data["totals"]["charged"] == "100.00"
    charge = response.data["charges"][0]
    for field in (
        "method", "transaction_type", "source_type", "source_reference", "generating_user",
        "payer_party", "payer_user", "amount_charged", "amount_collected",
        "amount_company_earned", "third_party_payable", "settlement_status",
    ):
        assert field in charge
    detail = api.get(f"{CHARGES_URL}{charge['id']}/")
    assert detail.status_code == 200
    assert detail.data["charge"]["journal_entry"]["payer_party"] == "BUYER"


def test_freight_settlements_endpoint_exposes_parties(api, financial_manager, super_admin, wholesaler, driver, farmer_product):
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-FR-API")
    payment = _freight_payment(order, driver)
    _method(
        super_admin, transaction_type="FREIGHT", method="FREIGHT_MARGIN",
        payer="BUYER", calculation="FIXED", fixed_fee="60",
    )
    apply_freight_revenue(payment, actor=super_admin)
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/freight-settlements/")
    assert response.status_code == 200
    row = next(r for r in response.data["settlements"] if r["payment_reference"] == payment.payment_reference)
    assert row["shipper"] and row["driver"] and row["transport_provider"]
    assert row["counts_as_company_revenue"] is False


def test_farmer_cannot_read_revenue_charges(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get(CHARGES_URL).status_code == 403


# ------------------------------------------- Super Admin revenue-source control

def test_wholesaler_is_buyer_when_buying_and_seller_when_reselling(
    super_admin, wholesaler, retailer, farmer_product, wholesaler_product,
):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="SELLER")
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="BUYER_COMMISSION", payer="BUYER")
    order_a = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-ROLE-A")
    post_completed_order(order_a, actor=super_admin)

    # Farmer -> wholesaler: farmer earns, wholesaler pays the buyer commission.
    farmer_charge = RevenueCharge.objects.get(
        method="SELLER_COMMISSION", source_reference=order_a.reference
    )
    farmer_buyer = RevenueCharge.objects.get(
        method="BUYER_COMMISSION", source_reference=order_a.reference
    )
    assert farmer_charge.payer_user_id == farmer_product.owner_id
    assert farmer_charge.generating_user_id == farmer_product.owner_id
    assert farmer_buyer.payer_user_id == wholesaler.id

    _method(super_admin, transaction_type="WHOLESALER_RETAILER", method="SELLER_COMMISSION", payer="SELLER")
    _method(super_admin, transaction_type="WHOLESALER_RETAILER", method="BUYER_COMMISSION", payer="BUYER")
    order_b = _settled_resale_order(wholesaler, retailer, wholesaler_product, reference="#ORD-RM-ROLE-B")
    post_completed_order(order_b, actor=super_admin)

    # Wholesaler -> retailer: the same wholesaler now earns and the retailer pays.
    reseller_charge = RevenueCharge.objects.get(
        method="SELLER_COMMISSION", source_reference=order_b.reference
    )
    retailer_charge = RevenueCharge.objects.get(
        method="BUYER_COMMISSION", source_reference=order_b.reference
    )
    assert reseller_charge.payer_user_id == wholesaler.id
    assert reseller_charge.generating_user_id == wholesaler.id
    assert retailer_charge.payer_user_id == retailer.id
    assert reseller_charge.transaction_type == RevenueMethod.TransactionType.WHOLESALER_RETAILER


def test_disabling_a_source_stops_its_charges_and_commission_posting(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="SELLER_COMMISSION", payer="SELLER")
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BUYER", calculation="FIXED", fixed_fee="100",
    )
    _source(RevenueSourceConfig.Source.MARKETPLACE_COMMISSION, enabled=False)
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-OFF")
    post_completed_order(order, actor=super_admin)

    assert not RevenueCharge.objects.filter(method="SELLER_COMMISSION").exists()
    assert not RevenueCharge.objects.filter(method="FIXED_TRANSACTION_FEE").exists()
    assert not FinancialJournalEntry.objects.filter(category="MARKETPLACE_COMMISSION").exists()
    snapshot = FinancialOrderSnapshot.objects.get(order=order)
    assert snapshot.commission_amount == Decimal("0.00")
    assert snapshot.seller_proceeds == Decimal("300000.00")


def test_disabling_the_buyer_fee_source_stops_the_buyer_fee(super_admin, wholesaler, farmer_product):
    _commission_config(super_admin)
    _method(super_admin, transaction_type="FARMER_WHOLESALER", method="BUYER_COMMISSION", payer="BUYER")
    _source(RevenueSourceConfig.Source.BUYER_FEE, enabled=False)
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-BUYER-OFF")
    post_completed_order(order, actor=super_admin)

    assert not FinancialJournalEntry.objects.filter(category="MARKETPLACE_BUYER_FEE").exists()
    assert not RevenueCharge.objects.filter(method="BUYER_COMMISSION").exists()


def test_record_charge_refuses_a_switched_off_source(super_admin, wholesaler):
    _source(RevenueSourceConfig.Source.MARKETPLACE_COMMISSION, enabled=False)
    with pytest.raises(ValueError, match="switched off"):
        record_charge(
            reference="RC:OFF:1", rule=None, method="FIXED_TRANSACTION_FEE",
            transaction_type="FARMER_WHOLESALER", source_type="ORDER", source_reference="OFF",
            service_amount=Decimal("10"), generating_user=wholesaler,
            payer_party=RevenueCharge.PayerParty.BUYER, payer_user=wholesaler,
            amount_charged=Decimal("10"), actor=super_admin,
        )


def test_source_default_rate_prices_an_otherwise_blank_method(super_admin, wholesaler, farmer_product):
    _source(RevenueSourceConfig.Source.MARKETPLACE_COMMISSION, percentage="0.01")
    _method(
        super_admin, transaction_type="FARMER_WHOLESALER", method="FIXED_TRANSACTION_FEE",
        payer="BUYER", calculation="PERCENTAGE", rate="0", fixed_fee="0",
    )
    order = _settled_order(wholesaler, farmer_product, reference="#ORD-RM-DEFAULT")
    post_completed_order(order, actor=super_admin)

    charge = RevenueCharge.objects.get(method="FIXED_TRANSACTION_FEE")
    assert charge.amount_charged == Decimal("3000.00")
    assert charge.payer_user_id == wholesaler.id


def test_only_super_admin_can_change_a_revenue_source(api, super_admin, financial_manager):
    api.force_authenticate(user=financial_manager)
    assert api.get(SOURCES_URL).status_code == 200
    denied = api.put(
        f"{SOURCES_URL}MARKETPLACE_COMMISSION/", {"enabled": False}, format="json"
    )
    assert denied.status_code == 403

    api.force_authenticate(user=super_admin)
    updated = api.put(
        f"{SOURCES_URL}MARKETPLACE_COMMISSION/",
        {"enabled": False, "default_percentage_rate": "0.015"},
        format="json",
    )
    assert updated.status_code == 200
    assert updated.data["enabled"] is False
    assert Decimal(updated.data["default_percentage_rate"]) == Decimal("0.015")


def test_expired_latest_method_is_not_shown_in_force_or_replaced_by_older_rule(api, super_admin):
    now = timezone.now()
    older = _method(
        super_admin, transaction_type=RevenueMethod.TransactionType.FARMER_WHOLESALER,
        method=RevenueMethod.Method.FIXED_TRANSACTION_FEE, payer=RevenueMethod.Payer.BUYER,
        calculation=RevenueMethod.Calculation.FIXED, fixed_fee="5",
    )
    older.effective_from = now - timedelta(days=4)
    older.approved_at = now - timedelta(days=4)
    older.save()
    latest = _method(
        super_admin, transaction_type=RevenueMethod.TransactionType.FARMER_WHOLESALER,
        method=RevenueMethod.Method.FIXED_TRANSACTION_FEE, payer=RevenueMethod.Payer.BUYER,
        calculation=RevenueMethod.Calculation.FIXED, fixed_fee="10",
    )
    latest.effective_from = now - timedelta(days=3)
    latest.effective_to = now - timedelta(days=1)
    latest.approved_at = now - timedelta(days=3)
    latest.save()

    assert active_methods(RevenueMethod.TransactionType.FARMER_WHOLESALER, at=now).get(
        RevenueMethod.Method.FIXED_TRANSACTION_FEE
    ) is None
    api.force_authenticate(user=super_admin)
    response = api.get(METHODS_URL)
    displayed = next(row for row in response.data["methods"] if row["id"] == str(latest.pk))
    assert displayed["effective_status"] == "EXPIRED"
