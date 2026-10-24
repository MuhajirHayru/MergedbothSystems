"""Shipment-scoped conversations shared by drivers and delivery requesters.

A conversation is never a separate chat record. It is the message thread that
already exists on a shipment, exposed as an inbox. Access always follows the
shipment permission model, so an unrelated account can never discover another
shipment, its participants, or its messages.
"""

from django.db.models import Q
from django.utils import timezone

from .models import (
    LogisticsUser,
    Shipment,
    ShipmentConversationRead,
    ShipmentMessage,
    ShipmentOffer,
)
from .shipment_services import (
    canonical_driver_is_authorized,
    is_active_assigned_driver,
    is_active_shipment_buyer,
)

ROLE_LABELS = {
    LogisticsUser.Role.DRIVER: "Driver",
    LogisticsUser.Role.FARMER: "Farmer",
    LogisticsUser.Role.WHOLESALER: "Wholesaler",
    LogisticsUser.Role.RETAILER: "Retailer",
    LogisticsUser.Role.FINANCIAL_MANAGER: "Financial Manager",
}

KIND_DELIVERY = "delivery"
KIND_OFFER = "offer"


def role_label(user):
    return ROLE_LABELS.get(user.role, user.get_role_display())


def _display_name(user):
    full_name = f"{user.first_name} {user.last_name}".strip()
    return full_name or user.username


def conversation_participant(user):
    return {
        "id": user.pk,
        "username": user.username,
        "display_name": _display_name(user),
        "role": user.role,
        "role_label": role_label(user),
    }


def buyer_shipments(user):
    if not user.is_active:
        return Shipment.objects.none()
    return Shipment.objects.filter(buyer=user).select_related(
        "buyer", "assigned_driver"
    )


def assigned_shipments(user):
    if not user.is_active or user.role != LogisticsUser.Role.DRIVER:
        return Shipment.objects.none()
    if not canonical_driver_is_authorized(user):
        return Shipment.objects.none()
    return Shipment.objects.filter(assigned_driver=user).select_related(
        "buyer", "assigned_driver"
    )


def pending_offer_shipments(user):
    """Shipments where the driver still holds a live, unassigned offer."""
    if not user.is_active or user.role != LogisticsUser.Role.DRIVER:
        return []
    if not canonical_driver_is_authorized(user):
        return []
    offers = (
        ShipmentOffer.objects.filter(
            driver=user,
            status=ShipmentOffer.Status.PENDING,
            expires_at__gt=timezone.now(),
            shipment__order_verified=True,
            shipment__assigned_driver__isnull=True,
        )
        .select_related("shipment__buyer", "shipment__assigned_driver")
        .order_by("-created_at")
    )
    return list(offers)


def conversation_scope(user):
    """Return every conversation the user may read, newest activity first."""
    conversations = {}
    for shipment in assigned_shipments(user):
        conversations[shipment.pk] = {
            "shipment": shipment,
            "kind": KIND_DELIVERY,
            "offer": None,
            "messages": ShipmentMessage.objects.filter(shipment=shipment).filter(
                Q(offer__isnull=True) | Q(offer__driver=user)
            ),
            "postable": shipment.assigned_driver_id == user.pk,
        }
    for shipment in buyer_shipments(user):
        conversations[shipment.pk] = {
            "shipment": shipment,
            "kind": KIND_DELIVERY,
            "offer": None,
            "messages": ShipmentMessage.objects.filter(shipment=shipment),
            "postable": shipment.assigned_driver_id is not None,
        }
    for offer in pending_offer_shipments(user):
        if offer.shipment_id in conversations:
            continue
        conversations[offer.shipment_id] = {
            "shipment": offer.shipment,
            "kind": KIND_OFFER,
            "offer": offer,
            "messages": ShipmentMessage.objects.filter(offer=offer),
            "postable": False,
        }
    return list(conversations.values())


def resolve_conversation(user, shipment_id):
    """Return the single conversation the user may read, or None."""
    for conversation in conversation_scope(user):
        if conversation["shipment"].pk == shipment_id:
            return conversation
    return None


def read_marker(user, shipment):
    marker = ShipmentConversationRead.objects.filter(
        user=user, shipment=shipment
    ).first()
    return marker.last_read_at if marker else None


def unread_count(conversation, user):
    messages = conversation["messages"]
    last_read_at = read_marker(user, conversation["shipment"])
    if last_read_at is None:
        return messages.exclude(sender=user).count()
    return messages.exclude(sender=user).filter(created_at__gt=last_read_at).count()


def mark_conversation_read(user, shipment):
    now = timezone.now()
    marker, _ = ShipmentConversationRead.objects.update_or_create(
        user=user,
        shipment=shipment,
        defaults={"last_read_at": now},
    )
    return marker


def serialize_conversation(conversation, user):
    shipment = conversation["shipment"]
    messages = list(conversation["messages"].order_by("-created_at", "-pk")[:1])
    last_message = None
    if messages:
        message = messages[0]
        last_message = {
            "id": message.pk,
            "sender_username": message.sender.username,
            "body": message.body,
            "created_at": message.created_at,
        }
    others = []
    if shipment.assigned_driver_id and shipment.assigned_driver_id != user.pk:
        others.append(conversation_participant(shipment.assigned_driver))
    if shipment.buyer_id != user.pk:
        others.append(conversation_participant(shipment.buyer))
    return {
        "shipment_id": shipment.pk,
        "kind": conversation["kind"],
        "reference": shipment.external_order_reference,
        "status": shipment.status,
        "currency": shipment.currency,
        "product_summary": shipment.product_summary,
        "pickup_region": shipment.pickup_region,
        "destination_region": shipment.destination_region,
        "participants": others,
        "last_message": last_message,
        "unread_count": unread_count(conversation, user),
        "can_post": conversation["postable"],
        "last_read_at": read_marker(user, shipment),
        "updated_at": shipment.updated_at,
    }
