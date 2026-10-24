from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AccountStatus, Role

from .delivery_fee_reviews import (
    DeliveryFeeReviewConflict,
    StaleDeliveryFeeAgreement,
    review_delivery_fee_agreement,
)
from .models import MarketplaceDeliveryFeeAgreement, MarketplaceDeliveryFeeReview


class IsMarketplaceFinancialReviewer(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.is_active
            and user.status == AccountStatus.APPROVED
            and user.role == Role.FINANCIAL_MANAGER
            and "delivery_fee:review" in user.get_role_permissions()
        )


class DeliveryFeeReviewDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(
        choices=MarketplaceDeliveryFeeReview.Decision.choices
    )
    proposal_version = serializers.IntegerField(min_value=1)
    rejection_reason = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=True, max_length=2000
    )

    def validate(self, attrs):
        if set(self.initial_data) - {
            "decision",
            "proposal_version",
            "rejection_reason",
        }:
            raise serializers.ValidationError("Unexpected review decision fields.")
        if isinstance(self.initial_data.get("proposal_version"), bool):
            raise serializers.ValidationError(
                {"proposal_version": "A positive proposal version is required."}
            )
        reason = attrs.get("rejection_reason", "").strip()
        if (
            attrs["decision"] == MarketplaceDeliveryFeeReview.Decision.REJECTED
            and not reason
        ):
            raise serializers.ValidationError(
                {"rejection_reason": "A rejection reason is required."}
            )
        if attrs["decision"] == MarketplaceDeliveryFeeReview.Decision.APPROVED:
            attrs["rejection_reason"] = ""
        else:
            attrs["rejection_reason"] = reason
        return attrs


class DeliveryFeeReviewRecordSerializer(serializers.ModelSerializer):
    actor_id = serializers.UUIDField(read_only=True)
    actor_name = serializers.CharField(source="actor.full_name", read_only=True)

    class Meta:
        model = MarketplaceDeliveryFeeReview
        fields = [
            "decision",
            "rejection_reason",
            "actor_id",
            "actor_name",
            "reviewer_role",
            "authorization_context",
            "decision_event_id",
            "proposal_version",
            "decided_at",
        ]
        read_only_fields = fields


class MarketplaceDeliveryFeeAgreementSerializer(serializers.ModelSerializer):
    agreement_event_id = serializers.UUIDField(
        source="source_event_id", read_only=True
    )
    order_reference = serializers.CharField(source="order.reference", read_only=True)
    order_id = serializers.UUIDField(read_only=True)
    buyer_name = serializers.CharField(source="order.buyer.full_name", read_only=True)
    buyer_reference = serializers.SerializerMethodField()
    seller_name = serializers.CharField(source="order.seller.full_name", read_only=True)
    seller_reference = serializers.SerializerMethodField()
    driver_payee_reference = serializers.SerializerMethodField()
    driver_payee_name = serializers.SerializerMethodField()
    review_status = serializers.SerializerMethodField()
    review = DeliveryFeeReviewRecordSerializer(
        source="financial_review", read_only=True
    )

    class Meta:
        model = MarketplaceDeliveryFeeAgreement
        fields = [
            "id",
            "agreement_event_id",
            "order_id",
            "order_reference",
            "buyer_name",
            "buyer_reference",
            "seller_name",
            "seller_reference",
            "driver_shipment_id",
            "driver_payee_reference",
            "driver_payee_name",
            "driver_proposal_version",
            "amount",
            "currency",
            "buyer_accepted_at",
            "driver_accepted_at",
            "recorded_at",
            "review_status",
            "review",
        ]
        read_only_fields = fields

    def get_buyer_reference(self, agreement):
        return str(agreement.order.buyer.pk)

    def get_seller_reference(self, agreement):
        return str(agreement.order.seller.pk)

    def get_driver_payee_reference(self, agreement):
        if agreement.driver_payee_id is not None:
            return str(agreement.driver_payee.pk)
        return f"driver-shipment:{agreement.driver_shipment_id}"

    def get_driver_payee_name(self, agreement):
        if agreement.driver_payee_id is not None:
            return agreement.driver_payee.full_name
        return ""

    def get_review_status(self, agreement):
        if not hasattr(agreement, "financial_review"):
            return "pending"
        return agreement.financial_review.decision


class MarketplaceDeliveryFeeAgreementListView(generics.ListAPIView):
    serializer_class = MarketplaceDeliveryFeeAgreementSerializer
    permission_classes = [IsMarketplaceFinancialReviewer]

    def get_queryset(self):
        queryset = (
            MarketplaceDeliveryFeeAgreement.objects.select_related(
                "order__wholesaler",
                "order__farmer",
                "order__retailer",
                "driver_payee",
                "financial_review__actor",
            )
            .order_by("-recorded_at")
        )
        review_status = self.request.query_params.get("status", "pending")
        if review_status == "pending":
            return queryset.filter(financial_review__isnull=True)
        if review_status == "all":
            return queryset
        if review_status in MarketplaceDeliveryFeeReview.Decision.values:
            return queryset.filter(financial_review__decision=review_status)
        return queryset.none()


class DeliveryFeeReviewConflictResponse(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The agreement already has a conflicting review decision."
    default_code = "delivery_fee_review_conflict"


class StaleDeliveryFeeAgreementResponse(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The delivery-fee proposal is stale."
    default_code = "stale_delivery_fee_agreement"


class MarketplaceDeliveryFeeReviewView(APIView):
    permission_classes = [IsMarketplaceFinancialReviewer]

    def post(self, request, agreement_id):
        serializer = DeliveryFeeReviewDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            review, created = review_delivery_fee_agreement(
                agreement_id=agreement_id,
                actor=request.user,
                decision=serializer.validated_data["decision"],
                proposal_version=serializer.validated_data["proposal_version"],
                rejection_reason=serializer.validated_data["rejection_reason"],
            )
        except PermissionError as error:
            raise PermissionDenied(str(error)) from error
        except DeliveryFeeReviewConflict as error:
            raise DeliveryFeeReviewConflictResponse(str(error)) from error
        except StaleDeliveryFeeAgreement as error:
            raise StaleDeliveryFeeAgreementResponse(str(error)) from error

        if review is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)
        agreement = get_object_or_404(
            MarketplaceDeliveryFeeAgreement.objects.select_related(
                "order__wholesaler",
                "order__farmer",
                "order__retailer",
                "financial_review__actor",
            ),
            pk=agreement_id,
        )
        return Response(
            MarketplaceDeliveryFeeAgreementSerializer(agreement).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )
