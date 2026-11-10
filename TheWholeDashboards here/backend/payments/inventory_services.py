"""Resale inventory services — lot lifecycle per the multi-role resale chain.

- Every released, completed order grants the BUYER a stock lot (what they can
  now resell).
- When the SELLER of that order is a wholesaler/retailer reselling from their
  own lots, the sold quantity is consumed FIFO across their open lots for the
  same product (append-only RESALE movements).
- Over-reselling is prevented at order creation: the requested quantity may
  never exceed the seller's remaining lot quantity for that product.
"""
from decimal import Decimal

from django.db import transaction

from products.models import Product, ProductType
from .models import StockLot, StockMovement

RESALE_SELLER_ROLES = ("WHOLESALER", "RETAILER")


def get_available_resale_quantity(user, product=None):
    """Remaining resale quantity the user holds (fungible across their lots)."""
    lots = StockLot.objects.filter(owner=user)
    if product is not None:
        lots = lots.filter(product=product)
    total = Decimal("0")
    for lot in lots:
        total += lot.quantity_purchased - lot.quantity_movements
    return total


def create_lot_for_buyer(order) -> StockLot | None:
    """Grant the buyer a lot when their order completes and is released."""
    buyer = order.buyer
    if buyer is None or buyer.role not in ("WHOLESALER", "RETAILER"):
        return None
    if hasattr(order, "stock_lot"):
        return order.stock_lot
    return StockLot.objects.create(
        origin_order=order,
        product=order.product,
        owner=order.buyer,
        quantity_purchased=order.quantity,
        unit=order.product.unit_of_measure or "",
    )


def consume_stock_for_resale(order) -> list[StockMovement]:
    """FIFO-consume the seller's open lots for this resale order.

    Applies when the seller is a wholesaler/retailer selling from a
    WHOLESALER_LISTING — i.e., goods moving through the resale chain.
    """
    seller = order.farmer or order.seller
    if seller is None or seller.role not in RESALE_SELLER_ROLES:
        return []
    if order.product.product_type != ProductType.WHOLESALER_LISTING:
        return []

    remaining = order.quantity
    movements: list[StockMovement] = []
    lots = (
        StockLot.objects.filter(owner=seller)
        .order_by("created_at")
        .select_for_update()
    )
    for lot in lots:
        if remaining <= 0:
            break
        available = lot.quantity_purchased - lot.quantity_movements
        if available <= 0:
            continue
        take = min(available, remaining)
        movements.append(
            StockMovement.objects.create(
                lot=lot,
                movement_type=StockMovement.Type.RESALE,
                quantity=take,
                resale_order=order,
                notes=f"FIFO consumption for resale order {order.reference}",
                created_by=seller,
            )
        )
        remaining -= take
    if remaining > 0:
        raise ValueError(
            f"Resale settlement shortfall: {seller.email} is short "
            f"{remaining} {order.product.unit_of_measure or 'units'} of "
            f"{order.product.title}."
        )
    return movements


def record_owner_movement(lot: StockLot, *, movement_type: str, quantity: Decimal,
                          notes: str = "", actor=None) -> StockMovement:
    """Owner-recorded SPOILAGE / ADJUSTMENT movement against one lot."""
    if movement_type not in (StockMovement.Type.SPOILAGE, StockMovement.Type.ADJUSTMENT):
        raise ValueError("Only SPOILAGE or ADJUSTMENT movements can be recorded manually.")
    quantity = Decimal(str(quantity or 0))
    if quantity <= 0:
        raise ValueError("Quantity must be greater than zero.")
    if quantity > lot.quantity_purchased - lot.quantity_movements:
        raise ValueError(
            "Movement exceeds the remaining quantity of this lot "
            f"({lot.quantity_purchased - lot.quantity_movements} available)."
        )
    return StockMovement.objects.create(
        lot=lot, movement_type=movement_type, quantity=quantity,
        notes=notes, created_by=actor,
    )


@transaction.atomic
def settle_order_inventory(order) -> dict:
    """Full inventory settlement for one released, completed order:
    consume the seller's lots (resale chain) and grant the buyer a new lot.
    Idempotent: repeated calls never consume or grant twice."""
    if StockMovement.objects.filter(resale_order=order, movement_type=StockMovement.Type.RESALE).exists():
        consumed = []
    else:
        consumed = consume_stock_for_resale(order)
    lot = create_lot_for_buyer(order)
    return {"consumed_movements": len(consumed), "buyer_lot": lot}
