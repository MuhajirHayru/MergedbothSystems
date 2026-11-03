import uuid
from pathlib import Path

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.core.files.storage import storages
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


private_document_storage = storages["private_documents"]
SUPPORTED_SHIPMENT_CURRENCIES = ("ETB",)


def validate_shipment_currency(value):
    if value not in SUPPORTED_SHIPMENT_CURRENCIES:
        raise ValidationError(
            f"Currency must be one of: {', '.join(SUPPORTED_SHIPMENT_CURRENCIES)}."
        )


def driver_document_upload_to(instance, filename):
    extension = Path(filename).suffix.lower()
    return f"driver-documents/{instance.application_id}/{uuid.uuid4().hex}{extension}"


def shipment_evidence_upload_to(instance, filename):
    extension = Path(filename).suffix.lower()
    return f"shipment-evidence/{instance.shipment_id}/{uuid.uuid4().hex}{extension}"


class LogisticsUser(AbstractUser):
    class Role(models.TextChoices):
        DRIVER = "driver", "Driver"
        FARMER = "farmer", "Farmer"
        WHOLESALER = "wholesaler", "Wholesaler"
        RETAILER = "retailer", "Retailer"
        FINANCIAL_MANAGER = "financial_manager", "Financial manager"
        ADMINISTRATOR = "administrator", "Administrator"
        SUPER_ADMIN = "super_admin", "Super Admin"
        TOP_USER_ADMIN = "top_user_admin", "Top User Admin"
        REGIONAL_ADMIN = "regional_admin", "Regional Admin"
        ZONAL_ADMIN = "zonal_admin", "Zonal Admin"
        WEREDA_ADMIN = "wereda_admin", "Wereda Admin"

    role = models.CharField(max_length=32, choices=Role.choices, blank=True)
    email_verified = models.BooleanField(default=True)
    external_user_id = models.CharField(
        max_length=128, unique=True, null=True, blank=True
    )
    admin_region = models.CharField(max_length=100, blank=True)
    admin_zone = models.CharField(max_length=100, blank=True)
    admin_wereda = models.CharField(max_length=100, blank=True)

    class Meta:
        indexes = [models.Index(fields=["role", "is_active"])]


class DriverProfile(models.Model):
    class Language(models.TextChoices):
        ENGLISH = "en", "English"
        AMHARIC = "am", "Amharic"
        AFAAN_OROMO = "om", "Afaan Oromo"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="driver_profile",
    )
    phone_number = models.CharField(max_length=32)
    preferred_language = models.CharField(
        max_length=2, choices=Language.choices, default=Language.ENGLISH
    )
    is_available = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Driver profile for {self.user.username}"


class MarketplaceDriverIdentity(models.Model):
    """Idempotent link and authorization snapshot for a canonical Marketplace driver."""

    marketplace_user_id = models.UUIDField(unique=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="marketplace_driver_identity",
    )
    profile = models.OneToOneField(
        DriverProfile,
        on_delete=models.PROTECT,
        related_name="marketplace_identity",
    )
    revision = models.PositiveBigIntegerField(default=0)
    account_status = models.CharField(max_length=20, blank=True, default="")
    account_active = models.BooleanField(default=False)
    application_status = models.CharField(max_length=32, blank=True, default="")
    documents_verified = models.BooleanField(default=False)
    driver_authorized = models.BooleanField(default=False)
    license_expiry = models.DateField(null=True, blank=True)
    last_event_id = models.UUIDField(unique=True)
    payload_sha256 = models.CharField(max_length=64)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["driver_authorized", "updated_at"])]


class DriverApplication(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        ADDITIONAL_INFO_REQUIRED = "additional_info_required", "Additional Information Required"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        SUSPENDED = "suspended", "Suspended"
        EXPIRED = "expired", "Expired"

    profile = models.OneToOneField(
        DriverProfile,
        on_delete=models.PROTECT,
        related_name="application",
    )
    status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.DRAFT, db_index=True
    )
    legal_full_name = models.CharField(max_length=200)
    identity_document_type = models.CharField(max_length=50, blank=True)
    identity_reference = models.CharField(max_length=100, blank=True)
    license_number = models.CharField(max_length=100, blank=True)
    license_expiry = models.DateField(null=True, blank=True)
    vehicle_type = models.CharField(max_length=80, blank=True)
    vehicle_registration = models.CharField(max_length=80, blank=True)
    cargo_capacity_kg = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    service_region = models.CharField(max_length=100, blank=True)
    service_zone = models.CharField(max_length=100, blank=True)
    service_wereda = models.CharField(max_length=100, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_driver_applications",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-submitted_at", "-created_at"]
        indexes = [models.Index(fields=["status", "service_region", "service_zone"])]

    def __str__(self):
        return f"{self.legal_full_name} ({self.status})"


class DriverApplicationReview(models.Model):
    application = models.ForeignKey(
        DriverApplication,
        on_delete=models.PROTECT,
        related_name="review_history",
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        related_name="driver_application_reviews",
    )
    from_status = models.CharField(max_length=32, choices=DriverApplication.Status.choices)
    to_status = models.CharField(max_length=32, choices=DriverApplication.Status.choices)
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Driver application review history is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Driver application review history cannot be deleted.")


class DriverDocument(models.Model):
    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        VERIFIED = "verified", "Verified"
        REJECTED = "rejected", "Rejected"

    application = models.ForeignKey(
        DriverApplication,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    document_type = models.CharField(max_length=50)
    file = models.FileField(
        storage=private_document_storage,
        upload_to=driver_document_upload_to,
        max_length=300,
    )
    verification_status = models.CharField(
        max_length=16,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING,
    )
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_driver_documents",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_reason = models.TextField(blank=True)
    is_current = models.BooleanField(default=True)
    expires_at = models.DateField(null=True, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="uploaded_driver_documents",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["document_type", "-uploaded_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["application", "document_type"],
                condition=Q(is_current=True),
                name="one_current_driver_document_per_type",
            )
        ]

    def __str__(self):
        return f"{self.document_type} for application {self.application_id}"


class SystemSetting(models.Model):
    key = models.SlugField(max_length=100, unique=True)
    value = models.JSONField(default=dict)
    description = models.CharField(max_length=255, blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="updated_logistics_settings",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self):
        return self.key


class AuditEvent(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="logistics_audit_events",
    )
    action = models.CharField(max_length=100)
    object_type = models.CharField(max_length=100)
    object_id = models.CharField(max_length=128, blank=True)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["object_type", "object_id"])]

    def __str__(self):
        return f"{self.action}: {self.object_type} {self.object_id}"[:150]


class MarketplaceOrderAuthorization(models.Model):
    class Status(models.TextChoices):
        ELIGIBLE = "eligible", "Eligible"
        INELIGIBLE = "ineligible", "Ineligible"

    external_order_reference = models.CharField(max_length=128, unique=True)
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="authorized_marketplace_orders",
    )
    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="authorized_marketplace_sales",
    )
    status = models.CharField(max_length=16, choices=Status.choices)
    source_revision = models.PositiveBigIntegerField(default=0)
    source_event_id = models.CharField(max_length=128, blank=True)
    source_updated_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["buyer", "status"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(seller__isnull=True) | ~Q(buyer=F("seller")),
                name="marketplace_order_buyer_differs_from_seller",
            ),
            models.CheckConstraint(
                condition=Q(status="ineligible") | Q(seller__isnull=False),
                name="eligible_marketplace_order_has_seller",
            ),
        ]


class MarketplaceIntegrationEvent(models.Model):
    event_id = models.CharField(max_length=128, unique=True)
    event_type = models.CharField(max_length=40)
    external_order_reference = models.CharField(max_length=128, db_index=True)
    revision = models.PositiveBigIntegerField()
    payload_sha256 = models.CharField(max_length=64)
    response_status = models.PositiveSmallIntegerField(default=200)
    response_payload = models.JSONField(default=dict)
    applied = models.BooleanField(default=False)
    processed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["processed_at", "pk"]
        indexes = [
            models.Index(
                fields=["external_order_reference", "revision"],
                name="log_mkt_evt_ord_rev_idx",
            )
        ]


class MarketplaceShipmentEvent(models.Model):
    event_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    shipment = models.ForeignKey(
        "Shipment", on_delete=models.PROTECT, related_name="marketplace_events"
    )
    event_type = models.CharField(max_length=64)
    details = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["pk"]
        indexes = [models.Index(fields=["shipment", "created_at"])]


class MarketplacePaymentSnapshot(models.Model):
    """Immutable informational copy of an exact marketplace order payment state."""

    source_system = models.CharField(max_length=64)
    event = models.OneToOneField(
        MarketplaceIntegrationEvent,
        on_delete=models.PROTECT,
        related_name="payment_snapshot",
    )
    shipment = models.ForeignKey(
        "Shipment", on_delete=models.PROTECT, related_name="payment_snapshots"
    )
    status = models.CharField(max_length=24)
    revision = models.PositiveBigIntegerField()
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["revision", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["shipment", "revision"],
                name="unique_marketplace_payment_snapshot_revision",
            )
        ]


class MarketplaceDeliveryFeeReview(models.Model):
    class Decision(models.TextChoices):
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    event = models.OneToOneField(
        MarketplaceIntegrationEvent,
        on_delete=models.PROTECT,
        related_name="delivery_fee_review",
    )
    shipment = models.ForeignKey(
        "Shipment",
        on_delete=models.PROTECT,
        related_name="marketplace_delivery_fee_reviews",
    )
    agreement_event_id = models.UUIDField()
    proposal_version = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=3)
    decision = models.CharField(max_length=8, choices=Decision.choices)
    rejection_reason = models.CharField(max_length=2000, blank=True, default="")
    message = models.CharField(max_length=200)
    revision = models.PositiveBigIntegerField()
    occurred_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["revision", "pk"]
        constraints = [
            models.CheckConstraint(
                condition=Q(proposal_version__gt=0),
                name="marketplace_fee_review_version_positive",
            ),
            models.CheckConstraint(
                condition=Q(amount__gt=0),
                name="marketplace_fee_review_amount_positive",
            ),
            models.CheckConstraint(
                condition=Q(currency="ETB"),
                name="marketplace_fee_review_currency_etb",
            ),
            models.CheckConstraint(
                condition=(
                    Q(decision="approved", rejection_reason="")
                    | (Q(decision="rejected") & ~Q(rejection_reason=""))
                ),
                name="marketplace_fee_review_reason_valid",
            ),
            models.UniqueConstraint(
                fields=["shipment", "revision"],
                name="unique_marketplace_fee_review_revision",
            ),
            models.UniqueConstraint(
                fields=["agreement_event_id"],
                name="unique_marketplace_fee_review_agreement",
            ),
        ]


class Shipment(models.Model):
    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        FEE_PROPOSED = "fee_proposed", "Fee proposed"
        NEGOTIATING = "negotiating", "Negotiating"
        FEE_AGREED = "fee_agreed", "Fee agreed"
        OFFERED = "offered", "Offered"
        ASSIGNED = "assigned", "Assigned"
        PICKUP_PENDING = "pickup_pending", "Pickup pending"
        PICKUP_ARRIVED = "pickup_arrived", "Arrived at pickup"
        PICKED_UP = "picked_up", "Picked up"
        IN_TRANSIT = "in_transit", "In transit"
        DELIVERY_ATTEMPTED = "delivery_attempted", "Delivery attempted"
        DELIVERY_CONFIRMATION_REQUESTED = (
            "delivery_confirmation_requested",
            "Delivery confirmation requested",
        )
        DELIVERED = "delivered", "Delivered"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        DISPUTED = "disputed", "Disputed"

    class PaymentStatus(models.TextChoices):
        UNAVAILABLE = "unavailable", "Payment integration unavailable"
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        DISPUTED = "disputed", "Disputed"

    class FeeAgreementStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        AGREED = "agreed", "Agreed"

    external_order_reference = models.CharField(max_length=128, db_index=True)
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requested_shipments",
    )
    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="selling_shipments",
    )
    assigned_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="assigned_shipments",
    )
    order_verified = models.BooleanField(default=False)
    pickup_region = models.CharField(max_length=100)
    pickup_zone = models.CharField(max_length=100, blank=True)
    pickup_wereda = models.CharField(max_length=100, blank=True)
    pickup_kebele = models.CharField(max_length=100, blank=True, default="")
    pickup_address = models.TextField()
    destination_region = models.CharField(max_length=100)
    destination_zone = models.CharField(max_length=100, blank=True)
    destination_wereda = models.CharField(max_length=100, blank=True)
    destination_kebele = models.CharField(max_length=100, blank=True, default="")
    destination_address = models.TextField()
    product_summary = models.CharField(max_length=500)
    external_product_reference = models.CharField(
        max_length=128, blank=True, default=""
    )
    cargo_quantity = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    cargo_quantity_unit = models.CharField(max_length=32, blank=True, default="")
    cargo_weight_kg = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    handling_requirements = models.CharField(max_length=500, blank=True)
    packaging_details = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(
        max_length=40, choices=Status.choices, default=Status.REQUESTED, db_index=True
    )
    fee_agreement_status = models.CharField(
        max_length=16,
        choices=FeeAgreementStatus.choices,
        default=FeeAgreementStatus.PENDING,
        db_index=True,
    )
    currency = models.CharField(
        max_length=3,
        default="ETB",
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES],
        validators=[validate_shipment_currency],
    )
    current_fee_proposal_version = models.PositiveIntegerField(default=0)
    payment_status = models.CharField(
        max_length=16,
        choices=PaymentStatus.choices,
        default=PaymentStatus.UNAVAILABLE,
        db_index=True,
    )
    marketplace_payment_reference = models.CharField(max_length=128, blank=True)
    payment_status_updated_at = models.DateTimeField(null=True, blank=True)
    estimated_pickup_at = models.DateTimeField(null=True, blank=True)
    estimated_delivery_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="cancelled_shipments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["buyer", "status"]),
            models.Index(fields=["assigned_driver", "status"]),
            models.Index(fields=["order_verified", "status", "pickup_region"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["buyer", "external_order_reference"],
                condition=~Q(status="cancelled"),
                name="one_active_shipment_per_buyer_order",
            ),
            models.CheckConstraint(
                condition=Q(seller__isnull=True) | ~Q(buyer=F("seller")),
                name="shipment_buyer_differs_from_seller",
            ),
            models.CheckConstraint(
                condition=~Q(order_verified=True, seller__isnull=True),
                name="verified_shipment_has_seller",
            ),
        ]


class DriverShipmentLocation(models.Model):
    shipment = models.OneToOneField(
        Shipment,
        on_delete=models.CASCADE,
        related_name="driver_location",
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="shipment_locations",
    )
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=10, decimal_places=6, null=True, blank=True
    )
    accuracy_meters = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    observed_at = models.DateTimeField(null=True, blank=True)
    received_at = models.DateTimeField(null=True, blank=True)
    sharing_started_at = models.DateTimeField()
    sharing_stopped_at = models.DateTimeField(null=True, blank=True)
    sharing_expires_at = models.DateTimeField()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(latitude__isnull=True) | Q(latitude__gte=-90, latitude__lte=90),
                name="driver_location_latitude_range",
            ),
            models.CheckConstraint(
                condition=Q(longitude__isnull=True)
                | Q(longitude__gte=-180, longitude__lte=180),
                name="driver_location_longitude_range",
            ),
        ]
        indexes = [models.Index(fields=["driver", "sharing_expires_at"])]


class ShipmentOffer(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        EXPIRED = "expired", "Expired"
        WITHDRAWN = "withdrawn", "Withdrawn"

    shipment = models.ForeignKey(
        Shipment, on_delete=models.PROTECT, related_name="offers"
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shipment_offers",
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    expires_at = models.DateTimeField(db_index=True)
    response_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["shipment", "driver"], name="one_offer_per_shipment_driver"
            )
        ]
        indexes = [models.Index(fields=["driver", "status", "expires_at"])]


class ShipmentFeeProposal(models.Model):
    class Status(models.TextChoices):
        PROPOSED = "proposed", "Proposed"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        SUPERSEDED = "superseded", "Superseded"
        WITHDRAWN = "withdrawn", "Withdrawn"

    shipment = models.ForeignKey(
        Shipment, on_delete=models.PROTECT, related_name="fee_proposals"
    )
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shipment_fee_proposals",
    )
    target_driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="targeted_shipment_fee_proposals",
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
    )
    currency = models.CharField(
        max_length=3,
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES],
        validators=[validate_shipment_currency],
    )
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PROPOSED, db_index=True
    )
    response_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["shipment", "version"],
                name="unique_shipment_fee_proposal_version",
            ),
            models.CheckConstraint(
                condition=Q(version__gt=0),
                name="shipment_fee_proposal_version_positive",
            ),
            models.CheckConstraint(
                condition=Q(amount__gt=0),
                name="shipment_fee_proposal_amount_positive",
            )
        ]
        indexes = [models.Index(fields=["shipment", "status"])]


class ShipmentFeeAgreement(models.Model):
    shipment = models.OneToOneField(
        Shipment, on_delete=models.PROTECT, related_name="fee_agreement"
    )
    proposal = models.ForeignKey(
        ShipmentFeeProposal, on_delete=models.PROTECT, related_name="agreements"
    )
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="accepted_shipment_fees",
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="agreed_shipment_fees",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(
        max_length=3,
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES],
        validators=[validate_shipment_currency],
    )
    buyer_accepted_at = models.DateTimeField()
    driver_accepted_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(amount__gt=0),
                name="shipment_fee_agreement_amount_positive",
            )
        ]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Shipment fee agreements are immutable.")
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Shipment fee agreements cannot be deleted.")


class ShipmentTransition(models.Model):
    shipment = models.ForeignKey(
        Shipment, on_delete=models.PROTECT, related_name="transitions"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="shipment_transitions",
    )
    from_status = models.CharField(max_length=40, choices=Shipment.Status.choices)
    to_status = models.CharField(max_length=40, choices=Shipment.Status.choices)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Shipment transition history is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Shipment transition history cannot be deleted.")


class ShipmentMessage(models.Model):
    shipment = models.ForeignKey(
        Shipment, on_delete=models.PROTECT, related_name="messages"
    )
    offer = models.ForeignKey(
        ShipmentOffer,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="messages",
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shipment_messages",
    )
    body = models.CharField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]
        indexes = [models.Index(fields=["shipment", "created_at"])]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Shipment messages are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Shipment messages cannot be deleted.")


class ShipmentEvidence(models.Model):
    class Type(models.TextChoices):
        PICKUP = "pickup", "Pickup"
        DELIVERY_ATTEMPT = "delivery_attempt", "Delivery attempt"
        DELIVERY_CONFIRMATION = "delivery_confirmation", "Delivery confirmation"
        OTHER = "other", "Other"

    shipment = models.ForeignKey(
        Shipment, on_delete=models.PROTECT, related_name="evidence"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shipment_evidence",
    )
    evidence_type = models.CharField(max_length=24, choices=Type.choices)
    file = models.FileField(
        storage=private_document_storage,
        upload_to=shipment_evidence_upload_to,
        max_length=300,
    )
    description = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ShipmentException(models.Model):
    class Type(models.TextChoices):
        DELAY = "delay", "Delay"
        INCIDENT = "incident", "Incident"
        FAILED_DELIVERY = "failed_delivery", "Failed delivery"

    shipment = models.ForeignKey(
        Shipment, on_delete=models.PROTECT, related_name="exceptions"
    )
    reported_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="shipment_exceptions",
    )
    exception_type = models.CharField(max_length=24, choices=Type.choices)
    reason = models.CharField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)


class ShipmentNotification(models.Model):
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="shipment_notifications",
    )
    shipment = models.ForeignKey(
        Shipment, on_delete=models.CASCADE, related_name="notifications"
    )
    event_type = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
        indexes = [models.Index(fields=["recipient", "created_at"])]


class ShipmentConversationRead(models.Model):
    """Per-participant read marker for a shipment-scoped conversation."""

    shipment = models.ForeignKey(
        Shipment, on_delete=models.CASCADE, related_name="conversation_reads"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="shipment_conversation_reads",
    )
    last_read_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_read_at", "-pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["shipment", "user"],
                name="unique_shipment_conversation_read",
            )
        ]
        indexes = [models.Index(fields=["user", "last_read_at"])]


class AssistantConversation(models.Model):
    """Authenticated assistant thread scoped to one logistics account."""

    class Role(models.TextChoices):
        DRIVER = "driver", "Driver"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assistant_conversations",
    )
    title = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-pk"]
        indexes = [models.Index(fields=["user", "updated_at"])]


class AssistantMessage(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"

    conversation = models.ForeignKey(
        AssistantConversation, on_delete=models.CASCADE, related_name="messages"
    )
    role = models.CharField(max_length=16, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "pk"]
        indexes = [models.Index(fields=["conversation", "created_at"])]

