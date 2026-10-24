import hashlib
import hmac
import json
from datetime import timedelta
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

import pytest
from django.conf import settings
from django.utils import timezone

from payments.integration_outbox import EVENT_PATH, MAX_ATTEMPTS, deliver_pending_events
from payments.models import MarketplaceIntegrationOutbox

pytestmark = pytest.mark.django_db


@pytest.fixture
def pending_event(order):
    payload = json.dumps(
        {
            "contract_version": "2",
            "event_id": "55555555-5555-4555-8555-555555555555",
            "event_type": "payment.status_snapshot",
            "order_reference": str(order.pk),
            "revision": 1,
        },
        separators=(",", ":"),
    )
    return MarketplaceIntegrationOutbox.objects.create(
        order=order,
        revision=1,
        event_type="payment.status_snapshot",
        payload=payload,
    )


@pytest.fixture
def integration_credentials(monkeypatch):
    secret = "test-integration-secret-with-more-than-32-characters"
    monkeypatch.setattr(
        settings,
        "GREENPATH_DRIVER_INTEGRATION_BASE_URL",
        "https://driver.example",
    )
    monkeypatch.setattr(settings, "GREENPATH_DRIVER_INTEGRATION_SECRET", secret)
    return secret


def successful_response(status=202):
    response = MagicMock()
    response.__enter__.return_value.status = status
    return response


def test_outbox_sends_exact_persisted_payload_with_hmac(
    pending_event, integration_credentials, monkeypatch
):
    timestamp = 1_700_000_000
    monkeypatch.setattr("payments.integration_outbox.time.time", lambda: timestamp)
    with patch(
        "payments.integration_outbox.urlopen",
        return_value=successful_response(),
    ) as mocked:
        assert deliver_pending_events() == 1

    request = mocked.call_args.args[0]
    headers = {key.lower(): value for key, value in request.headers.items()}
    body = request.data
    canonical = b"\n".join(
        (
            str(timestamp).encode("ascii"),
            str(pending_event.event_id).encode("ascii"),
            b"POST",
            EVENT_PATH.encode("ascii"),
            body,
        )
    )
    signature = "sha256=" + hmac.new(
        integration_credentials.encode("utf-8"), canonical, hashlib.sha256
    ).hexdigest()
    assert body.decode("utf-8") == pending_event.payload
    assert headers["x-gp-integration-request-id"] == str(pending_event.event_id)
    assert headers["x-gp-integration-signature"] == signature
    pending_event.refresh_from_db()
    assert pending_event.status == MarketplaceIntegrationOutbox.Status.DELIVERED
    assert pending_event.attempts == 1


def test_outbox_retries_transient_failure_then_delivers_same_payload(
    pending_event, integration_credentials
):
    original_payload = pending_event.payload
    failure = HTTPError(
        "https://driver.example/api/integrations/v2/events/",
        503,
        "unavailable",
        {},
        None,
    )
    with patch(
        "payments.integration_outbox.urlopen", side_effect=failure
    ) as mocked:
        assert deliver_pending_events() == 0
    first_request = mocked.call_args.args[0]
    pending_event.refresh_from_db()
    assert pending_event.status == MarketplaceIntegrationOutbox.Status.PENDING
    assert pending_event.attempts == 1
    assert pending_event.available_at > timezone.now()
    assert pending_event.payload == original_payload
    assert first_request.data.decode("utf-8") == original_payload

    pending_event.available_at = timezone.now() - timedelta(seconds=1)
    pending_event.save(update_fields=["available_at"])
    with patch(
        "payments.integration_outbox.urlopen",
        return_value=successful_response(),
    ) as retry_mock:
        assert deliver_pending_events() == 1
    retry_request = retry_mock.call_args.args[0]
    assert retry_request.data.decode("utf-8") == original_payload
    assert retry_request.get_header("X-gp-integration-request-id") == str(
        pending_event.event_id
    )
    pending_event.refresh_from_db()
    assert pending_event.status == MarketplaceIntegrationOutbox.Status.DELIVERED
    assert pending_event.attempts == 2


def test_outbox_blocks_event_at_bounded_attempt_limit(
    pending_event, integration_credentials
):
    pending_event.attempts = MAX_ATTEMPTS - 1
    pending_event.save(update_fields=["attempts"])
    failure = HTTPError(
        "https://driver.example/api/integrations/v2/events/",
        503,
        "unavailable",
        {},
        None,
    )
    with patch("payments.integration_outbox.urlopen", side_effect=failure):
        assert deliver_pending_events() == 0

    pending_event.refresh_from_db()
    assert pending_event.attempts == MAX_ATTEMPTS
    assert pending_event.status == MarketplaceIntegrationOutbox.Status.BLOCKED
    assert pending_event.last_error_code == "http_503"


def test_outbox_never_delivers_later_revision_before_retrying_predecessor(
    pending_event, integration_credentials
):
    pending_event.available_at = timezone.now() + timedelta(minutes=1)
    pending_event.save(update_fields=["available_at"])
    later = MarketplaceIntegrationOutbox.objects.create(
        order=pending_event.order,
        revision=2,
        event_type="payment.status_snapshot",
        payload='{"revision":2}',
    )

    with patch("payments.integration_outbox.urlopen") as mocked:
        assert deliver_pending_events() == 0

    assert not mocked.called
    pending_event.refresh_from_db()
    later.refresh_from_db()
    assert pending_event.status == MarketplaceIntegrationOutbox.Status.PENDING
    assert later.status == MarketplaceIntegrationOutbox.Status.PENDING


def test_outbox_blocks_later_revisions_after_predecessor_is_blocked(
    pending_event, integration_credentials
):
    pending_event.status = MarketplaceIntegrationOutbox.Status.BLOCKED
    pending_event.save(update_fields=["status"])
    later = MarketplaceIntegrationOutbox.objects.create(
        order=pending_event.order,
        revision=2,
        event_type="payment.status_snapshot",
        payload='{"revision":2}',
    )

    with patch("payments.integration_outbox.urlopen") as mocked:
        assert deliver_pending_events() == 0

    assert not mocked.called
    later.refresh_from_db()
    assert later.status == MarketplaceIntegrationOutbox.Status.BLOCKED
    assert later.last_error_code == "prior_event_blocked"
