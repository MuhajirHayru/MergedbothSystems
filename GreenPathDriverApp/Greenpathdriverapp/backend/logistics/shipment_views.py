from pathlib import PurePosixPath

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.pagination import LimitOffsetPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from .models import (
    LogisticsUser,
    MarketplaceOrderAuthorization,
    Shipment,
    ShipmentEvidence,
    ShipmentException,
    ShipmentFeeProposal,
    ShipmentMessage,
    ShipmentNotification,
    ShipmentOffer,
)
from .serializers import (
    ShipmentEvidenceUploadSerializer,
    ShipmentExceptionInputSerializer,
    ShipmentFeeAcceptanceSerializer,
    ShipmentFeeCounterSerializer,
    ShipmentFeeProposalInputSerializer,
    ShipmentFeeProposalSerializer,
    ShipmentMessageInputSerializer,
    ShipmentMessageSerializer,
    ShipmentNotificationSerializer,
    ShipmentOfferSerializer,
    ShipmentProgressSerializer,
    ShipmentReasonSerializer,
    ShipmentRescheduleSerializer,
    ShipmentActionReasonSerializer,
    ShipmentFeeVersionSerializer,
    ShipmentRequestSerializer,
    ShipmentSerializer,
)
from .services import record_audit
from .shipment_services import (
    accept_buyer_fee_proposal,
    accept_driver_fee_counterproposal,
    cancel_shipment,
    confirm_shipment_delivery,
    counter_shipment_fee,
    create_buyer_fee_proposal,
    create_shipment_offers,
    decline_shipment_offer,
    dispute_shipment,
    driver_meets_shipment_requirements,
    marketplace_order_is_authorized,
    refresh_shipment_offers,
    reject_driver_fee_counterproposal,
    report_shipment_exception,
    report_delivery_problem,
    reschedule_failed_delivery,
    update_shipment_status,
    notify_shipment_participants,
    is_active_assigned_driver,
    is_active_shipment_buyer,
    is_active_shipment_participant,
)


BUYER_ROLES = {LogisticsUser.Role.WHOLESALER, LogisticsUser.Role.RETAILER}


def require_buyer(user):
    if not user.is_active or user.role not in BUYER_ROLES:
        raise PermissionDenied("An active wholesaler or retailer account is required.")


def owned_shipment(shipment_id, user):
    shipment = (
        Shipment.objects.select_related("buyer", "assigned_driver")
        .filter(pk=shipment_id)
        .first()
    )
    if shipment is None or not is_active_shipment_participant(shipment, user):
        raise NotFound("Shipment was not found.")
    return shipment


class ShipmentPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 100


class ShipmentCollectionView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="shipment_list",
        responses=ShipmentSerializer(many=True),
    )
    def get(self, request):
        if not request.user.is_active:
            raise PermissionDenied("An active account is required.")
        if request.user.role in BUYER_ROLES:
            shipments = Shipment.objects.filter(buyer=request.user)
        elif request.user.role == LogisticsUser.Role.DRIVER:
            shipments = Shipment.objects.filter(assigned_driver=request.user)
        else:
            raise PermissionDenied("Shipment access is not available to this role.")
        return Response(
            ShipmentSerializer(
                shipments.select_related("buyer", "assigned_driver")
                .prefetch_related("fee_proposals", "evidence"),
                many=True,
                context={"request": request},
            ).data
        )

    @extend_schema(
        operation_id="shipment_create",
        request=ShipmentRequestSerializer,
        responses={status.HTTP_201_CREATED: ShipmentSerializer},
    )
    @transaction.atomic
    def post(self, request):
        require_buyer(request.user)
        serializer = ShipmentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order_reference = serializer.validated_data["external_order_reference"]
        if Shipment.objects.filter(
            buyer=request.user, external_order_reference=order_reference
        ).exclude(status=Shipment.Status.CANCELLED).exists():
            raise ValidationError(
                {"external_order_reference": "A shipment request already exists for this order."}
            )
        authorization = MarketplaceOrderAuthorization.objects.select_related(
            "seller"
        ).filter(external_order_reference=order_reference).first()
        if authorization and authorization.buyer_id != request.user.pk:
            raise NotFound("Marketplace order was not found.")
        if (
            authorization
            and authorization.status == MarketplaceOrderAuthorization.Status.INELIGIBLE
        ):
            raise ValidationError(
                {"external_order_reference": "This marketplace order is not eligible for delivery."}
            )

        values = dict(serializer.validated_data)
        initial_fee = values.pop("initial_fee")
        currency = values.pop("currency")
        order_verified = bool(
            authorization
            and authorization.status == MarketplaceOrderAuthorization.Status.ELIGIBLE
            and authorization.seller_id
            and authorization.seller.is_active
            and authorization.seller.role
            in {
                LogisticsUser.Role.FARMER,
                LogisticsUser.Role.WHOLESALER,
                LogisticsUser.Role.RETAILER,
            }
        )
        shipment = Shipment.objects.create(
            buyer=request.user,
            seller=authorization.seller if order_verified else None,
            order_verified=order_verified,
            currency=currency,
            status=Shipment.Status.REQUESTED,
            **values,
        )
        proposal = ShipmentFeeProposal.objects.create(
            shipment=shipment,
            proposed_by=request.user,
            amount=initial_fee,
            currency=currency,
            version=1,
        )
        shipment.current_fee_proposal_version = proposal.version
        shipment.save(update_fields=["current_fee_proposal_version", "updated_at"])
        record_audit(
            request.user,
            "shipment.fee_proposed",
            "shipment_fee_proposal",
            proposal.pk,
            {
                "shipment_id": shipment.pk,
                "version": proposal.version,
                "amount": str(proposal.amount),
                "currency": currency,
            },
        )
        if shipment.order_verified:
            from .shipment_services import _transition

            _transition(shipment, request.user, Shipment.Status.FEE_PROPOSED)
            create_shipment_offers(shipment)
        record_audit(
            request.user,
            "shipment.requested",
            "shipment",
            shipment.pk,
            {
                "order_verified": shipment.order_verified,
                "fee_proposal_id": proposal.pk,
            },
        )
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ShipmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="shipment_retrieve",
        responses=ShipmentSerializer,
    )
    def get(self, request, shipment_id):
        shipment = owned_shipment(shipment_id, request.user)
        if shipment.assigned_driver_id:
            record_audit(
                request.user,
                "shipment.private_details_viewed",
                "shipment",
                shipment.pk,
                {"shipment_id": shipment.pk},
            )
        return Response(
            ShipmentSerializer(
                shipment,
                context={"request": request},
            ).data
        )


class DriverShipmentOfferListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if (
            not request.user.is_active
            or request.user.role != LogisticsUser.Role.DRIVER
        ):
            raise PermissionDenied("An active driver account is required.")
        now = timezone.now()
        ShipmentOffer.objects.filter(
            driver=request.user,
            status=ShipmentOffer.Status.PENDING,
            expires_at__lte=now,
        ).update(status=ShipmentOffer.Status.EXPIRED, responded_at=now)
        offers = list(ShipmentOffer.objects.filter(
            driver=request.user,
            status=ShipmentOffer.Status.PENDING,
            expires_at__gt=now,
            shipment__order_verified=True,
            shipment__seller__isnull=False,
            shipment__status__in=[
                Shipment.Status.FEE_PROPOSED,
                Shipment.Status.NEGOTIATING,
            ],
        ).select_related("shipment", "shipment__buyer", "shipment__seller")
            .prefetch_related("shipment__fee_proposals"))
        visible_offers = []
        for offer in offers:
            if (
                marketplace_order_is_authorized(offer.shipment)
                and driver_meets_shipment_requirements(request.user, offer.shipment)
            ):
                visible_offers.append(offer)
            else:
                offer.status = ShipmentOffer.Status.WITHDRAWN
                offer.responded_at = now
                offer.response_reason = (
                    "The driver or marketplace order no longer meets eligibility requirements."
                )
                offer.save(
                    update_fields=["status", "responded_at", "response_reason"]
                )
                record_audit(
                    request.user,
                    "shipment.offer_withdrawn",
                    "shipment_offer",
                    offer.pk,
                    {"shipment_id": offer.shipment_id},
                )
        return Response(ShipmentOfferSerializer(visible_offers, many=True).data)


class ShipmentOfferActionView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, shipment_id, offer_id, action):
        if (
            not request.user.is_active
            or request.user.role != LogisticsUser.Role.DRIVER
        ):
            raise PermissionDenied("An active driver account is required.")
        offer = get_object_or_404(
            ShipmentOffer.objects.select_related("shipment"),
            pk=offer_id,
            shipment_id=shipment_id,
            driver=request.user,
        )
        if action == "accept":
            serializer = ShipmentFeeAcceptanceSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            shipment = accept_buyer_fee_proposal(
                shipment_id,
                serializer.validated_data["proposal_id"],
                serializer.validated_data["version"],
                request.user,
            )
            return Response(
                ShipmentSerializer(shipment, context={"request": request}).data
            )
        if action == "decline":
            reason = request.data.get("reason", "")
            if not isinstance(reason, str) or not reason.strip():
                raise ValidationError({"reason": "A decline reason is required."})
            decline_shipment_offer(offer.pk, request.user, reason)
            return Response({"detail": "Offer declined."})
        raise NotFound("Offer action was not found.")


class ShipmentFeeCounterproposalView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id, offer_id):
        if (
            not request.user.is_active
            or request.user.role != LogisticsUser.Role.DRIVER
        ):
            raise PermissionDenied("An active driver account is required.")
        serializer = ShipmentFeeCounterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = counter_shipment_fee(
            shipment_id,
            offer_id,
            request.user,
            serializer.validated_data["amount"],
            serializer.validated_data["currency"],
        )
        return Response(
            {
                "id": proposal.pk,
                "amount": proposal.amount,
                "currency": proposal.currency,
                "version": proposal.version,
                "status": proposal.status,
                "created_at": proposal.created_at,
            },
            status=status.HTTP_201_CREATED,
        )


class ShipmentFeeProposalAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id, proposal_id):
        require_buyer(request.user)
        serializer = ShipmentFeeVersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shipment = accept_driver_fee_counterproposal(
            shipment_id, proposal_id, serializer.validated_data["version"], request.user
        )
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentFeeProposalCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ShipmentFeeProposalInputSerializer,
        responses={status.HTTP_201_CREATED: ShipmentFeeProposalSerializer},
    )
    def post(self, request, shipment_id):
        require_buyer(request.user)
        serializer = ShipmentFeeProposalInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        proposal = create_buyer_fee_proposal(
            shipment_id,
            request.user,
            serializer.validated_data["amount"],
            serializer.validated_data["currency"],
        )
        return Response(
            ShipmentFeeProposalSerializer(proposal).data,
            status=status.HTTP_201_CREATED,
        )


class ShipmentFeeProposalRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id, proposal_id):
        require_buyer(request.user)
        serializer = ShipmentActionReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reject_driver_fee_counterproposal(
            shipment_id,
            proposal_id,
            serializer.validated_data["version"],
            request.user,
            serializer.validated_data["reason"],
        )
        return Response({"detail": "Fee counterproposal rejected."})


class ShipmentOfferRefreshView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        require_buyer(request.user)
        created = refresh_shipment_offers(shipment_id, request.user)
        return Response({"new_offers": created})


class ShipmentStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        if (
            not request.user.is_active
            or request.user.role != LogisticsUser.Role.DRIVER
        ):
            raise PermissionDenied("An active driver account is required.")
        serializer = ShipmentProgressSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_status = serializer.validated_data["status"]
        reason = serializer.validated_data.get("reason", "")
        if target_status == Shipment.Status.DELIVERY_ATTEMPTED and not reason.strip():
            raise ValidationError(
                {"reason": "A delivery-attempt reason is required."}
            )
        shipment = update_shipment_status(
            shipment_id, request.user, target_status, reason
        )
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentEvidenceUploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request, shipment_id):
        if (
            not request.user.is_active
            or request.user.role != LogisticsUser.Role.DRIVER
        ):
            raise PermissionDenied("An active driver account is required.")
        shipment = owned_shipment(shipment_id, request.user)
        serializer = ShipmentEvidenceUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        evidence_type = serializer.validated_data["evidence_type"]
        if evidence_type == ShipmentEvidence.Type.PICKUP and shipment.status not in {
            Shipment.Status.PICKUP_PENDING,
            Shipment.Status.PICKUP_ARRIVED,
        }:
            raise ValidationError({"evidence_type": "Pickup evidence is accepted only while pickup is pending."})
        if evidence_type in {
            ShipmentEvidence.Type.DELIVERY_ATTEMPT,
            ShipmentEvidence.Type.DELIVERY_CONFIRMATION,
        } and shipment.status != Shipment.Status.IN_TRANSIT:
            raise ValidationError({"evidence_type": "Delivery evidence is accepted only while in transit."})
        evidence = serializer.save(shipment=shipment, uploaded_by=request.user)
        record_audit(
            request.user,
            "shipment.evidence_uploaded",
            "shipment_evidence",
            evidence.pk,
            {"shipment_id": shipment.pk, "evidence_type": evidence_type},
        )
        return Response(
            {
                "id": evidence.pk,
                "evidence_type": evidence.evidence_type,
                "description": evidence.description,
                "uploaded_at": evidence.created_at,
            },
            status=status.HTTP_201_CREATED,
        )


class ShipmentEvidenceDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, shipment_id, evidence_id):
        evidence = get_object_or_404(
            ShipmentEvidence.objects.select_related("shipment"),
            pk=evidence_id,
            shipment_id=shipment_id,
        )
        if not is_active_shipment_participant(evidence.shipment, request.user):
            raise Http404
        try:
            content = evidence.file.open("rb")
        except (OSError, ValueError):
            raise Http404
        response = FileResponse(
            content,
            as_attachment=True,
            filename=f"shipment-evidence-{evidence.pk}{PurePosixPath(evidence.file.name).suffix}",
            content_type="application/octet-stream",
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        record_audit(
            request.user,
            "shipment.evidence_downloaded",
            "shipment_evidence",
            evidence.pk,
            {"shipment_id": evidence.shipment_id},
        )
        return response


class ShipmentDeliveryConfirmView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        require_buyer(request.user)
        shipment = confirm_shipment_delivery(shipment_id, request.user)
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentDeliveryProblemView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        require_buyer(request.user)
        serializer = ShipmentReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shipment = report_delivery_problem(
            shipment_id, request.user, serializer.validated_data["reason"]
        )
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentRescheduleView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        if not request.user.is_active:
            raise PermissionDenied("An active shipment participant is required.")
        serializer = ShipmentRescheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shipment = reschedule_failed_delivery(
            shipment_id,
            request.user,
            serializer.validated_data["estimated_delivery_at"],
            serializer.validated_data["reason"],
        )
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentCancelView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        require_buyer(request.user)
        reason = request.data.get("reason", "")
        if not isinstance(reason, str) or not reason.strip():
            raise ValidationError({"reason": "A cancellation reason is required."})
        shipment = cancel_shipment(shipment_id, request.user, reason)
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentDisputeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        serializer = ShipmentReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shipment = dispute_shipment(
            shipment_id, request.user, serializer.validated_data["reason"]
        )
        return Response(
            ShipmentSerializer(shipment, context={"request": request}).data
        )


class ShipmentExceptionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, shipment_id):
        serializer = ShipmentExceptionInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        exception = report_shipment_exception(
            shipment_id,
            request.user,
            serializer.validated_data["exception_type"],
            serializer.validated_data["reason"],
        )
        return Response(
            {
                "id": exception.pk,
                "exception_type": exception.exception_type,
                "reason": exception.reason,
                "created_at": exception.created_at,
            },
            status=status.HTTP_201_CREATED,
        )


class ShipmentMessageListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, shipment_id):
        shipment = Shipment.objects.filter(pk=shipment_id).first()
        if shipment is None:
            raise NotFound("Shipment was not found.")
        messages = ShipmentMessage.objects.filter(shipment=shipment)
        if is_active_shipment_buyer(shipment, request.user):
            pass
        elif is_active_assigned_driver(shipment, request.user):
            messages = messages.filter(
                Q(offer__isnull=True) | Q(offer__driver=request.user)
            )
        else:
            offer = ShipmentOffer.objects.filter(
                shipment=shipment,
                driver=request.user,
                status=ShipmentOffer.Status.PENDING,
                expires_at__gt=timezone.now(),
                shipment__order_verified=True,
            ).first()
            if (
                offer is None
                or not request.user.is_active
                or request.user.role != LogisticsUser.Role.DRIVER
            ):
                raise NotFound("Shipment was not found.")
            messages = messages.filter(offer=offer)
        messages = messages.order_by("-created_at", "-pk")
        paginator = ShipmentPagination()
        page = paginator.paginate_queryset(messages, request, view=self)
        return paginator.get_paginated_response(
            ShipmentMessageSerializer(page, many=True).data
        )

    def post(self, request, shipment_id):
        shipment = Shipment.objects.filter(pk=shipment_id).first()
        if shipment is None:
            raise NotFound("Shipment was not found.")
        if not is_active_shipment_participant(shipment, request.user):
            raise NotFound("Shipment was not found.")
        if shipment.assigned_driver_id is None:
            raise ValidationError(
                {"detail": "Free-form messaging is available after driver assignment; use fee actions to negotiate."}
            )
        serializer = ShipmentMessageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        offer = None
        offer_id = serializer.validated_data.get("offer_id")
        if offer_id is not None:
            offer = get_object_or_404(
                ShipmentOffer,
                pk=offer_id,
                shipment=shipment,
                status=ShipmentOffer.Status.ACCEPTED,
            )
            if request.user.pk not in {shipment.buyer_id, offer.driver_id}:
                raise NotFound("Shipment was not found.")
        message = ShipmentMessage.objects.create(
            shipment=shipment,
            offer=offer,
            sender=request.user,
            body=serializer.validated_data["body"],
        )
        record_audit(
            request.user,
            "shipment.message_sent",
            "shipment_message",
            message.pk,
            {"shipment_id": shipment.pk},
        )
        notify_shipment_participants(
            shipment, "message_received", exclude=request.user
        )
        return Response(
            ShipmentMessageSerializer(message).data,
            status=status.HTTP_201_CREATED,
        )


class ShipmentNotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not request.user.is_active:
            raise PermissionDenied("An active account is required.")
        notifications = ShipmentNotification.objects.filter(
            recipient=request.user
        ).select_related("shipment")
        paginator = ShipmentPagination()
        page = paginator.paginate_queryset(notifications, request, view=self)
        return paginator.get_paginated_response(
            ShipmentNotificationSerializer(page, many=True).data
        )


class ShipmentNotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id):
        if not request.user.is_active:
            raise PermissionDenied("An active account is required.")
        notification = get_object_or_404(
            ShipmentNotification,
            pk=notification_id,
            recipient=request.user,
        )
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return Response(ShipmentNotificationSerializer(notification).data)
