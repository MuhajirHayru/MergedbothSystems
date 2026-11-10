"""Revenue & commission rule engine tests — master-prompt scenarios 1, 2, 6, 9, 12.

The engine selects exactly one applicable rule (explicit priority, then
specificity: product > region > roles > quantity range), supports percentage /
fixed / per-unit calculations, buyer service fees, min/max caps, and quantity
/ value ranges. Statutory figures are never hardcoded here — every test
writes its own config rules like the Super Admin would.
"""
import pytest
from decimal import Decimal
from django.utils import timezone
from datetime import timedelta

from payments.financial_models import (
    FinancialConfiguration, FinancialJournalEntry, FinancialOrderSnapshot, RevenueSourceConfig,
)
from payments.financial_services import build_agreement_financial_terms_snapshot, post_completed_order
from payments.models import BusinessAgreement, Order, OrderPaymentStatus, OrderStatus
from users.models import Role

COMMISSIONS_URL = "/api/v1/payments/financial/configurations/"


def _approve_commission_config(super_admin, *, version, rules, effective_from=None):
    now = timezone.now()
    return FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.COMMISSION,
        name=f"Commission config v{version}", version=version,
        status=FinancialConfiguration.Status.APPROVED,
        rules=rules, reason="Test commission config",
        effective_from=effective_from or (now - timedelta(days=1)),
        created_by=super_admin, approved_by=super_admin,
        approved_at=now - timedelta(hours=1),
    )


def _complete_and_release(order):
    Order.objects.filter(pk=order.pk).update(
        status=OrderStatus.COMPLETED,
        payment_status=OrderPaymentStatus.RELEASED,
        quality_confirmed_at=timezone.now(),
    )
    order.refresh_from_db()


@pytest.fixture
def settlement_env(db, super_admin, farmer_product):
    """A completed, released 300,000 ETB order (100 quintals × 3,000)."""
    from payments.models import Order, Wallet
    from tests.conftest import make_user
    wholesaler_b = make_user(Role.WHOLESALER, "wholesaler.b@rev.et", "Wholesaler B")
    Wallet.objects.create(user=wholesaler_b, available_balance="100000.00")
    order = Order.objects.create(
        reference="#ORD-REV-001", wholesaler=wholesaler_b,
        farmer=farmer_product.owner, product=farmer_product,
        quantity=100, total_amount=300000, status="Processing",
    )
    from payments.models import BusinessAgreement
    from payments.financial_models import RevenueMethod
    BusinessAgreement.objects.create(order=order, terms="Approved test order terms")
    method_time = timezone.now()
    for method, payer in ((RevenueMethod.Method.SELLER_COMMISSION, RevenueMethod.Payer.SELLER),
                          (RevenueMethod.Method.BUYER_COMMISSION, RevenueMethod.Payer.BUYER)):
        RevenueMethod.objects.create(
            transaction_type=RevenueMethod.TransactionType.FARMER_WHOLESALER,
            method=method, name=f"Test {method}", payer=payer,
            created_by=super_admin, approved_by=super_admin,
            approved_at=method_time - timedelta(minutes=1),
            effective_from=method_time - timedelta(days=1),
        )
    _complete_and_release(order)
    return {"super_admin": super_admin, "order": order, "product": farmer_product}


# ------------------------------------------------------------- scenario 1

@pytest.mark.django_db
def test_producer_sale_percentage_commission(settlement_env):
    """Scenario 1: 300,000 sale at 2% → 6,000 commission, correct proceeds."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "tomato-comm", "name": "Tomato commission", "enabled": True,
         "seller_role": "FARMER", "calculation": "percentage", "rate": "0.02"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("6000.00")
    assert snapshot.seller_proceeds == Decimal("294000.00")
    assert snapshot.buyer_fee_amount == Decimal("0.00")
    entry = FinancialJournalEntry.objects.filter(
        category="MARKETPLACE_COMMISSION", source_reference=order.reference,
    ).first()
    assert entry is not None and entry.amount == Decimal("6000.00")


# ------------------------------------------------------- calculation methods

@pytest.mark.django_db
def test_per_unit_commission_on_quantity(settlement_env):
    """One hundred kilograms are one quintal, so the fee is 50 ETB."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "per-quintal", "enabled": True, "calculation": "per_unit",
         "unit": "quintal", "unit_fee": "50"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("50.00")


@pytest.mark.django_db
def test_tax_rule_can_assign_a_payer_independently_of_commission(settlement_env):
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "commission", "enabled": True, "calculation": "percentage", "rate": "0.02"},
    ]})
    now = timezone.now()
    FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.TAX, name="Buyer-pays tax test", version=1,
        status=FinancialConfiguration.Status.APPROVED,
        rules={"rules": [{"rule_id": "tax", "enabled": True, "rate": "0.10", "fee_payer": "buyer"}]},
        source="Test tax authority", source_url="https://tax.example/test-rule",
        reason="Verify independent tax payer", effective_from=now - timedelta(days=1),
        created_by=sa, approved_by=sa, approved_at=now - timedelta(hours=1),
    )
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.tax_amount == Decimal("600.00")
    assert snapshot.tax_payer_party == "BUYER"
    assert snapshot.tax_payer_user_id == order.buyer.pk
    tax_entry = FinancialJournalEntry.objects.get(category="TAX_LIABILITY", order_reference=order.reference)
    assert tax_entry.payer_party == "BUYER"
    assert tax_entry.payer_user_id == order.buyer.pk


@pytest.mark.django_db
def test_accepted_fee_snapshot_survives_later_source_switch(settlement_env):
    """A later source switch must not rewrite fees participants already accepted."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    agreement = BusinessAgreement.objects.get(order=order)
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "accepted-commission", "enabled": True,
         "calculation": "percentage", "rate": "0.02"},
    ]})
    terms = build_agreement_financial_terms_snapshot(
        order, agreement=agreement, at=agreement.activated_at
    )
    assert terms["commission_amount"] == "6000.00"
    agreement.financial_terms_snapshot = terms
    agreement.save(update_fields=["financial_terms_snapshot"])

    RevenueSourceConfig.objects.update_or_create(
        source=RevenueSourceConfig.Source.MARKETPLACE_COMMISSION,
        defaults={"enabled": False, "updated_by": sa},
    )
    posted = post_completed_order(order, actor=sa)

    assert posted.commission_amount == Decimal("6000.00")
    charge = FinancialJournalEntry.objects.get(
        category="MARKETPLACE_COMMISSION", source_reference=order.reference
    )
    assert charge.amount == Decimal("6000.00")


@pytest.mark.django_db
def test_fixed_commission(settlement_env):
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "flat", "enabled": True, "calculation": "fixed", "fixed_fee": "250"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("250.00")


@pytest.mark.django_db
def test_missing_commission_configuration_records_explicit_zero_fee(settlement_env):
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]

    snapshot = post_completed_order(order, actor=sa)

    assert snapshot.configuration_id is None
    assert snapshot.commission_amount == Decimal("0.00")
    assert snapshot.tax_amount == Decimal("0.00")
    assert snapshot.status == FinancialOrderSnapshot.Status.SETTLED


# ------------------------------------------------------------- buyer fees

@pytest.mark.django_db
def test_buyer_fee_posted_as_separate_revenue(settlement_env):
    """Buyer service fee is computed from the same rule but identified and
    posted separately from the seller-side commission."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "both-sides", "enabled": True,
         "calculation": "percentage", "rate": "0.02",
         "buyer_fee_calculation": "percentage", "buyer_fee_rate": "0.01"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("6000.00")
    assert snapshot.buyer_fee_amount == Decimal("3000.00")
    buyer_entry = FinancialJournalEntry.objects.filter(
        category="MARKETPLACE_BUYER_FEE", source_reference=order.reference,
    ).first()
    assert buyer_entry is not None and buyer_entry.amount == Decimal("3000.00")


# ------------------------------------------- priority, specificity, ranges

@pytest.mark.django_db
def test_product_specific_rule_beats_general(settlement_env):
    """Scenario 12: overlapping rules never combine — the most specific wins."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    product_type = settlement_env["product"].product_type
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "general", "enabled": True, "calculation": "percentage", "rate": "0.05"},
        {"rule_id": "tomato-specific", "enabled": True,
         "product_type": product_type, "calculation": "percentage", "rate": "0.02"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("6000.00")


@pytest.mark.django_db
def test_explicit_priority_overrides_specificity(settlement_env):
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    product_type = settlement_env["product"].product_type
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "tomato-specific", "enabled": True, "product_type": product_type,
         "calculation": "percentage", "rate": "0.02"},
        {"rule_id": "campaign", "enabled": True, "priority": 10,
         "calculation": "percentage", "rate": "0.01"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("3000.00")


@pytest.mark.django_db
def test_quantity_range_scoping_and_min_cap(settlement_env):
    """A rule scoped to ≥200 quintals does not match a 100-quintal order; the
    fallback rule applies with its min_commission clamp."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "bulk-only", "enabled": True, "min_quantity": 200,
         "calculation": "percentage", "rate": "0.01"},
        {"rule_id": "small-seller", "enabled": True, "calculation": "fixed",
         "fixed_fee": "10", "min_commission": "150"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("150.00")


@pytest.mark.django_db
def test_max_commission_cap(settlement_env):
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "capped", "enabled": True, "calculation": "percentage",
         "rate": "0.02", "max_commission": "4000"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("4000.00")


@pytest.mark.django_db
def test_disabled_rule_is_skipped(settlement_env):
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    product_type = settlement_env["product"].product_type
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "paused", "enabled": False, "product_type": product_type,
         "calculation": "percentage", "rate": "0.50"},
        {"rule_id": "active", "enabled": True, "calculation": "percentage", "rate": "0.02"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("6000.00")


# ------------------------------------------------ scenario 6: dynamic change

@pytest.mark.django_db
def test_rate_change_applies_to_new_orders_only(settlement_env):
    """Scenario 6: previous transactions keep their original calculation."""
    sa = settlement_env["super_admin"]
    order1 = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "std", "enabled": True, "calculation": "percentage", "rate": "0.02"},
    ]})
    snap1 = post_completed_order(order1, actor=sa)
    assert snap1.commission_amount == Decimal("6000.00")

    # Super Admin raises the commission: new approved version.
    _approve_commission_config(sa, version=2, rules={"rules": [
        {"rule_id": "std", "enabled": True, "calculation": "percentage", "rate": "0.03"},
    ]})

    from tests.conftest import make_user
    from payments.models import Order
    order2 = Order.objects.create(
        reference="#ORD-REV-002", wholesaler=make_user(Role.WHOLESALER, "ws.c@rev.et", "WS C"),
        farmer=settlement_env["product"].owner, product=settlement_env["product"],
        quantity=100, total_amount=300000, status="Processing",
    )
    from payments.models import BusinessAgreement
    BusinessAgreement.objects.create(order=order2, terms="Approved test order terms")
    _complete_and_release(order2)
    snap2 = post_completed_order(order2, actor=sa)
    assert snap2.commission_amount == Decimal("9000.00")
    snap1.refresh_from_db()
    assert snap1.commission_amount == Decimal("6000.00")
    assert snap1.configuration.version == 1
    assert snap2.configuration.version == 2


# ------------------------------------------------ scenario 9: permissions

@pytest.mark.django_db
def test_logistics_manager_cannot_change_commission_rules(api, db):
    """Scenario 9: the Logistics Manager cannot modify commission rules."""
    from rest_framework.test import APIClient
    from users.models import Role
    from tests.conftest import make_user
    logistics_manager = make_user(Role.LOGISTICS_MANAGER, "logistics.lm@rev.et", "Logistics LM")
    client = APIClient()
    client.force_authenticate(user=logistics_manager)
    response = client.post(COMMISSIONS_URL, {
        "kind": "COMMISSION", "name": "LM attempt", "version": 99,
        "rules": {"rules": []}, "reason": "attempt",
        "effective_from": timezone.now().isoformat(),
    }, format="json")
    assert response.status_code in (403, 400)


@pytest.mark.django_db
def test_no_rule_leaves_proceeds_unposted(settlement_env):
    """Without any matching rule the full value goes to the seller and the
    snapshot is flagged TAX_UNRESOLVED — nothing is silently charged."""
    sa = settlement_env["super_admin"]
    order = settlement_env["order"]
    _approve_commission_config(sa, version=1, rules={"rules": [
        {"rule_id": "other-region", "enabled": True, "region_id": "00000000-0000-0000-0000-000000000000",
         "calculation": "percentage", "rate": "0.02"},
    ]})
    snapshot = post_completed_order(order, actor=sa)
    assert snapshot.commission_amount == Decimal("0")
    assert snapshot.seller_proceeds == Decimal("300000.00")
    assert snapshot.status == FinancialOrderSnapshot.Status.TAX_UNRESOLVED
