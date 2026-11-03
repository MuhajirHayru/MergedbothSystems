"""Server-side discount validation and application.

Every rule is enforced here, never on the frontend: the order creation view
passes the buyer, product, gross total, and the submitted coupon code; this
module returns the campaign, the recalculated discount, and an immutable
snapshot, or raises ``ValidationError`` with a buyer-safe message.
"""

from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from rest_framework.exceptions import ValidationError
from django.utils import timezone

from .discount_models import DiscountCampaign, DiscountRedemption

TWO_PLACES = Decimal("0.01")


def _quantize(value):
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


@transaction.atomic
def resolve_discount_for_order(*, buyer, product, seller, gross_total, coupon_code):
    """Validate ``coupon_code`` against the order context and return (campaign, discount, snapshot).

    Raises ``ValidationError`` when the code is unknown, inactive, out of its
    window, out of scope for this product/seller/category, below the minimum
    order value, exhausted, already used up by this buyer, or when the buyer
    does not meet a first-order restriction. Discount amounts are always
    recalculated here from the campaign configuration and the gross total.
    """
    code = (coupon_code or "").strip()
    if not code:
        return None, Decimal("0"), None
    from users.models import PlatformSettings
    if PlatformSettings.load().discount_campaigns_disabled:
        raise ValidationError({"coupon_code": "Discount campaigns are temporarily paused."})
    now = timezone.now()
    campaign = (
        DiscountCampaign.objects.select_for_update()
        .select_related("product", "seller")
        .filter(code__iexact=code)
        .first()
    )
    if campaign is None:
        raise ValidationError({"coupon_code": "This coupon code is not valid."})
    if not campaign.is_active:
        raise ValidationError({"coupon_code": "This coupon is not active."})
    if campaign.starts_at > now:
        raise ValidationError({"coupon_code": "This coupon is not active yet."})
    if campaign.ends_at and campaign.ends_at <= now:
        raise ValidationError({"coupon_code": "This coupon has expired."})
    if campaign.effective_status != DiscountCampaign.Status.ACTIVE:
        raise ValidationError({"coupon_code": "This coupon is not active."})
    if campaign.product_id and campaign.product_id != product.pk:
        raise ValidationError({"coupon_code": "This coupon does not apply to this product."})
    if campaign.product_category and campaign.product_category != product.category:
        raise ValidationError({"coupon_code": "This coupon does not apply to this product category."})
    if campaign.seller_id and campaign.seller_id != seller.pk:
        raise ValidationError({"coupon_code": "This coupon does not apply to this seller."})

    gross_total = _quantize(gross_total)
    if gross_total < _quantize(campaign.min_order_value):
        raise ValidationError(
            {
                "coupon_code": (
                    f"This coupon requires a minimum order value of "
                    f"{campaign.min_order_value:.2f} ETB."
                )
            }
        )

    if campaign.first_order_only:
        prior = DiscountRedemption.objects.filter(user=buyer).exists()
        if prior:
            raise ValidationError(
                {"coupon_code": "This coupon is only valid on a buyer's first order."}
            )

    total_redemptions = DiscountRedemption.objects.filter(campaign=campaign).count()
    if campaign.usage_limit is not None and total_redemptions >= campaign.usage_limit:
        raise ValidationError({"coupon_code": "This coupon has reached its usage limit."})
    user_redemptions = DiscountRedemption.objects.filter(campaign=campaign, user=buyer).count()
    if user_redemptions >= campaign.per_user_limit:
        raise ValidationError({"coupon_code": "You have already used this coupon."})

    if campaign.discount_type == DiscountCampaign.DiscountType.FIXED:
        discount = campaign.discount_value
    else:
        discount = gross_total * campaign.discount_value / Decimal("100")
        if campaign.max_discount_amount is not None:
            discount = min(discount, campaign.max_discount_amount)
    discount = min(_quantize(discount), gross_total)
    if discount <= 0:
        raise ValidationError({"coupon_code": "This coupon does not reduce this order's value."})

    final_amount = gross_total - discount
    snapshot = {
        "campaign_id": str(campaign.pk),
        "name": campaign.name,
        "code": campaign.code,
        "discount_type": campaign.discount_type,
        "discount_value": str(campaign.discount_value),
        "max_discount_amount": (
            str(campaign.max_discount_amount) if campaign.max_discount_amount is not None else None
        ),
        "funding_source": campaign.funding_source,
        "original_amount": str(gross_total),
        "discount_amount": str(discount),
        "final_amount": str(final_amount),
        "applied_at": now.isoformat(),
    }
    return campaign, discount, snapshot


@transaction.atomic
def record_redemption(*, order, buyer, campaign, discount, snapshot):
    """Persist the immutable redemption row once the order row exists."""
    return DiscountRedemption.objects.create(
        campaign=campaign,
        order=order,
        user=buyer,
        code_snapshot=snapshot["code"],
        campaign_snapshot=snapshot,
        original_amount=Decimal(snapshot["original_amount"]),
        discount_amount=discount,
        final_amount=Decimal(snapshot["final_amount"]),
        funded_by=campaign.funding_source,
    )
