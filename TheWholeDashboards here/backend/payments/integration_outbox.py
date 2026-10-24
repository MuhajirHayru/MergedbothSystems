import hashlib
import hmac
import time
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from users.models import AuditLog

from .models import MarketplaceIntegrationOutbox

EVENT_PATH = "/api/integrations/v2/events/"
MAX_ATTEMPTS = 8
REQUEST_TIMEOUT_SECONDS = 10
CLAIM_LEASE = timedelta(minutes=5)


def deliver_pending_events(limit=50):
    _validate_configuration()
    delivered = 0
    for _ in range(limit):
        event = _claim_next_event()
        if event is None:
            break
        status_code, error_code = _send_event(event)
        _record_attempt(event.pk, status_code, error_code)
        if status_code is not None and 200 <= status_code < 300:
            delivered += 1
    return delivered


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


def _claim_next_event():
    now = timezone.now()
    prior_undelivered = MarketplaceIntegrationOutbox.objects.filter(
        order_id=OuterRef("order_id"),
        revision__lt=OuterRef("revision"),
    ).exclude(status=MarketplaceIntegrationOutbox.Status.DELIVERED)
    prior_blocked = MarketplaceIntegrationOutbox.objects.filter(
        order_id=OuterRef("order_id"),
        revision__lt=OuterRef("revision"),
        status=MarketplaceIntegrationOutbox.Status.BLOCKED,
    )
    retryable = Q(
        status=MarketplaceIntegrationOutbox.Status.PENDING,
        available_at__lte=now,
    ) | Q(
        status=MarketplaceIntegrationOutbox.Status.SENDING,
        claimed_at__lte=now - CLAIM_LEASE,
    )
    with transaction.atomic():
        exhausted_count = MarketplaceIntegrationOutbox.objects.filter(
            retryable,
            attempts__gte=MAX_ATTEMPTS,
        ).update(
            status=MarketplaceIntegrationOutbox.Status.BLOCKED,
            last_error_code="attempt_limit",
        )
        if exhausted_count:
            AuditLog.objects.create(
                actor=None,
                action="driver_integration_outbox_blocked",
                target="",
                detail=f"{exhausted_count} event(s) blocked after bounded retries.",
            )
        newly_blocked = (
            MarketplaceIntegrationOutbox.objects.filter(
                status=MarketplaceIntegrationOutbox.Status.PENDING
            )
            .annotate(has_blocked_predecessor=Exists(prior_blocked))
            .filter(has_blocked_predecessor=True)
            .update(
                status=MarketplaceIntegrationOutbox.Status.BLOCKED,
                last_error_code="prior_event_blocked",
            )
        )
        if newly_blocked:
            AuditLog.objects.create(
                actor=None,
                action="driver_integration_outbox_blocked",
                target="",
                detail=(
                    f"{newly_blocked} event(s) blocked because an earlier "
                    "event for the same order is blocked."
                ),
            )
        rows = MarketplaceIntegrationOutbox.objects.select_for_update(
            skip_locked=connection.features.has_select_for_update_skip_locked
        ).filter(retryable, attempts__lt=MAX_ATTEMPTS).annotate(
            has_prior_undelivered=Exists(prior_undelivered)
        ).filter(
            has_prior_undelivered=False
        ).order_by("created_at", "pk")
        event = rows.first()
        if event is None:
            return None
        event.status = MarketplaceIntegrationOutbox.Status.SENDING
        event.attempts += 1
        event.claimed_at = now
        event.save(update_fields=["status", "attempts", "claimed_at"])
        return event


def _send_event(event):
    body = event.payload.encode("utf-8")
    timestamp = str(int(time.time()))
    request_id = str(event.event_id)
    canonical = b"\n".join(
        (
            timestamp.encode("ascii"),
            request_id.encode("ascii"),
            b"POST",
            EVENT_PATH.encode("ascii"),
            body,
        )
    )
    signature = hmac.new(
        settings.GREENPATH_DRIVER_INTEGRATION_SECRET.encode("utf-8"),
        canonical,
        hashlib.sha256,
    ).hexdigest()
    request = Request(
        f"{settings.GREENPATH_DRIVER_INTEGRATION_BASE_URL}{EVENT_PATH}",
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
            return response.status, ""
    except HTTPError as error:
        return error.code, f"http_{error.code}"
    except (URLError, TimeoutError):
        return None, "network_error"


def _record_attempt(event_id, status_code, error_code):
    now = timezone.now()
    with transaction.atomic():
        event = MarketplaceIntegrationOutbox.objects.select_for_update().get(
            pk=event_id
        )
        event.last_status_code = status_code
        event.last_error_code = error_code
        event.claimed_at = None
        if status_code is not None and 200 <= status_code < 300:
            event.status = MarketplaceIntegrationOutbox.Status.DELIVERED
            event.delivered_at = now
            event.available_at = now
            action = "driver_integration_event_delivered"
        elif status_code is not None and status_code < 500 and status_code != 429:
            event.status = MarketplaceIntegrationOutbox.Status.BLOCKED
            action = "driver_integration_event_blocked"
        elif event.attempts >= MAX_ATTEMPTS:
            event.status = MarketplaceIntegrationOutbox.Status.BLOCKED
            event.last_error_code = error_code or "attempt_limit"
            action = "driver_integration_event_blocked"
        else:
            event.status = MarketplaceIntegrationOutbox.Status.PENDING
            delay_seconds = min(900, 5 * (2 ** (event.attempts - 1)))
            event.available_at = now + timedelta(seconds=delay_seconds)
            action = "driver_integration_event_retry_scheduled"
        event.save(
            update_fields=[
                "status",
                "last_status_code",
                "last_error_code",
                "claimed_at",
                "delivered_at",
                "available_at",
            ]
        )
        AuditLog.objects.create(
            actor=None,
            action=action,
            target=str(event.event_id),
            detail=(
                f"Integration event attempt {event.attempts}; "
                f"HTTP status {status_code or 'unavailable'}; "
                f"result {event.last_error_code or 'accepted'}."
            ),
        )
