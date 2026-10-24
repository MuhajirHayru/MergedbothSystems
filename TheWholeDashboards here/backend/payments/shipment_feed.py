import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal, InvalidOperation
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.management.base import CommandError
from django.db import transaction
from users.models import AccountStatus, AuditLog, Role, User

from .models import (
    DriverShipmentEventCursor,
    DriverShipmentEventInbox,
    MarketplaceDeliveryFeeAgreement,
    Order,
    OrderShipmentDetails,
)

FEED_PATH = "/api/integrations/v1/shipment-events/"
MAX_RETRIES = 4
REQUEST_TIMEOUT_SECONDS = 10
EVENT_TYPES = {
    "order.authorized",
    "driver.assigned",
    "driver.preparing_for_pickup",
    "driver.arrived_at_pickup",
    "shipment.picked_up",
    "shipment.in_transit",
    "delivery.attempt_failed",
    "driver.delivery_reported",
    "buyer.receipt_confirmed",
    "shipment.completed",
    "shipment.cancelled",
    "shipment.disputed",
    "shipment.status_changed",
    "shipment.exception_reported",
    "delivery_fee.agreed",
}
SHIPMENT_STATUSES = {
    "requested",
    "fee_proposed",
    "negotiating",
    "fee_agreed",
    "offered",
    "assigned",
    "pickup_pending",
    "pickup_arrived",
    "picked_up",
    "in_transit",
    "delivery_attempted",
    "delivery_confirmation_requested",
    "delivered",
    "completed",
    "cancelled",
    "disputed",
}
EXCEPTION_TYPES = {"delay", "incident", "failed_delivery"}


def sync_driver_shipment_events(limit=50):
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise CommandError("Shipment event page limit must be between 1 and 100.")
    _validate_configuration()
    cursor, _ = DriverShipmentEventCursor.objects.get_or_create(pk=1)
    params = urlencode({"after_id": cursor.cursor, "limit": limit})
    path = f"{FEED_PATH}?{params}"
    payload = _fetch_page(path)
    _validate_page(payload, cursor.cursor, limit)
    return _apply_page(payload, cursor.cursor)


def _validate_configuration():
    base_url = settings.GREENPATH_DRIVER_INTEGRATION_BASE_URL
    secret = settings.GREENPATH_DRIVER_INTEGRATION_SECRET
    parsed = urlparse(base_url)
    local_http = parsed.scheme == "http" and parsed.hostname in {
        "localhost",
        "127.0.0.1",
        "::1",
    }
    if (
        not base_url
        or parsed.scheme not in {"https", "http"}
        or not parsed.netloc
        or (parsed.scheme != "https" and not local_http)
    ):
        raise CommandError(
            "Set GREENPATH_DRIVER_INTEGRATION_BASE_URL to HTTPS or a loopback HTTP URL."
        )
    if len(secret) < 32:
        raise CommandError(
            "GREENPATH_DRIVER_INTEGRATION_SECRET must contain at least 32 characters."
        )


def _fetch_page(path):
    for attempt in range(MAX_RETRIES):
        request_id = str(uuid.uuid4())
        timestamp = str(int(time.time()))
        canonical = b"\n".join(
            (
                timestamp.encode("ascii"),
                request_id.encode("ascii"),
                b"GET",
                path.encode("ascii"),
                b"",
            )
        )
        signature = hmac.new(
            settings.GREENPATH_DRIVER_INTEGRATION_SECRET.encode("utf-8"),
            canonical,
            hashlib.sha256,
        ).hexdigest()
        request = Request(
            f"{settings.GREENPATH_DRIVER_INTEGRATION_BASE_URL.rstrip('/')}{path}",
            method="GET",
            headers={
                "X-GP-Integration-Timestamp": timestamp,
                "X-GP-Integration-Request-ID": request_id,
                "X-GP-Integration-Signature": f"sha256={signature}",
            },
        )
        try:
            with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                try:
                    return json.loads(response.read().decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise CommandError(
                        "Driver shipment feed returned invalid JSON."
                    ) from error
        except HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise CommandError(
                    f"Driver shipment feed returned HTTP {error.code}."
                ) from error
            if attempt == MAX_RETRIES - 1:
                raise CommandError(
                    f"Driver shipment feed failed after {MAX_RETRIES} attempts (HTTP {error.code})."
                ) from error
        except (URLError, TimeoutError) as error:
            if attempt == MAX_RETRIES - 1:
                raise CommandError(
                    f"Driver shipment feed failed after {MAX_RETRIES} attempts."
                ) from error
        sleep(min(2 ** attempt, 8))
    raise CommandError("Driver shipment feed retry loop ended unexpectedly.")


def _validate_page(page, current_cursor, limit):
    if not isinstance(page, dict) or set(page) != {
        "results",
        "next_cursor",
        "has_more",
    }:
        raise CommandError("Driver shipment feed returned an invalid page envelope.")
    if (
        not isinstance(page["results"], list)
        or len(page["results"]) > limit
        or isinstance(page["next_cursor"], bool)
        or not isinstance(page["next_cursor"], int)
        or page["next_cursor"] < current_cursor
        or not isinstance(page["has_more"], bool)
    ):
        raise CommandError("Driver shipment feed returned invalid pagination values.")
    last_cursor = 0
    for event in page["results"]:
        _validate_event(event)
        if event["cursor"] <= last_cursor:
            raise CommandError("Driver shipment feed cursors are not strictly increasing.")
        last_cursor = event["cursor"]
    if page["results"] and page["next_cursor"] != last_cursor:
        raise CommandError("Driver shipment feed cursor does not match the page.")
    if not page["results"] and page["next_cursor"] != current_cursor:
        raise CommandError("Empty driver feed page advanced its cursor.")
    if page["has_more"] and len(page["results"]) != limit:
        raise CommandError("Driver shipment feed pagination metadata is inconsistent.")


def _validate_event(event):
    if not isinstance(event, dict) or set(event) != {
        "event_id",
        "cursor",
        "event_type",
        "occurred_at",
        "order_reference",
        "shipment_id",
        "details",
    }:
        raise CommandError("Driver shipment feed returned an invalid event shape.")
    if not isinstance(event["event_id"], str) or not isinstance(
        event["order_reference"], str
    ) or not isinstance(event["occurred_at"], str):
        raise CommandError("Driver shipment feed returned invalid identifier fields.")
    try:
        if str(uuid.UUID(event["event_id"])) != event["event_id"]:
            raise ValueError
        if str(uuid.UUID(event["order_reference"])) != event["order_reference"]:
            raise ValueError
        occurred_at = datetime.fromisoformat(
            event["occurred_at"].replace("Z", "+00:00")
        )
    except (TypeError, ValueError) as error:
        raise CommandError("Driver shipment feed returned an invalid identifier or timestamp.") from error
    if occurred_at.tzinfo is None:
        raise CommandError("Driver shipment event timestamps must include a UTC offset.")
    for key in ("cursor", "shipment_id"):
        if isinstance(event[key], bool) or not isinstance(event[key], int) or event[key] <= 0:
            raise CommandError(f"Driver shipment feed returned an invalid {key}.")
    if (
        not isinstance(event["event_type"], str)
        or event["event_type"] not in EVENT_TYPES
        or not isinstance(event["details"], dict)
    ):
        raise CommandError("Driver shipment feed returned an unsupported event.")
    details = event["details"]
    if event["event_type"] == "shipment.exception_reported":
        if (
            set(details) != {"exception_type"}
            or not isinstance(details["exception_type"], str)
            or details["exception_type"] not in EXCEPTION_TYPES
        ):
            raise CommandError("Driver shipment feed returned invalid exception details.")
    elif event["event_type"] == "delivery_fee.agreed":
        required_details = {
            "amount",
            "currency",
            "proposal_version",
            "buyer_accepted_at",
            "driver_accepted_at",
        }
        optional_details = {"driver_external_user_id"}
        if not required_details.issubset(details) or not set(details).issubset(
            required_details | optional_details
        ):
            raise CommandError("Driver shipment feed returned invalid fee agreement details.")
        if "driver_external_user_id" in details:
            driver_external_user_id = details["driver_external_user_id"]
            if (
                not isinstance(driver_external_user_id, str)
                or not driver_external_user_id.strip()
                or len(driver_external_user_id) > 64
            ):
                raise CommandError(
                    "Driver shipment feed returned an invalid driver identity."
                )
        if (
            not isinstance(details["amount"], str)
            or not isinstance(details["currency"], str)
            or details["currency"] != "ETB"
            or isinstance(details["proposal_version"], bool)
            or not isinstance(details["proposal_version"], int)
            or details["proposal_version"] <= 0
        ):
            raise CommandError("Driver shipment feed returned invalid fee agreement values.")
        try:
            amount = Decimal(details["amount"])
            accepted_times = [
                datetime.fromisoformat(
                    details[key].replace("Z", "+00:00")
                )
                for key in ("buyer_accepted_at", "driver_accepted_at")
            ]
        except (InvalidOperation, TypeError, ValueError) as error:
            raise CommandError("Driver shipment feed returned invalid fee agreement values.") from error
        if (
            not amount.is_finite()
            or amount <= 0
            or amount > Decimal("9999999999.99")
            or amount.as_tuple().exponent < -2
            or any(value.tzinfo is None for value in accepted_times)
            or any(
                value.astimezone(datetime_timezone.utc)
                > occurred_at.astimezone(datetime_timezone.utc)
                for value in accepted_times
            )
        ):
            raise CommandError("Driver shipment feed returned invalid fee agreement values.")
    elif event["event_type"] == "order.authorized":
        if (
            set(details) != {"from_status", "to_status"}
            or not isinstance(details["from_status"], str)
            or not isinstance(details["to_status"], str)
            or details["to_status"] != "fee_proposed"
        ):
            raise CommandError("Driver shipment feed returned invalid authorization details.")
    else:
        if set(details) != {"from_status", "to_status"}:
            raise CommandError("Driver shipment feed returned invalid status details.")
        if (
            not isinstance(details["from_status"], str)
            or not isinstance(details["to_status"], str)
            or details["from_status"] not in SHIPMENT_STATUSES
            or details["to_status"] not in SHIPMENT_STATUSES
        ):
            raise CommandError("Driver shipment feed returned an unknown shipment status.")


@transaction.atomic
def _apply_page(page, current_cursor):
    feed_cursor, _ = DriverShipmentEventCursor.objects.select_for_update().get_or_create(
        pk=1
    )
    if feed_cursor.cursor != current_cursor:
        raise CommandError("Shipment event cursor changed during polling; retry the poll.")
    newly_processed = 0
    for event in page["results"]:
        event_id = uuid.UUID(event["event_id"])
        digest = _event_digest(event)
        existing = DriverShipmentEventInbox.objects.filter(event_id=event_id).first()
        if existing:
            event_time = datetime.fromisoformat(
                event["occurred_at"].replace("Z", "+00:00")
            ).astimezone(datetime_timezone.utc)
            same_stored_event = (
                existing.cursor == event["cursor"]
                and existing.order_id == uuid.UUID(event["order_reference"])
                and existing.driver_shipment_id == event["shipment_id"]
                and existing.event_type == event["event_type"]
                and existing.occurred_at == event_time
                and existing.details == event["details"]
            )
            if not same_stored_event or (
                existing.payload_sha256 and existing.payload_sha256 != digest
            ):
                raise CommandError("Driver reused an event ID or cursor with changed data.")
            if not existing.payload_sha256:
                existing.payload_sha256 = digest
                existing.save(update_fields=["payload_sha256"])
            continue
        if event["cursor"] != feed_cursor.cursor + 1:
            raise CommandError("Driver shipment feed cursor gap requires reconciliation.")
        order = Order.objects.filter(pk=event["order_reference"]).first()
        if order is None:
            raise CommandError("Driver shipment event references an unknown marketplace order.")
        details = (
            OrderShipmentDetails.objects.select_for_update()
            .filter(order=order, authorized_at__isnull=False)
            .first()
        )
        if details is None:
            raise CommandError("Driver shipment event has no authorized marketplace details.")
        if details.driver_shipment_id not in (None, event["shipment_id"]):
            raise CommandError("Driver shipment ID conflicts with the existing order mapping.")
        if event["event_type"] == "delivery_fee.agreed":
            projected_status = details.driver_shipment_status
            if projected_status != "assigned":
                raise CommandError("Fee agreement arrived before driver assignment.")
            if MarketplaceDeliveryFeeAgreement.objects.filter(order=order).exists():
                raise CommandError("A fee agreement is already recorded for this order.")
            accepted_times = [
                datetime.fromisoformat(
                    event["details"][key].replace("Z", "+00:00")
                ).astimezone(datetime_timezone.utc)
                for key in ("buyer_accepted_at", "driver_accepted_at")
            ]
            driver_external_user_id = str(
                event["details"].get("driver_external_user_id", "")
            ).strip()
            driver_payee = None
            if driver_external_user_id:
                driver_payee = (
                    User.objects.filter(
                        pk=driver_external_user_id,
                        role=Role.DRIVER,
                        status=AccountStatus.APPROVED,
                    )
                    .first()
                )
                if driver_payee is None:
                    raise CommandError(
                        "Driver fee agreement references an unknown marketplace driver."
                    )
            MarketplaceDeliveryFeeAgreement.objects.create(
                order=order,
                source_event_id=event_id,
                driver_shipment_id=event["shipment_id"],
                driver_payee=driver_payee,
                driver_external_user_id=driver_external_user_id,
                driver_proposal_version=event["details"]["proposal_version"],
                amount=Decimal(event["details"]["amount"]),
                currency=event["details"]["currency"],
                buyer_accepted_at=accepted_times[0],
                driver_accepted_at=accepted_times[1],
            )
            AuditLog.objects.create(
                actor=None,
                action="driver_delivery_fee_agreement_recorded",
                target=str(order.pk),
                detail=(
                    f"Driver fee agreement event {event_id} recorded for "
                    f"{event['details']['amount']} ETB at proposal version "
                    f"{event['details']['proposal_version']}."
                    + (
                        f" Payee driver {driver_external_user_id}."
                        if driver_external_user_id
                        else " No canonical driver payee was supplied."
                    )
                ),
            )
        else:
            projected_status = (
                "fee_proposed"
                if event["event_type"] == "order.authorized"
                else event["details"].get("to_status", details.driver_shipment_status)
            )
        event_time = datetime.fromisoformat(
            event["occurred_at"].replace("Z", "+00:00")
        ).astimezone(datetime_timezone.utc)
        safe_details = dict(event["details"])
        DriverShipmentEventInbox.objects.create(
            event_id=event_id,
            cursor=event["cursor"],
            order=order,
            driver_shipment_id=event["shipment_id"],
            event_type=event["event_type"],
            occurred_at=event_time,
            details=safe_details,
            payload_sha256=digest,
        )
        details.driver_shipment_id = event["shipment_id"]
        if projected_status:
            details.driver_shipment_status = projected_status
        details.driver_last_event_at = event_time
        if projected_status in {"completed", "cancelled", "disputed"}:
            details.closed_at = details.closed_at or event_time
        details.save(
            update_fields=[
                "driver_shipment_id",
                "driver_shipment_status",
                "driver_last_event_at",
                "closed_at",
                "updated_at",
            ]
        )
        feed_cursor.cursor = event["cursor"]
        AuditLog.objects.create(
            actor=None,
            action="driver_shipment_event_processed",
            target=str(order.pk),
            detail=(
                f"Processed driver event {event_id} at cursor {event['cursor']} "
                f"({event['event_type']})."
            ),
        )
        newly_processed += 1
    if page["next_cursor"] > feed_cursor.cursor:
        feed_cursor.cursor = page["next_cursor"]
    feed_cursor.save(update_fields=["cursor", "updated_at"])
    return {
        "processed": newly_processed,
        "cursor": feed_cursor.cursor,
        "has_more": page["has_more"],
    }


def _event_digest(event):
    canonical = json.dumps(
        event, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()
