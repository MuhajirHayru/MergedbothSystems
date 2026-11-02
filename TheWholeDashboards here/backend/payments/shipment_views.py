"""Buyer shipment tracking views."""
from django.db.models import Q
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import OrderShipmentDetails
from .serializers import BuyerShipmentSerializer


def _buyer_shipments(user):
    """Shipments on orders where the user is the buyer (retailer or wholesaler)."""
    return OrderShipmentDetails.objects.filter(
        Q(order__retailer=user) | Q(order__wholesaler=user)
    ).select_related(
        "order",
        "order__wholesaler",
        "order__retailer",
        "order__farmer",
        "pickup_region",
        "pickup_zone",
        "pickup_wereda",
        "destination_region",
        "destination_zone",
        "destination_wereda",
    )


class BuyerShipmentListView(generics.ListAPIView):
    """List all shipments for the authenticated buyer's orders."""

    permission_classes = [IsAuthenticated]
    serializer_class = BuyerShipmentSerializer

    def get_queryset(self):
        return _buyer_shipments(self.request.user).order_by("-order__created_at")

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()

        status = request.query_params.get("status")
        if status:
            queryset = queryset.filter(order__status=status)

        search = request.query_params.get("search")
        if search:
            criteria = Q(order__reference__icontains=search)
            if search.isdigit():
                criteria |= Q(driver_shipment_id=int(search))
            queryset = queryset.filter(criteria)

        serializer = self.get_serializer(queryset, many=True)
        return Response({"count": queryset.count(), "results": serializer.data})


class BuyerShipmentDetailView(generics.RetrieveAPIView):
    """Retrieve detailed shipment information for a buyer's order."""

    permission_classes = [IsAuthenticated]
    serializer_class = BuyerShipmentSerializer

    def get_queryset(self):
        return _buyer_shipments(self.request.user)
