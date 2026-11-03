import hashlib
from decimal import Decimal
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import (
    LogisticsUser,
    DriverApplication,
    DriverProfile,
    MarketplaceDriverIdentity,
    MarketplaceIntegrationEvent,
    MarketplaceOrderAuthorization,
    MarketplaceDeliveryFeeReview,
    MarketplacePaymentSnapshot,
    MarketplaceShipmentEvent,
    Shipment,
    ShipmentFeeProposal,
    ShipmentOffer,
)
from .services import record_audit
from .shipment_services import SHIPMENT_TRANSITIONS, _transition, create_shipment_offers


class EventConflict(Exception):
    pass


def apply_marketplace_v2_event(event_data, payload_sha256):
    if event_data["event_type"] == "driver.authorization_snapshot":
        return apply_marketplace_driver_authorization(event_data, payload_sha256)
    if event_data["event_type"] == "order.authorized":
        return apply_marketplace_order_event(
            _normalize_v2_authorization(event_data), payload_sha256
        )
    if event_data["event_type"] == "order.cancelled":
        return apply_marketplace_order_event(
            _normalize_v2_cancellation(event_data), payload_sha256
        )
    if event_data["event_type"] == "delivery_fee.reviewed":
        return _apply_marketplace_v2_delivery_fee_review(event_data, payload_sha256)
    return _apply_marketplace_v2_payment_snapshot(event_data, payload_sha256)


@transaction.atomic
def apply_marketplace_driver_authorization(event_data, payload_sha256):
    """Apply a revisioned Marketplace decision without transferring credentials or documents."""
    event_id = str(event_data["event_id"])
    canonical_user_id = UUID(str(event_data["canonical_user_id"]))
    external_reference = f"driver:{canonical_user_id}"
    existing_event = MarketplaceIntegrationEvent.objects.select_for_update().filter(
        event_id=event_id
    ).first()
    if existing_event:
        if existing_event.payload_sha256 == payload_sha256:
            return existing_event.response_status, existing_event.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    snapshot = event_data["driver_authorization"]
    identity = MarketplaceDriverIdentity.objects.select_for_update().filter(
        marketplace_user_id=canonical_user_id
    ).select_related("user", "profile").first()
    if identity and event_data["revision"] <= identity.revision:
        response = {
            "event_id": event_id,
            "status": "rejected",
            "code": "stale_revision",
            "canonical_user_id": str(canonical_user_id),
        }
        MarketplaceIntegrationEvent.objects.create(
            event_id=event_id,
            event_type=event_data["event_type"],
            external_order_reference=external_reference,
            revision=event_data["revision"],
            payload_sha256=payload_sha256,
            response_status=409,
            response_payload=response,
            applied=False,
        )
        return 409, response

    if identity is None:
        user = LogisticsUser.objects.filter(
            external_user_id=str(canonical_user_id)
        ).first()
        if user and user.role != LogisticsUser.Role.DRIVER:
            response = {
                "event_id": event_id,
                "status": "rejected",
                "code": "canonical_identity_role_conflict",
            }
            MarketplaceIntegrationEvent.objects.create(
                event_id=event_id,
                event_type=event_data["event_type"],
                external_order_reference=external_reference,
                revision=event_data["revision"],
                payload_sha256=payload_sha256,
                response_status=409,
                response_payload=response,
                applied=False,
            )
            return 409, response
        if user is None:
            user = LogisticsUser(
                username=f"marketplace-{canonical_user_id}",
                role=LogisticsUser.Role.DRIVER,
                external_user_id=str(canonical_user_id),
                email_verified=True,
            )
            user.set_unusable_password()
            user.save()
        profile, _ = DriverProfile.objects.get_or_create(
            user=user,
            defaults={"phone_number": snapshot["phone"]},
        )
        identity = MarketplaceDriverIdentity(
            marketplace_user_id=canonical_user_id,
            user=user,
            profile=profile,
            revision=0,
            last_event_id=event_data["event_id"],
            payload_sha256=payload_sha256,
        )

    user = identity.user
    profile = identity.profile
    profile.phone_number = snapshot["phone"]
    profile.save(update_fields=["phone_number", "updated_at"])
    user.role = LogisticsUser.Role.DRIVER
    user.external_user_id = str(canonical_user_id)
    user.is_active = bool(snapshot["driver_authorized"])
    user.first_name, _, user.last_name = snapshot["legal_full_name"].partition(" ")
    user.save(update_fields=["role", "external_user_id", "is_active", "first_name", "last_name"])

    status_map = {
        "draft": DriverApplication.Status.DRAFT,
        "submitted": DriverApplication.Status.SUBMITTED,
        "under_review": DriverApplication.Status.UNDER_REVIEW,
        "additional_info_required": DriverApplication.Status.ADDITIONAL_INFO_REQUIRED,
        "approved": DriverApplication.Status.APPROVED,
        "rejected": DriverApplication.Status.REJECTED,
        "suspended": DriverApplication.Status.SUSPENDED,
    }
    application_status = status_map.get(snapshot["application_status"])
    if application_status is None:
        raise EventConflict("Unsupported canonical driver application status.")
    application, _ = DriverApplication.objects.get_or_create(
        profile=profile,
        defaults={"legal_full_name": snapshot["legal_full_name"]},
    )
    application.legal_full_name = snapshot["legal_full_name"]
    application.license_number = snapshot["license_number"]
    application.license_expiry = snapshot["license_expiry"]
    application.vehicle_type = snapshot["vehicle_type"]
    application.vehicle_registration = snapshot["vehicle_registration"]
    application.cargo_capacity_kg = (
        Decimal(snapshot["cargo_capacity_kg"])
        if snapshot["cargo_capacity_kg"] is not None
        else None
    )
    application.service_region = snapshot["service_region"]
    application.service_zone = snapshot["service_zone"]
    application.service_wereda = snapshot["service_wereda"]
    application.status = application_status
    if application_status in {
        DriverApplication.Status.SUBMITTED,
        DriverApplication.Status.UNDER_REVIEW,
        DriverApplication.Status.APPROVED,
        DriverApplication.Status.REJECTED,
    } and application.submitted_at is None:
        application.submitted_at = timezone.now()
    application.save()

    identity.revision = event_data["revision"]
    identity.account_status = snapshot["account_status"]
    identity.account_active = snapshot["account_active"]
    identity.application_status = snapshot["application_status"]
    identity.documents_verified = snapshot["documents_verified"]
    identity.driver_authorized = snapshot["driver_authorized"]
    identity.license_expiry = snapshot["license_expiry"]
    identity.last_event_id = event_data["event_id"]
    identity.payload_sha256 = payload_sha256
    identity.save()
    response = {
        "event_id": event_id,
        "status": "applied",
        "canonical_user_id": str(canonical_user_id),
        "driver_app_user_id": str(user.pk),
        "driver_app_profile_id": str(profile.pk),
        "driver_authorized": identity.driver_authorized,
        "revision": identity.revision,
    }
    MarketplaceIntegrationEvent.objects.create(
        event_id=event_id,
        event_type=event_data["event_type"],
        external_order_reference=external_reference,
        revision=event_data["revision"],
        payload_sha256=payload_sha256,
        response_status=200,
        response_payload=response,
        applied=True,
    )
    return 200, response


def _normalize_v2_authorization(event_data):
    shipment = event_data["shipment"]
    product = shipment["product"]
    fee = event_data["delivery_fee_proposal"]
    return {
        "event_id": str(event_data["event_id"]),
        "event_type": "order.authorized",
        "occurred_at": event_data["occurred_at"],
        "revision": event_data["revision"],
        "order": {
            "id": str(event_data["order_reference"]),
            "status": "authorized",
            "buyer": event_data["buyer"],
            "seller": event_data["seller"],
            "shipment": {
                "pickup_region": shipment["pickup"]["region"],
                "pickup_zone": shipment["pickup"].get("zone") or "",
                "pickup_wereda": shipment["pickup"].get("wereda") or "",
                "pickup_kebele": shipment["pickup"].get("kebele") or "",
                "pickup_address": shipment["pickup"]["address_line"],
                "destination_region": shipment["destination"]["region"],
                "destination_zone": shipment["destination"].get("zone") or "",
                "destination_wereda": shipment["destination"].get("wereda") or "",
                "destination_kebele": shipment["destination"].get("kebele") or "",
                "destination_address": shipment["destination"]["address_line"],
                "product_summary": (
                    f'{product["description"]} '
                    f'({product["quantity"]} {product["unit"]})'
                ),
                "external_product_reference": str(product["id"]),
                "cargo_quantity": product["quantity"],
                "cargo_quantity_unit": product["unit"],
                "cargo_weight_kg": shipment["cargo_weight_kg"],
                "packaging_details": shipment["packaging_details"],
                "handling_requirements": "",
            },
            "delivery_fee": {
                "amount": fee["amount"],
                "currency": fee["currency"],
            },
        },
    }


def _normalize_v2_cancellation(event_data):
    return {
        "event_id": str(event_data["event_id"]),
        "event_type": "order.cancelled",
        "occurred_at": event_data["occurred_at"],
        "revision": event_data["revision"],
        "order": {
            "id": str(event_data["order_reference"]),
            "status": "cancelled",
            "buyer": event_data["buyer"],
            "seller": event_data["seller"],
            "cancellation_reason": event_data["cancellation_reason"],
        },
    }


@transaction.atomic
def _apply_marketplace_v2_payment_snapshot(event_data, payload_sha256):
    event_id = str(event_data["event_id"])
    order_reference = str(event_data["order_reference"])
    existing = MarketplaceIntegrationEvent.objects.filter(event_id=event_id).first()
    if existing:
        if existing.payload_sha256 == payload_sha256:
            return existing.response_status, existing.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    normalized = {
        "event_id": event_id,
        "event_type": event_data["event_type"],
        "revision": event_data["revision"],
        "order": {"id": order_reference},
    }
    event = _create_inbox_event(normalized, order_reference, payload_sha256)
    if event is None:
        existing = MarketplaceIntegrationEvent.objects.get(event_id=event_id)
        if existing.payload_sha256 == payload_sha256:
            return existing.response_status, existing.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    authorization = (
        MarketplaceOrderAuthorization.objects.select_for_update()
        .filter(
            external_order_reference=order_reference,
        )
        .first()
    )
    if authorization is None:
        result = _rejected(
            404,
            "No eligible marketplace order was found.",
            "order_not_found",
        )
    elif event_data["revision"] <= authorization.source_revision:
        result = _rejected(
            409,
            "This marketplace order event is stale or out of order.",
            "stale_revision",
        )
    else:
        shipment = (
            Shipment.objects.select_for_update()
            .filter(external_order_reference=order_reference)
            .first()
        )
        if shipment is None:
            result = _rejected(
                404,
                "No active marketplace shipment was found.",
                "shipment_not_found",
            )
        else:
            MarketplacePaymentSnapshot.objects.create(
                source_system=event_data["source_system"],
                event=event,
                shipment=shipment,
                status=event_data["payment"]["status"],
                revision=event_data["revision"],
                occurred_at=event_data["occurred_at"],
            )
            authorization.source_revision = event_data["revision"]
            authorization.source_event_id = event_id
            authorization.source_updated_at = event_data["occurred_at"]
            authorization.save(
                update_fields=[
                    "source_revision",
                    "source_event_id",
                    "source_updated_at",
                    "verified_at",
                ]
            )
            result = (
                200,
                {
                    "event_id": event_id,
                    "status": "payment_snapshot_stored",
                    "order_reference": order_reference,
                    "revision": event_data["revision"],
                },
            )

    status_code, response = result
    event.response_status = status_code
    event.response_payload = response
    event.applied = 200 <= status_code < 300
    event.save(update_fields=["response_status", "response_payload", "applied"])
    record_audit(
        None,
        "marketplace.v2_payment_snapshot_stored"
        if event.applied
        else "marketplace.v2_payment_snapshot_rejected",
        "marketplace_integration_event",
        event_id,
        {
            "external_order_reference": order_reference,
            "revision": event_data["revision"],
            "status_code": status_code,
            "reason": response.get("code", "accepted"),
        },
    )
    return status_code, response


@transaction.atomic
def _apply_marketplace_v2_delivery_fee_review(event_data, payload_sha256):
    event_id = str(event_data["event_id"])
    order_reference = str(event_data["order_reference"])
    existing = MarketplaceIntegrationEvent.objects.filter(event_id=event_id).first()
    if existing:
        if existing.payload_sha256 == payload_sha256:
            return existing.response_status, existing.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    normalized = {
        "event_id": event_id,
        "event_type": event_data["event_type"],
        "revision": event_data["revision"],
        "order": {"id": order_reference},
    }
    event = _create_inbox_event(normalized, order_reference, payload_sha256)
    if event is None:
        existing = MarketplaceIntegrationEvent.objects.get(event_id=event_id)
        if existing.payload_sha256 == payload_sha256:
            return existing.response_status, existing.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    review_data = event_data["delivery_fee_review"]
    authorization = (
        MarketplaceOrderAuthorization.objects.select_for_update()
        .filter(external_order_reference=order_reference)
        .first()
    )
    shipment = None
    agreement = None
    if authorization is None or authorization.status != MarketplaceOrderAuthorization.Status.ELIGIBLE:
        result = _rejected(
            404,
            "No eligible marketplace shipment was found.",
            "order_not_found",
        )
    elif event_data["revision"] <= authorization.source_revision:
        result = _rejected(
            409,
            "This marketplace order event is stale or out of order.",
            "stale_revision",
        )
    else:
        shipment = (
            Shipment.objects.select_for_update()
            .filter(external_order_reference=order_reference)
            .first()
        )
        if shipment is None or shipment.pk != review_data["shipment_id"]:
            result = _rejected(
                409,
                "The delivery-fee review references a different shipment.",
                "shipment_mismatch",
            )
        else:
            agreement = (
                shipment.fee_agreement
                if hasattr(shipment, "fee_agreement")
                else None
            )
            source_agreement_event = MarketplaceShipmentEvent.objects.filter(
                event_id=review_data["agreement_event_id"],
                shipment=shipment,
                event_type="delivery_fee.agreed",
            ).first()
            if (
                agreement is None
                or source_agreement_event is None
                or agreement.proposal.version != review_data["proposal_version"]
                or agreement.amount != review_data["amount"]
                or agreement.currency != review_data["currency"]
                or source_agreement_event.details.get("proposal_version")
                != review_data["proposal_version"]
                or source_agreement_event.details.get("amount")
                != str(review_data["amount"])
                or source_agreement_event.details.get("currency")
                != review_data["currency"]
            ):
                result = _rejected(
                    409,
                    "The delivery-fee review does not match the accepted agreement.",
                    "agreement_mismatch",
                )
                agreement = None

        if agreement is not None and MarketplaceDeliveryFeeReview.objects.filter(
            agreement_event_id=review_data["agreement_event_id"]
        ).exists():
            result = _rejected(
                409,
                "A delivery-fee review was already recorded for this agreement.",
                "agreement_review_already_recorded",
            )
            agreement = None

        if agreement is not None:
            MarketplaceDeliveryFeeReview.objects.create(
                event=event,
                shipment=shipment,
                agreement_event_id=review_data["agreement_event_id"],
                proposal_version=review_data["proposal_version"],
                amount=review_data["amount"],
                currency=review_data["currency"],
                decision=review_data["decision"],
                rejection_reason=review_data.get("rejection_reason", ""),
                message=review_data["message"],
                revision=event_data["revision"],
                occurred_at=event_data["occurred_at"],
            )
            authorization.source_revision = event_data["revision"]
            authorization.source_event_id = event_id
            authorization.source_updated_at = event_data["occurred_at"]
            authorization.save(
                update_fields=[
                    "source_revision",
                    "source_event_id",
                    "source_updated_at",
                    "verified_at",
                ]
            )
            result = (
                200,
                {
                    "event_id": event_id,
                    "status": "delivery_fee_review_recorded",
                    "order_reference": order_reference,
                    "revision": event_data["revision"],
                },
            )

    status_code, response = result
    event.response_status = status_code
    event.response_payload = response
    event.applied = 200 <= status_code < 300
    event.save(update_fields=["response_status", "response_payload", "applied"])
    record_audit(
        None,
        "marketplace.delivery_fee_review_received"
        if event.applied
        else "marketplace.delivery_fee_review_rejected",
        "marketplace_integration_event",
        event_id,
        {
            "external_order_reference": order_reference,
            "revision": event_data["revision"],
            "decision": review_data["decision"],
            "status_code": status_code,
            "reason": response.get("code", "accepted"),
        },
    )
    return status_code, response


def apply_marketplace_order_event(event_data, payload_sha256):
    try:
        return _apply_marketplace_order_event_transactionally(
            event_data, payload_sha256
        )
    except EventConflict as error:
        record_audit(
            None,
            "marketplace.integration_event_id_conflict",
            "marketplace_integration",
            event_data["event_id"],
            {"event_type": event_data["event_type"]},
        )
        raise


@transaction.atomic
def _apply_marketplace_order_event_transactionally(event_data, payload_sha256):
    event_id = event_data["event_id"]
    order = event_data["order"]
    external_reference = order["id"]

    previous_event = MarketplaceIntegrationEvent.objects.filter(
        event_id=event_id
    ).first()
    if previous_event:
        if previous_event.payload_sha256 == payload_sha256:
            return previous_event.response_status, previous_event.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    event = _create_inbox_event(event_data, external_reference, payload_sha256)
    if event is None:
        previous_event = MarketplaceIntegrationEvent.objects.get(event_id=event_id)
        if previous_event.payload_sha256 == payload_sha256:
            return previous_event.response_status, previous_event.response_payload
        raise EventConflict("The event ID was already used with a different payload.")

    status_code, response = _apply_new_event(event, event_data)
    event.response_status = status_code
    event.response_payload = response
    event.applied = 200 <= status_code < 300
    event.save(update_fields=["response_status", "response_payload", "applied"])
    record_audit(
        None,
        "marketplace.integration_event_processed"
        if event.applied
        else "marketplace.integration_event_rejected",
        "marketplace_integration_event",
        event.event_id,
        {
            "event_type": event.event_type,
            "external_order_reference": event.external_order_reference,
            "revision": event.revision,
            "status_code": status_code,
            "reason": response.get("code", "accepted"),
        },
    )
    return status_code, response


def _create_inbox_event(event_data, external_reference, payload_sha256):
    try:
        with transaction.atomic():
            return MarketplaceIntegrationEvent.objects.create(
                event_id=event_data["event_id"],
                event_type=event_data["event_type"],
                external_order_reference=external_reference,
                revision=event_data["revision"],
                payload_sha256=payload_sha256,
            )
    except IntegrityError:
        return None


@transaction.atomic
def _apply_new_event(event_record, event_data):
    order = event_data["order"]
    participants = list(
        LogisticsUser.objects.select_for_update()
        .filter(
            external_user_id__in=[
                order["buyer"]["external_user_id"],
                order["seller"]["external_user_id"],
            ],
            is_active=True,
        )
        .order_by("pk")
    )
    participants_by_external_id = {
        participant.external_user_id: participant for participant in participants
    }
    buyer = participants_by_external_id.get(order["buyer"]["external_user_id"])
    seller = participants_by_external_id.get(order["seller"]["external_user_id"])
    if (
        buyer is None
        or seller is None
        or buyer.pk == seller.pk
        or buyer.role != order["buyer"]["role"]
        or seller.role != order["seller"]["role"]
        or buyer.role not in {LogisticsUser.Role.WHOLESALER, LogisticsUser.Role.RETAILER}
        or seller.role
        not in {
            LogisticsUser.Role.FARMER,
            LogisticsUser.Role.WHOLESALER,
            LogisticsUser.Role.RETAILER,
        }
    ):
        return _rejected(
            403,
            "Buyer and seller must map to distinct active marketplace participants.",
            "participant_mismatch",
        )

    authorization = (
        MarketplaceOrderAuthorization.objects.select_for_update()
        .filter(external_order_reference=order["id"])
        .first()
    )
    if authorization and (
        authorization.buyer_id != buyer.pk
        or authorization.seller_id != seller.pk
    ):
        return _rejected(
            409,
            "The marketplace order is already linked to different participants.",
            "order_participant_conflict",
        )
    if authorization and event_data["revision"] <= authorization.source_revision:
        return _rejected(
            409,
            "This marketplace order event is stale or out of order.",
            "stale_revision",
        )

    event_type = event_data["event_type"]
    if event_type == "order.authorized":
        result = _authorize_order(event_record, event_data, authorization, buyer, seller)
    elif event_type == "order.cancelled":
        result = _cancel_marketplace_order(
            event_record, event_data, authorization, buyer, seller
        )
    else:
        result = _update_marketplace_payment(
            event_record, event_data, authorization, buyer, seller
        )
    return result


def _authorize_order(event_record, event_data, authorization, buyer, seller):
    order = event_data["order"]
    shipment_values = dict(order["shipment"])
    fee = order["delivery_fee"]
    if fee["currency"] not in ("ETB",):
        return _rejected(400, "The delivery-fee currency is not supported.", "invalid_currency")
    if authorization and authorization.status == MarketplaceOrderAuthorization.Status.INELIGIBLE:
        return _rejected(
            409,
            "A previously cancelled or ineligible marketplace order cannot be reauthorized.",
            "order_not_reauthorizable",
        )

    shipment = (
        Shipment.objects.select_for_update()
        .filter(external_order_reference=order["id"], buyer=buyer)
        .exclude(status=Shipment.Status.CANCELLED)
        .first()
    )
    if shipment and shipment.assigned_driver_id:
        return _rejected(
            409,
            "Order details cannot be changed after a driver is assigned.",
            "shipment_already_assigned",
        )
    if shipment and shipment.status != Shipment.Status.REQUESTED:
        if not _shipment_matches(shipment, shipment_values, fee, seller):
            return _rejected(
                409,
                "Order details cannot be changed after shipment negotiation has started.",
                "shipment_update_conflict",
            )
    elif shipment:
        if shipment.seller_id not in (None, seller.pk):
            return _rejected(
                409,
                "The shipment is already linked to a different seller.",
                "shipment_seller_conflict",
            )
        _update_requested_shipment(shipment, shipment_values, fee, seller)
    else:
        shipment = Shipment.objects.create(
            external_order_reference=order["id"],
            buyer=buyer,
            seller=seller,
            order_verified=True,
            status=Shipment.Status.REQUESTED,
            currency=fee["currency"],
            **shipment_values,
        )
        ShipmentFeeProposal.objects.create(
            shipment=shipment,
            proposed_by=buyer,
            amount=fee["amount"],
            currency=fee["currency"],
            version=1,
        )
        shipment.current_fee_proposal_version = 1
        shipment.save(update_fields=["current_fee_proposal_version", "updated_at"])

    if authorization is None:
        authorization = MarketplaceOrderAuthorization.objects.create(
            external_order_reference=order["id"],
            buyer=buyer,
            seller=seller,
            status=MarketplaceOrderAuthorization.Status.ELIGIBLE,
        )
    _update_authorization_source(authorization, event_record, event_data)
    authorization.status = MarketplaceOrderAuthorization.Status.ELIGIBLE
    authorization.save(update_fields=["status", "verified_at", "source_revision", "source_event_id", "source_updated_at"])

    shipment.order_verified = True
    shipment.seller = seller
    shipment.save(update_fields=["order_verified", "seller", "updated_at"])
    if shipment.status == Shipment.Status.REQUESTED:
        _transition(shipment, None, Shipment.Status.FEE_PROPOSED)
    _apply_payment_snapshot(shipment, order.get("payment"), event_data["occurred_at"])
    created_offers = create_shipment_offers(shipment)
    record_audit(
        None,
        "marketplace.order_authorized",
        "marketplace_order",
        order["id"],
        {
            "event_id": event_record.event_id,
            "revision": event_data["revision"],
            "buyer_id": buyer.pk,
            "seller_id": seller.pk,
            "shipment_id": shipment.pk,
        },
    )
    return 200, {
        "event_id": event_record.event_id,
        "status": "authorized",
        "order_reference": order["id"],
        "shipment_id": shipment.pk,
        "shipment_status": shipment.status,
        "order_verified": True,
        "fee_agreement_status": shipment.fee_agreement_status,
        "payment_status": shipment.payment_status,
        "offers_created": created_offers,
    }


def _update_requested_shipment(shipment, shipment_values, fee, seller):
    for field, value in shipment_values.items():
        setattr(shipment, field, value)
    shipment.seller = seller
    shipment.order_verified = True
    shipment.currency = fee["currency"]
    shipment.save()

    current = shipment.fee_proposals.filter(
        status=ShipmentFeeProposal.Status.PROPOSED
    )
    if not current.exists() or any(
        proposal.amount != fee["amount"] or proposal.currency != fee["currency"]
        for proposal in current
    ):
        current.update(
            status=ShipmentFeeProposal.Status.SUPERSEDED,
            responded_at=timezone.now(),
        )
        version = shipment.current_fee_proposal_version + 1
        ShipmentFeeProposal.objects.create(
            shipment=shipment,
            proposed_by=shipment.buyer,
            amount=fee["amount"],
            currency=fee["currency"],
            version=version,
        )
        shipment.current_fee_proposal_version = version
        shipment.save(update_fields=["current_fee_proposal_version", "updated_at"])


def _shipment_matches(shipment, values, fee, seller):
    return (
        shipment.seller_id == seller.pk
        and shipment.currency == fee["currency"]
        and all(getattr(shipment, field) == value for field, value in values.items())
        and shipment.fee_proposals.filter(
            version=shipment.current_fee_proposal_version,
            amount=fee["amount"],
            currency=fee["currency"],
            status=ShipmentFeeProposal.Status.PROPOSED,
        ).exists()
    )


def _cancel_marketplace_order(event_record, event_data, authorization, buyer, seller):
    order = event_data["order"]
    if authorization is None or authorization.status != MarketplaceOrderAuthorization.Status.ELIGIBLE:
        return _rejected(404, "No eligible marketplace order was found.", "order_not_found")
    shipment = (
        Shipment.objects.select_for_update()
        .filter(external_order_reference=order["id"], buyer=buyer)
        .exclude(status=Shipment.Status.CANCELLED)
        .first()
    )
    if shipment is None:
        return _rejected(404, "No active shipment was found for this order.", "shipment_not_found")
    if shipment.assigned_driver_id or Shipment.Status.CANCELLED not in SHIPMENT_TRANSITIONS.get(
        shipment.status, set()
    ):
        return _rejected(
            409,
            "This shipment must be cancelled through the participant workflow.",
            "shipment_cannot_be_cancelled_by_integration",
        )

    reason = order["cancellation_reason"].strip()
    shipment.cancellation_reason = reason
    shipment.cancelled_by = None
    shipment.save(update_fields=["cancellation_reason", "cancelled_by", "updated_at"])
    pending_driver_ids = list(
        shipment.offers.filter(status=ShipmentOffer.Status.PENDING).values_list(
            "driver_id", flat=True
        )
    )
    shipment.offers.filter(status=ShipmentOffer.Status.PENDING).update(
        status=ShipmentOffer.Status.WITHDRAWN,
        responded_at=timezone.now(),
        response_reason="Marketplace order cancelled.",
    )
    shipment.fee_proposals.filter(status=ShipmentFeeProposal.Status.PROPOSED).update(
        status=ShipmentFeeProposal.Status.WITHDRAWN,
        responded_at=timezone.now(),
    )
    _transition(shipment, None, Shipment.Status.CANCELLED, reason)
    authorization.status = MarketplaceOrderAuthorization.Status.INELIGIBLE
    _update_authorization_source(authorization, event_record, event_data)
    authorization.save(update_fields=["status", "verified_at", "source_revision", "source_event_id", "source_updated_at"])
    record_audit(
        None,
        "marketplace.order_cancelled",
        "marketplace_order",
        order["id"],
        {
            "event_id": event_record.event_id,
            "revision": event_data["revision"],
            "shipment_id": shipment.pk,
            "withdrawn_offer_count": len(pending_driver_ids),
        },
    )
    return 200, {
        "event_id": event_record.event_id,
        "status": "cancelled",
        "order_reference": order["id"],
        "shipment_id": shipment.pk,
        "shipment_status": shipment.status,
    }


def _update_marketplace_payment(event_record, event_data, authorization, buyer, seller):
    order = event_data["order"]
    if authorization is None or authorization.status != MarketplaceOrderAuthorization.Status.ELIGIBLE:
        return _rejected(404, "No eligible marketplace order was found.", "order_not_found")
    shipment = Shipment.objects.select_for_update().filter(
        external_order_reference=order["id"], buyer=buyer, seller=seller
    ).first()
    if shipment is None:
        return _rejected(404, "No marketplace shipment was found.", "shipment_not_found")
    _apply_payment_snapshot(shipment, order["payment"], event_data["occurred_at"])
    _update_authorization_source(authorization, event_record, event_data)
    authorization.save(
        update_fields=["verified_at", "source_revision", "source_event_id", "source_updated_at"]
    )
    record_audit(
        None,
        "marketplace.payment_status_synchronized",
        "shipment",
        shipment.pk,
        {
            "event_id": event_record.event_id,
            "revision": event_data["revision"],
            "payment_status": shipment.payment_status,
        },
    )
    return 200, {
        "event_id": event_record.event_id,
        "status": "payment_status_updated",
        "order_reference": order["id"],
        "shipment_id": shipment.pk,
        "payment_status": shipment.payment_status,
    }


def _apply_payment_snapshot(shipment, payment, occurred_at):
    if payment is None:
        return
    shipment.payment_status = payment["status"]
    shipment.payment_status_updated_at = occurred_at
    if "reference" in payment:
        shipment.marketplace_payment_reference = payment["reference"]
    shipment.save(
        update_fields=[
            "payment_status",
            "payment_status_updated_at",
            "marketplace_payment_reference",
            "updated_at",
        ]
    )


def _update_authorization_source(authorization, event_record, event_data):
    authorization.source_revision = event_data["revision"]
    authorization.source_event_id = event_record.event_id
    authorization.source_updated_at = event_data["occurred_at"]


def _rejected(status_code, detail, reason):
    return status_code, {"detail": detail, "code": reason}


def record_invalid_integration_payload(event_id, reason):
    record_audit(
        None,
        "marketplace.integration_payload_rejected",
        "marketplace_integration",
        event_id[:128] if event_id else "",
        {"reason": reason},
    )


def integration_event_page(after_id, limit):
    events = list(
        MarketplaceShipmentEvent.objects.filter(pk__gt=after_id)
        .select_related("shipment")
        .order_by("pk")[: limit + 1]
    )
    has_more = len(events) > limit
    page = events[:limit]
    results = [
        {
            "event_id": str(event.event_id),
            "cursor": event.pk,
            "event_type": event.event_type,
            "occurred_at": event.created_at,
            "order_reference": event.shipment.external_order_reference,
            "shipment_id": event.shipment_id,
            "details": event.details,
        }
        for event in page
    ]
    next_cursor = page[-1].pk if page else after_id
    return {
        "results": results,
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


def integration_payload_sha256(payload):
    import json

    canonical_payload = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical_payload).hexdigest()
