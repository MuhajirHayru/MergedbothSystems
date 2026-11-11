"""Part 26 — freight oversight board for logistics staff.

The DriverApp owns the bidding mechanics (fee proposals, driver counterproposals,
accept/reject — no second system here). This board gives authorized logistics
staff marketplace-side visibility over authorized shipments, their pricing
snapshots, and compensation status, honoring Option C models.
"""

from datetime import timedelta

from django.conf import settings
from django.core.paginator import EmptyPage, Paginator
from django.db.models import Q
from rest_framework.exceptions import NotFound, ParseError
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.financial_models import DeliveryFeePayment
from payments.models import MarketplaceDeliveryFeeAgreement, OrderShipmentDetails, OrderStatus
from payments.freight_models import FreightJob
from logistics.models import DriverApplication, DriverProfile, DriverShipmentLocation, Shipment
from users.models import AccountStatus, Role
from users.permissions import IsAuthenticatedRole

FREIGHT_ROLES = (Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER, Role.FINANCIAL_MANAGER, Role.CUSTOMER_SUPPORT)


def _driver_roster():
    """Approved roster plus location only while the driver is actively sharing it."""
    from django.utils import timezone

    now = timezone.now()
    active_statuses = (
        Shipment.Status.ASSIGNED,
        Shipment.Status.PICKUP_PENDING,
        Shipment.Status.PICKUP_ARRIVED,
        Shipment.Status.PICKED_UP,
        Shipment.Status.IN_TRANSIT,
        Shipment.Status.DELIVERY_ATTEMPTED,
        Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
    )
    profiles = DriverProfile.objects.filter(
        user__role=Role.DRIVER,
        user__status=AccountStatus.APPROVED,
        user__is_active=True,
        application__status=DriverApplication.Status.APPROVED,
    ).select_related("user", "application").order_by("user__full_name")
    rows = []
    from payments.freight_models import FreightJob
    for profile in profiles:
        app = profile.application
        locations = DriverShipmentLocation.objects.filter(
            driver=profile.user,
            shipment__assigned_driver=profile.user,
            shipment__status__in=active_statuses,
            sharing_stopped_at__isnull=True,
            sharing_expires_at__gt=now,
            latitude__isnull=False,
            longitude__isnull=False,
        ).select_related("shipment").order_by("-observed_at")
        location = locations.first()
        location_is_fresh = bool(
            location and location.observed_at
            and location.observed_at >= now - timedelta(
                seconds=settings.DRIVER_LOCATION_STALE_AFTER_SECONDS
            )
        )
        # A driver's precise coordinates are included only during a current,
        # authorized active shipment sharing session.
        rows.append({
            "id": str(profile.user_id),
            "name": profile.user.full_name,
            "available": profile.is_available,
            "phone": profile.phone_number,
            "email": profile.user.email,
            "registered_location": {
                "address": profile.user.location,
                "latitude": str(profile.user.latitude) if profile.user.latitude is not None else None,
                "longitude": str(profile.user.longitude) if profile.user.longitude is not None else None,
            },
            "vehicle_type": app.vehicle_type,
            "vehicle_registration": app.vehicle_registration,
            "capacity_kg": str(app.cargo_capacity_kg) if app.cargo_capacity_kg is not None else None,
            "service_region": app.service_region,
            "service_zone": app.service_zone,
            "service_wereda": app.service_wereda,
            "active_shipment_count": Shipment.objects.filter(
                assigned_driver=profile.user, status__in=active_statuses
            ).count() + FreightJob.objects.filter(
                assigned_driver=profile.user, status=FreightJob.Status.ASSIGNED
            ).count(),
            "location_status": "live" if location_is_fresh else (
                "stale" if location else (
                    "registered" if profile.user.latitude is not None and profile.user.longitude is not None
                    else "unregistered"
                )
            ),
            "location": ({
                "latitude": str(location.latitude),
                "longitude": str(location.longitude),
                "observed_at": location.observed_at.isoformat() if location.observed_at else None,
                "order_reference": location.shipment.external_order_reference,
                "shipment_status": location.shipment.status,
            } if location_is_fresh else None),
        })
    return rows


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
            details = details.filter(order__delivery_fee_agreement__isnull=True)
        elif status_param == "agreed":
            details = details.filter(order__delivery_fee_agreement__isnull=False)
        if request.query_params.get("region"):
            details = details.filter(pickup_region_id=request.query_params["region"])
        search = (request.query_params.get("search") or "").strip()
        if search:
            details = details.filter(
                Q(order__reference__icontains=search)
                | Q(pickup_address_line__icontains=search)
                | Q(destination_address_line__icontains=search)
                | Q(order__product__title__icontains=search)
                | Q(order__wholesaler__full_name__icontains=search)
                | Q(order__farmer__full_name__icontains=search)
                | Q(order__retailer__full_name__icontains=search)
                | Q(order__delivery_fee_agreement__driver_payee__full_name__icontains=search)
                | Q(order__delivery_fee_agreement__driver_payee__email__icontains=search)
                | Q(order__delivery_fee_agreement__driver_external_user_id__icontains=search)
            )

        try:
            page_number = int(request.query_params.get("page", "1"))
            page_size = min(int(request.query_params.get("page_size", "25")), 100)
        except (TypeError, ValueError):
            raise ParseError({"page": "Use a positive page number and page size."})
        if page_number < 1 or page_size < 1:
            raise ParseError({"page": "Use a positive page number and page size."})

        total = details.count()
        awaiting_agreement = details.filter(order__delivery_fee_agreement__isnull=True).count()
        with_agreement = details.filter(order__delivery_fee_agreement__isnull=False).count()
        paginator = Paginator(details, page_size)
        try:
            page = paginator.page(page_number)
        except EmptyPage:
            raise NotFound("That page contains no authorized shipments.")

        # Region filters are supplied from the actual authorized shipment data,
        # so newly added regions appear without a frontend option list change.
        from registrations.models import AdministrativeLocation

        region_ids = OrderShipmentDetails.objects.filter(
            authorized_at__isnull=False
        ).values_list("pickup_region_id", flat=True).distinct()
        regions = list(
            AdministrativeLocation.objects.filter(pk__in=region_ids, active=True)
            .order_by("name")
            .values("id", "name")
        )

        rows = []
        for d in page.object_list:
            order_id = d.order.pk
            agreement = MarketplaceDeliveryFeeAgreement.objects.filter(order=d.order).select_related("driver_payee").first()
            payment = DeliveryFeePayment.objects.filter(agreement=agreement).select_related("agreement").first() if agreement else None
            rows.append({
                "order_id": str(d.order.pk),
                "order_reference": d.order.reference,
                "product": d.order.product.title,
                "quantity": str(d.order.quantity),
                "buyer": d.order.buyer.full_name,
                "buyer_role": d.order.buyer.role,
                "seller": d.order.seller.full_name,
                "seller_role": d.order.seller.role,
                "freight_payer": d.order.buyer.full_name,
                "freight_payer_role": d.order.buyer.role,
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
                    "customer_amount": (agreement.pricing_configuration_snapshot or {}).get("customer_amount"),
                    "driver_payee": agreement.driver_payee.full_name if agreement.driver_payee else agreement.driver_external_user_id,
                } if agreement else None,
                "payment_status": payment.status if payment else None,
                "compensation_paid": payment.compensation_paid_at is not None if payment else False,
                "freight_job": self._freight_job_summary(d.order),
                "order_status": d.order.status,
            })
        return Response({
            "success": True,
            "summary": {
                "authorized_shipments": total,
                "with_agreement": with_agreement,
                "awaiting_agreement": awaiting_agreement,
            },
            "pagination": {
                "page": page.number,
                "page_size": page_size,
                "total_items": paginator.count,
                "total_pages": paginator.num_pages,
                "has_next": page.has_next(),
                "has_previous": page.has_previous(),
            },
            "regions": regions,
            # Staff outside logistics oversight can inspect shipment finance,
            # but do not receive the fleet roster or operational driver details.
            "drivers": _driver_roster() if request.user.role in (Role.LOGISTICS_MANAGER, Role.SUPER_ADMIN) else [],
            "shipments": rows,
        })

    @staticmethod
    def _freight_job_summary(order):
        job = FreightJob.objects.filter(order=order).select_related("assigned_driver").first()
        if not job:
            return None
        return {
            "id": str(job.pk), "status": job.status,
            "delivery_status": job.delivery_status,
            "driver": job.assigned_driver.full_name if job.assigned_driver_id else None,
            "fee": str(job.assigned_fee) if job.assigned_fee is not None else None,
        }


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
        freight_job = FreightJob.objects.filter(order=order).select_related("assigned_driver").first()
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
            "driver_shipment_status": (freight_job.delivery_status or freight_job.status.lower()) if freight_job and not (details and details.driver_shipment_id) else (details.driver_shipment_status if details else None),
            "driver": freight_job.assigned_driver.full_name if freight_job and freight_job.assigned_driver_id else (agreement.driver_payee.full_name if agreement and agreement.driver_payee else (agreement.driver_external_user_id if agreement else None)),
            "fee": str(agreement.amount) if agreement else None,
            "freight_job": FreightBoardView._freight_job_summary(order),
            "timeline": timeline,
        })
