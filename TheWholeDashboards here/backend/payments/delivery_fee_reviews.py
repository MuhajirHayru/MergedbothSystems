import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from users.models import AccountStatus, AuditLog, Role

from .models import (
    MarketplaceDeliveryFeeAgreement,
    MarketplaceDeliveryFeeReview,
    Order,
    OrderShipmentDetails,
)


class DeliveryFeeReviewConflict(Exception):
    pass


class StaleDeliveryFeeAgreement(Exception):
    pass


def _review_matches(review, decision, reason, proposal_version):
    return (
        review.decision == decision
        and review.rejection_reason == reason
        and review.proposal_version == proposal_version
    )


def review_delivery_fee_agreement(
    agreement_id, actor, decision, proposal_version, rejection_reason=""
):
    if (
        not actor
        or not actor.is_authenticated
        or not actor.is_active
        or actor.status != AccountStatus.APPROVED
        or actor.role != Role.FINANCIAL_MANAGER
        or "delivery_fee:review" not in actor.get_role_permissions()
    ):
        raise PermissionError("This account is not authorized to review delivery fees.")

    reason = rejection_reason.strip()
    try:
        with transaction.atomic():
            agreement = (
                MarketplaceDeliveryFeeAgreement.objects.select_for_update()
                .select_related("order")
                .filter(pk=agreement_id)
                .first()
            )
            if agreement is None:
                return None, False

            order = Order.objects.select_for_update().get(pk=agreement.order_id)
            agreement = MarketplaceDeliveryFeeAgreement.objects.select_for_update().get(
                pk=agreement.pk
            )
            prior = MarketplaceDeliveryFeeReview.objects.filter(
                agreement=agreement
            ).first()
            if prior:
                if not _review_matches(prior, decision, reason, proposal_version):
                    raise DeliveryFeeReviewConflict(
                        "This agreement already has a different financial decision."
                    )
                return prior, False

            details = (
                OrderShipmentDetails.objects.select_for_update()
                .filter(order=order, authorized_at__isnull=False)
                .first()
            )
            if (
                details is None
                or proposal_version != agreement.driver_proposal_version
                or details.delivery_fee_proposal_version
                != agreement.driver_proposal_version
                or details.delivery_fee_proposal_amount != agreement.amount
                or details.delivery_fee_proposal_currency != agreement.currency
                or details.buyer_confirmed_revision != details.details_revision
                or details.seller_confirmed_revision != details.details_revision
            ):
                raise StaleDeliveryFeeAgreement(
                    "The delivery-fee agreement no longer matches the confirmed proposal."
                )

            from .integration import enqueue_delivery_fee_review
            from .wallet_services import credit_driver_delivery_fee

            review = MarketplaceDeliveryFeeReview.objects.create(
                agreement=agreement,
                decision_event_id=uuid.uuid4(),
                actor=actor,
                reviewer_role=actor.role,
                authorization_context="delivery_fee:review",
                decision=decision,
                rejection_reason=reason,
                proposal_version=proposal_version,
                decided_at=timezone.now(),
            )
            if decision == MarketplaceDeliveryFeeReview.Decision.APPROVED:
                credit_driver_delivery_fee(agreement, actor)
            enqueue_delivery_fee_review(review)
            AuditLog.objects.create(
                actor=actor,
                action=f"marketplace_delivery_fee_{decision}",
                target=str(agreement.source_event_id),
                detail=(
                    f"Decision event {review.decision_event_id}; "
                    f"order {order.reference}; proposal version {proposal_version}."
                    + (f" Rejection reason: {reason}" if reason else "")
                ),
            )
            return review, True
    except IntegrityError:
        prior = MarketplaceDeliveryFeeReview.objects.filter(
            agreement_id=agreement_id
        ).first()
        if prior and _review_matches(prior, decision, reason, proposal_version):
            return prior, False
        if prior:
            raise DeliveryFeeReviewConflict(
                "This agreement already has a different financial decision."
            )
        raise
