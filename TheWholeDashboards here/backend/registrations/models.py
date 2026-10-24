import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from products.models import Category

from .storage import PrivateRegistrationStorage


class LocationLevel(models.TextChoices):
    REGION = "REGION", "Region"
    ZONE = "ZONE", "Zone"
    WOREDA = "WOREDA", "Woreda"
    KEBELE = "KEBELE", "Kebele"
    CITY = "CITY", "City"
    SUBCITY = "SUBCITY", "Sub-city"
    DISTRICT = "DISTRICT", "District"
    OTHER = "OTHER", "Other administrative unit"


class AdministrativeLocation(models.Model):
    """Versionable, parent-linked administrative reference data."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    source_id = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=200)
    alternative_names = models.JSONField(default=list, blank=True)
    level = models.CharField(max_length=20, choices=LocationLevel.choices)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="children",
    )
    active = models.BooleanField(default=True)
    source_url = models.URLField(max_length=500, blank=True, default="")
    source_version = models.CharField(max_length=64, blank=True, default="")
    verified_on = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "administrative_locations"
        ordering = ["name", "source_id"]
        indexes = [
            models.Index(fields=["parent", "active"]),
            models.Index(fields=["level", "active"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["parent", "name"],
                name="reg_loc_parent_name_uq",
            )
        ]

    def clean(self):
        if self.parent_id and self.parent_id == self.pk:
            raise ValidationError({"parent": "A location cannot be its own parent."})
        if self.parent_id and self.parent and self.parent.level == self.level:
            raise ValidationError(
                {"parent": "A location cannot have a parent at the same level."}
            )
        ancestor = self.parent
        while ancestor is not None:
            if self.pk and ancestor.pk == self.pk:
                raise ValidationError({"parent": "Location hierarchy cannot contain a cycle."})
            ancestor = ancestor.parent

    def __str__(self):
        return f"{self.name} ({self.get_level_display()})"


class AdministrativeLocationImport(models.Model):
    """Audit receipt for an idempotent administrative-data import."""

    source_name = models.CharField(max_length=200)
    source_url = models.URLField(max_length=500)
    source_version = models.CharField(max_length=64)
    source_retrieved_on = models.DateField()
    reviewed_on = models.DateField(null=True, blank=True)
    imported_at = models.DateTimeField(auto_now_add=True)
    record_count = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    updated_count = models.PositiveIntegerField(default=0)
    unchanged_count = models.PositiveIntegerField(default=0)
    inactive_count = models.PositiveIntegerField(default=0)
    coverage_report = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "administrative_location_imports"
        ordering = ["-imported_at"]


class ProductCatalogCategory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=100, unique=True)
    name_en = models.CharField(max_length=120)
    name_am = models.CharField(max_length=120, blank=True, default="")
    name_am_latin = models.CharField(max_length=120, blank=True, default="")
    description = models.CharField(max_length=300, blank=True, default="")
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="children",
    )
    sort_order = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)
    registration_enabled = models.BooleanField(default=False)

    class Meta:
        db_table = "product_catalog_categories"
        ordering = ["sort_order", "name_en"]
        constraints = [
            models.UniqueConstraint(
                fields=["parent", "name_en"], name="catalog_category_parent_name_uq"
            )
        ]
        indexes = [
            models.Index(fields=["parent", "active", "sort_order"]),
        ]

    def clean(self):
        if self.parent_id == self.pk and self.pk:
            raise ValidationError({"parent": "A category cannot be its own parent."})
        if self.parent_id and self.parent and self.parent.parent_id:
            raise ValidationError({"parent": "Categories support one subcategory level."})
        ancestor = self.parent
        while ancestor is not None:
            if self.pk and ancestor.pk == self.pk:
                raise ValidationError({"parent": "Category hierarchy cannot contain a cycle."})
            ancestor = ancestor.parent
        if self.parent_id and self.registration_enabled:
            raise ValidationError(
                {"registration_enabled": "Only main categories can be enabled for registration."}
            )

    def __str__(self):
        return self.name_en


class AgriculturalProductType(models.Model):
    """Canonical agricultural catalog product reused by listings and registration."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.SlugField(max_length=100, unique=True)
    name = models.CharField(max_length=200)
    name_am = models.CharField(max_length=200, blank=True, default="")
    name_am_latin = models.CharField(max_length=200, blank=True, default="")
    category = models.CharField(max_length=100)
    catalog_category = models.ForeignKey(
        ProductCatalogCategory,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="products",
    )
    supports_varieties = models.BooleanField(default=False)
    mapping_needs_review = models.BooleanField(default=False)
    review_note = models.CharField(max_length=300, blank=True, default="")
    active = models.BooleanField(default=True)

    class Meta:
        db_table = "agricultural_product_types"
        ordering = ["category", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["category", "name"],
                name="reg_prod_cat_name_uq",
            )
        ]
        indexes = [
            models.Index(fields=["category", "active"]),
            models.Index(fields=["catalog_category", "active"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.category})"


class ProductVariety(models.Model):
    class ReviewStatus(models.TextChoices):
        APPROVED = "APPROVED", "Approved"
        PENDING = "PENDING", "Pending review"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product = models.ForeignKey(
        AgriculturalProductType,
        on_delete=models.PROTECT,
        related_name="varieties",
    )
    name_en = models.CharField(max_length=200)
    name_am = models.CharField(max_length=200, blank=True, default="")
    name_am_latin = models.CharField(max_length=200, blank=True, default="")
    active = models.BooleanField(default=True)
    review_status = models.CharField(
        max_length=16, choices=ReviewStatus.choices, default=ReviewStatus.APPROVED
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "product_varieties"
        ordering = ["name_en"]
        constraints = [
            models.UniqueConstraint(
                fields=["product", "name_en"], name="catalog_variety_product_name_uq"
            )
        ]
        indexes = [models.Index(fields=["product", "active", "review_status"])]

    def __str__(self):
        return f"{self.product.name}: {self.name_en}"


class ProductAlias(models.Model):
    class Language(models.TextChoices):
        ENGLISH = "en", "English"
        AMHARIC = "am", "Amharic"
        AMHARIC_LATIN = "am-Latn", "Amharic Latin"

    product = models.ForeignKey(
        AgriculturalProductType,
        on_delete=models.CASCADE,
        related_name="aliases",
    )
    variety = models.ForeignKey(
        ProductVariety,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="aliases",
    )
    alias = models.CharField(max_length=200)
    normalized_alias = models.CharField(max_length=200, db_index=True)
    language = models.CharField(max_length=12, choices=Language.choices)
    approved = models.BooleanField(default=True)

    class Meta:
        db_table = "product_aliases"
        constraints = [
            models.UniqueConstraint(
                fields=["product", "variety", "normalized_alias"],
                name="catalog_alias_product_variety_name_uq",
            )
        ]


class ProductSuggestion(models.Model):
    class SuggestionType(models.TextChoices):
        PRODUCT = "PRODUCT", "Product"
        VARIETY = "VARIETY", "Variety"

    class ReviewStatus(models.TextChoices):
        PENDING = "PENDING", "Pending review"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    suggested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="product_catalog_suggestions",
    )
    suggested_category = models.ForeignKey(
        ProductCatalogCategory,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="product_suggestions",
    )
    resolved_product = models.ForeignKey(
        AgriculturalProductType,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="resolved_suggestions",
    )
    resolved_variety = models.ForeignKey(
        ProductVariety,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="resolved_suggestions",
    )
    suggestion_type = models.CharField(max_length=12, choices=SuggestionType.choices)
    name = models.CharField(max_length=200)
    language = models.CharField(max_length=12, blank=True, default="")
    parent_product = models.ForeignKey(
        AgriculturalProductType,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="variety_suggestions",
    )
    status = models.CharField(
        max_length=12, choices=ReviewStatus.choices, default=ReviewStatus.PENDING
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reviewed_product_catalog_suggestions",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "product_suggestions"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "-created_at"])]


class RegistrationFieldConfiguration(models.Model):
    class Stage(models.TextChoices):
        INITIAL = "INITIAL", "Initial registration"
        PROFILE = "PROFILE", "Profile completion"

    class FieldKey(models.TextChoices):
        FULL_NAME = "full_name", "Full name"
        EMAIL = "email", "Email address"
        PHONE = "phone", "Phone"
        DATE_OF_BIRTH = "date_of_birth", "Date of birth"
        SEX = "sex", "Sex"
        BUSINESS_NAME = "business_name", "Business name"
        BUSINESS_ADDRESS = "business_address", "Business address"
        LOCATION = "location", "Administrative location"
        PRODUCT_SELECTIONS = "product_selections", "Product interests"
        DRIVING_LICENSE_NUMBER = "driving_license_number", "Driving-license number"
        LICENSE_EXPIRY = "license_expiry", "Driving-license expiry"
        VEHICLE_TYPE = "vehicle_type", "Vehicle type"
        VEHICLE_REGISTRATION = "vehicle_registration", "Vehicle registration"
        CARGO_CAPACITY_KG = "cargo_capacity_kg", "Cargo capacity (kg)"

    field_key = models.CharField(max_length=32, choices=FieldKey.choices)
    stage = models.CharField(max_length=16, choices=Stage.choices)
    label = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True, default="")
    required = models.BooleanField(default=False)
    visible = models.BooleanField(default=True)
    display_order = models.PositiveSmallIntegerField(default=0)
    roles = models.JSONField(default=list)
    options = models.JSONField(default=list, blank=True)
    editable_after_approval = models.BooleanField(default=False)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registration_field_updates",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "registration_field_configurations"
        ordering = ["stage", "display_order", "field_key"]
        constraints = [
            models.UniqueConstraint(
                fields=["field_key", "stage"],
                name="reg_field_stage_key_uq",
            )
        ]

    def __str__(self):
        return f"{self.label} ({self.stage})"


class RegistrationStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    SUBMITTED = "SUBMITTED", "Submitted"
    CHANGES_REQUESTED = "CHANGES_REQUESTED", "Changes Requested"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"


class UserRegistration(models.Model):
    """Role-specific details kept separate from login identity and account status."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="registration",
    )
    date_of_birth = models.DateField(null=True, blank=True)
    sex = models.CharField(max_length=24, blank=True, default="")
    business_name = models.CharField(max_length=255, blank=True, default="")
    business_address = models.CharField(max_length=500, blank=True, default="")
    driving_license_number = models.CharField(max_length=64, blank=True, default="")
    license_expiry = models.DateField(null=True, blank=True)
    vehicle_type = models.CharField(max_length=120, blank=True, default="")
    vehicle_registration = models.CharField(max_length=64, blank=True, default="")
    cargo_capacity_kg = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True
    )
    location = models.ForeignKey(
        AdministrativeLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="registrations",
    )
    status = models.CharField(
        max_length=24,
        choices=RegistrationStatus.choices,
        default=RegistrationStatus.DRAFT,
    )
    legacy_registration = models.BooleanField(default=False)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    product_types = models.ManyToManyField(
        AgriculturalProductType,
        through="RegistrationProductSelection",
        related_name="registrations",
        blank=True,
    )

    class Meta:
        db_table = "user_registrations"
        indexes = [
            models.Index(fields=["status", "submitted_at"]),
            models.Index(fields=["location", "status"]),
        ]

    def __str__(self):
        return f"{self.user_id} registration ({self.status})"


class RegistrationProductSelection(models.Model):
    class Intent(models.TextChoices):
        PRODUCES = "PRODUCES", "Produces"
        BUYS = "BUYS", "Buys"
        SELLS = "SELLS", "Sells"
        HANDLES = "HANDLES", "Handles"

    registration = models.ForeignKey(
        UserRegistration,
        on_delete=models.CASCADE,
        related_name="product_selections",
    )
    product_type = models.ForeignKey(
        AgriculturalProductType, on_delete=models.PROTECT
    )
    intent = models.CharField(max_length=12, choices=Intent.choices)

    class Meta:
        db_table = "registration_product_selections"
        constraints = [
            models.UniqueConstraint(
                fields=["registration", "product_type", "intent"],
                name="reg_prod_intent_uq",
            )
        ]


def private_document_path(instance, filename):
    extension = Path(filename).suffix.lower()
    return f"{instance.registration.user_id}/{uuid.uuid4().hex}{extension}"


class RegistrationDocument(models.Model):
    class VerificationStatus(models.TextChoices):
        PENDING = "PENDING", "Not Verified"
        VERIFIED = "VERIFIED", "Verified"
        REJECTED = "REJECTED", "Correction Required"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    registration = models.ForeignKey(
        UserRegistration,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    document_type = models.CharField(max_length=40, default="BUSINESS_LICENSE")
    original_filename = models.CharField(max_length=255)
    file = models.FileField(
        storage=PrivateRegistrationStorage(),
        upload_to=private_document_path,
        max_length=500,
    )
    verification_status = models.CharField(
        max_length=16,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING,
    )
    verification_note = models.TextField(blank=True, default="")
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="verified_registration_documents",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "registration_documents"
        indexes = [
            models.Index(fields=["registration", "verification_status"]),
        ]


class RegistrationReview(models.Model):
    class Action(models.TextChoices):
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        CHANGES_REQUESTED = "CHANGES_REQUESTED", "Changes Requested"
        LICENSE_VERIFIED = "LICENSE_VERIFIED", "License Verified"
        LICENSE_REJECTED = "LICENSE_REJECTED", "License Correction Required"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    registration = models.ForeignKey(
        UserRegistration,
        on_delete=models.CASCADE,
        related_name="review_history",
    )
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="registration_reviews",
    )
    action = models.CharField(max_length=24, choices=Action.choices)
    reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "registration_reviews"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["registration", "created_at"])]


class AdministratorScope(models.Model):
    class Level(models.TextChoices):
        GLOBAL = "GLOBAL", "Global"
        LOCATION = "LOCATION", "Administrative location"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="administrative_scope",
    )
    level = models.CharField(max_length=12, choices=Level.choices)
    location = models.ForeignKey(
        AdministrativeLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="administrator_scopes",
    )

    class Meta:
        db_table = "administrator_scopes"
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(level="GLOBAL", location__isnull=True)
                    | models.Q(level="LOCATION", location__isnull=False)
                ),
                name="admin_scope_loc_level_ck",
            )
        ]
        indexes = [models.Index(fields=["level", "location"])]

    def clean(self):
        if self.user_id and self.user.role != "USER_ADMIN":
            raise ValidationError({"user": "Only User Admin accounts can have a scope."})
        if (self.level == self.Level.GLOBAL) != (self.location_id is None):
            raise ValidationError(
                {"location": "Global scope has no location; other scopes require one."}
            )

    def __str__(self):
        return f"{self.user_id}: {self.location or self.get_level_display()}"


class DriverIntegrationLink(models.Model):
    """Stable mapping from the canonical Marketplace user to DriverApp."""

    class SyncStatus(models.TextChoices):
        NOT_LINKED = "not_linked", "Not linked"
        PENDING = "pending", "Pending synchronization"
        IN_SYNC = "in_sync", "Synchronized"
        FAILED = "failed", "Synchronization failed"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="driver_integration_link",
    )
    driver_app_user_id = models.CharField(
        max_length=128, blank=True, null=True, unique=True
    )
    driver_app_profile_id = models.CharField(max_length=128, blank=True, default="")
    sync_status = models.CharField(
        max_length=16, choices=SyncStatus.choices, default=SyncStatus.NOT_LINKED
    )
    revision = models.PositiveBigIntegerField(default=0)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, blank=True, default="")
    last_correlation_id = models.UUIDField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "driver_integration_links"
        indexes = [models.Index(fields=["sync_status", "updated_at"])]

    def clean(self):
        if self.user_id and self.user.role != "DRIVER":
            raise ValidationError({"user": "Only Driver accounts can be linked."})


class DriverAuthorizationOutbox(models.Model):
    """Durable, ordered delivery of canonical driver authorization snapshots."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENDING = "sending", "Sending"
        DELIVERED = "delivered", "Delivered"
        BLOCKED = "blocked", "Blocked"

    event_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    link = models.ForeignKey(
        DriverIntegrationLink,
        on_delete=models.PROTECT,
        related_name="outbox_events",
    )
    revision = models.PositiveBigIntegerField()
    payload = models.JSONField()
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    available_at = models.DateTimeField(auto_now_add=True, db_index=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    last_status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "driver_authorization_outbox"
        ordering = ["created_at", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["link", "revision"],
                name="unique_driver_authorization_revision",
            )
        ]
        indexes = [models.Index(fields=["status", "available_at"])]
