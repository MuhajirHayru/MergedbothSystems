"""Discount campaign, coupon application, and discount accounting tests.

Covers the mandatory discount rules: server-side recalculation, immutable
snapshots, usage limits, duplicate prevention, and the different escrow
settlement treatment of platform funded vs seller funded discounts.
"""
from datetime import timedelta

from django.core.exceptions import ValidationError
from decimal import Decimal

import pytest
from django.utils import timezone

from payments.discount_models import DiscountCampaign, DiscountRedemption
from payments.financial_models import FinancialJournalEntry, FinancialOrderSnapshot
from payments.models import Order, OrderPaymentStatus, OrderStatus
from payments.wallet_services import release_escrow, reserve_order_funds
from products.models import ProductStatus, ProductType
from users.models import AuditLog

pytestmark = pytest.mark.django_db


def make_campaign(super_admin, product=None, **overrides):
    now = timezone.now()
    fields = dict(
        name="E2E campaign",
        code="SAVE10",
        discount_type=DiscountCampaign.DiscountType.PERCENTAGE,
        discount_value=Decimal("10"),
        max_discount_amount=Decimal("50.00"),
        min_order_value=Decimal("0"),
        funding_source=DiscountCampaign.FundingSource.PLATFORM,
        product=product,
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(days=7),
        created_by=super_admin,
    )
    fields.update(overrides)
    return DiscountCampaign.objects.create(**fields)


def test_percentage_discount_requires_max_cap(db, super_admin):
    campaign = DiscountCampaign(
        name="bad", code="NOCAP", discount_type=DiscountCampaign.DiscountType.PERCENTAGE,
        discount_value=Decimal("10"), starts_at=timezone.now(), created_by=super_admin,
    )
    with pytest.raises(ValidationError):
        campaign.full_clean()


def test_order_with_coupon_reserves_net_and_snapshots_discount(
    api, wholesaler, farmer, farmer_product, super_admin
):
    make_campaign(super_admin, product=farmer_product)
    api.force_authenticate(user=wholesaler)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "10", "coupon_code": "SAVE10"},
        format="json",
    )
    assert response.status_code == 201, response.data
    order_id = response.data["order"]["id"]
    order = Order.objects.get(pk=order_id)
    gross = Decimal("10") * farmer_product.price_per_unit
    assert order.total_amount == gross
    assert order.discount_amount == gross * Decimal("10") / Decimal("100")
    assert order.payable_amount == gross - order.discount_amount
    snapshot = order.discount_snapshot
    assert snapshot["code"] == "SAVE10"
    assert snapshot["funding_source"] == "PLATFORM"
    assert Decimal(snapshot["original_amount"]) == gross
    assert Decimal(snapshot["final_amount"]) == order.payable_amount
    redemption = DiscountRedemption.objects.get(order=order)
    assert redemption.discount_amount == order.discount_amount
    assert redemption.funded_by == "PLATFORM"


def test_coupon_without_code_keeps_legacy_flow(api, wholesaler, farmer, farmer_product):
    api.force_authenticate(user=wholesaler)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "3"},
        format="json",
    )
    assert response.status_code == 201
    order = Order.objects.get(pk=response.data["order"]["id"])
    assert order.discount_amount == Decimal("0")
    assert order.payable_amount == order.total_amount


def test_duplicate_coupon_use_rejected(api, wholesaler, farmer, farmer_product, super_admin):
    make_campaign(super_admin, product=farmer_product, per_user_limit=1)
    api.force_authenticate(user=wholesaler)
    first = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1", "coupon_code": "SAVE10"},
        format="json",
    )
    assert first.status_code == 201
    # cancel to free inventory, then attempt reuse
    order_id = first.data["order"]["id"]
    api.patch(
        f"/api/v1/orders/{order_id}/status/", {"status": "Cancelled"}, format="json"
    )
    second = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1", "coupon_code": "SAVE10"},
        format="json",
    )
    assert second.status_code == 400
    assert "already used" in str(second.data)


def test_unknown_expired_and_min_value_coupons_rejected(
    api, wholesaler, farmer, farmer_product, super_admin
):
    now = timezone.now()
    make_campaign(super_admin, code="EXPIRED1", ends_at=now - timedelta(minutes=5))
    make_campaign(
        super_admin, code="MINBIG", min_order_value=Decimal("100000.00")
    )
    api.force_authenticate(user=wholesaler)
    for code, message in (
        ("UNKNOWN1", "not valid"),
        ("EXPIRED1", "expired"),
        ("MINBIG", "minimum order value"),
    ):
        response = api.post(
            "/api/v1/orders/",
            {"product": str(farmer_product.pk), "quantity": "1", "coupon_code": code},
            format="json",
        )
        assert response.status_code == 400, (code, response.data)
        assert message in str(response.data)


def test_usage_limit_blocks_when_exhausted(api, wholesaler, farmer, farmer_product, super_admin):
    make_campaign(super_admin, product=farmer_product, usage_limit=1)
    api.force_authenticate(user=wholesaler)
    first = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1", "coupon_code": "SAVE10"},
        format="json",
    )
    assert first.status_code == 201
    first_id = first.data["order"]["id"]
    api.patch(f"/api/v1/orders/{first_id}/status/", {"status": "Cancelled"}, format="json")
    exhausted = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1", "coupon_code": "SAVE10"},
        format="json",
    )
    assert exhausted.status_code == 400
    assert "usage limit" in str(exhausted.data)


def _complete_order(order, financial_manager):
    reserve_order_funds(order, order.buyer)
    order.status = OrderStatus.ACCEPTED
    order.save(update_fields=["status"])
    for status in (
        OrderStatus.PROCESSING,
        OrderStatus.CONFIRMED,
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
    ):
        order.status = status
        order.save(update_fields=["status"])
    order.status = OrderStatus.AWAITING_PAYMENT_RELEASE
    order.payment_status = OrderPaymentStatus.RELEASE_PENDING
    order.quality_confirmed_at = timezone.now()
    order.save(update_fields=["status", "payment_status", "quality_confirmed_at"])
    return release_escrow(order, financial_manager)


def test_platform_funded_discount_books_promotion_expense(
    wholesaler, farmer, farmer_product, financial_manager, super_admin
):
    campaign = make_campaign(super_admin, product=farmer_product)
    order = Order.objects.create(
        reference="#ORDDISC001", wholesaler=wholesaler, farmer=farmer,
        product=farmer_product, quantity=Decimal("10"),
        total_amount=Decimal("420.00"), discount_amount=Decimal("42.00"),
        discount_snapshot={
            "code": "SAVE10", "funding_source": "PLATFORM",
            "original_amount": "420.00", "discount_amount": "42.00",
            "final_amount": "378.00",
        },
        status=OrderStatus.PENDING_SELLER_APPROVAL,
        payment_status=OrderPaymentStatus.RESERVED,
    )
    DiscountRedemption.objects.create(
        campaign=campaign, order=order, user=wholesaler,
        code_snapshot="SAVE10", campaign_snapshot={}, original_amount=Decimal("420.00"),
        discount_amount=Decimal("42.00"), final_amount=Decimal("378.00"),
        funded_by="PLATFORM",
    )
    _complete_order(order, financial_manager)
    order.refresh_from_db()
    assert order.status == OrderStatus.COMPLETED
    snapshot = FinancialOrderSnapshot.objects.get(order=order)
    # platform funded: commission applies to the gross, promotion tops the seller up
    assert snapshot.gross_order_value == Decimal("420.00")
    topup = FinancialJournalEntry.objects.get(
        idempotency_key=f"order-promotion:{order.pk}"
    )
    assert topup.category == "PROMOTION_EXPENSE"
    assert topup.amount == Decimal("42.00")
    # escrow only ever held the payable amount
    escrow = FinancialJournalEntry.objects.get(idempotency_key=f"escrow-release:{order.pk}")
    assert escrow.amount == Decimal("378.00")
    # seller receives gross minus commission (config absent => full proceeds)
    assert snapshot.seller_proceeds == Decimal("420.00")
    audit = AuditLog.objects.filter(target=order.reference, action="escrow_released").first()
    assert audit is not None


def test_seller_funded_discount_settles_on_net(
    wholesaler, farmer, farmer_product, financial_manager, super_admin
):
    campaign = make_campaign(
        super_admin, product=farmer_product,
        funding_source=DiscountCampaign.FundingSource.SELLER,
    )
    order = Order.objects.create(
        reference="#ORDDISC002", wholesaler=wholesaler, farmer=farmer,
        product=farmer_product, quantity=Decimal("10"),
        total_amount=Decimal("420.00"), discount_amount=Decimal("42.00"),
        discount_snapshot={
            "code": "SAVE10", "funding_source": "SELLER",
            "original_amount": "420.00", "discount_amount": "42.00",
            "final_amount": "378.00",
        },
        status=OrderStatus.PENDING_SELLER_APPROVAL,
        payment_status=OrderPaymentStatus.RESERVED,
    )
    DiscountRedemption.objects.create(
        campaign=campaign, order=order, user=wholesaler,
        code_snapshot="SAVE10", campaign_snapshot={}, original_amount=Decimal("420.00"),
        discount_amount=Decimal("42.00"), final_amount=Decimal("378.00"),
        funded_by="SELLER",
    )
    _complete_order(order, financial_manager)
    snapshot = FinancialOrderSnapshot.objects.get(order=order)
    # seller funded: effective gross is the discounted amount, no promotion journal
    assert snapshot.gross_order_value == Decimal("378.00")
    assert snapshot.seller_proceeds == Decimal("378.00")
    assert not FinancialJournalEntry.objects.filter(
        idempotency_key=f"order-promotion:{order.pk}"
    ).exists()


def test_only_super_admin_creates_campaigns(api, financial_manager):
    api.force_authenticate(user=financial_manager)
    response = api.post(
        "/api/v1/payments/financial/discount-campaigns/",
        {"name": "x", "code": "X1", "discount_type": "FIXED", "discount_value": "5",
         "funding_source": "PLATFORM", "starts_at": timezone.now().isoformat()},
        format="json",
    )
    assert response.status_code == 403


def test_campaign_listing_reports_usage(
    api, financial_manager, super_admin, wholesaler, farmer, farmer_product
):
    campaign = make_campaign(super_admin, product=farmer_product)
    order = Order.objects.create(
        reference="#ORDDISC003", wholesaler=wholesaler, farmer=farmer,
        product=farmer_product, quantity=Decimal("1"),
        total_amount=Decimal("42.00"), discount_amount=Decimal("4.20"),
        status=OrderStatus.PENDING_SELLER_APPROVAL,
    )
    DiscountRedemption.objects.create(
        campaign=campaign, order=order, user=wholesaler,
        code_snapshot="SAVE10", campaign_snapshot={}, original_amount=Decimal("42.00"),
        discount_amount=Decimal("4.20"), final_amount=Decimal("37.80"),
        funded_by="PLATFORM",
    )
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/discount-campaigns/")
    assert response.status_code == 200
    row = next(c for c in response.data if str(c["id"]) == str(campaign.pk))
    assert row["total_redemptions"] == 1
    assert Decimal(row["total_discount_amount"]) == Decimal("4.20")
    listing = api.get("/api/v1/payments/financial/discount-redemptions/")
    assert listing.status_code == 200
    assert listing.data["summary"]["count"] == 1
