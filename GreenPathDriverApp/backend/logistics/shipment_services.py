from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, ValidationError

from .configuration import required_driver_document_types
from .models import (
    AuditEvent,
    DriverApplication,
    DriverDocument,
    DriverShipmentLocation,
    LogisticsUser,
    MarketplaceOrderAuthorization,
    MarketplaceDriverIdentity,
    MarketplaceShipmentEvent,
    Shipment,
    ShipmentException,
    ShipmentFeeAgreement,
    ShipmentFeeProposal,
    ShipmentEvidence,
    ShipmentOffer,
    ShipmentMessage,
    ShipmentNotification,
    ShipmentTransition,
    SUPPORTED_SHIPMENT_CURRENCIES,
)
from .services import record_audit


DRIVER_TRANSITIONS = {
    Shipment.Status.ASSIGNED: {Shipment.Status.PICKUP_PENDING},
    Shipment.Status.PICKUP_PENDING: {Shipment.Status.PICKUP_ARRIVED},
    Shipment.Status.PICKUP_ARRIVED: {Shipment.Status.PICKED_UP},
    Shipment.Status.PICKED_UP: {Shipment.Status.IN_TRANSIT},
    Shipment.Status.IN_TRANSIT: {
        Shipment.Status.DELIVERY_ATTEMPTED,
        Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
    },
}
SHIPMENT_TRANSITIONS = {
    Shipment.Status.REQUESTED: {Shipment.Status.FEE_PROPOSED, Shipment.Status.CANCELLED},
    Shipment.Status.FEE_PROPOSED: {
        Shipment.Status.NEGOTIATING,
        Shipment.Status.FEE_AGREED,
        Shipment.Status.CANCELLED,
    },
    Shipment.Status.NEGOTIATING: {
        Shipment.Status.FEE_AGREED,
        Shipment.Status.CANCELLED,
    },
    Shipment.Status.FEE_AGREED: {Shipment.Status.OFFERED},
    Shipment.Status.OFFERED: {Shipment.Status.ASSIGNED},
    Shipment.Status.ASSIGNED: {
        Shipment.Status.PICKUP_PENDING,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.PICKUP_PENDING: {
        Shipment.Status.PICKUP_ARRIVED,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.PICKUP_ARRIVED: {
        Shipment.Status.PICKED_UP,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.PICKED_UP: {
        Shipment.Status.IN_TRANSIT,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.IN_TRANSIT: {
        Shipment.Status.DELIVERY_ATTEMPTED,
        Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.DELIVERY_ATTEMPTED: {
        Shipment.Status.IN_TRANSIT,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED: {
        Shipment.Status.DELIVERED,
        Shipment.Status.DISPUTED,
    },
    Shipment.Status.DELIVERED: {
        Shipment.Status.COMPLETED,
        Shipment.Status.DISPUTED,
    },
}
DISPUTABLE_STATUSES = {
    Shipment.Status.ASSIGNED,
    Shipment.Status.PICKUP_PENDING,
    Shipment.Status.PICKUP_ARRIVED,
    Shipment.Status.PICKED_UP,
    Shipment.Status.IN_TRANSIT,
    Shipment.Status.DELIVERY_ATTEMPTED,
    Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
    Shipment.Status.DELIVERED,
}
NOTIFICATION_STATUSES = {
    Shipment.Status.ASSIGNED,
    Shipment.Status.PICKUP_PENDING,
    Shipment.Status.PICKUP_ARRIVED,
    Shipment.Status.PICKED_UP,
    Shipment.Status.IN_TRANSIT,
    Shipment.Status.DELIVERY_ATTEMPTED,
    Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
    Shipment.Status.DELIVERED,
    Shipment.Status.COMPLETED,
    Shipment.Status.CANCELLED,
    Shipment.Status.DISPUTED,
}


class ShipmentConflict(APIException):
    status_code = 409
    default_detail = "The shipment changed before this action could be applied."
    default_code = "shipment_conflict"


def is_active_shipment_buyer(shipment, user):
    return (
        user.is_active
        and user.role
        in {LogisticsUser.Role.WHOLESALER, LogisticsUser.Role.RETAILER}
        and user.pk == shipment.buyer_id
    )


def is_active_assigned_driver(shipment, user):
    return (
        user.is_active
        and user.role == LogisticsUser.Role.DRIVER
        and user.pk == shipment.assigned_driver_id
        and canonical_driver_is_authorized(user)
    )


def canonical_driver_is_authorized(user):
    """Fail closed for Marketplace-linked driver work when integration is enabled."""
    if not settings.MARKETPLACE_INTEGRATION_ENABLED:
        return True
    today = timezone.localdate()
    return MarketplaceDriverIdentity.objects.filter(
        user=user,
        driver_authorized=True,
        account_active=True,
        account_status="APPROVED",
        application_status="approved",
        documents_verified=True,
        license_expiry__gt=today,
    ).exists()


def is_active_shipment_participant(shipment, user):
    return is_active_shipment_buyer(shipment, user) or is_active_assigned_driver(
        shipment, user
    )


def eligible_driver_applications(region, weight_kg=None):
    today = timezone.localdate()
    applications = (
        DriverApplication.objects.filter(
            status=DriverApplication.Status.APPROVED,
            service_region=region,
            license_expiry__gt=today,
            profile__user__role=LogisticsUser.Role.DRIVER,
            profile__user__is_active=True,
            profile__is_available=True,
        )
        .select_related("profile__user")
        .prefetch_related("documents")
    )
    if weight_kg is not None:
        applications = applications.filter(cargo_capacity_kg__gte=weight_kg)

    required_types = set(required_driver_document_types())
    for application in applications:
        if settings.MARKETPLACE_INTEGRATION_ENABLED:
            if not canonical_driver_is_authorized(application.profile.user):
                continue
            # Marketplace is the canonical reviewer for linked drivers; its signed
            # authorization snapshot attests the complete verified document set.
            yield application
            continue
        valid_documents = {
            document.document_type
            for document in application.documents.all()
            if document.is_current
            and document.verification_status == DriverDocument.VerificationStatus.VERIFIED
            and (document.expires_at is None or document.expires_at > today)
        }
        if required_types.issubset(valid_documents):
            yield application


def marketplace_order_is_authorized(shipment):
    if not shipment.order_verified or shipment.seller_id is None:
        return False
    return MarketplaceOrderAuthorization.objects.filter(
        external_order_reference=shipment.external_order_reference,
        buyer_id=shipment.buyer_id,
        buyer__is_active=True,
        buyer__role__in=[
            LogisticsUser.Role.WHOLESALER,
            LogisticsUser.Role.RETAILER,
        ],
        seller_id=shipment.seller_id,
        seller__is_active=True,
        seller__role__in=[
            LogisticsUser.Role.FARMER,
            LogisticsUser.Role.WHOLESALER,
            LogisticsUser.Role.RETAILER,
        ],
        status=MarketplaceOrderAuthorization.Status.ELIGIBLE,
    ).exists()


def create_shipment_offers(shipment):
    if (
        not marketplace_order_is_authorized(shipment)
        or shipment.assigned_driver_id
    ):
        return 0
    expiry = timezone.now() + timedelta(hours=24)
    created = 0
    for application in eligible_driver_applications(
        shipment.pickup_region, shipment.cargo_weight_kg
    ):
        offer, was_created = ShipmentOffer.objects.get_or_create(
            shipment=shipment,
            driver=application.profile.user,
            defaults={"expires_at": expiry},
        )
        if was_created:
            buyer_proposal = shipment.fee_proposals.filter(
                proposed_by=shipment.buyer,
                target_driver__isnull=True,
                status=ShipmentFeeProposal.Status.PROPOSED,
            ).order_by("-created_at").first()
            if buyer_proposal:
                ShipmentMessage.objects.create(
                    shipment=shipment,
                    offer=offer,
                    sender=shipment.buyer,
                    body=(
                        f"Buyer proposed a delivery fee of "
                        f"{buyer_proposal.amount} {buyer_proposal.currency}."
                    ),
                )
                created += 1
    return created


def _transition(shipment, actor, target_status, reason=""):
    previous = shipment.status
    if target_status not in SHIPMENT_TRANSITIONS.get(previous, set()):
        raise ValidationError(
            {"status": f"Cannot change shipment from {previous} to {target_status}."}
        )
    shipment.status = target_status
    shipment.save(update_fields=["status", "updated_at"])
    ShipmentTransition.objects.create(
        shipment=shipment,
        actor=actor,
        from_status=previous,
        to_status=target_status,
        reason=reason,
    )
    if shipment.order_verified:
        event_types = {
            (Shipment.Status.REQUESTED, Shipment.Status.FEE_PROPOSED): "order.authorized",
            (Shipment.Status.OFFERED, Shipment.Status.ASSIGNED): "driver.assigned",
            (Shipment.Status.ASSIGNED, Shipment.Status.PICKUP_PENDING): "driver.preparing_for_pickup",
            (Shipment.Status.PICKUP_PENDING, Shipment.Status.PICKUP_ARRIVED): "driver.arrived_at_pickup",
            (Shipment.Status.PICKUP_ARRIVED, Shipment.Status.PICKED_UP): "shipment.picked_up",
            (Shipment.Status.PICKED_UP, Shipment.Status.IN_TRANSIT): "shipment.in_transit",
            (Shipment.Status.IN_TRANSIT, Shipment.Status.DELIVERY_ATTEMPTED): "delivery.attempt_failed",
            (
                Shipment.Status.IN_TRANSIT,
                Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
            ): "driver.delivery_reported",
            (
                Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
                Shipment.Status.DELIVERED,
            ): "buyer.receipt_confirmed",
            (Shipment.Status.DELIVERED, Shipment.Status.COMPLETED): "shipment.completed",
            (previous, Shipment.Status.CANCELLED): "shipment.cancelled",
            (previous, Shipment.Status.DISPUTED): "shipment.disputed",
        }
        MarketplaceShipmentEvent.objects.create(
            shipment=shipment,
            event_type=event_types.get(
                (previous, target_status), "shipment.status_changed"
            ),
            details={
                "from_status": previous,
                "to_status": target_status,
            },
        )
    record_audit(
        actor,
        "shipment.status_changed",
        "shipment",
        shipment.pk,
        {"from_status": previous, "to_status": target_status, "reason": reason},
    )
    if target_status in {
        Shipment.Status.DELIVERED,
        Shipment.Status.COMPLETED,
        Shipment.Status.CANCELLED,
        Shipment.Status.DISPUTED,
    }:
        stopped_at = timezone.now()
        DriverShipmentLocation.objects.filter(shipment=shipment).update(
            sharing_stopped_at=stopped_at,
            sharing_expires_at=stopped_at,
            latitude=None,
            longitude=None,
            accuracy_meters=None,
            observed_at=None,
            received_at=None,
        )
    if target_status in NOTIFICATION_STATUSES:
        notify_shipment_participants(shipment, target_status, exclude=actor)


def notify_shipment_participants(shipment, event_type, exclude=None):
    recipients = {shipment.buyer_id, shipment.assigned_driver_id}
    notify_shipment_users(shipment, recipients, event_type, exclude=exclude)


def notify_shipment_users(shipment, user_ids, event_type, exclude=None):
    recipients = set(user_ids)
    recipients.discard(None)
    if exclude is not None:
        recipients.discard(exclude.pk)
    if recipients:
        ShipmentNotification.objects.bulk_create(
            [
                ShipmentNotification(
                    shipment=shipment,
                    recipient_id=recipient_id,
                    event_type=event_type,
                )
                for recipient_id in recipients
            ]
        )


@transaction.atomic
def authorize_marketplace_order(
    external_order_reference,
    buyer_external_user_id,
    eligible,
    seller_external_user_id=None,
):
    """Record marketplace ownership after the trusted adapter validates both parties."""
    buyer = LogisticsUser.objects.filter(
        external_user_id=buyer_external_user_id,
        role__in=[LogisticsUser.Role.WHOLESALER, LogisticsUser.Role.RETAILER],
        is_active=True,
    ).first()
    if buyer is None:
        raise NotFound("The marketplace buyer is not mapped to an active buyer account.")

    seller = None
    if seller_external_user_id:
        seller = LogisticsUser.objects.filter(
            external_user_id=seller_external_user_id,
            role__in=[
                LogisticsUser.Role.FARMER,
                LogisticsUser.Role.WHOLESALER,
                LogisticsUser.Role.RETAILER,
            ],
            is_active=True,
        ).first()
        if seller is None:
            raise NotFound("The marketplace seller is not mapped to an active seller account.")
        if seller.pk == buyer.pk:
            raise ValidationError("The marketplace buyer and seller must be different accounts.")
    if eligible and seller is None:
        raise ValidationError(
            "An eligible marketplace order must identify an active seller account."
        )

    authorization, created = MarketplaceOrderAuthorization.objects.get_or_create(
        external_order_reference=external_order_reference,
        defaults={
            "buyer": buyer,
            "seller": seller,
            "status": (
                MarketplaceOrderAuthorization.Status.ELIGIBLE
                if eligible
                else MarketplaceOrderAuthorization.Status.INELIGIBLE
            ),
        },
    )
    if not created and authorization.buyer_id != buyer.pk:
        raise ValidationError(
            "This marketplace order reference is already linked to another buyer."
        )
    if not created and seller and authorization.seller_id not in (None, seller.pk):
        raise ValidationError(
            "This marketplace order reference is already linked to another seller."
        )
    changed_fields = []
    if not created and seller and authorization.seller_id is None:
        authorization.seller = seller
        changed_fields.append("seller")
    target_status = (
        MarketplaceOrderAuthorization.Status.ELIGIBLE
        if eligible
        else MarketplaceOrderAuthorization.Status.INELIGIBLE
    )
    if not created and authorization.status != target_status:
        authorization.status = target_status
        changed_fields.extend(["status", "verified_at"])
    if changed_fields:
        authorization.save(update_fields=changed_fields)

    requests = Shipment.objects.select_for_update().filter(
        external_order_reference=external_order_reference,
        buyer=buyer,
        assigned_driver__isnull=True,
    )
    for shipment in requests:
        shipment.order_verified = eligible
        update_fields = ["order_verified", "updated_at"]
        if eligible and seller:
            shipment.seller = seller
            update_fields.append("seller")
        shipment.save(update_fields=update_fields)
        if eligible:
            if shipment.status == Shipment.Status.REQUESTED:
                _transition(shipment, None, Shipment.Status.FEE_PROPOSED)
            create_shipment_offers(shipment)
        else:
            shipment.offers.filter(status=ShipmentOffer.Status.PENDING).update(
                status=ShipmentOffer.Status.WITHDRAWN,
                responded_at=timezone.now(),
                response_reason="The marketplace order is not eligible for delivery.",
            )

    record_audit(
        None,
        "marketplace_order.authorization_updated",
        "marketplace_order",
        external_order_reference,
        {
            "eligible": eligible,
            "buyer_id": buyer.pk,
            "seller_id": authorization.seller_id,
        },
    )
    return authorization


@transaction.atomic
def refresh_shipment_offers(shipment_id, buyer):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id).first()
    if shipment is None or shipment.buyer_id != buyer.pk:
        raise NotFound("Shipment was not found.")
    if not shipment.order_verified:
        raise ValidationError(
            {"order": "Driver offers are unavailable until the marketplace verifies this order."}
        )
    if shipment.status not in {
        Shipment.Status.FEE_PROPOSED,
        Shipment.Status.NEGOTIATING,
    }:
        raise ValidationError({"status": "Offers cannot be refreshed in this state."})
    created = create_shipment_offers(shipment)
    record_audit(
        buyer,
        "shipment.offers_refreshed",
        "shipment",
        shipment.pk,
        {"new_offer_count": created},
    )
    return created


def driver_meets_shipment_requirements(driver, shipment):
    if driver.role != LogisticsUser.Role.DRIVER or not driver.is_active:
        return False
    if not getattr(getattr(driver, "driver_profile", None), "is_available", False):
        return False
    if not canonical_driver_is_authorized(driver):
        return False
    application = DriverApplication.objects.filter(
        profile__user=driver,
        status=DriverApplication.Status.APPROVED,
        license_expiry__gt=timezone.localdate(),
    ).first()
    if application is None:
        return False
    if (
        application.service_region != shipment.pickup_region
        or (
            shipment.cargo_weight_kg is not None
            and (
                application.cargo_capacity_kg is None
                or application.cargo_capacity_kg < shipment.cargo_weight_kg
            )
        )
    ):
        return False
    if settings.MARKETPLACE_INTEGRATION_ENABLED:
        return True
    required = set(required_driver_document_types())
    valid = set(
        application.documents.filter(
            is_current=True,
            verification_status=DriverDocument.VerificationStatus.VERIFIED,
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.localdate()))
        .values_list("document_type", flat=True)
    )
    return required.issubset(valid)


def _check_offer(offer, driver):
    if offer.driver_id != driver.pk:
        raise NotFound("Shipment offer was not found.")
    if offer.status != ShipmentOffer.Status.PENDING:
        raise ShipmentConflict("This offer has already been consumed or withdrawn.")
    if offer.expires_at <= timezone.now():
        raise ShipmentConflict("This offer has expired.")
    if not marketplace_order_is_authorized(offer.shipment):
        raise ValidationError({"order": "The marketplace order is not verified."})
    if offer.shipment.status not in {
        Shipment.Status.FEE_PROPOSED,
        Shipment.Status.NEGOTIATING,
    }:
        raise ValidationError({"shipment": "This shipment is no longer available."})
    if not driver_meets_shipment_requirements(driver, offer.shipment):
        raise ValidationError(
            {"driver": "You no longer meet the verified shipment eligibility requirements."}
        )


@transaction.atomic
def decline_shipment_offer(offer_id, driver, reason):
    offer = (
        ShipmentOffer.objects.select_for_update()
        .select_related("shipment")
        .filter(pk=offer_id, driver=driver)
        .first()
    )
    if offer is None:
        raise NotFound("Shipment offer was not found.")
    if offer.status != ShipmentOffer.Status.PENDING:
        raise ValidationError({"offer": "This offer is no longer available."})
    offer.status = ShipmentOffer.Status.DECLINED
    offer.response_reason = reason.strip()
    offer.responded_at = timezone.now()
    offer.save(update_fields=["status", "response_reason", "responded_at"])
    record_audit(
        driver,
        "shipment.offer_declined",
        "shipment_offer",
        offer.pk,
        {"shipment_id": offer.shipment_id, "reason": reason.strip()},
    )
    return offer


@transaction.atomic
def counter_shipment_fee(shipment_id, offer_id, driver, amount, currency):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id).first()
    if shipment is None:
        raise NotFound("Shipment was not found.")
    offer = (
        ShipmentOffer.objects.select_for_update()
        .filter(pk=offer_id, shipment=shipment, driver=driver)
        .first()
    )
    if offer is None:
        raise NotFound("Shipment offer was not found.")
    _check_offer(offer, driver)
    if currency not in SUPPORTED_SHIPMENT_CURRENCIES:
        raise ValidationError({"currency": "This currency is not supported."})
    if currency != shipment.currency:
        raise ValidationError({"currency": "Counterproposals must use the shipment currency."})
    ShipmentFeeProposal.objects.filter(
        shipment=shipment,
        status=ShipmentFeeProposal.Status.PROPOSED,
    ).update(
        status=ShipmentFeeProposal.Status.SUPERSEDED,
        responded_at=timezone.now(),
    )
    version = shipment.current_fee_proposal_version + 1
    shipment.current_fee_proposal_version = version
    shipment.save(update_fields=["current_fee_proposal_version", "updated_at"])
    proposal = ShipmentFeeProposal.objects.create(
        shipment=shipment,
        proposed_by=driver,
        target_driver=driver,
        amount=amount,
        currency=currency,
        version=version,
    )
    ShipmentMessage.objects.create(
        shipment=shipment,
        offer=offer,
        sender=driver,
        body=f"Driver counterproposed a delivery fee of {amount} {currency}.",
    )
    if shipment.status != Shipment.Status.NEGOTIATING:
        _transition(shipment, driver, Shipment.Status.NEGOTIATING)
    record_audit(
        driver,
        "shipment.fee_counterproposed",
        "shipment_fee_proposal",
        proposal.pk,
        {
            "shipment_id": shipment.pk,
            "version": version,
            "amount": str(amount),
            "currency": currency,
        },
    )
    return proposal


@transaction.atomic
def create_buyer_fee_proposal(shipment_id, buyer, amount, currency):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id).first()
    if shipment is None or shipment.buyer_id != buyer.pk:
        raise NotFound("Shipment was not found.")
    if currency not in SUPPORTED_SHIPMENT_CURRENCIES:
        raise ValidationError({"currency": "This currency is not supported."})
    if currency != shipment.currency:
        raise ValidationError({"currency": "A fee amendment must use the shipment currency."})
    if not shipment.order_verified or shipment.seller_id is None:
        raise ValidationError(
            {"order": "A fee proposal requires a marketplace-verified order and seller."}
        )
    if shipment.assigned_driver_id or shipment.status not in {
        Shipment.Status.FEE_PROPOSED,
        Shipment.Status.NEGOTIATING,
    }:
        raise ShipmentConflict(
            "A fee proposal cannot be changed after assignment or outside negotiation."
        )

    now = timezone.now()
    shipment.fee_proposals.filter(status=ShipmentFeeProposal.Status.PROPOSED).update(
        status=ShipmentFeeProposal.Status.SUPERSEDED,
        responded_at=now,
    )
    version = shipment.current_fee_proposal_version + 1
    shipment.current_fee_proposal_version = version
    shipment.save(update_fields=["current_fee_proposal_version", "updated_at"])
    proposal = ShipmentFeeProposal.objects.create(
        shipment=shipment,
        proposed_by=buyer,
        amount=amount,
        currency=currency,
        version=version,
    )
    record_audit(
        buyer,
        "shipment.fee_proposed",
        "shipment_fee_proposal",
        proposal.pk,
        {
            "shipment_id": shipment.pk,
            "version": version,
            "amount": str(amount),
            "currency": currency,
        },
    )
    return proposal


@transaction.atomic
def _assign_from_agreement(
    shipment_id, proposal_id, expected_version, actor, actor_is_buyer
):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id).first()
    if shipment is None:
        raise NotFound("Shipment was not found.")
    if shipment.assigned_driver_id:
        if shipment.assigned_driver_id == actor.pk:
            raise ShipmentConflict(
                "This shipment has already been assigned; the duplicate acceptance was ignored."
            )
        raise ShipmentConflict("Another driver has already been assigned.")
    proposal = (
        ShipmentFeeProposal.objects.select_for_update()
        .filter(pk=proposal_id, shipment=shipment, status=ShipmentFeeProposal.Status.PROPOSED)
        .first()
    )
    if proposal is None:
        raise ShipmentConflict("This fee proposal is no longer available.")
    if (
        proposal.version != expected_version
        or proposal.version != shipment.current_fee_proposal_version
    ):
        raise ShipmentConflict(
            "This fee proposal is stale; refresh the shipment before responding."
        )
    if proposal.currency != shipment.currency:
        raise ShipmentConflict("The fee proposal currency does not match the shipment.")
    if not marketplace_order_is_authorized(shipment):
        raise ValidationError({"order": "The marketplace order is not verified."})
    if shipment.status not in {
        Shipment.Status.FEE_PROPOSED,
        Shipment.Status.NEGOTIATING,
    }:
        if shipment.assigned_driver_id:
            raise ShipmentConflict("Another driver has already been assigned.")
        raise ShipmentConflict("This shipment can no longer be assigned.")

    if actor_is_buyer:
        if shipment.buyer_id != actor.pk or proposal.proposed_by_id == shipment.buyer_id:
            raise NotFound("Fee proposal was not found.")
        driver = proposal.target_driver
        if (
            driver is None
            or proposal.proposed_by_id != driver.pk
            or driver.role != LogisticsUser.Role.DRIVER
            or not driver.is_active
        ):
            raise ShipmentConflict("This driver counterproposal is no longer valid.")
        buyer_accepted_at = timezone.now()
        driver_accepted_at = proposal.created_at
    else:
        if proposal.proposed_by_id != shipment.buyer_id or proposal.target_driver_id:
            raise ValidationError({"fee": "Only an original buyer proposal can be accepted here."})
        driver = actor
        buyer_accepted_at = proposal.created_at
        driver_accepted_at = timezone.now()

    offer = (
        ShipmentOffer.objects.select_for_update()
        .filter(
            shipment=shipment,
            driver=driver,
            status=ShipmentOffer.Status.PENDING,
        )
        .first()
    )
    if offer is None:
        if shipment.assigned_driver_id:
            raise ShipmentConflict("Another driver has already been assigned.")
        raise ShipmentConflict("The driver's offer is no longer available.")
    _check_offer(offer, driver)

    proposal.status = ShipmentFeeProposal.Status.ACCEPTED
    proposal.responded_at = timezone.now()
    proposal.save(update_fields=["status", "responded_at"])
    record_audit(
        actor,
        "shipment.fee_proposal_accepted",
        "shipment_fee_proposal",
        proposal.pk,
        {
            "shipment_id": shipment.pk,
            "version": proposal.version,
            "amount": str(proposal.amount),
            "currency": proposal.currency,
            "buyer_id": shipment.buyer_id,
            "driver_id": driver.pk,
        },
    )
    shipment.fee_proposals.filter(status=ShipmentFeeProposal.Status.PROPOSED).exclude(
        pk=proposal.pk
    ).update(status=ShipmentFeeProposal.Status.WITHDRAWN, responded_at=timezone.now())
    _transition(shipment, actor, Shipment.Status.FEE_AGREED)
    _transition(shipment, actor, Shipment.Status.OFFERED)
    assignment_updated = Shipment.objects.filter(
        pk=shipment.pk,
        assigned_driver__isnull=True,
        status=Shipment.Status.OFFERED,
        current_fee_proposal_version=expected_version,
    ).update(
        assigned_driver=driver,
        fee_agreement_status=Shipment.FeeAgreementStatus.AGREED,
        updated_at=timezone.now(),
    )
    if assignment_updated != 1:
        raise ShipmentConflict("Another driver has already been assigned.")
    shipment.refresh_from_db()
    agreement = ShipmentFeeAgreement.objects.create(
        shipment=shipment,
        proposal=proposal,
        buyer=shipment.buyer,
        driver=driver,
        amount=proposal.amount,
        currency=proposal.currency,
        buyer_accepted_at=buyer_accepted_at,
        driver_accepted_at=driver_accepted_at,
    )
    ShipmentMessage.objects.create(
        shipment=shipment,
        offer=offer,
        sender=actor,
        body=(
            f"{'Buyer' if actor_is_buyer else 'Driver'} accepted the delivery fee "
            f"of {agreement.amount} {agreement.currency}."
        ),
    )
    offer.status = ShipmentOffer.Status.ACCEPTED
    offer.responded_at = timezone.now()
    offer.save(update_fields=["status", "responded_at"])
    competing_offers = shipment.offers.filter(
        status=ShipmentOffer.Status.PENDING
    ).exclude(pk=offer.pk)
    competing_driver_ids = list(
        competing_offers.values_list("driver_id", flat=True)
    )
    competing_offers.update(
        status=ShipmentOffer.Status.WITHDRAWN,
        responded_at=timezone.now(),
        response_reason="Another driver was assigned to this shipment.",
    )
    notify_shipment_users(
        shipment,
        competing_driver_ids,
        ShipmentOffer.Status.WITHDRAWN,
        exclude=actor,
    )

    _transition(shipment, actor, Shipment.Status.ASSIGNED)
    record_audit(
        actor,
        "shipment.driver_assigned",
        "shipment",
        shipment.pk,
        {
            "driver_id": driver.pk,
            "fee_agreement_id": agreement.pk,
            "amount": str(agreement.amount),
            "currency": agreement.currency,
        },
    )
    MarketplaceShipmentEvent.objects.create(
        shipment=shipment,
        event_type="delivery_fee.agreed",
        details={
            "amount": str(agreement.amount),
            "currency": agreement.currency,
            "proposal_version": agreement.proposal.version,
            "buyer_accepted_at": agreement.buyer_accepted_at.isoformat(),
            "driver_accepted_at": agreement.driver_accepted_at.isoformat(),
            **_driver_external_identity_details(driver),
        },
    )
    return shipment


def _driver_external_identity_details(driver):
    """Expose the canonical marketplace driver id so the marketplace can pay the fee."""
    identity = MarketplaceDriverIdentity.objects.filter(user=driver).first()
    if identity is None:
        return {}
    return {"driver_external_user_id": str(identity.marketplace_user_id)}


def accept_driver_fee_counterproposal(shipment_id, proposal_id, version, buyer):
    return _assign_from_agreement(shipment_id, proposal_id, version, buyer, True)


def accept_buyer_fee_proposal(shipment_id, proposal_id, version, driver):
    return _assign_from_agreement(shipment_id, proposal_id, version, driver, False)


@transaction.atomic
def reject_driver_fee_counterproposal(
    shipment_id, proposal_id, expected_version, buyer, reason
):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id, buyer=buyer).first()
    if shipment is None:
        raise NotFound("Shipment was not found.")
    proposal = ShipmentFeeProposal.objects.select_for_update().filter(
        pk=proposal_id,
        shipment=shipment,
        target_driver__isnull=False,
        proposed_by_id=F("target_driver_id"),
        status=ShipmentFeeProposal.Status.PROPOSED,
    ).first()
    if proposal is None:
        raise ShipmentConflict("This fee proposal is no longer available.")
    if (
        proposal.version != shipment.current_fee_proposal_version
        or proposal.version != expected_version
    ):
        raise ShipmentConflict(
            "This fee proposal is stale; refresh the shipment before responding."
        )
    proposal.status = ShipmentFeeProposal.Status.REJECTED
    proposal.response_reason = reason.strip()
    proposal.responded_at = timezone.now()
    proposal.save(update_fields=["status", "response_reason", "responded_at"])
    record_audit(
        buyer,
        "shipment.fee_counterproposal_rejected",
        "shipment_fee_proposal",
        proposal.pk,
        {
            "shipment_id": shipment.pk,
            "version": proposal.version,
            "reason": reason.strip(),
        },
    )
    return proposal


@transaction.atomic
def update_shipment_status(shipment_id, driver, target_status, reason=""):
    shipment = Shipment.objects.select_for_update().filter(
        pk=shipment_id, assigned_driver=driver
    ).first()
    if shipment is None:
        raise NotFound("Shipment was not found.")
    if not is_active_assigned_driver(shipment, driver):
        raise NotFound("Shipment was not found.")
    if target_status not in DRIVER_TRANSITIONS.get(shipment.status, set()):
        raise ValidationError(
            {"status": f"Cannot change shipment from {shipment.status} to {target_status}."}
        )
    if (
        target_status == Shipment.Status.PICKED_UP
        and settings.SHIPMENT_REQUIRE_PICKUP_EVIDENCE
        and not shipment.evidence.filter(
            uploaded_by=driver, evidence_type=ShipmentEvidence.Type.PICKUP
        ).exists()
    ):
        raise ValidationError({"evidence": "Pickup evidence is required before confirming pickup."})
    required_evidence_type = {
        Shipment.Status.DELIVERY_ATTEMPTED: ShipmentEvidence.Type.DELIVERY_ATTEMPT,
        Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED: (
            ShipmentEvidence.Type.DELIVERY_CONFIRMATION
        ),
    }.get(target_status)
    if (
        required_evidence_type
        and settings.SHIPMENT_REQUIRE_DELIVERY_EVIDENCE
        and not shipment.evidence.filter(
            uploaded_by=driver, evidence_type=required_evidence_type
        ).exists()
    ):
        raise ValidationError(
            {"evidence": "Required delivery evidence must be uploaded before this update."}
        )
    _transition(shipment, driver, target_status, reason.strip())
    return shipment


@transaction.atomic
def confirm_shipment_delivery(shipment_id, buyer):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id, buyer=buyer).first()
    if shipment is None or not is_active_shipment_buyer(shipment, buyer):
        raise NotFound("Shipment was not found.")
    if shipment.status != Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED:
        raise ValidationError(
            {"status": "Receipt can only be confirmed after the driver requests delivery confirmation."}
        )
    _transition(shipment, buyer, Shipment.Status.DELIVERED)
    return shipment


@transaction.atomic
def reschedule_failed_delivery(shipment_id, actor, estimated_delivery_at, reason):
    shipment = (
        Shipment.objects.select_for_update()
        .filter(pk=shipment_id)
        .filter(models_buyer_or_assigned(actor))
        .first()
    )
    if shipment is None:
        raise NotFound("Shipment was not found.")
    if not is_active_shipment_participant(shipment, actor):
        raise NotFound("Shipment was not found.")
    if shipment.status != Shipment.Status.DELIVERY_ATTEMPTED:
        raise ValidationError(
            {"status": "Only a failed delivery attempt can be rescheduled."}
        )
    if not timezone.is_aware(estimated_delivery_at) or estimated_delivery_at <= timezone.now():
        raise ValidationError(
            {"estimated_delivery_at": "Choose a future delivery time with a timezone."}
        )
    reason = reason.strip()
    if not reason:
        raise ValidationError({"reason": "A rescheduling reason is required."})
    exception = ShipmentException.objects.create(
        shipment=shipment,
        reported_by=actor,
        exception_type=ShipmentException.Type.FAILED_DELIVERY,
        reason=reason,
    )
    shipment.estimated_delivery_at = estimated_delivery_at
    shipment.save(update_fields=["estimated_delivery_at", "updated_at"])
    record_audit(
        actor,
        "shipment.rescheduled",
        "shipment_exception",
        exception.pk,
        {
            "shipment_id": shipment.pk,
            "estimated_delivery_at": estimated_delivery_at.isoformat(),
        },
    )
    notify_shipment_participants(
        shipment, ShipmentException.Type.FAILED_DELIVERY, exclude=actor
    )
    _transition(
        shipment,
        actor,
        Shipment.Status.IN_TRANSIT,
        f"Rescheduled: {reason}",
    )
    return shipment


@transaction.atomic
def cancel_shipment(shipment_id, buyer, reason):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id, buyer=buyer).first()
    if shipment is None or not is_active_shipment_buyer(shipment, buyer):
        raise NotFound("Shipment was not found.")
    if shipment.status not in {
        Shipment.Status.REQUESTED,
        Shipment.Status.FEE_PROPOSED,
        Shipment.Status.NEGOTIATING,
    }:
        raise ValidationError({"status": "Assigned shipments cannot be cancelled through this action."})
    shipment.cancellation_reason = reason.strip()
    shipment.cancelled_by = buyer
    shipment.save(update_fields=["cancellation_reason", "cancelled_by", "updated_at"])
    pending_driver_ids = list(
        shipment.offers.filter(status=ShipmentOffer.Status.PENDING)
        .values_list("driver_id", flat=True)
    )
    shipment.offers.filter(status=ShipmentOffer.Status.PENDING).update(
        status=ShipmentOffer.Status.WITHDRAWN,
        responded_at=timezone.now(),
        response_reason="The buyer cancelled this shipment.",
    )
    notify_shipment_users(
        shipment, pending_driver_ids, Shipment.Status.CANCELLED, exclude=buyer
    )
    shipment.fee_proposals.filter(status=ShipmentFeeProposal.Status.PROPOSED).update(
        status=ShipmentFeeProposal.Status.WITHDRAWN, responded_at=timezone.now()
    )
    _transition(shipment, buyer, Shipment.Status.CANCELLED, reason.strip())
    return shipment


@transaction.atomic
def dispute_shipment(shipment_id, actor, reason):
    shipment = Shipment.objects.select_for_update().filter(pk=shipment_id).first()
    if shipment is None or not is_active_shipment_participant(shipment, actor):
        raise NotFound("Shipment was not found.")
    if shipment.status not in DISPUTABLE_STATUSES:
        raise ValidationError({"status": "This shipment cannot be disputed in its current state."})
    ShipmentException.objects.create(
        shipment=shipment,
        reported_by=actor,
        exception_type=ShipmentException.Type.INCIDENT,
        reason=reason.strip(),
    )
    record_audit(
        actor,
        "shipment.disputed",
        "shipment",
        shipment.pk,
        {"reason": reason.strip()},
    )
    _transition(shipment, actor, Shipment.Status.DISPUTED, reason.strip())
    return shipment


@transaction.atomic
def report_delivery_problem(shipment_id, buyer, reason):
    shipment = Shipment.objects.select_for_update().filter(
        pk=shipment_id, buyer=buyer
    ).first()
    if shipment is None or not is_active_shipment_buyer(shipment, buyer):
        raise NotFound("Shipment was not found.")
    if shipment.status != Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED:
        raise ValidationError(
            {"status": "A delivery problem can be reported only for a pending confirmation."}
        )
    reason = reason.strip()
    ShipmentException.objects.create(
        shipment=shipment,
        reported_by=buyer,
        exception_type=ShipmentException.Type.INCIDENT,
        reason=reason,
    )
    record_audit(
        buyer,
        "shipment.delivery_problem_reported",
        "shipment",
        shipment.pk,
        {"reason": reason},
    )
    _transition(shipment, buyer, Shipment.Status.DISPUTED, reason)
    return shipment


@transaction.atomic
def report_shipment_exception(shipment_id, actor, exception_type, reason):
    shipment = (
        Shipment.objects.select_for_update()
        .filter(pk=shipment_id)
        .filter(
            models_buyer_or_assigned(actor)
        )
        .first()
    )
    if shipment is None:
        raise NotFound("Shipment was not found.")
    if not is_active_shipment_participant(shipment, actor):
        raise NotFound("Shipment was not found.")
    if shipment.status not in {
        Shipment.Status.ASSIGNED,
        Shipment.Status.PICKUP_PENDING,
        Shipment.Status.PICKUP_ARRIVED,
        Shipment.Status.PICKED_UP,
        Shipment.Status.IN_TRANSIT,
        Shipment.Status.DELIVERY_ATTEMPTED,
        Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
    }:
        raise ValidationError({"status": "Exceptions can only be reported on active shipments."})
    exception = ShipmentException.objects.create(
        shipment=shipment,
        reported_by=actor,
        exception_type=exception_type,
        reason=reason.strip(),
    )
    record_audit(
        actor,
        "shipment.exception_reported",
        "shipment_exception",
        exception.pk,
        {"shipment_id": shipment.pk, "exception_type": exception_type},
    )
    if shipment.order_verified:
        MarketplaceShipmentEvent.objects.create(
            shipment=shipment,
            event_type="shipment.exception_reported",
            details={"exception_type": exception_type},
        )
    notify_shipment_participants(
        shipment, exception_type, exclude=actor
    )
    return exception


def models_buyer_or_assigned(actor):
    return Q(buyer=actor) | Q(assigned_driver=actor)
