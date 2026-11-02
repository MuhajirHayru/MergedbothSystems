from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from rest_framework import generics, serializers, status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
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


DELIVERY_FEE_ORDERINGS = {
    "-recorded_at",
    "recorded_at",
    "-financial_review__decided_at",
    "financial_review__decided_at",
    "-amount",
    "amount",
}


def _date_param(params, name):
    raw = params.get(name)
    if not raw:
        return None
    parsed = parse_date(raw)
    if parsed is None:
        raise ValidationError({name: "Use YYYY-MM-DD format."})
    return parsed


class MarketplaceDeliveryFeeAgreementListView(generics.ListAPIView):
    serializer_class = MarketplaceDeliveryFeeAgreementSerializer
    permission_classes = [IsMarketplaceFinancialReviewer]

    def get_queryset(self):
        params = self.request.query_params
        queryset = MarketplaceDeliveryFeeAgreement.objects.select_related(
            "order__wholesaler",
            "order__farmer",
            "order__retailer",
            "driver_payee",
            "financial_review__actor",
        )

        review_status = params.get("status", "pending")
        if review_status == "pending":
            queryset = queryset.filter(financial_review__isnull=True)
        elif review_status == "all":
            pass
        elif review_status in MarketplaceDeliveryFeeReview.Decision.values:
            queryset = queryset.filter(financial_review__decision=review_status)
        else:
            queryset = queryset.none()

        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(order__reference__icontains=search)
                | Q(order__wholesaler__full_name__icontains=search)
                | Q(order__farmer__full_name__icontains=search)
                | Q(order__retailer__full_name__icontains=search)
                | Q(driver_payee__full_name__icontains=search)
            )

        recorded_from = _date_param(params, "recorded_from")
        recorded_to = _date_param(params, "recorded_to")
        if recorded_from and recorded_to and recorded_from > recorded_to:
            raise ValidationError({"recorded_to": "Must be on or after recorded_from."})
        if recorded_from:
            queryset = queryset.filter(recorded_at__date__gte=recorded_from)
        if recorded_to:
            queryset = queryset.filter(recorded_at__date__lte=recorded_to)

        decided_from = _date_param(params, "decided_from")
        decided_to = _date_param(params, "decided_to")
        if decided_from and decided_to and decided_from > decided_to:
            raise ValidationError({"decided_to": "Must be on or after decided_from."})
        if decided_from:
            queryset = queryset.filter(financial_review__decided_at__date__gte=decided_from)
        if decided_to:
            queryset = queryset.filter(financial_review__decided_at__date__lte=decided_to)

        ordering = params.get("ordering", "-recorded_at")
        if ordering in DELIVERY_FEE_ORDERINGS:
            queryset = queryset.order_by(ordering)
        else:
            queryset = queryset.order_by("-recorded_at")
        return queryset


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
