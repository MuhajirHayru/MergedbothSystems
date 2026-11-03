"""Part 26 — freight bidding marketplace (Uber-style, marketplace-managed).

Flow:
1. When an order's shipment details are confirmed and authorized, a FreightJob
   is created automatically from the confirmed details.
2. Logistics staff (LOGISTICS_MANAGER / SUPER_ADMIN) manage jobs — publish,
   cancel, compare bids, and assign. They control the whole board.
3. Approved drivers browse open jobs (like a ride-hailing job board) and bid
   with an amount, an estimated delivery time, and a message.
4. Staff accept one bid: the job becomes ASSIGNED, the winning bid is marked
   accepted, losing bids are rejected, the driver is notified, and a delivery
   fee agreement snapshot is recorded exactly like the Option C models require.

No second shipment system: physical execution continues through the existing
shipment details / DriverApp integration. This layer is the management and
bidding marketplace the logistics tracker controls.
"""

import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone



class FreightJob(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open for bidding"
        ASSIGNED = "ASSIGNED", "Assigned"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.OneToOneField(
        "payments.Order", on_delete=models.PROTECT, related_name="freight_job"
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="freight_jobs_published",
    )
    pickup_summary = models.CharField(max_length=300, blank=True, default="")
    destination_summary = models.CharField(max_length=300, blank=True, default="")
    cargo_weight_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    packaging_details = models.CharField(max_length=200, blank=True, default="")
    vehicle_requirement = models.CharField(max_length=120, blank=True, default="")
    pickup_deadline = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    assigned_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="assigned_freight_jobs",
    )
    assigned_fee = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    exact_pickup_address = models.CharField(max_length=500, blank=True, default="")
    exact_destination_address = models.CharField(max_length=500, blank=True, default="")
    addresses_disclosed_at = models.DateTimeField(null=True, blank=True)
    delivery_status = models.CharField(
        max_length=20, blank=True, default="",
        choices=[
            ("", "Not started"),
            ("PICKUP_IN_PROGRESS", "En route to pickup"),
            ("ARRIVED_AT_PICKUP", "Arrived at pickup"),
            ("PICKED_UP", "Picked up"),
            ("IN_TRANSIT", "In transit"),
            ("DELIVERED", "Delivered"),
        ],
    )
    delivery_status_updated_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(default=timezone.now)
    assigned_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "freight_jobs"
        ordering = ["-published_at"]

    def clean(self):
        if self.status == self.Status.OPEN and self.assigned_driver_id:
            raise ValidationError("An open job cannot have an assigned driver.")


class FreightBid(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "SUBMITTED", "Submitted"
        ACCEPTED = "ACCEPTED", "Accepted"
        REJECTED = "REJECTED", "Rejected"
        WITHDRAWN = "WITHDRAWN", "Withdrawn"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(FreightJob, on_delete=models.PROTECT, related_name="bids")
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="freight_bids"
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    estimated_hours = models.PositiveIntegerField(default=24)
    message = models.CharField(max_length=300, blank=True, default="")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SUBMITTED)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "freight_bids"
        ordering = ["amount", "-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["job", "driver"], name="unique_bid_per_driver"),
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="freight_bid_positive"),
        ]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Bids are append-only; withdraw and re-bid instead.")
        super().save(*args, **kwargs)


def quantize_fee(value):
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
