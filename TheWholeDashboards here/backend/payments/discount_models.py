"""Discount campaigns and per-order redemption snapshots (marketplace promotions).

Discount accounting rules enforced here and in ``discount_services``:
- The original gross order value and the final payable amount are stored on
  the order itself, so a discount can never silently rewrite the price.
- Every redemption keeps an immutable snapshot of the campaign configuration
  that was in force when the order was placed.
- ``funding_source`` distinguishes Green Path funded promotions from
  seller funded ones, because escrow settlement treats them differently:
  a seller funded discount reduces the seller's settlement, a platform
  funded one is recorded as platform marketing expense.
"""

import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


class DiscountCampaign(models.Model):
    class DiscountType(models.TextChoices):
        FIXED = "FIXED", "Fixed amount"
        PERCENTAGE = "PERCENTAGE", "Percentage"

    class FundingSource(models.TextChoices):
        PLATFORM = "PLATFORM", "Green Path funded"
        SELLER = "SELLER", "Seller funded"

    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Scheduled"
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        EXPIRED = "EXPIRED", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=40, unique=True)
    description = models.TextField(blank=True, default="")
    discount_type = models.CharField(max_length=10, choices=DiscountType.choices)
    discount_value = models.DecimalField(
        max_digits=12, decimal_places=4, validators=[MinValueValidator(Decimal("0"))]
    )
    max_discount_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    min_order_value = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0")
    )
    first_order_only = models.BooleanField(default=False)
    funding_source = models.CharField(max_length=10, choices=FundingSource.choices)
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, null=True, blank=True,
        related_name="discount_campaigns",
    )
    product_category = models.CharField(max_length=64, blank=True, default="")
    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="discount_campaigns_offered",
    )
    usage_limit = models.PositiveIntegerField(null=True, blank=True)
    per_user_limit = models.PositiveIntegerField(default=1)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="discount_campaigns_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "discount_campaigns"
        indexes = [models.Index(fields=["code"]), models.Index(fields=["is_active", "starts_at"])]

    def clean(self):
        if self.ends_at and self.ends_at <= self.starts_at:
            raise ValidationError("ends_at must be later than starts_at.")
        if self.discount_type == self.DiscountType.PERCENTAGE and not (
            Decimal("0") <= self.discount_value <= Decimal("100")
        ):
            raise ValidationError("Percentage discount_value is expressed in percent (0-100).")
        if (
            self.discount_type == self.DiscountType.PERCENTAGE
            and self.max_discount_amount is None
        ):
            raise ValidationError("Percentage discounts must cap max_discount_amount.")

    @property
    def effective_status(self):
        now = timezone.now()
        if not self.is_active:
            return self.Status.INACTIVE
        if self.starts_at > now:
            return self.Status.SCHEDULED
        if self.ends_at and self.ends_at <= now:
            return self.Status.EXPIRED
        return self.Status.ACTIVE

    def __str__(self):
        return f"{self.name} ({self.code})"


class DiscountRedemption(models.Model):
    """Immutable per-order record of an applied discount."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    campaign = models.ForeignKey(
        DiscountCampaign, on_delete=models.PROTECT, related_name="redemptions"
    )
    order = models.ForeignKey(
        "payments.Order", on_delete=models.PROTECT, related_name="discount_redemptions"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="discount_redemptions"
    )
    code_snapshot = models.CharField(max_length=40)
    campaign_snapshot = models.JSONField()
    original_amount = models.DecimalField(max_digits=14, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=14, decimal_places=2)
    final_amount = models.DecimalField(max_digits=14, decimal_places=2)
    funded_by = models.CharField(max_length=10, choices=DiscountCampaign.FundingSource.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "discount_redemptions"
        constraints = [
            models.UniqueConstraint(fields=["campaign", "order"], name="unique_campaign_per_order"),
            models.CheckConstraint(condition=models.Q(discount_amount__gt=0), name="discount_positive"),
            models.CheckConstraint(condition=models.Q(final_amount__gte=0), name="final_nonnegative"),
        ]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Discount redemptions are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Discount redemptions cannot be deleted.")

    def __str__(self):
        return f"{self.code_snapshot} on {self.order_id}: -{self.discount_amount}"
