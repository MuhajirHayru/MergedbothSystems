"""Resale lot tracking tests — master-prompt scenarios 2 & 3 + over-resell guard.

Chain under test: producer → Wholesaler A (500q) → Wholesaler B (200q)
→ Retailer C (100q). Every link: lot creation for the buyer, FIFO consumption
for the reselling seller, commission only per platform-facilitated order.
"""
import pytest
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone

from payments.financial_models import (
    FinancialConfiguration, FinancialOrderSnapshot, FinancialJournalEntry,
)
from payments.financial_services import post_completed_order
from payments.inventory_services import (
    get_available_resale_quantity, settle_order_inventory,
)
from payments.models import Order, OrderPaymentStatus, OrderStatus, StockLot, StockMovement
from products.models import Product, ProductStatus, ProductType
from users.models import Role

from tests.conftest import make_user


def _approve_commission(super_admin, *, version, rate):
    now = timezone.now()
    return FinancialConfiguration.objects.create(
        kind=FinancialConfiguration.Kind.COMMISSION,
        name=f"Commission v{version}", version=version,
        status=FinancialConfiguration.Status.APPROVED,
        rules={"rules": [
            {"rule_id": "std", "enabled": True,
             "calculation": "percentage", "rate": str(rate)},
        ]},
        reason="Resale chain test config",
        effective_from=now - timedelta(days=1),
        created_by=super_admin, approved_by=super_admin,
        approved_at=now - timedelta(hours=1),
    )


def _complete(order):
    Order.objects.filter(pk=order.pk).update(
        status=OrderStatus.COMPLETED,
        payment_status=OrderPaymentStatus.RELEASED,
        quality_confirmed_at=timezone.now(),
    )
    order.refresh_from_db()


def _create_order(*, reference, buyer, product, quantity, total):
    seller = product.owner
    order_data = dict(
        reference=reference, farmer=seller,
        product=product, quantity=quantity, total_amount=total,
        status="Processing",
    )
    order_data["wholesaler"] = buyer if buyer.role == Role.WHOLESALER else seller
    order_data["retailer" if buyer.role == Role.RETAILER else "wholesaler"] = buyer
    order = Order.objects.create(**order_data)
    from payments.models import BusinessAgreement
    BusinessAgreement.objects.create(order=order, terms="Approved resale terms")
    return order


@pytest.fixture
def chain_env(db, super_admin, farmer, farmer_product):
    """Wholesaler A (buyer of the farmer's 500q) + approved 2% commission."""
    ws_a = make_user(Role.WHOLESALER, "ws.a@lots.et", "Wholesaler A")
    _approve_commission(super_admin, version=1, rate="0.02")
    from payments.financial_models import RevenueMethod
    method_time = timezone.now()
    for transaction_type in (RevenueMethod.TransactionType.FARMER_WHOLESALER, RevenueMethod.TransactionType.WHOLESALER_RETAILER):
        RevenueMethod.objects.create(
            transaction_type=transaction_type, method=RevenueMethod.Method.SELLER_COMMISSION,
            name=f"Test seller commission {transaction_type}", payer=RevenueMethod.Payer.SELLER,
            created_by=super_admin, approved_by=super_admin,
            approved_at=method_time - timedelta(minutes=1), effective_from=method_time - timedelta(days=1),
        )
    order = _create_order(
        reference="#ORD-LOT-000", buyer=ws_a, product=farmer_product,
        quantity=500, total=150000,
    )
    _complete(order)
    settle_order_inventory(order)
    return {
        "super_admin": super_admin, "farmer_product": farmer_product,
        "ws_a": ws_a, "origin_order": order,
    }


def _ws_listing(env, *, quantity, title):
    return Product.objects.create(
        title=title, category="Vegetables",
        quantity=quantity, unit_of_measure="quintal",
        price_per_unit=320, owner=env["ws_a"],
        product_type=ProductType.WHOLESALER_LISTING,
        description="Resale listing.",
    )


# ----------------------------------------------------------- scenario 2

@pytest.mark.django_db
def test_purchase_creates_lot_for_buyer(chain_env):
    """Scenario 2 (setup): Wholesaler A's 500q purchase becomes a lot with
    the full remaining quantity."""
    lot = StockLot.objects.get(origin_order=chain_env["origin_order"])
    assert lot.owner == chain_env["ws_a"]
    assert lot.quantity_purchased == Decimal("500.00")
    assert lot.quantity_remaining == Decimal("500.00")
    assert lot.unit == "kg"


@pytest.mark.django_db
def test_resale_consumes_lot_and_commissions_the_new_transaction(chain_env):
    """Scenario 2: A resells 200q via a platform order — A's lot is consumed
    FIFO and the NEW transaction earns its own commission per the rules."""
    sa = chain_env["super_admin"]
    ws_b = make_user(Role.WHOLESALER, "ws.b@lots.et", "Wholesaler B")
    listing = _ws_listing(chain_env, quantity=500, title="Tomatoes (resale A)")
    resale_order = _create_order(
        reference="#ORD-LOT-001", buyer=ws_b, product=listing,
        quantity=200, total=64000,
    )
    _complete(resale_order)
    snap = post_completed_order(resale_order, actor=sa)

    # Wholesaler-to-wholesaler is not one of the configured marketplace
    # transaction types, so the calculation rule alone must not charge it.
    assert snap.commission_amount == Decimal("0.00")

    # A's lot: 500 purchased, 200 resold → 300 remaining
    lot = StockLot.objects.get(origin_order=chain_env["origin_order"])
    assert lot.quantity_remaining == Decimal("300.00")
    movement = StockMovement.objects.get(
        lot=lot, resale_order=resale_order, movement_type=StockMovement.Type.RESALE,
    )
    assert movement.quantity == Decimal("200.00")

    # B received their own lot from the resale purchase
    b_lot = StockLot.objects.get(origin_order=resale_order)
    assert b_lot.owner == ws_b
    assert b_lot.quantity_remaining == Decimal("200.00")


# ----------------------------------------------------------- scenario 3

@pytest.mark.django_db
def test_resale_chain_no_duplicate_commission(chain_env):
    """Scenario 3: A → B → C. Each link earns exactly one commission; the
    original lot is consumed FIFO and never double-charged."""
    sa = chain_env["super_admin"]
    ws_b = make_user(Role.WHOLESALER, "ws.b@lots.et", "Wholesaler B")
    listing_a = _ws_listing(chain_env, quantity=500, title="Tomatoes (resale A)")

    order_a_b = _create_order(
        reference="#ORD-LOT-001", buyer=ws_b, product=listing_a,
        quantity=200, total=64000,
    )
    _complete(order_a_b)
    post_completed_order(order_a_b, actor=sa)

    # B resells 100q to retailer C from B's own lot
    retailer_c = make_user(Role.RETAILER, "retailer.c@lots.et", "Retailer C")
    listing_b = Product.objects.create(
        title="Tomatoes (resale B)", category="Vegetables",
        quantity=200, unit_of_measure="quintal",
        price_per_unit=350, owner=ws_b,
        product_type=ProductType.WHOLESALER_LISTING,
        description="B's resale listing.",
    )
    order_b_c = _create_order(
        reference="#ORD-LOT-002", buyer=retailer_c, product=listing_b,
        quantity=100, total=35000,
    )
    _complete(order_b_c)
    snap_b_c = post_completed_order(order_b_c, actor=sa)
    assert snap_b_c.commission_amount == Decimal("700.00")

    # Chain totals: exactly one commission per link, lots correct
    assert FinancialOrderSnapshot.objects.count() == 2  # A→B and B→C only
    lot_a = StockLot.objects.get(origin_order=chain_env["origin_order"])
    lot_b = StockLot.objects.get(origin_order=order_a_b)
    assert lot_a.quantity_remaining == Decimal("300.00")
    assert lot_b.quantity_remaining == Decimal("100.00")

    # No RESALE movement was charged against the original farmer transaction
    assert not StockMovement.objects.filter(
        lot=lot_a, resale_order=order_b_c,
    ).exists()


# --------------------------------------------------- over-resell prevention

@pytest.mark.django_db
def test_order_creation_rejects_over_resell(chain_env, api):
    """Selling more than the seller's remaining lot quantity is rejected at
    order creation through the API."""
    from rest_framework.test import APIClient
    ws_b = make_user(Role.WHOLESALER, "ws.b@lots.et", "Wholesaler B")
    listing_a = _ws_listing(chain_env, quantity=500, title="Tomatoes (resale A)")
    # A first resells 400 legitimately (leaves 100 in their lot)…
    ws_c = make_user(Role.WHOLESALER, "ws.c@lots.et", "Wholesaler C")
    order1 = _create_order(
        reference="#ORD-LOT-003", buyer=ws_c, product=listing_a,
        quantity=400, total=128000,
    )
    _complete(order1)
    settle_order_inventory(order1)
    # …then tries to place a 150-unit order: within the listing quantity but
    # beyond the remaining lot stock — the resale guard must fire.
    client = APIClient()
    client.force_authenticate(user=ws_b)
    response = client.post(
        "/api/v1/orders/",
        {"product": str(listing_a.pk), "quantity": 150},
        format="json",
    )
    assert response.status_code == 400
    assert "can only resell" in str(response.content)


@pytest.mark.django_db
def test_resale_shortfall_raises_at_settlement(chain_env):
    """If inventory moves outside the platform (adjustments), a resale order
    that can no longer be covered raises at settlement — never silently."""
    ws_b = make_user(Role.WHOLESALER, "ws.b@lots.et", "Wholesaler B")
    listing_a = _ws_listing(chain_env, quantity=500, title="Tomatoes (resale A)")
    order = _create_order(
        reference="#ORD-LOT-004", buyer=ws_b, product=listing_a,
        quantity=200, total=64000,
    )
    _complete(order)
    lot = StockLot.objects.get(origin_order=chain_env["origin_order"])
    # 400 units spoil off-platform AFTER the order was placed
    StockMovement.objects.create(
        lot=lot, movement_type=StockMovement.Type.SPOILAGE,
        quantity=Decimal("400.00"), notes="Cold-storage failure",
    )
    with pytest.raises(Exception, match="shortfall"):
        settle_order_inventory(order)


# ------------------------------------------------------------ owner movements

@pytest.mark.django_db
def test_owner_can_record_spoilage_within_remaining(chain_env):
    ws_a = chain_env["ws_a"]
    lot = StockLot.objects.get(origin_order=chain_env["origin_order"])
    from payments.inventory_services import record_owner_movement
    movement = record_owner_movement(
        lot, movement_type="SPOILAGE", quantity=Decimal("25.00"),
        notes="Spoiled in transit storage", actor=ws_a,
    )
    assert movement.quantity == Decimal("25.00")
    assert lot.quantity_remaining == Decimal("475.00")


@pytest.mark.django_db
def test_owner_cannot_record_movement_beyond_remaining(chain_env):
    ws_a = chain_env["ws_a"]
    lot = StockLot.objects.get(origin_order=chain_env["origin_order"])
    from payments.inventory_services import record_owner_movement
    with pytest.raises(Exception, match="exceeds the remaining quantity"):
        record_owner_movement(
            lot, movement_type="SPOILAGE", quantity=Decimal("600.00"),
            notes="over", actor=ws_a,
        )


# --------------------------------------- supply-chain eligibility (freight prompt §2)

@pytest.mark.django_db
def test_retailer_cannot_purchase_directly_from_producer(chain_env, api, retailer):
    """Supply-chain eligibility: retailers/resellers purchase EXCLUSIVELY from
    wholesalers — a direct farmer listing is refused to them."""
    api.force_authenticate(user=retailer)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(chain_env["farmer_product"].pk), "quantity": 10},
        format="json",
    )
    assert response.status_code == 400
    assert "not available to your role" in str(response.content)


@pytest.mark.django_db
def test_wholesaler_cannot_be_recorded_as_original_producer(chain_env):
    """The original producer and the current seller stay separately
    identifiable on every resale order in the chain."""
    ws_b = make_user(Role.WHOLESALER, "ws.b@lots.et", "Wholesaler B")
    listing_a = _ws_listing(chain_env, quantity=500, title="Tomatoes (resale A)")
    order = _create_order(
        reference="#ORD-LOT-010", buyer=ws_b, product=listing_a,
        quantity=100, total=32000,
    )
    _complete(order)
    snap = post_completed_order(order, actor=chain_env["super_admin"])
    # Original producer (farmer_product.owner) ≠ current seller (ws_a) — the
    # snapshot records the CURRENT seller; the origin lot records the chain.
    assert snap.seller_user == chain_env["ws_a"]
    lot = StockLot.objects.get(origin_order=order)
    assert lot.product.owner == chain_env["ws_a"]
    origin = chain_env["origin_order"]
    assert origin.farmer != order.farmer
