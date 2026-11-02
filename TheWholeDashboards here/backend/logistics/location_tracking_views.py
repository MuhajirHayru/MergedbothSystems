from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from .location_tracking import (
    get_shipment_location,
    start_location_sharing,
    stop_location_sharing,
    update_driver_location,
)
from .location_tracking_serializers import (
    DriverLocationResponseSerializer,
    DriverLocationUpdateSerializer,
)


class ShipmentLocationStartView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "driver_location_session"

    @extend_schema(
        operation_id="shipment_location_start",
        request=None,
        responses=DriverLocationResponseSerializer,
    )
    def post(self, request, shipment_id):
        return Response(
            start_location_sharing(shipment_id, request.user),
            status=status.HTTP_200_OK,
        )


class ShipmentLocationUpdateView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "driver_location_update"

    @extend_schema(
        operation_id="shipment_location_update",
        request=DriverLocationUpdateSerializer,
        responses=DriverLocationResponseSerializer,
    )
    def post(self, request, shipment_id):
        max_bytes = settings.DRIVER_LOCATION_MAX_PAYLOAD_BYTES
        content_length = request.META.get("CONTENT_LENGTH")
        if content_length and int(content_length) > max_bytes:
            return Response(
                {"detail": "Location update exceeds the request-size limit."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        if len(request.body) > max_bytes:
            return Response(
                {"detail": "Location update exceeds the request-size limit."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )
        serializer = DriverLocationUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = update_driver_location(
            shipment_id, request.user, serializer.validated_data
        )
        return Response(result, status=status.HTTP_200_OK)


class ShipmentLocationStopView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "driver_location_session"

    @extend_schema(
        operation_id="shipment_location_stop",
        request=None,
        responses=DriverLocationResponseSerializer,
    )
    def post(self, request, shipment_id):
        return Response(
            stop_location_sharing(shipment_id, request.user),
            status=status.HTTP_200_OK,
        )


class ShipmentLocationView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "shipment_location_read"

    @extend_schema(
        operation_id="shipment_location_retrieve",
        responses=DriverLocationResponseSerializer,
    )
    def get(self, request, shipment_id):
        return Response(get_shipment_location(shipment_id, request.user))
