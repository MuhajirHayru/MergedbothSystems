"""Part 26 — freight oversight board for logistics staff.

The DriverApp owns the bidding mechanics (fee proposals, driver counterproposals,
accept/reject — no second system here). This board gives authorized logistics
staff marketplace-side visibility over authorized shipments, their pricing
snapshots, and compensation status, honoring Option C models.
"""

from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.financial_models import DeliveryFeePayment
from payments.models import MarketplaceDeliveryFeeAgreement, OrderShipmentDetails, OrderStatus
from users.models import Role
from users.permissions import IsAuthenticatedRole

FREIGHT_ROLES = (Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER, Role.FINANCIAL_MANAGER, Role.CUSTOMER_SUPPORT)


class FreightBoardView(APIView):
    """GET /api/v1/payments/financial/freight-board/ — authorized shipments oversight."""

    def get_permissions(self):
        return [IsAuthenticatedRole(FREIGHT_ROLES)]

    def get(self, request):
        details = (
            OrderShipmentDetails.objects.select_related(
                "order", "order__product", "order__wholesaler", "order__farmer",
                "order__retailer", "pickup_region", "destination_region",
            )
            .filter(authorized_at__isnull=False)
            .order_by("-authorized_at")
        )
        status_param = request.query_params.get("shipment_status")
        if status_param == "awaiting_agreement":
            details = details.filter(driver_shipment_id__isnull=True)
        elif status_param == "agreed":
            details = details.filter(driver_shipment_id__isnull=False)
        if request.query_params.get("region"):
            details = details.filter(pickup_region_id=request.query_params["region"])
        search = (request.query_params.get("search") or "").strip()
        if search:
            details = details.filter(
                Q(order__reference__icontains=search)
                | Q(pickup_address_line__icontains=search)
                | Q(destination_address_line__icontains=search)
                | Q(order__product__title__icontains=search)
            )

        rows = []
        for d in details[:100]:
            order_id = d.order.pk
            agreement = MarketplaceDeliveryFeeAgreement.objects.filter(order=d.order).select_related("driver_payee").first()
            payment = DeliveryFeePayment.objects.filter(agreement=agreement).select_related("agreement").first() if agreement else None
            rows.append({
                "order_id": str(d.order.pk),
                "order_reference": d.order.reference,
                "product": d.order.product.title,
                "quantity": str(d.order.quantity),
                "buyer": d.order.buyer.full_name,
                "seller": d.order.seller.full_name,
                "pickup": f"{d.pickup_region.name if d.pickup_region else ''} — {d.pickup_address_line}",
                "destination": f"{d.destination_region.name if d.destination_region else ''} — {d.destination_address_line}",
                "cargo_weight_kg": str(d.cargo_weight_kg),
                "packaging": d.packaging_details,
                "driver_shipment_id": d.driver_shipment_id,
                "driver_shipment_status": d.driver_shipment_status,
                "proposed_fee": str(d.delivery_fee_proposal_amount) if d.delivery_fee_proposal_amount else None,
                "agreement": {
                    "amount": str(agreement.amount),
                    "pricing_model": agreement.pricing_model_snapshot,
                    "driver_charge": str(agreement.driver_charge_snapshot) if agreement.driver_charge_snapshot else None,
                    "platform_fee": str(agreement.platform_fee_snapshot) if agreement.platform_fee_snapshot else None,
                    "driver_payee": agreement.driver_payee.email if agreement.driver_payee else agreement.driver_external_user_id,
                } if agreement else None,
                "payment_status": payment.status if payment else None,
                "compensation_paid": payment.compensation_paid_at is not None if payment else False,
                "order_status": d.order.status,
            })
        return Response({
            "success": True,
            "summary": {
                "authorized_shipments": details.count(),
                "with_agreement": MarketplaceDeliveryFeeAgreement.objects.count(),
                "awaiting_agreement": details.filter(driver_shipment_id__isnull=True).count(),
            },
            "shipments": rows,
        })


class FreightTrackingView(APIView):
    """GET /payments/financial/freight-board/<order_id>/tracking/ — Part 26.5.

    Shipment status, driver, and the full event timeline from the DriverApp
    shipment feed inbox, for logistics staff.
    """

    def get_permissions(self):
        return [IsAuthenticatedRole(FREIGHT_ROLES)]

    def get(self, request, order_id):
        from payments.models import DriverShipmentEventInbox, Order
        order = Order.objects.filter(pk=order_id).first()
        if order is None:
            return Response({"success": False, "error": "Order not found."}, status=404)
        details = OrderShipmentDetails.objects.select_related(
            "pickup_region", "destination_region"
        ).filter(order=order).first()
        agreement = MarketplaceDeliveryFeeAgreement.objects.filter(order=order).select_related("driver_payee").first()
        events = DriverShipmentEventInbox.objects.filter(order=order).order_by("created_at")
        timeline = []
        for e in events:
            to_status = e.details.get("to_status") if isinstance(e.details, dict) else None
            timeline.append({
                "event_type": e.event_type,
                "status": to_status,
                "at": e.created_at.isoformat(),
            })
        return Response({
            "success": True,
            "order_reference": order.reference,
            "order_status": order.status,
            "driver_shipment_id": details.driver_shipment_id if details else None,
            "driver_shipment_status": details.driver_shipment_status if details else None,
            "driver": agreement.driver_payee.full_name if agreement and agreement.driver_payee else (agreement.driver_external_user_id if agreement else None),
            "fee": str(agreement.amount) if agreement else None,
            "timeline": timeline,
        })
