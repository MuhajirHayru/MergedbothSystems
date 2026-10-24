import hashlib
import hmac
import json
import time
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import connection, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from .models import DriverAuthorizationOutbox, DriverIntegrationLink

EVENT_PATH = "/api/integrations/v2/events/"
REQUEST_TIMEOUT_SECONDS = 10
MAX_ATTEMPTS = 8


def _endpoint():
    base = (settings.GREENPATH_DRIVER_INTEGRATION_BASE_URL or "").rstrip("/")
    if not base or not settings.GREENPATH_DRIVER_INTEGRATION_SECRET:
        return None
    parsed = urlsplit(base)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        return None
    if parsed.scheme != "https" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        return None
    return base + EVENT_PATH


def _claim_one():
    now = timezone.now()
    with transaction.atomic():
        DriverAuthorizationOutbox.objects.filter(
            status=DriverAuthorizationOutbox.Status.SENDING,
            claimed_at__lt=now - timedelta(minutes=5),
        ).update(status=DriverAuthorizationOutbox.Status.PENDING, claimed_at=None)
        prior = DriverAuthorizationOutbox.objects.filter(
            link_id=OuterRef("link_id"), revision__lt=OuterRef("revision")
        ).exclude(status=DriverAuthorizationOutbox.Status.DELIVERED)
        event = (
            DriverAuthorizationOutbox.objects.select_for_update(
                skip_locked=connection.features.has_select_for_update_skip_locked
            )
            .filter(
                Q(status=DriverAuthorizationOutbox.Status.PENDING)
                & Q(available_at__lte=now)
                & Q(attempts__lt=MAX_ATTEMPTS)
            )
            .annotate(has_prior_undelivered=Exists(prior))
            .filter(has_prior_undelivered=False)
            .order_by("created_at", "pk")
            .first()
        )
        if event is None:
            return None
        event.status = DriverAuthorizationOutbox.Status.SENDING
        event.attempts += 1
        event.claimed_at = now
        event.save(update_fields=["status", "attempts", "claimed_at"])
        return event


def _send(event, endpoint):
    payload = event.payload
    # Older durable rows stored the v2 authorization fields at the envelope
    # level. Normalize them on send so pending events remain safely retryable.
    if (
        payload.get("event_type") == "driver.authorization_snapshot"
        and "driver_authorization" not in payload
    ):
        authorization_fields = {
            "account_status",
            "account_active",
            "application_status",
            "driver_authorized",
            "documents_verified",
            "license_expiry",
            "legal_full_name",
            "phone",
            "service_region",
            "service_zone",
            "service_wereda",
            "service_kebele",
            "license_number",
            "vehicle_type",
            "vehicle_registration",
            "cargo_capacity_kg",
        }
        payload = {
            key: value for key, value in payload.items() if key not in authorization_fields
        }
        payload["driver_authorization"] = {
            key: value for key, value in event.payload.items() if key in authorization_fields
        }
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = str(int(time.time()))
    request_id = str(event.event_id)
    canonical = b"\n".join(
        (timestamp.encode("ascii"), request_id.encode("ascii"), b"POST", EVENT_PATH.encode("ascii"), body)
    )
    signature = hmac.new(
        settings.GREENPATH_DRIVER_INTEGRATION_SECRET.encode("utf-8"),
        canonical,
        hashlib.sha256,
    ).hexdigest()
    request = Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-GP-Integration-Timestamp": timestamp,
            "X-GP-Integration-Request-ID": request_id,
            "X-GP-Integration-Signature": f"sha256={signature}",
        },
    )
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return response.status, response.read(65536), ""
    except HTTPError as error:
        return error.code, b"", f"http_{error.code}"
    except (URLError, TimeoutError):
        return None, b"", "network_error"


def _record(event_id, status_code, response_body, error_code):
    now = timezone.now()
    with transaction.atomic():
        event = DriverAuthorizationOutbox.objects.select_for_update().select_related("link").get(pk=event_id)
        link = DriverIntegrationLink.objects.select_for_update().get(pk=event.link_id)
        if status_code is not None and 200 <= status_code < 300:
            try:
                response = json.loads(response_body.decode("utf-8")) if response_body else {}
            except (UnicodeDecodeError, json.JSONDecodeError):
                response = {}
            event.status = DriverAuthorizationOutbox.Status.DELIVERED
            event.delivered_at = now
            link.sync_status = DriverIntegrationLink.SyncStatus.IN_SYNC
            link.last_synced_at = now
            link.last_error_code = ""
            local_user_id = response.get("driver_app_user_id")
            profile_id = response.get("driver_app_profile_id")
            if local_user_id:
                link.driver_app_user_id = str(local_user_id)
            if profile_id:
                link.driver_app_profile_id = str(profile_id)
        elif status_code is not None and status_code < 500 and status_code != 429:
            event.status = DriverAuthorizationOutbox.Status.BLOCKED
            event.last_error_code = error_code or "receiver_rejected"
            link.sync_status = DriverIntegrationLink.SyncStatus.FAILED
            link.last_error_code = event.last_error_code
        elif event.attempts >= MAX_ATTEMPTS:
            event.status = DriverAuthorizationOutbox.Status.BLOCKED
            event.last_error_code = error_code or "attempt_limit"
            link.sync_status = DriverIntegrationLink.SyncStatus.FAILED
            link.last_error_code = event.last_error_code
        else:
            event.status = DriverAuthorizationOutbox.Status.PENDING
            event.available_at = now + timedelta(seconds=min(900, 5 * (2 ** (event.attempts - 1))))
            event.last_error_code = error_code or "temporary_failure"
        event.last_status_code = status_code
        event.claimed_at = None
        event.save(update_fields=[
            "status", "available_at", "claimed_at", "delivered_at",
            "last_status_code", "last_error_code",
        ])
        link.save(update_fields=[
            "driver_app_user_id", "driver_app_profile_id", "sync_status",
            "last_synced_at", "last_error_code", "updated_at",
        ])


def deliver_driver_authorization_events(limit=50):
    endpoint = _endpoint()
    if endpoint is None:
        return {"delivered": 0, "blocked": 0, "remaining": DriverAuthorizationOutbox.objects.filter(status="pending").count(), "configured": False}
    delivered = blocked = processed = 0
    while processed < limit:
        event = _claim_one()
        if event is None:
            break
        status_code, response, error = _send(event, endpoint)
        _record(event.pk, status_code, response, error)
        processed += 1
        if status_code is not None and 200 <= status_code < 300:
            delivered += 1
        elif status_code is not None and status_code < 500 and status_code != 429:
            blocked += 1
    return {
        "delivered": delivered,
        "blocked": blocked,
        "remaining": DriverAuthorizationOutbox.objects.filter(status="pending").count(),
        "configured": True,
    }
