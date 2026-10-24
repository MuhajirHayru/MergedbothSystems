import hashlib
import hmac
import io
import json
import uuid
from datetime import timedelta
from unittest.mock import patch
from urllib.error import HTTPError

import pytest
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import CommandError
from django.utils import timezone

from payments.models import (
    DriverShipmentEventCursor,
    DriverShipmentEventInbox,
    MarketplaceDeliveryFeeAgreement,
    OrderShipmentDetails,
)
from payments.shipment_feed import (
    _apply_page,
    _fetch_page,
    _validate_page,
)
from registrations.models import AdministrativeLocation, LocationLevel
from users.models import AuditLog

pytestmark = pytest.mark.django_db


@pytest.fixture
def authorized_shipment(order):
    region = AdministrativeLocation.objects.create(
        source_id="feed-region",
        name="Feed Region",
        level=LocationLevel.REGION,
    )
    return OrderShipmentDetails.objects.create(
        order=order,
        pickup_region=region,
        pickup_address_line="Confirmed pickup",
        destination_region=region,
        destination_address_line="Confirmed destination",
        cargo_weight_kg="12.50",
        packaging_details="Sealed crates",
        authorized_at=timezone.now(),
    )


def shipment_event(order_id, *, cursor=1, event_id=None, status="assigned"):
    return {
        "event_id": str(event_id or uuid.uuid4()),
        "cursor": cursor,
        "event_type": "shipment.status_changed",
        "occurred_at": timezone.now().isoformat(),
        "order_reference": str(order_id),
        "shipment_id": 42,
        "details": {"from_status": "offered", "to_status": status},
    }


def page_for(*events, has_more=False):
    return {
        "results": list(events),
        "next_cursor": events[-1]["cursor"] if events else 0,
        "has_more": has_more,
    }


def test_shipment_feed_persists_projection_inbox_and_cursor(order, authorized_shipment):
    event = shipment_event(order.pk)
    page = page_for(event)
    _validate_page(page, 0, 10)

    result = _apply_page(page, 0)

    authorized_shipment.refresh_from_db()
    assert result == {"processed": 1, "cursor": 1, "has_more": False}
    assert authorized_shipment.driver_shipment_id == 42
    assert authorized_shipment.driver_shipment_status == "assigned"
    assert DriverShipmentEventCursor.objects.get(pk=1).cursor == 1
    stored = DriverShipmentEventInbox.objects.get(event_id=event["event_id"])
    assert stored.order_id == order.pk
    assert len(stored.payload_sha256) == 64
    assert AuditLog.objects.filter(
        action="driver_shipment_event_processed",
        target=str(order.pk),
    ).exists()


def test_identical_replayed_event_is_deduplicated(order, authorized_shipment):
    event = shipment_event(order.pk)
    _apply_page(page_for(event), 0)

    replay = page_for(event)
    _validate_page(replay, 1, 10)
    result = _apply_page(replay, 1)

    assert result["processed"] == 0
    assert result["cursor"] == 1
    assert DriverShipmentEventInbox.objects.count() == 1
    assert AuditLog.objects.filter(action="driver_shipment_event_processed").count() == 1


def test_feed_page_failure_rolls_back_events_and_cursor(order, authorized_shipment):
    DriverShipmentEventCursor.objects.create(pk=1)
    first = shipment_event(order.pk)
    unknown_order = shipment_event(uuid.uuid4(), cursor=2)
    invalid_page = page_for(first, unknown_order, has_more=False)
    _validate_page(invalid_page, 0, 10)

    with pytest.raises(CommandError, match="unknown marketplace order"):
        _apply_page(invalid_page, 0)

    authorized_shipment.refresh_from_db()
    assert authorized_shipment.driver_shipment_status == ""
    assert DriverShipmentEventInbox.objects.count() == 0
    assert DriverShipmentEventCursor.objects.get(pk=1).cursor == 0


def test_event_id_reuse_with_changed_payload_is_rejected(order, authorized_shipment):
    event_id = uuid.uuid4()
    original = shipment_event(order.pk, event_id=event_id)
    _apply_page(page_for(original), 0)
    altered = shipment_event(
        order.pk,
        cursor=1,
        event_id=event_id,
        status="in_transit",
    )

    with pytest.raises(CommandError, match="changed data"):
        _apply_page(page_for(altered), 1)


def test_cursor_gap_stops_page_without_advancing(order, authorized_shipment):
    DriverShipmentEventCursor.objects.create(pk=1)
    event = shipment_event(order.pk, cursor=2)

    with pytest.raises(CommandError, match="cursor gap"):
        _apply_page(page_for(event), 0)

    assert DriverShipmentEventInbox.objects.count() == 0
    assert DriverShipmentEventCursor.objects.get(pk=1).cursor == 0


def test_terminal_driver_status_closes_exact_address_visibility(
    order, authorized_shipment
):
    event = shipment_event(order.pk, status="completed")
    event["details"] = {
        "from_status": "delivered",
        "to_status": "completed",
    }

    _apply_page(page_for(event), 0)

    authorized_shipment.refresh_from_db()
    assert authorized_shipment.driver_shipment_status == "completed"
    assert authorized_shipment.closed_at is not None


def test_fee_agreement_event_records_acceptance_without_financial_effects(
    order, authorized_shipment
):
    assigned = shipment_event(order.pk, cursor=1, status="assigned")
    accepted_at = (timezone.now() - timedelta(minutes=1)).isoformat()
    agreement = shipment_event(order.pk, cursor=2, status="assigned")
    agreement["event_type"] = "delivery_fee.agreed"
    agreement["details"] = {
        "amount": "375.00",
        "currency": "ETB",
        "proposal_version": 2,
        "buyer_accepted_at": accepted_at,
        "driver_accepted_at": accepted_at,
    }

    _apply_page(page_for(assigned, agreement), 0)

    saved = MarketplaceDeliveryFeeAgreement.objects.get(order=order)
    assert saved.source_event_id == uuid.UUID(agreement["event_id"])
    assert saved.driver_shipment_id == 42
    assert saved.driver_proposal_version == 2
    assert str(saved.amount) == "375.00"
    assert saved.currency == "ETB"
    assert saved.buyer_accepted_at == saved.driver_accepted_at
    assert authorized_shipment.order.wallet_transactions.count() == 0
    _validate_page(page_for(agreement), 2, 10)
    assert _apply_page(page_for(agreement), 2)["processed"] == 0
    assert MarketplaceDeliveryFeeAgreement.objects.filter(order=order).count() == 1

    with pytest.raises(ValidationError, match="immutable"):
        saved.save()


def test_signed_feed_request_uses_exact_path_and_bodyless_hmac(monkeypatch):
    secret = "test-integration-secret-with-more-than-32-characters"
    monkeypatch.setattr(settings, "GREENPATH_DRIVER_INTEGRATION_BASE_URL", "https://driver.example")
    monkeypatch.setattr(settings, "GREENPATH_DRIVER_INTEGRATION_SECRET", secret)
    monkeypatch.setattr("payments.shipment_feed.time.time", lambda: 1_700_000_000)
    monkeypatch.setattr(
        "payments.shipment_feed.uuid.uuid4",
        lambda: uuid.UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"),
    )
    response_body = json.dumps(
        {"results": [], "next_cursor": 0, "has_more": False}
    ).encode("utf-8")

    with patch("payments.shipment_feed.urlopen", return_value=io.BytesIO(response_body)) as mocked:
        result = _fetch_page("/api/integrations/v1/shipment-events/?after_id=0&limit=10")

    request = mocked.call_args.args[0]
    headers = {key.lower(): value for key, value in request.headers.items()}
    request_id = headers["x-gp-integration-request-id"]
    canonical = b"\n".join(
        (
            b"1700000000",
            request_id.encode("ascii"),
            b"GET",
            b"/api/integrations/v1/shipment-events/?after_id=0&limit=10",
            b"",
        )
    )
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), canonical, hashlib.sha256
    ).hexdigest()
    assert headers["x-gp-integration-signature"] == expected
    assert mocked.call_args.kwargs["timeout"] > 0
    assert result["results"] == []


def test_feed_retries_transient_http_failure_with_fresh_request_ids(monkeypatch):
    monkeypatch.setattr(
        settings,
        "GREENPATH_DRIVER_INTEGRATION_BASE_URL",
        "https://driver.example",
    )
    monkeypatch.setattr(
        settings,
        "GREENPATH_DRIVER_INTEGRATION_SECRET",
        "test-integration-secret-with-more-than-32-characters",
    )
    request_ids = [
        uuid.UUID("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"),
        uuid.UUID("ffffffff-ffff-4fff-8fff-ffffffffffff"),
        uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ]
    monkeypatch.setattr(
        "payments.shipment_feed.uuid.uuid4",
        lambda: request_ids.pop(0),
    )
    unavailable = HTTPError(
        "https://driver.example/api/integrations/v1/shipment-events/",
        503,
        "unavailable",
        {},
        None,
    )
    response_body = json.dumps(
        {"results": [], "next_cursor": 0, "has_more": False}
    ).encode("utf-8")

    with (
        patch(
            "payments.shipment_feed.urlopen",
            side_effect=[unavailable, unavailable, io.BytesIO(response_body)],
        ) as mocked,
        patch("payments.shipment_feed.sleep") as sleep_mock,
    ):
        result = _fetch_page("/api/integrations/v1/shipment-events/?after_id=0&limit=10")

    request_header_sets = [
        {
            key.lower(): value
            for key, value in call.args[0].headers.items()
        }
        for call in mocked.call_args_list
    ]
    request_ids_used = [
        headers["x-gp-integration-request-id"] for headers in request_header_sets
    ]
    assert mocked.call_count == 3
    assert len(set(request_ids_used)) == 3
    assert sleep_mock.call_count == 2
    assert result["results"] == []
