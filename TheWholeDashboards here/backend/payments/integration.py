import json
import uuid

from django.db import transaction
from django.utils import timezone

from users.models import AccountStatus, AuditLog, Role

from .models import (
    AgreementStatus,
    BusinessAgreement,
    MarketplaceIntegrationOutbox,
    MarketplaceIntegrationRevision,
    MarketplaceDeliveryFeeReview,
    Order,
    OrderShipmentDetails,
    OrderStatus,
)


@transaction.atomic
def enqueue_order_authorization(order_id, actor):
    order = (
        Order.objects.select_for_update()
        .select_related("wholesaler", "farmer", "retailer", "product")
        .filter(pk=order_id)
        .first()
    )
    if order is None or order.status != OrderStatus.ACCEPTED:
        return None
    if not BusinessAgreement.objects.filter(
        order=order, status=AgreementStatus.ACTIVE
    ).exists():
        return None

    buyer = order.buyer
    seller = order.seller
    expected_buyer_roles = {Role.WHOLESALER, Role.RETAILER}
    expected_seller_roles = {Role.FARMER, Role.WHOLESALER}
    if (
        not buyer.is_active
        or not seller.is_active
        or buyer.status != AccountStatus.APPROVED
        or seller.status != AccountStatus.APPROVED
        or buyer.role not in expected_buyer_roles
        or seller.role not in expected_seller_roles
        or buyer.pk == seller.pk
    ):
        return None

    details = (
        OrderShipmentDetails.objects.select_for_update()
        .select_related(
            "pickup_region",
            "pickup_zone",
            "pickup_wereda",
            "pickup_kebele",
            "destination_region",
            "destination_zone",
            "destination_wereda",
            "destination_kebele",
        )
        .filter(order=order)
        .first()
    )
    if details is None or details.authorized_at or details.closed_at:
        return None
    if (
        details.buyer_confirmed_revision != details.details_revision
        or details.seller_confirmed_revision != details.details_revision
        or details.delivery_fee_proposal_amount is None
        or details.delivery_fee_proposal_amount <= 0
        or details.delivery_fee_proposal_currency != "ETB"
        or not details.packaging_details.strip()
        or details.cargo_weight_kg <= 0
    ):
        return None
    locations = (
        details.pickup_region,
        details.pickup_zone,
        details.pickup_wereda,
        details.pickup_kebele,
        details.destination_region,
        details.destination_zone,
        details.destination_wereda,
        details.destination_kebele,
    )
    if any(location is not None and not location.active for location in locations):
        return None

    event_id = uuid.uuid4()
    occurred_at = timezone.now()
    revision = _next_revision(order)
    payload = {
        "contract_version": "2",
        "source_system": "greenpath_marketplace",
        "event_id": str(event_id),
        "event_type": "order.authorized",
        "occurred_at": occurred_at.isoformat(),
        "revision": revision,
        "order_reference": str(order.pk),
        "buyer": {
            "external_user_id": str(buyer.pk),
            "role": buyer.role.lower(),
        },
        "seller": {
            "external_user_id": str(seller.pk),
            "role": seller.role.lower(),
        },
        "shipment": {
            "pickup": _address_payload(
                details, "pickup", details.pickup_region, details.pickup_zone,
                details.pickup_wereda, details.pickup_kebele,
            ),
            "destination": _address_payload(
                details, "destination", details.destination_region,
                details.destination_zone, details.destination_wereda,
                details.destination_kebele,
            ),
            "product": {
                "id": str(order.product_id),
                "description": order.product.title,
                "quantity": str(order.quantity),
                "unit": order.product.unit_of_measure,
            },
            "cargo_weight_kg": str(details.cargo_weight_kg),
            "packaging_details": details.packaging_details,
            "details_revision": details.details_revision,
        },
        "delivery_fee_proposal": {
            "amount": str(details.delivery_fee_proposal_amount),
            "currency": details.delivery_fee_proposal_currency,
            "proposer": "buyer",
            "version": details.delivery_fee_proposal_version,
        },
    }
    _store_outbox(order, event_id, revision, "order.authorized", payload)
    details.authorized_at = occurred_at
    details.save(update_fields=["authorized_at", "updated_at"])
    AuditLog.objects.create(
        actor=actor,
        action="driver_authorization_enqueued",
        target=str(order.pk),
        detail=f"Integration authorization event {event_id} queued at revision {revision}.",
    )
    enqueue_payment_snapshot(order.pk, actor)
    return event_id


@transaction.atomic
def enqueue_order_cancellation(order_id, actor):
    order = (
        Order.objects.select_for_update()
        .select_related("wholesaler", "farmer", "retailer")
        .filter(pk=order_id)
        .first()
    )
    if order is None or order.status != OrderStatus.CANCELLED:
        return None
    details = (
        OrderShipmentDetails.objects.select_for_update()
        .filter(order=order, authorized_at__isnull=False)
        .first()
    )
    if details is None:
        return None
    if details.closed_at is None:
        details.closed_at = timezone.now()
        details.save(update_fields=["closed_at", "updated_at"])
    if MarketplaceIntegrationOutbox.objects.filter(
        order=order, event_type="order.cancelled"
    ).exists():
        return None

    event_id = uuid.uuid4()
    revision = _next_revision(order)
    payload = {
        "contract_version": "2",
        "source_system": "greenpath_marketplace",
        "event_id": str(event_id),
        "event_type": "order.cancelled",
        "occurred_at": timezone.now().isoformat(),
        "revision": revision,
        "order_reference": str(order.pk),
        "buyer": {
            "external_user_id": str(order.buyer.pk),
            "role": order.buyer.role.lower(),
        },
        "seller": {
            "external_user_id": str(order.seller.pk),
            "role": order.seller.role.lower(),
        },
        "cancellation_reason": "The marketplace order was cancelled.",
    }
    _store_outbox(order, event_id, revision, "order.cancelled", payload)
    AuditLog.objects.create(
        actor=actor,
        action="driver_authorization_cancelled",
        target=str(order.pk),
        detail=f"Integration cancellation event {event_id} queued at revision {revision}.",
    )
    return event_id


@transaction.atomic
def enqueue_payment_snapshot(order_id, actor=None):
    order = (
        Order.objects.select_for_update()
        .filter(pk=order_id)
        .first()
    )
    if order is None or not order.payment_status:
        return None
    if not OrderShipmentDetails.objects.filter(
        order=order, authorized_at__isnull=False
    ).exists():
        return None
    latest = (
        MarketplaceIntegrationOutbox.objects.filter(
            order=order, event_type="payment.status_snapshot"
        )
        .order_by("-revision")
        .first()
    )
    if latest:
        previous_payload = json.loads(latest.payload)
        if previous_payload["payment"]["status"] == order.payment_status:
            return latest.event_id

    event_id = uuid.uuid4()
    revision = _next_revision(order)
    payload = {
        "contract_version": "2",
        "source_system": "greenpath_marketplace",
        "event_id": str(event_id),
        "event_type": "payment.status_snapshot",
        "occurred_at": timezone.now().isoformat(),
        "revision": revision,
        "order_reference": str(order.pk),
        "payment": {"status": order.payment_status},
    }
    _store_outbox(order, event_id, revision, "payment.status_snapshot", payload)
    AuditLog.objects.create(
        actor=actor,
        action="marketplace_payment_snapshot_enqueued",
        target=str(order.pk),
        detail=f"Payment status snapshot queued at revision {revision}.",
    )
    return event_id


@transaction.atomic
def enqueue_delivery_fee_review(review: MarketplaceDeliveryFeeReview):
    agreement = review.agreement
    order = (
        Order.objects.select_for_update()
        .select_related("wholesaler", "farmer", "retailer")
        .get(pk=agreement.order_id)
    )
    event_id = review.decision_event_id
    revision = _next_revision(order)
    occurred_at = review.decided_at
    delivery_fee_review = {
        "agreement_event_id": str(agreement.source_event_id),
        "shipment_id": agreement.driver_shipment_id,
        "proposal_version": review.proposal_version,
        "amount": str(agreement.amount),
        "currency": agreement.currency,
        "decision": review.decision,
        "message": "The marketplace delivery-fee review is complete.",
    }
    if review.decision == MarketplaceDeliveryFeeReview.Decision.REJECTED:
        delivery_fee_review["rejection_reason"] = review.rejection_reason
    payload = {
        "contract_version": "2",
        "source_system": "greenpath_marketplace",
        "event_id": str(event_id),
        "event_type": "delivery_fee.reviewed",
        "occurred_at": occurred_at.isoformat(),
        "revision": revision,
        "order_reference": str(order.pk),
        "delivery_fee_review": delivery_fee_review,
    }
    _store_outbox(order, event_id, revision, "delivery_fee.reviewed", payload)
    AuditLog.objects.create(
        actor=review.actor,
        action="marketplace_delivery_fee_review_event_enqueued",
        target=str(agreement.source_event_id),
        detail=f"Decision event {event_id} queued at revision {revision}.",
    )
    return event_id


def _next_revision(order):
    revision, _ = MarketplaceIntegrationRevision.objects.get_or_create(order=order)
    revision.next_revision += 1
    revision.save(update_fields=["next_revision", "updated_at"])
    return revision.next_revision


def _store_outbox(order, event_id, revision, event_type, payload):
    return MarketplaceIntegrationOutbox.objects.create(
        event_id=event_id,
        order=order,
        revision=revision,
        event_type=event_type,
        payload=json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ),
    )


def _address_payload(details, prefix, region, zone, wereda, kebele):
    return {
        "region": region.name,
        "zone": zone.name if zone else None,
        "wereda": wereda.name if wereda else None,
        "kebele": kebele.name if kebele else None,
        "address_line": getattr(details, f"{prefix}_address_line"),
    }
