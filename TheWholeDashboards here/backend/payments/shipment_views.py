"""Buyer shipment tracking views."""
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.db.models import Q

from users.permissions import IsAuthenticatedRole
from .models import Order, OrderShipmentDetails, OrderStatus
from .serializers import OrderShipmentDetailsSerializer


class BuyerShipmentListView(generics.ListAPIView):
    """List all shipments for the authenticated buyer's orders."""
    
    permission_classes = [IsAuthenticated]
    serializer_class = OrderShipmentDetailsSerializer
    
    def get_queryset(self):
        user = self.request.user
        # Get all orders where the user is the buyer
        return OrderShipmentDetails.objects.filter(
            order__buyer=user
        ).select_related(
            'order',
            'order__buyer',
            'order__seller',
            'pickup_region',
            'destination_region'
        ).order_by('-order__created_at')
    
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        
        # Filter by status if provided
        status = request.query_params.get('status')
        if status:
            queryset = queryset.filter(order__status=status)
        
        # Search by order reference
        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(order__order_reference__icontains=search) |
                Q(driver_shipment_reference__icontains=search)
            )
        
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'count': queryset.count(),
            'results': serializer.data
        })


class BuyerShipmentDetailView(generics.RetrieveAPIView):
    """Retrieve detailed shipment information for a buyer's order."""
    
    permission_classes = [IsAuthenticated]
    serializer_class = OrderShipmentDetailsSerializer
    
    def get_queryset(self):
        user = self.request.user
        return OrderShipmentDetails.objects.filter(
            order__buyer=user
        ).select_related(
            'order',
            'order__buyer',
            'order__seller',
            'pickup_region',
            'pickup_zone',
            'pickup_wereda',
            'destination_region',
            'destination_zone',
            'destination_wereda'
        )
    
    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        
        data = serializer.data
        
        # Include driver shipment status from inbox if available
        from .models import DriverShipmentEventInbox
        latest_event = DriverShipmentEventInbox.objects.filter(
            driver_shipment_id=instance.driver_shipment_id
        ).order_by('-received_at').first()
        
        if latest_event:
            data['driver_status'] = latest_event.payload.get('status')
            data['last_status_update'] = latest_event.received_at
        
        return Response(data)
