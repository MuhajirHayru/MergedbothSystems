import re
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model, password_validation
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field

from .configuration import (
    allowed_driver_document_types,
    max_driver_document_bytes,
)
from .models import (
    AssistantConversation,
    AssistantMessage,
    DriverApplication,
    DriverDocument,
    DriverProfile,
    LogisticsUser,
    Shipment,
    ShipmentEvidence,
    ShipmentException,
    ShipmentFeeProposal,
    ShipmentMessage,
    ShipmentNotification,
    ShipmentOffer,
    SUPPORTED_SHIPMENT_CURRENCIES,
)

User = get_user_model()


class CsrfTokenSerializer(serializers.Serializer):
    csrf_token = serializers.CharField()


class AuthCredentialsSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class AccountActivationSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class ActionDetailSerializer(serializers.Serializer):
    detail = serializers.CharField()


class RegistrationResponseSerializer(ActionDetailSerializer):
    development_activation = serializers.DictField(required=False)


class PasswordResetResponseSerializer(ActionDetailSerializer):
    development_reset = serializers.DictField(required=False)


class CurrentUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "email_verified",
            "is_active",
        ]
        read_only_fields = fields


class DriverRegistrationSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    legal_full_name = serializers.CharField(max_length=200)
    phone_number = serializers.CharField(max_length=32)
    preferred_language = serializers.ChoiceField(choices=DriverProfile.Language.choices)

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value.lower()

    def validate_password(self, value):
        try:
            password_validation.validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value


class DriverProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = DriverProfile
        fields = ["phone_number", "preferred_language"]


class DriverAvailabilityInputSerializer(serializers.Serializer):
    available = serializers.BooleanField()


class DriverApplicationInputSerializer(serializers.ModelSerializer):
    phone_number = serializers.CharField(source="profile.phone_number", required=False)
    preferred_language = serializers.ChoiceField(
        source="profile.preferred_language",
        choices=DriverProfile.Language.choices,
        required=False,
    )

    class Meta:
        model = DriverApplication
        fields = [
            "legal_full_name",
            "identity_document_type",
            "identity_reference",
            "license_number",
            "license_expiry",
            "vehicle_type",
            "vehicle_registration",
            "cargo_capacity_kg",
            "service_region",
            "service_zone",
            "service_wereda",
            "phone_number",
            "preferred_language",
        ]

    def validate_cargo_capacity_kg(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Cargo capacity must be greater than zero.")
        return value

    def validate(self, attrs):
        application = self.instance
        if application and application.status not in {
            DriverApplication.Status.DRAFT,
            DriverApplication.Status.ADDITIONAL_INFO_REQUIRED,
        }:
            raise serializers.ValidationError(
                "Submitted application details are locked pending reviewer action."
            )
        return attrs

    def update(self, instance, validated_data):
        profile_data = validated_data.pop("profile", {})
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if profile_data:
            for field, value in profile_data.items():
                setattr(instance.profile, field, value)
            instance.profile.save()
        return instance


class DriverDocumentMetadataSerializer(serializers.ModelSerializer):
    verified_by = serializers.CharField(source="verified_by.username", read_only=True)

    class Meta:
        model = DriverDocument
        fields = [
            "id",
            "document_type",
            "verification_status",
            "verified_by",
            "verified_at",
            "verification_reason",
            "expires_at",
            "uploaded_at",
        ]
        read_only_fields = fields


class DriverApplicationSerializer(serializers.ModelSerializer):
    profile = DriverProfileSerializer(read_only=True)
    documents = serializers.SerializerMethodField()
    review_history = serializers.SerializerMethodField()

    class Meta:
        model = DriverApplication
        fields = [
            "id",
            "status",
            "legal_full_name",
            "identity_document_type",
            "identity_reference",
            "license_number",
            "license_expiry",
            "vehicle_type",
            "vehicle_registration",
            "cargo_capacity_kg",
            "service_region",
            "service_zone",
            "service_wereda",
            "submitted_at",
            "reviewed_at",
            "review_reason",
            "created_at",
            "updated_at",
            "profile",
            "documents",
            "review_history",
        ]
        read_only_fields = fields

    @extend_schema_field(DriverDocumentMetadataSerializer(many=True))
    def get_documents(self, application):
        return DriverDocumentMetadataSerializer(
            application.documents.filter(is_current=True), many=True
        ).data

    @extend_schema_field(serializers.ListField(child=serializers.DictField()))
    def get_review_history(self, application):
        return [
            {
                "from_status": review.from_status,
                "to_status": review.to_status,
                "reason": review.reason,
                "reviewer": review.reviewer.username if review.reviewer else None,
                "created_at": review.created_at,
            }
            for review in application.review_history.select_related("reviewer")
        ]


class ReviewerDriverApplicationSerializer(DriverApplicationSerializer):
    username = serializers.CharField(source="profile.user.username", read_only=True)
    email = serializers.EmailField(source="profile.user.email", read_only=True)

    class Meta(DriverApplicationSerializer.Meta):
        fields = DriverApplicationSerializer.Meta.fields + [
            "username",
            "email",
            "review_history",
        ]

class DocumentUploadSerializer(serializers.Serializer):
    document_type = serializers.CharField(max_length=50)
    file = serializers.FileField()
    expires_at = serializers.DateField(required=False, allow_null=True)

    def validate_document_type(self, value):
        if value not in allowed_driver_document_types():
            raise serializers.ValidationError("Unsupported document type.")
        return value

    def validate_file(self, uploaded_file):
        if uploaded_file.size > max_driver_document_bytes():
            raise serializers.ValidationError("File exceeds the configured size limit.")

        extension = uploaded_file.name.rsplit(".", 1)[-1].lower() if "." in uploaded_file.name else ""
        signature = uploaded_file.read(8)
        uploaded_file.seek(0)
        signatures = {
            "pdf": signature.startswith(b"%PDF-"),
            "png": signature.startswith(b"\x89PNG\r\n\x1a\n"),
            "jpg": signature.startswith(b"\xff\xd8\xff"),
            "jpeg": signature.startswith(b"\xff\xd8\xff"),
        }
        if extension not in signatures or not signatures[extension]:
            raise serializers.ValidationError("Upload a valid PDF, PNG, or JPEG document.")
        return uploaded_file


class ReviewActionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=DriverApplication.Status.choices)
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate(self, attrs):
        if attrs["status"] in {
            DriverApplication.Status.DRAFT,
            DriverApplication.Status.SUBMITTED,
            DriverApplication.Status.EXPIRED,
        }:
            raise serializers.ValidationError("This status is not an administrative decision.")
        if not attrs["reason"]:
            raise serializers.ValidationError({"reason": "A reason is required."})
        return attrs


class DocumentVerificationSerializer(serializers.Serializer):
    verification_status = serializers.ChoiceField(
        choices=[
            DriverDocument.VerificationStatus.VERIFIED,
            DriverDocument.VerificationStatus.REJECTED,
        ]
    )
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A reason is required.")
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value):
        try:
            password_validation.validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value


class ShipmentRequestSerializer(serializers.ModelSerializer):
    initial_fee = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    currency = serializers.ChoiceField(
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES]
    )

    class Meta:
        model = Shipment
        fields = [
            "external_order_reference",
            "pickup_region",
            "pickup_zone",
            "pickup_wereda",
            "pickup_kebele",
            "pickup_address",
            "destination_region",
            "destination_zone",
            "destination_wereda",
            "destination_kebele",
            "destination_address",
            "product_summary",
            "external_product_reference",
            "cargo_quantity",
            "cargo_quantity_unit",
            "cargo_weight_kg",
            "handling_requirements",
            "packaging_details",
            "estimated_pickup_at",
            "estimated_delivery_at",
            "initial_fee",
            "currency",
        ]

    def validate_external_order_reference(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("An external order reference is required.")
        return value

    def validate_cargo_weight_kg(self, value):
        if value is not None and value <= 0:
            raise serializers.ValidationError("Cargo weight must be greater than zero.")
        return value

    def validate(self, attrs):
        for field in (
            "pickup_region",
            "pickup_address",
            "destination_region",
            "destination_address",
            "product_summary",
        ):
            if not attrs.get(field, "").strip():
                raise serializers.ValidationError({field: "This field is required."})
        pickup = attrs.get("estimated_pickup_at")
        delivery = attrs.get("estimated_delivery_at")
        if pickup and delivery and delivery < pickup:
            raise serializers.ValidationError(
                {"estimated_delivery_at": "Delivery cannot be estimated before pickup."}
            )
        return attrs


class StrictIntegrationSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict):
            unknown = set(data) - set(self.fields)
            if unknown:
                raise serializers.ValidationError(
                    {key: "Unknown field." for key in sorted(unknown)}
                )
        return super().to_internal_value(data)


class IntegrationParticipantSerializer(StrictIntegrationSerializer):
    external_user_id = serializers.CharField(max_length=128, trim_whitespace=True)
    role = serializers.ChoiceField(
        choices=[
            LogisticsUser.Role.FARMER,
            LogisticsUser.Role.WHOLESALER,
            LogisticsUser.Role.RETAILER,
        ]
    )


class OffsetDateTimeField(serializers.DateTimeField):
    def to_internal_value(self, value):
        if not isinstance(value, str) or not re.search(
            r"(?:Z|[+-]\d{2}:\d{2})$", value, re.IGNORECASE
        ):
            raise serializers.ValidationError(
                "Use an ISO-8601 timestamp with an explicit UTC offset."
            )
        return super().to_internal_value(value)


class MarketplaceShipmentDetailsSerializer(StrictIntegrationSerializer):
    pickup_region = serializers.CharField(max_length=100)
    pickup_zone = serializers.CharField(max_length=100, required=False, allow_blank=True)
    pickup_wereda = serializers.CharField(max_length=100, required=False, allow_blank=True)
    pickup_address = serializers.CharField(max_length=2000)
    destination_region = serializers.CharField(max_length=100)
    destination_zone = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    destination_wereda = serializers.CharField(
        max_length=100, required=False, allow_blank=True
    )
    destination_address = serializers.CharField(max_length=2000)
    product_summary = serializers.CharField(max_length=500)
    cargo_weight_kg = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal("0.01"), required=False
    )
    handling_requirements = serializers.CharField(
        max_length=500, required=False, allow_blank=True
    )
    estimated_pickup_at = OffsetDateTimeField(required=False, allow_null=True)
    estimated_delivery_at = OffsetDateTimeField(required=False, allow_null=True)

    def validate(self, attrs):
        for field in (
            "pickup_region",
            "pickup_address",
            "destination_region",
            "destination_address",
            "product_summary",
        ):
            if not attrs.get(field, "").strip():
                raise serializers.ValidationError({field: "This field is required."})
        pickup = attrs.get("estimated_pickup_at")
        delivery = attrs.get("estimated_delivery_at")
        if pickup and delivery and delivery < pickup:
            raise serializers.ValidationError(
                {"estimated_delivery_at": "Delivery cannot be estimated before pickup."}
            )
        return attrs


class MarketplaceDeliveryFeeSerializer(StrictIntegrationSerializer):
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    currency = serializers.ChoiceField(
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES]
    )


class MarketplacePaymentStatusSerializer(StrictIntegrationSerializer):
    status = serializers.ChoiceField(
        choices=[
            Shipment.PaymentStatus.PENDING,
            Shipment.PaymentStatus.PAID,
            Shipment.PaymentStatus.FAILED,
            Shipment.PaymentStatus.DISPUTED,
        ]
    )
    reference = serializers.CharField(max_length=128, required=False, allow_blank=True)


class MarketplaceV2AddressSerializer(StrictIntegrationSerializer):
    region = serializers.CharField(max_length=100)
    zone = serializers.CharField(max_length=100, allow_null=True, required=False)
    wereda = serializers.CharField(max_length=100, allow_null=True, required=False)
    kebele = serializers.CharField(max_length=100, allow_null=True, required=False)
    address_line = serializers.CharField(max_length=500)

    def validate(self, attrs):
        if not attrs["region"].strip() or not attrs["address_line"].strip():
            raise serializers.ValidationError("Region and address line are required.")
        return attrs


class MarketplaceV2ShipmentProductSerializer(StrictIntegrationSerializer):
    id = serializers.UUIDField()
    description = serializers.CharField(max_length=400, trim_whitespace=True)
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    unit = serializers.CharField(max_length=32, trim_whitespace=True)

    def validate(self, attrs):
        if not attrs["description"] or not attrs["unit"]:
            raise serializers.ValidationError("Product description and unit are required.")
        return attrs


class MarketplaceV2ShipmentSerializer(StrictIntegrationSerializer):
    pickup = MarketplaceV2AddressSerializer()
    destination = MarketplaceV2AddressSerializer()
    product = MarketplaceV2ShipmentProductSerializer()
    cargo_weight_kg = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    packaging_details = serializers.CharField(max_length=500, trim_whitespace=True)
    details_revision = serializers.IntegerField(min_value=1)

    def validate_packaging_details(self, value):
        if not value:
            raise serializers.ValidationError("Packaging details are required.")
        return value


class MarketplaceV2FeeProposalSerializer(StrictIntegrationSerializer):
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    currency = serializers.ChoiceField(choices=SUPPORTED_SHIPMENT_CURRENCIES)
    proposer = serializers.ChoiceField(choices=["buyer"])
    version = serializers.IntegerField(min_value=1)


class MarketplaceV2PaymentSerializer(StrictIntegrationSerializer):
    status = serializers.ChoiceField(
        choices=[
            "RESERVED",
            "HELD",
            "RELEASE_PENDING",
            "RELEASED",
            "REFUNDED",
            "DISPUTED",
        ]
    )


class MarketplaceV2DeliveryFeeReviewSerializer(StrictIntegrationSerializer):
    agreement_event_id = serializers.UUIDField()
    shipment_id = serializers.IntegerField(min_value=1)
    proposal_version = serializers.IntegerField(min_value=1)
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    currency = serializers.ChoiceField(choices=["ETB"])
    decision = serializers.ChoiceField(choices=["approved", "rejected"])
    rejection_reason = serializers.CharField(
        max_length=2000, trim_whitespace=True, required=False, allow_blank=True
    )
    message = serializers.CharField(max_length=200, trim_whitespace=True)

    def validate_agreement_event_id(self, value):
        root_data = getattr(self.root, "initial_data", {})
        review_data = root_data.get("delivery_fee_review", {})
        if review_data.get("agreement_event_id") != str(value):
            raise serializers.ValidationError("Use the canonical lowercase UUID form.")
        return value

    def validate(self, attrs):
        root_data = getattr(self.root, "initial_data", {})
        review_data = root_data.get("delivery_fee_review", {})
        if isinstance(review_data.get("proposal_version"), bool) or isinstance(
            review_data.get("shipment_id"), bool
        ):
            raise serializers.ValidationError(
                "Shipment and proposal references must be positive integers."
            )
        if attrs["decision"] == "rejected":
            if not attrs.get("rejection_reason", "").strip():
                raise serializers.ValidationError(
                    {"rejection_reason": "A rejection reason is required."}
                )
        elif "rejection_reason" in review_data:
            raise serializers.ValidationError(
                {"rejection_reason": "A rejection reason is only valid for a rejection."}
            )
        if set(review_data) - {
            "agreement_event_id",
            "shipment_id",
            "proposal_version",
            "amount",
            "currency",
            "decision",
            "message",
            *({"rejection_reason"} if attrs["decision"] == "rejected" else set()),
        }:
            raise serializers.ValidationError("Unexpected delivery-fee review fields.")
        return attrs


class MarketplaceDriverAuthorizationSerializer(StrictIntegrationSerializer):
    account_status = serializers.CharField(max_length=20)
    account_active = serializers.BooleanField()
    application_status = serializers.CharField(max_length=32)
    driver_authorized = serializers.BooleanField()
    documents_verified = serializers.BooleanField()
    license_expiry = serializers.DateField(allow_null=True)
    legal_full_name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=32)
    service_region = serializers.CharField(max_length=100, allow_blank=True)
    service_zone = serializers.CharField(max_length=100, allow_blank=True)
    service_wereda = serializers.CharField(max_length=100, allow_blank=True)
    service_kebele = serializers.CharField(max_length=100, allow_blank=True)
    license_number = serializers.CharField(max_length=64, allow_blank=True)
    vehicle_type = serializers.CharField(max_length=120, allow_blank=True)
    vehicle_registration = serializers.CharField(max_length=64, allow_blank=True)
    cargo_capacity_kg = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
        allow_null=True,
    )


class MarketplaceV2EventSerializer(StrictIntegrationSerializer):
    contract_version = serializers.ChoiceField(choices=["2"])
    source_system = serializers.ChoiceField(choices=["greenpath_marketplace"])
    event_id = serializers.UUIDField()
    event_type = serializers.ChoiceField(
        choices=[
            "order.authorized",
            "order.cancelled",
            "payment.status_snapshot",
            "delivery_fee.reviewed",
            "driver.authorization_snapshot",
        ]
    )
    occurred_at = OffsetDateTimeField()
    revision = serializers.IntegerField(min_value=1, max_value=9223372036854775807)
    order_reference = serializers.UUIDField(required=False)
    canonical_user_id = serializers.UUIDField(required=False)
    buyer = IntegrationParticipantSerializer(required=False)
    seller = IntegrationParticipantSerializer(required=False)
    shipment = MarketplaceV2ShipmentSerializer(required=False)
    delivery_fee_proposal = MarketplaceV2FeeProposalSerializer(required=False)
    payment = MarketplaceV2PaymentSerializer(required=False)
    delivery_fee_review = MarketplaceV2DeliveryFeeReviewSerializer(required=False)
    driver_authorization = MarketplaceDriverAuthorizationSerializer(required=False)
    cancellation_reason = serializers.CharField(
        max_length=2000, trim_whitespace=True, required=False
    )

    def validate_event_id(self, value):
        if self.initial_data.get("event_id") != str(value):
            raise serializers.ValidationError("Use the canonical lowercase UUID form.")
        return value

    def validate_order_reference(self, value):
        if self.initial_data.get("order_reference") != str(value):
            raise serializers.ValidationError("Use the canonical lowercase UUID form.")
        return value

    def validate(self, attrs):
        if attrs["occurred_at"] > timezone.now() + timedelta(
            seconds=settings.MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS
        ):
            raise serializers.ValidationError(
                {"occurred_at": "Event timestamps cannot be in the future."}
            )
        event_type = attrs["event_type"]
        if event_type == "driver.authorization_snapshot":
            required = {"canonical_user_id", "driver_authorization"}
            allowed = {
                "contract_version", "source_system", "event_id", "event_type",
                "occurred_at", "revision", "canonical_user_id", "driver_authorization",
            }
        else:
            required = (
            {"buyer", "seller", "shipment", "delivery_fee_proposal"}
            if event_type == "order.authorized"
            else (
                {"buyer", "seller", "cancellation_reason"}
                if event_type == "order.cancelled"
                else (
                    {"delivery_fee_review"}
                    if event_type == "delivery_fee.reviewed"
                    else {"payment"}
                )
            )
        )
            allowed = {
            "order.authorized": {
                "contract_version", "source_system", "event_id", "event_type",
                "occurred_at", "revision", "order_reference", "buyer", "seller",
                "shipment", "delivery_fee_proposal",
            },
            "payment.status_snapshot": {
                "contract_version", "source_system", "event_id", "event_type",
                "occurred_at", "revision", "order_reference", "payment",
            },
            "delivery_fee.reviewed": {
                "contract_version", "source_system", "event_id", "event_type",
                "occurred_at", "revision", "order_reference", "delivery_fee_review",
            },
            "order.cancelled": {
                "contract_version", "source_system", "event_id", "event_type",
                "occurred_at", "revision", "order_reference", "buyer", "seller",
                "cancellation_reason",
            },
            }[event_type]
        errors = {
            field: "This field is required for this event type."
            for field in required - set(attrs)
        }
        unexpected = set(self.initial_data) - allowed
        errors.update({field: "This field is not valid for this event type." for field in unexpected})
        if (
            event_type == "order.cancelled"
            and "cancellation_reason" in attrs
            and not attrs["cancellation_reason"]
        ):
            errors["cancellation_reason"] = "A cancellation reason is required."
        if errors:
            raise serializers.ValidationError(errors)
        if event_type == "driver.authorization_snapshot":
            snapshot = attrs["driver_authorization"]
            expected_authorized = bool(
                snapshot["account_active"]
                and snapshot["account_status"] == "APPROVED"
                and snapshot["application_status"] == "approved"
                and snapshot["documents_verified"]
                and snapshot["license_expiry"]
                and snapshot["license_expiry"] > timezone.localdate()
            )
            if snapshot["driver_authorized"] != expected_authorized:
                raise serializers.ValidationError(
                    {"driver_authorization": "Authorization flags do not match the verified account state."}
                )
        return attrs


class _MarketplaceOrderSerializer(StrictIntegrationSerializer):
    class Meta:
        ref_name = "MarketplaceOrderEventOrder"

    id = serializers.CharField(max_length=128, trim_whitespace=True)
    status = serializers.ChoiceField(choices=["authorized", "cancelled"])
    buyer = IntegrationParticipantSerializer()
    seller = IntegrationParticipantSerializer()
    shipment = MarketplaceShipmentDetailsSerializer(required=False)
    delivery_fee = MarketplaceDeliveryFeeSerializer(required=False)
    payment = MarketplacePaymentStatusSerializer(required=False)
    cancellation_reason = serializers.CharField(
        max_length=2000, required=False, allow_blank=True
    )

    def validate_id(self, value):
        if not value:
            raise serializers.ValidationError("An order ID is required.")
        return value


class MarketplaceOrderEventSerializer(StrictIntegrationSerializer):
    contract_version = serializers.ChoiceField(choices=["1"])
    event_id = serializers.CharField(max_length=128, trim_whitespace=True)
    event_type = serializers.ChoiceField(
        choices=["order.authorized", "order.cancelled", "payment.status_changed"]
    )
    occurred_at = OffsetDateTimeField()
    revision = serializers.IntegerField(min_value=1, max_value=9223372036854775807)
    order = _MarketplaceOrderSerializer()

    def validate_event_id(self, value):
        if not value:
            raise serializers.ValidationError("An event ID is required.")
        return value

    def validate(self, attrs):
        if attrs["occurred_at"] > timezone.now() + timedelta(
            seconds=settings.MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS
        ):
            raise serializers.ValidationError(
                {"occurred_at": "Event timestamps cannot be in the future."}
            )
        order = attrs["order"]
        event_type = attrs["event_type"]
        required_status = {
            "order.authorized": "authorized",
            "order.cancelled": "cancelled",
            "payment.status_changed": "authorized",
        }[event_type]
        if order["status"] != required_status:
            raise serializers.ValidationError(
                {"order": {"status": f"This event requires status '{required_status}'."}}
            )
        allowed_order_fields = {
            "order.authorized": {
                "id",
                "status",
                "buyer",
                "seller",
                "shipment",
                "delivery_fee",
                "payment",
            },
            "order.cancelled": {
                "id",
                "status",
                "buyer",
                "seller",
                "cancellation_reason",
            },
            "payment.status_changed": {"id", "status", "buyer", "seller", "payment"},
        }[event_type]
        unexpected_fields = set(order) - allowed_order_fields
        if unexpected_fields:
            raise serializers.ValidationError(
                {
                    "order": {
                        key: "This field is not valid for this event type."
                        for key in sorted(unexpected_fields)
                    }
                }
            )
        if event_type == "order.authorized":
            for key in ("shipment", "delivery_fee"):
                if key not in order:
                    raise serializers.ValidationError(
                        {"order": {key: "This field is required for an authorized order."}}
                    )
        elif event_type == "order.cancelled":
            if not order.get("cancellation_reason", "").strip():
                raise serializers.ValidationError(
                    {"order": {"cancellation_reason": "A cancellation reason is required."}}
                )
        elif "payment" not in order:
            raise serializers.ValidationError(
                {"order": {"payment": "This field is required for a payment update."}}
            )
        return attrs


class MarketplaceIntegrationAcknowledgementSerializer(serializers.Serializer):
    event_id = serializers.CharField()
    status = serializers.CharField()
    order_reference = serializers.CharField()
    shipment_id = serializers.IntegerField(required=False)
    shipment_status = serializers.CharField(required=False)
    order_verified = serializers.BooleanField(required=False)
    fee_agreement_status = serializers.CharField(required=False)
    payment_status = serializers.CharField(required=False)
    offers_created = serializers.IntegerField(required=False)


class MarketplaceOutboundEventSerializer(serializers.Serializer):
    event_id = serializers.UUIDField()
    cursor = serializers.IntegerField()
    event_type = serializers.CharField()
    occurred_at = serializers.DateTimeField()
    order_reference = serializers.CharField()
    shipment_id = serializers.IntegerField()
    details = serializers.DictField()


class MarketplaceShipmentEventPageSerializer(serializers.Serializer):
    results = MarketplaceOutboundEventSerializer(many=True)
    next_cursor = serializers.IntegerField()
    has_more = serializers.BooleanField()


class ShipmentFeeProposalSerializer(serializers.ModelSerializer):
    proposed_by_role = serializers.CharField(source="proposed_by.role", read_only=True)
    offer_reference = serializers.SerializerMethodField()

    class Meta:
        model = ShipmentFeeProposal
        fields = [
            "id",
            "amount",
            "currency",
            "status",
            "version",
            "proposed_by_role",
            "offer_reference",
            "response_reason",
            "created_at",
            "responded_at",
        ]
        read_only_fields = fields

    def get_offer_reference(self, proposal):
        if proposal.target_driver_id is None:
            return None
        return (
            ShipmentOffer.objects.filter(
                shipment=proposal.shipment,
                driver_id=proposal.target_driver_id,
            )
            .values_list("pk", flat=True)
            .first()
        )


class ShipmentSerializer(serializers.ModelSerializer):
    pickup_address = serializers.SerializerMethodField()
    destination_address = serializers.SerializerMethodField()
    external_order_reference = serializers.SerializerMethodField()
    fee_proposals = serializers.SerializerMethodField()
    assigned_driver_username = serializers.CharField(
        source="assigned_driver.username", read_only=True, allow_null=True
    )
    buyer_username = serializers.CharField(source="buyer.username", read_only=True)
    current_fee = serializers.SerializerMethodField()
    evidence = serializers.SerializerMethodField()
    transitions = serializers.SerializerMethodField()
    exceptions = serializers.SerializerMethodField()
    evidence_requirements = serializers.SerializerMethodField()

    class Meta:
        model = Shipment
        fields = [
            "id",
            "external_order_reference",
            "buyer_username",
            "assigned_driver_username",
            "order_verified",
            "pickup_region",
            "pickup_zone",
            "pickup_wereda",
            "pickup_address",
            "destination_region",
            "destination_zone",
            "destination_wereda",
            "destination_address",
            "product_summary",
            "cargo_weight_kg",
            "handling_requirements",
            "packaging_details",
            "status",
            "fee_agreement_status",
            "currency",
            "current_fee_proposal_version",
            "payment_status",
            "estimated_pickup_at",
            "estimated_delivery_at",
            "cancellation_reason",
            "created_at",
            "updated_at",
            "fee_proposals",
            "current_fee",
            "evidence",
            "transitions",
            "exceptions",
            "evidence_requirements",
        ]
        read_only_fields = fields

    def _can_view_private_details(self, shipment):
        user = self.context["request"].user
        if shipment.status in {
            Shipment.Status.CANCELLED,
            Shipment.Status.COMPLETED,
            Shipment.Status.DISPUTED,
        }:
            return False
        if not shipment.order_verified:
            return user.pk in {shipment.buyer_id, shipment.assigned_driver_id}
        if user.pk in {shipment.buyer_id, shipment.seller_id}:
            return True
        if user.pk != shipment.assigned_driver_id or not user.is_active:
            return False
        application = getattr(
            getattr(user, "driver_profile", None), "application", None
        )
        return bool(
            application
            and application.status == DriverApplication.Status.APPROVED
            and application.license_expiry
            and application.license_expiry >= timezone.localdate()
        )

    def get_pickup_address(self, shipment):
        return shipment.pickup_address if self._can_view_private_details(shipment) else None

    def get_destination_address(self, shipment):
        return (
            shipment.destination_address
            if self._can_view_private_details(shipment)
            else None
        )

    def get_external_order_reference(self, shipment):
        if self.context["request"].user.pk == shipment.buyer_id:
            return shipment.external_order_reference
        return None

    def get_fee_proposals(self, shipment):
        user = self.context["request"].user
        proposals = shipment.fee_proposals.all()
        if user.pk != shipment.buyer_id:
            proposals = proposals.filter(status=ShipmentFeeProposal.Status.ACCEPTED)
        return ShipmentFeeProposalSerializer(proposals, many=True).data

    def get_current_fee(self, shipment):
        agreement = getattr(shipment, "fee_agreement", None)
        if agreement is None:
            return None
        return {"amount": agreement.amount, "currency": agreement.currency}

    def get_evidence(self, shipment):
        if not self._can_view_private_details(shipment):
            return []
        return [
            {
                "id": item.pk,
                "evidence_type": item.evidence_type,
                "description": item.description,
                "uploaded_at": item.created_at,
                "download": f"/api/shipments/{shipment.pk}/evidence/{item.pk}/",
            }
            for item in shipment.evidence.all()
        ]

    def get_transitions(self, shipment):
        return [
            {
                "from_status": item.from_status,
                "to_status": item.to_status,
                "actor_username": item.actor.username if item.actor_id else None,
                "reason": item.reason,
                "created_at": item.created_at,
            }
            for item in shipment.transitions.all()
        ]

    def get_exceptions(self, shipment):
        return [
            {
                "exception_type": item.exception_type,
                "reason": item.reason,
                "created_at": item.created_at,
            }
            for item in shipment.exceptions.all()
        ]

    def get_evidence_requirements(self, shipment):
        return {
            "pickup": settings.SHIPMENT_REQUIRE_PICKUP_EVIDENCE,
            "delivery": settings.SHIPMENT_REQUIRE_DELIVERY_EVIDENCE,
            "max_bytes": settings.SHIPMENT_EVIDENCE_MAX_BYTES,
        }


class ShipmentOfferSerializer(serializers.ModelSerializer):
    shipment_id = serializers.IntegerField(source="shipment.pk", read_only=True)
    pickup_region = serializers.CharField(source="shipment.pickup_region", read_only=True)
    destination_region = serializers.CharField(
        source="shipment.destination_region", read_only=True
    )
    product_summary = serializers.CharField(
        source="shipment.product_summary", read_only=True
    )
    cargo_weight_kg = serializers.DecimalField(
        source="shipment.cargo_weight_kg",
        max_digits=10,
        decimal_places=2,
        read_only=True,
        allow_null=True,
    )
    cargo_quantity = serializers.DecimalField(
        source="shipment.cargo_quantity",
        max_digits=12,
        decimal_places=2,
        read_only=True,
        allow_null=True,
    )
    cargo_quantity_unit = serializers.CharField(
        source="shipment.cargo_quantity_unit", read_only=True
    )
    handling_requirements = serializers.CharField(
        source="shipment.handling_requirements", read_only=True
    )
    packaging_details = serializers.CharField(
        source="shipment.packaging_details", read_only=True
    )
    external_order_reference = serializers.SerializerMethodField()
    fee_proposal = serializers.SerializerMethodField()

    class Meta:
        model = ShipmentOffer
        fields = [
            "id",
            "shipment_id",
            "pickup_region",
            "destination_region",
            "product_summary",
            "cargo_quantity",
            "cargo_quantity_unit",
            "cargo_weight_kg",
            "handling_requirements",
            "packaging_details",
            "status",
            "expires_at",
            "created_at",
            "external_order_reference",
            "fee_proposal",
        ]
        read_only_fields = fields

    def get_external_order_reference(self, offer):
        return None

    def get_fee_proposal(self, offer):
        proposal = (
            offer.shipment.fee_proposals.filter(
                proposed_by=offer.shipment.buyer,
                status=ShipmentFeeProposal.Status.PROPOSED,
                target_driver__isnull=True,
                version=offer.shipment.current_fee_proposal_version,
            )
            .first()
        )
        if proposal is None:
            proposal = (
                offer.shipment.fee_proposals.filter(
                    proposed_by=offer.driver,
                    status=ShipmentFeeProposal.Status.PROPOSED,
                    target_driver=offer.driver,
                    version=offer.shipment.current_fee_proposal_version,
                )
                .first()
            )
        return (
            ShipmentFeeProposalSerializer(proposal).data if proposal is not None else None
        )


class ShipmentFeeCounterSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    currency = serializers.ChoiceField(
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES]
    )


class ShipmentFeeProposalInputSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    currency = serializers.ChoiceField(
        choices=[(currency, currency) for currency in SUPPORTED_SHIPMENT_CURRENCIES]
    )


class ShipmentFeeAcceptanceSerializer(serializers.Serializer):
    proposal_id = serializers.IntegerField(min_value=1)
    version = serializers.IntegerField(min_value=1)


class ShipmentFeeVersionSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class ShipmentActionReasonSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A reason is required.")
        return value


class ShipmentMessageInputSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000, trim_whitespace=True)
    offer_id = serializers.IntegerField(required=False)

    def validate_body(self, value):
        if not value:
            raise serializers.ValidationError("A message cannot be empty.")
        return value


class ShipmentMessageSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source="sender.username", read_only=True)

    class Meta:
        model = ShipmentMessage
        fields = ["id", "sender_username", "body", "created_at", "offer_id"]
        read_only_fields = fields


class ShipmentNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentNotification
        fields = ["id", "shipment_id", "event_type", "created_at", "read_at"]
        read_only_fields = fields


class ShipmentRescheduleSerializer(serializers.Serializer):
    estimated_delivery_at = serializers.DateTimeField()
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate(self, attrs):
        raw_estimate = self.initial_data.get("estimated_delivery_at")
        if not isinstance(raw_estimate, str) or not re.search(
            r"(?:Z|[+-]\d{2}:\d{2})$", raw_estimate
        ):
            raise serializers.ValidationError(
                {
                    "estimated_delivery_at": (
                        "Provide an ISO-8601 timestamp with an explicit timezone."
                    )
                }
            )
        return attrs

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A rescheduling reason is required.")
        return value


class ShipmentReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("A reason is required.")
        return value


class ShipmentProgressSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=[
            Shipment.Status.PICKUP_PENDING,
            Shipment.Status.PICKUP_ARRIVED,
            Shipment.Status.PICKED_UP,
            Shipment.Status.IN_TRANSIT,
            Shipment.Status.DELIVERY_ATTEMPTED,
            Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
        ]
    )
    reason = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class ShipmentEvidenceUploadSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShipmentEvidence
        fields = ["evidence_type", "file", "description"]

    def validate_file(self, uploaded_file):
        if uploaded_file.size > settings.SHIPMENT_EVIDENCE_MAX_BYTES:
            raise serializers.ValidationError("File exceeds the configured size limit.")
        extension = uploaded_file.name.rsplit(".", 1)[-1].lower() if "." in uploaded_file.name else ""
        signature = uploaded_file.read(8)
        uploaded_file.seek(0)
        signatures = {
            "pdf": (b"%PDF-", "application/pdf"),
            "png": (b"\x89PNG\r\n\x1a\n", "image/png"),
            "jpg": (b"\xff\xd8\xff", "image/jpeg"),
            "jpeg": (b"\xff\xd8\xff", "image/jpeg"),
        }
        if extension not in signatures:
            raise serializers.ValidationError("Upload a valid PDF, PNG, or JPEG evidence file.")
        signature_prefix, expected_content_type = signatures[extension]
        if not signature.startswith(signature_prefix):
            raise serializers.ValidationError("Upload a valid PDF, PNG, or JPEG evidence file.")
        if uploaded_file.content_type and uploaded_file.content_type not in {
            expected_content_type,
            "application/octet-stream",
        }:
            raise serializers.ValidationError(
                "The file content type does not match its extension and signature."
            )
        return uploaded_file


class ShipmentExceptionInputSerializer(serializers.Serializer):
    exception_type = serializers.ChoiceField(choices=ShipmentException.Type.choices)
    reason = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value:
            raise serializers.ValidationError("An exception reason is required.")
        return value


class AssistantConversationSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssistantConversation
        fields = ["id", "title", "created_at", "updated_at"]
        read_only_fields = ["id", "title", "created_at", "updated_at"]


class AssistantMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssistantMessage
        fields = ["id", "role", "content", "created_at"]
        read_only_fields = ["id", "role", "content", "created_at"]
