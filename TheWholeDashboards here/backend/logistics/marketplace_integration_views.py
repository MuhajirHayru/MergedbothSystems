import json

from rest_framework import status
from rest_framework.exceptions import APIException, ParseError, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema

from .marketplace_integration import (
    EventConflict,
    apply_marketplace_order_event,
    apply_marketplace_v2_event,
    integration_event_page,
    integration_payload_sha256,
    record_invalid_integration_payload,
)
from .marketplace_integration_auth import signed_request_body
from .serializers import (
    MarketplaceIntegrationAcknowledgementSerializer,
    MarketplaceOrderEventSerializer,
    MarketplaceShipmentEventPageSerializer,
    MarketplaceV2EventSerializer,
)
from .services import record_audit


INTEGRATION_HEADERS = [
    OpenApiParameter(
        "X-GP-Integration-Timestamp",
        OpenApiTypes.STR,
        OpenApiParameter.HEADER,
        required=True,
    ),
    OpenApiParameter(
        "X-GP-Integration-Request-ID",
        OpenApiTypes.STR,
        OpenApiParameter.HEADER,
        required=True,
    ),
    OpenApiParameter(
        "X-GP-Integration-Signature",
        OpenApiTypes.STR,
        OpenApiParameter.HEADER,
        required=True,
    ),
]


def _reject_duplicate_json_keys(pairs):
    data = {}
    for key, value in pairs:
        if key in data:
            raise ValueError("Duplicate JSON object key.")
        data[key] = value
    return data


class IntegrationConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The integration event conflicts with the current order state."
    default_code = "integration_conflict"


class MarketplaceOrderEventView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "marketplace_integration"

    @extend_schema(
        parameters=INTEGRATION_HEADERS,
        request=MarketplaceOrderEventSerializer,
        responses=MarketplaceIntegrationAcknowledgementSerializer,
    )
    def post(self, request):
        raw_body, request_id = signed_request_body(request)
        if request.content_type != "application/json":
            record_invalid_integration_payload(request_id, "unsupported_media_type")
            return Response(
                {"detail": "Content-Type must be application/json."},
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            )
        try:
            payload = json.loads(
                raw_body.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
            )
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            record_invalid_integration_payload(request_id, "malformed_json")
            raise ParseError("The integration request body must be valid JSON.")
        if not isinstance(payload, dict):
            record_invalid_integration_payload(request_id, "invalid_payload_shape")
            raise ParseError("The integration request body must be a JSON object.")

        serializer = MarketplaceOrderEventSerializer(data=payload)
        if not serializer.is_valid():
            record_invalid_integration_payload(request_id, "schema_validation")
            raise ValidationError(serializer.errors)
        event_data = serializer.validated_data
        if event_data["event_id"] != request_id:
            record_invalid_integration_payload(request_id, "event_id_header_mismatch")
            raise ValidationError(
                {"event_id": "The signed request ID must match the event ID."}
            )
        try:
            response_status, response_payload = apply_marketplace_order_event(
                event_data, integration_payload_sha256(payload)
            )
        except EventConflict as error:
            raise IntegrationConflict(str(error)) from error
        return Response(response_payload, status=response_status)


class MarketplaceV2EventView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "marketplace_integration"

    @extend_schema(
        parameters=INTEGRATION_HEADERS,
        request=MarketplaceV2EventSerializer,
        responses=MarketplaceIntegrationAcknowledgementSerializer,
    )
    def post(self, request):
        raw_body, request_id = signed_request_body(request)
        if request.content_type != "application/json":
            record_invalid_integration_payload(request_id, "unsupported_media_type")
            return Response(
                {"detail": "Content-Type must be application/json."},
                status=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            )
        try:
            payload = json.loads(
                raw_body.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
            )
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            record_invalid_integration_payload(request_id, "malformed_json")
            raise ParseError("The integration request body must be valid JSON.")
        if not isinstance(payload, dict):
            record_invalid_integration_payload(request_id, "invalid_payload_shape")
            raise ParseError("The integration request body must be a JSON object.")

        serializer = MarketplaceV2EventSerializer(data=payload)
        if not serializer.is_valid():
            record_invalid_integration_payload(request_id, "schema_validation")
            raise ValidationError(serializer.errors)
        event_data = serializer.validated_data
        if str(event_data["event_id"]) != request_id:
            record_invalid_integration_payload(request_id, "event_id_header_mismatch")
            raise ValidationError(
                {"event_id": "The signed request ID must match the event ID."}
            )
        try:
            response_status, response_payload = apply_marketplace_v2_event(
                event_data, integration_payload_sha256(payload)
            )
        except EventConflict as error:
            raise IntegrationConflict(str(error)) from error
        return Response(response_payload, status=response_status)


class MarketplaceShipmentEventsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "marketplace_integration"

    @extend_schema(
        parameters=INTEGRATION_HEADERS
        + [
            OpenApiParameter(
                "after_id",
                OpenApiTypes.INT,
                OpenApiParameter.QUERY,
                required=False,
            ),
            OpenApiParameter(
                "limit",
                OpenApiTypes.INT,
                OpenApiParameter.QUERY,
                required=False,
            ),
        ],
        responses=MarketplaceShipmentEventPageSerializer,
    )
    def get(self, request):
        signed_request_body(request)
        try:
            after_id = int(request.query_params.get("after_id", "0"))
            limit = int(request.query_params.get("limit", "50"))
        except ValueError as error:
            raise ValidationError(
                {"detail": "after_id and limit must be integers."}
            ) from error
        if after_id < 0 or limit < 1 or limit > 100:
            raise ValidationError(
                {"detail": "after_id must be non-negative and limit must be 1-100."}
            )
        page = integration_event_page(after_id, limit)
        record_audit(
            None,
            "marketplace.shipment_events_polled",
            "marketplace_integration",
            "",
            {
                "after_id": after_id,
                "next_cursor": page["next_cursor"],
                "event_count": len(page["results"]),
            },
        )
        return Response(page)
