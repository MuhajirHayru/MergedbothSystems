"""Part 26 — freight bidding services: job creation, bidding, staff assignment."""

import uuid
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from notifications.services import notify
from users.audit import log_action
from users.models import AccountStatus, Role

from .models import MarketplaceDeliveryFeeAgreement
from .freight_models import FreightBid, FreightJob
from .models import OrderShipmentDetails, OrderStatus


def _buyer_id(order):
    return order.retailer_id or order.wholesaler_id

DRIVER_ROLES = (Role.DRIVER,)
STAFF_ROLES = (Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER)


@transaction.atomic
def ensure_freight_job_for_order(order_id):
    """Create the freight job automatically when a shipment is authorized."""
    details = OrderShipmentDetails.objects.select_related(
        "order", "order__product", "pickup_region", "destination_region"
    ).filter(order_id=order_id).first()
    if details is None or details.authorized_at is None:
        return None
    # Privacy (Part 26.4): bidding drivers see coarse locations only. The exact
    # addresses are disclosed to the winning driver by the logistics manager at
    # assignment (see assign_bid).
    job, created = FreightJob.objects.get_or_create(
        order_id=order_id,
        defaults={
            "pickup_summary": (
                details.pickup_region.name if details.pickup_region else "Pickup region"
            )[:300],
            "destination_summary": (
                details.destination_region.name if details.destination_region else "Destination region"
            )[:300],
            "cargo_weight_kg": details.cargo_weight_kg,
            "packaging_details": (details.packaging_details or "")[:200],
            "vehicle_requirement": "",
            "published_by": None,
        },
    )
    if created:
        from notifications.services import notify
        notify(
            roles=(Role.LOGISTICS_MANAGER, Role.SUPER_ADMIN),
            type="SYSTEM",
            message=(
                f"Freight job created for order {job.order.reference}: "
                f"{job.pickup_summary} → {job.destination_summary}. "
                f"Bidding is open — assign a driver to release exact addresses."
            ),
            target_url="/logistics-dashboard",
        )
    return job, created


def _open_job_or_404(job_id):
    job = FreightJob.objects.select_related("order").filter(pk=job_id).first()
    if job is None:
        raise NotFound("Freight job not found.")
    return job


def _require_approved_driver(user):
    if user.role != Role.DRIVER:
        raise ValidationError({"detail": "Only approved drivers can bid."})
    if user.status != AccountStatus.APPROVED:
        raise ValidationError({"detail": "Your driver account is not active."})


@transaction.atomic
def place_bid(*, driver, job_id, amount, estimated_hours, message=""):
    _require_approved_driver(driver)
    job = _open_job_or_404(job_id)
    if job.status != FreightJob.Status.OPEN:
        raise ValidationError({"detail": "This job is no longer open for bidding."})
    if job.order.buyer.pk == driver.pk:
        raise ValidationError({"detail": "You cannot bid on your own order's shipment."})
    amount = Decimal(str(amount))
    if amount <= 0:
        raise ValidationError({"amount": "Bid amount must be greater than zero."})
    existing = FreightBid.objects.filter(job=job, driver=driver).first()
    if existing is not None and existing.status == FreightBid.Status.SUBMITTED:
        # A driver may improve their own open bid; append-only rows are updated
        # through the queryset to keep the immutability guard for real history.
        FreightBid.objects.filter(pk=existing.pk).update(
            amount=amount,
            estimated_hours=max(1, int(estimated_hours or 24)),
            message=(message or "").strip()[:300],
        )
        existing.refresh_from_db()
        return existing
    if existing is not None:
        raise ValidationError({"detail": "You already have a final bid on this job."})
    bid = FreightBid.objects.create(
        job=job, driver=driver, amount=amount,
        estimated_hours=max(1, int(estimated_hours or 24)),
        message=(message or "").strip()[:300],
    )
    return bid


@transaction.atomic
def withdraw_bid(*, driver, job_id):
    bid = FreightBid.objects.select_related("job").filter(
        job_id=job_id, driver=driver, status=FreightBid.Status.SUBMITTED
    ).first()
    if bid is None:
        raise NotFound("No open bid found for this job.")
    if bid.job.status != FreightJob.Status.OPEN:
        raise ValidationError({"detail": "This job is no longer open."})
    FreightBid.objects.filter(pk=bid.pk).update(
        status=FreightBid.Status.WITHDRAWN, responded_at=timezone.now()
    )
    return bid


@transaction.atomic
def assign_bid(*, staff, job_id, bid_id):
    """Logistics staff accept a bid: everything else is rejected and the
    delivery fee agreement snapshot is recorded like the Option C models."""
    if staff.role not in STAFF_ROLES:
        raise ValidationError({"detail": "Only logistics staff can assign freight jobs."})
    job = FreightJob.objects.select_for_update().select_related("order").filter(pk=job_id).first()
    if job is None:
        raise NotFound("Freight job not found.")
    if job.status != FreightJob.Status.OPEN:
        raise ValidationError({"detail": "This job is not open for assignment."})
    bid = FreightBid.objects.select_for_update().select_related("driver").filter(
        pk=bid_id, job=job
    ).first()
    if bid is None:
        raise NotFound("Bid not found for this job.")
    if bid.status != FreightBid.Status.SUBMITTED:
        raise ValidationError({"detail": "This bid is no longer available."})

    now = timezone.now()
    FreightBid.objects.filter(pk=bid.pk).update(
        status=FreightBid.Status.ACCEPTED, responded_at=now
    )
    FreightBid.objects.filter(job=job).exclude(pk=bid.pk).filter(
        status=FreightBid.Status.SUBMITTED
    ).update(status=FreightBid.Status.REJECTED, responded_at=now)

    job.status = FreightJob.Status.ASSIGNED
    job.assigned_driver = bid.driver
    job.assigned_fee = bid.amount
    job.assigned_at = now
    job.save(update_fields=["status", "assigned_driver", "assigned_fee", "assigned_at"])

    # Record the delivery fee agreement snapshot (Option C: the accepted bid
    # IS the customer-agreed delivery amount; platform fee snapshot comes from
    # the approved pricing configuration at acceptance time).
    details = OrderShipmentDetails.objects.filter(order=job.order).first()
    # Part 26.4 — the logistics manager releases the exact seller/buyer addresses
    # to the winning driver only, at assignment.
    if details is not None:
        job.exact_pickup_address = (
            f"{details.pickup_region.name if details.pickup_region else ''} — "
            f"{details.pickup_address_line}"
        )[:500]
        job.exact_destination_address = (
            f"{details.destination_region.name if details.destination_region else ''} — "
            f"{details.destination_address_line}"
        )[:500]
        job.addresses_disclosed_at = now
        job.save(update_fields=["exact_pickup_address", "exact_destination_address", "addresses_disclosed_at"])
        if details.driver_shipment_id is None:
            details.driver_shipment_id = 0
            details.driver_shipment_status = "assigned"
            details.save(update_fields=["driver_shipment_id", "driver_shipment_status", "updated_at"])

    # The accepted bid is the final customer-agreed delivery amount: update any
    # existing agreement snapshot (e.g. from an earlier DriverApp feed event) to
    # match it, or create one for staff-managed assignments.
    agreement, _ = MarketplaceDeliveryFeeAgreement.objects.update_or_create(
        order=job.order,
        defaults={
            "source_event_id": uuid.uuid4(),
            "driver_shipment_id": 0,
            "driver_payee": bid.driver,
            "driver_external_user_id": str(bid.driver.pk),
            "driver_proposal_version": 1,
            "amount": bid.amount,
            "currency": "ETB",
            "buyer_accepted_at": (details.authorized_at or now) if details else now,
            "driver_accepted_at": now,
        },
    )

    notify(
        user_ids=[bid.driver_id],
        type="SYSTEM",
        message=(
            f"Your bid of {bid.amount} ETB for {job.order.reference} was accepted. "
            f"Exact pickup: {job.exact_pickup_address}. "
            f"Delivery to: {job.exact_destination_address}"
        ),
        actor=staff,
        target_url="/driver",
    )
    notify(
        user_ids=[_buyer_id(job.order)],
        type="SYSTEM",
        message=(
            f"A driver was assigned to your order {job.order.reference} "
            f"for {bid.amount} ETB."
        ),
        actor=staff,
        target_url="/orders",
    )
    return job, bid


DELIVERY_TRANSITIONS = {
    "ASSIGNED": "PICKUP_IN_PROGRESS",
    "PICKUP_IN_PROGRESS": "ARRIVED_AT_PICKUP",
    "ARRIVED_AT_PICKUP": "PICKED_UP",
    "PICKED_UP": "IN_TRANSIT",
    "IN_TRANSIT": "DELIVERED",
}

DELIVERY_LABELS = {
    "PICKUP_IN_PROGRESS": "En route to pickup",
    "ARRIVED_AT_PICKUP": "Arrived at pickup",
    "PICKED_UP": "Picked up — in transit",
    "IN_TRANSIT": "In transit to buyer",
    "DELIVERED": "Delivered",
}


@transaction.atomic
def advance_delivery_status(*, driver, job_id):
    """Driver advances their assigned delivery to the next status."""
    job = FreightJob.objects.select_for_update().select_related("order").filter(
        pk=job_id, assigned_driver=driver
    ).first()
    if job is None:
        raise NotFound("Assigned job not found.")
    if job.status != FreightJob.Status.ASSIGNED:
        raise ValidationError({"detail": "Only assigned jobs can be progressed."})
    current = job.delivery_status or "ASSIGNED"
    allowed_from = {v: k for k, v in DELIVERY_TRANSITIONS.items()}
    if current not in allowed_from:
        raise ValidationError({"detail": f"Delivery already at final status: {current}."})
    next_status = allowed_from[current]
    job.delivery_status = next_status
    job.delivery_status_updated_at = timezone.now()
    job.save(update_fields=["delivery_status", "delivery_status_updated_at"])
    if next_status == "DELIVERED":
        job.status = FreightJob.Status.COMPLETED
        job.save(update_fields=["status"])
    return job, next_status
