import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

import pytest
from django.db import close_old_connections, connection, connections, transaction
from rest_framework.test import APIClient
from django.utils import timezone

from payments.models import (
    MarketplaceDeliveryFeeAgreement,
    MarketplaceDeliveryFeeReview,
    MarketplaceIntegrationOutbox,
    OrderShipmentDetails,
)
from registrations.models import AdministrativeLocation, LocationLevel
from users.models import AuditLog, Role

pytestmark = pytest.mark.django_db
postgresql_only = pytest.mark.skipif(
    connection.vendor != "postgresql",
    reason="Delivery-fee review concurrency requires PostgreSQL row locks.",
)


@pytest.fixture
def delivery_fee_agreement(order):
    region = AdministrativeLocation.objects.create(
        source_id="fee-review-region",
        name="Fee Review Region",
        level=LocationLevel.REGION,
    )
    now = timezone.now()
    OrderShipmentDetails.objects.create(
        order=order,
        pickup_region=region,
        pickup_address_line="Pickup",
        destination_region=region,
        destination_address_line="Destination",
        cargo_weight_kg="12.50",
        packaging_details="Sealed crates",
        delivery_fee_proposal_amount="250.00",
        delivery_fee_proposal_currency="ETB",
        delivery_fee_proposal_version=1,
        buyer_confirmed_revision=1,
        seller_confirmed_revision=1,
        authorized_at=now,
        driver_shipment_id=42,
    )
    return MarketplaceDeliveryFeeAgreement.objects.create(
        order=order,
        source_event_id=uuid.uuid4(),
        driver_shipment_id=42,
        driver_proposal_version=1,
        amount="250.00",
        currency="ETB",
        buyer_accepted_at=now,
        driver_accepted_at=now,
    )


def review_url(agreement):
    return f"/api/v1/payments/delivery-fee-agreements/{agreement.pk}/review/"


def _post_review_concurrently(agreement, actor, payloads):
    start_together = Barrier(len(payloads))

    def post(payload):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user=actor)
        try:
            start_together.wait(timeout=15)
            response = client.post(review_url(agreement), payload, format="json")
            return response.status_code, response.data
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=len(payloads)) as executor:
        futures = [executor.submit(post, payload) for payload in payloads]
        return [future.result(timeout=45) for future in futures]


def test_financial_manager_approval_is_audited_and_only_queues_review_event(
    api, financial_manager, delivery_fee_agreement, order, wholesaler
):
    before_balance = wholesaler.wallet.available_balance
    api.force_authenticate(user=financial_manager)

    response = api.post(
        review_url(delivery_fee_agreement),
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )

    assert response.status_code == 201, response.data
    review = MarketplaceDeliveryFeeReview.objects.get()
    assert review.agreement_id == delivery_fee_agreement.pk
    assert review.actor_id == financial_manager.pk
    assert review.reviewer_role == Role.FINANCIAL_MANAGER
    assert review.authorization_context == "delivery_fee:review"
    assert review.decision_event_id
    assert response.data["review"]["actor_name"] == financial_manager.full_name
    outbox = MarketplaceIntegrationOutbox.objects.get()
    payload = json.loads(outbox.payload)
    assert outbox.event_type == "delivery_fee.reviewed"
    assert payload["delivery_fee_review"] == {
        "agreement_event_id": str(delivery_fee_agreement.source_event_id),
        "shipment_id": 42,
        "proposal_version": 1,
        "amount": "250.00",
        "currency": "ETB",
        "decision": "approved",
        "message": "The marketplace delivery-fee review is complete.",
    }
    assert outbox.status == MarketplaceIntegrationOutbox.Status.PENDING
    order.refresh_from_db()
    wholesaler.wallet.refresh_from_db()
    assert order.payment_status == ""
    assert wholesaler.wallet.available_balance == Decimal(before_balance)
    assert AuditLog.objects.filter(
        actor=financial_manager,
        action="marketplace_delivery_fee_approved",
        target=str(delivery_fee_agreement.source_event_id),
    ).exists()


def test_identical_retry_returns_existing_decision_without_duplicate_event(
    api, financial_manager, delivery_fee_agreement
):
    api.force_authenticate(user=financial_manager)
    payload = {"decision": "approved", "proposal_version": 1}

    first = api.post(review_url(delivery_fee_agreement), payload, format="json")
    retry = api.post(review_url(delivery_fee_agreement), payload, format="json")

    assert first.status_code == 201
    assert retry.status_code == 200
    assert MarketplaceDeliveryFeeReview.objects.count() == 1
    assert MarketplaceIntegrationOutbox.objects.filter(
        event_type="delivery_fee.reviewed"
    ).count() == 1


@pytest.mark.django_db(transaction=True)
@postgresql_only
def test_concurrent_conflicting_reviews_persist_one_decision_and_matching_event(
    financial_manager, delivery_fee_agreement
):
    responses = _post_review_concurrently(
        delivery_fee_agreement,
        financial_manager,
        [
            {"decision": "approved", "proposal_version": 1},
            {
                "decision": "rejected",
                "proposal_version": 1,
                "rejection_reason": "The agreed fee needs correction.",
            },
        ],
    )

    assert sorted(status for status, _ in responses) == [201, 409]
    review = MarketplaceDeliveryFeeReview.objects.get()
    outbox = MarketplaceIntegrationOutbox.objects.get(
        event_type="delivery_fee.reviewed"
    )
    payload = json.loads(outbox.payload)
    assert MarketplaceDeliveryFeeReview.objects.count() == 1
    assert MarketplaceIntegrationOutbox.objects.filter(
        event_type="delivery_fee.reviewed"
    ).count() == 1
    assert review.decision in {
        MarketplaceDeliveryFeeReview.Decision.APPROVED,
        MarketplaceDeliveryFeeReview.Decision.REJECTED,
    }
    assert review.proposal_version == 1
    assert outbox.event_id == review.decision_event_id
    assert payload["event_id"] == str(review.decision_event_id)
    assert payload["event_type"] == "delivery_fee.reviewed"
    assert payload["delivery_fee_review"]["decision"] == review.decision
    assert payload["delivery_fee_review"]["agreement_event_id"] == str(
        delivery_fee_agreement.source_event_id
    )
    assert outbox.order_id == delivery_fee_agreement.order_id


@pytest.mark.django_db(transaction=True)
@postgresql_only
def test_concurrent_identical_reviews_are_idempotent_and_emit_one_event(
    financial_manager, delivery_fee_agreement
):
    payload = {"decision": "approved", "proposal_version": 1}
    responses = _post_review_concurrently(
        delivery_fee_agreement,
        financial_manager,
        [payload, payload],
    )

    assert sorted(status for status, _ in responses) == [200, 201]
    review = MarketplaceDeliveryFeeReview.objects.get()
    outbox = MarketplaceIntegrationOutbox.objects.get(
        event_type="delivery_fee.reviewed"
    )
    payload = json.loads(outbox.payload)
    assert MarketplaceDeliveryFeeReview.objects.count() == 1
    assert MarketplaceIntegrationOutbox.objects.filter(
        event_type="delivery_fee.reviewed"
    ).count() == 1
    assert review.decision == MarketplaceDeliveryFeeReview.Decision.APPROVED
    assert outbox.event_id == review.decision_event_id
    assert payload["event_id"] == str(review.decision_event_id)
    assert payload["delivery_fee_review"]["decision"] == review.decision
    assert outbox.order_id == delivery_fee_agreement.order_id


def test_rolled_back_review_does_not_leave_a_decision_or_event(
    financial_manager, delivery_fee_agreement
):
    from payments.delivery_fee_reviews import review_delivery_fee_agreement

    with pytest.raises(RuntimeError), transaction.atomic():
        review_delivery_fee_agreement(
            agreement_id=delivery_fee_agreement.pk,
            actor=financial_manager,
            decision=MarketplaceDeliveryFeeReview.Decision.APPROVED,
            proposal_version=1,
        )
        raise RuntimeError("rollback test")

    assert not MarketplaceDeliveryFeeReview.objects.exists()
    assert not MarketplaceIntegrationOutbox.objects.exists()


def test_rejection_requires_reason_and_final_decision_cannot_be_changed(
    api, financial_manager, delivery_fee_agreement
):
    api.force_authenticate(user=financial_manager)
    url = review_url(delivery_fee_agreement)

    missing_reason = api.post(
        url,
        {"decision": "rejected", "proposal_version": 1},
        format="json",
    )
    rejected = api.post(
        url,
        {
            "decision": "rejected",
            "proposal_version": 1,
            "rejection_reason": "The agreed fee needs correction.",
        },
        format="json",
    )
    conflict = api.post(
        url,
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )

    assert missing_reason.status_code == 400
    assert rejected.status_code == 201
    assert conflict.status_code == 409
    review = MarketplaceDeliveryFeeReview.objects.get()
    assert review.rejection_reason == "The agreed fee needs correction."
    payload = json.loads(MarketplaceIntegrationOutbox.objects.get().payload)
    assert payload["delivery_fee_review"]["rejection_reason"] == review.rejection_reason
    assert MarketplaceIntegrationOutbox.objects.count() == 1


def test_unauthorized_role_cannot_review_or_emit_event(
    api, farmer, delivery_fee_agreement
):
    api.force_authenticate(user=farmer)

    response = api.post(
        review_url(delivery_fee_agreement),
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )

    assert response.status_code == 403
    assert not MarketplaceDeliveryFeeReview.objects.exists()
    assert not MarketplaceIntegrationOutbox.objects.exists()


def test_stale_proposal_revision_cannot_be_reviewed(
    api, financial_manager, delivery_fee_agreement, order
):
    details = OrderShipmentDetails.objects.get(order=order)
    details.delivery_fee_proposal_version = 2
    details.save(update_fields=["delivery_fee_proposal_version", "updated_at"])
    api.force_authenticate(user=financial_manager)

    response = api.post(
        review_url(delivery_fee_agreement),
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )

    assert response.status_code == 409
    assert not MarketplaceDeliveryFeeReview.objects.exists()
    assert not MarketplaceIntegrationOutbox.objects.exists()
