import hashlib
import hmac
import re
import time

from django.conf import settings
from rest_framework.exceptions import APIException, ParseError

from .services import record_audit


class IntegrationUnavailable(APIException):
    status_code = 503
    default_detail = "Marketplace integration is not enabled."
    default_code = "marketplace_integration_unavailable"


class IntegrationAuthenticationFailed(APIException):
    status_code = 401
    default_detail = "Marketplace integration authentication failed."
    default_code = "marketplace_integration_authentication_failed"


def signed_request_body(request):
    if (
        not settings.MARKETPLACE_INTEGRATION_ENABLED
        or len(settings.MARKETPLACE_INTEGRATION_SECRET) < 32
    ):
        raise IntegrationUnavailable()

    raw_body = request.body
    if len(raw_body) > settings.MARKETPLACE_INTEGRATION_MAX_BYTES:
        record_audit(
            None,
            "marketplace.integration_request_rejected",
            "marketplace_integration",
            "",
            {"reason": "body_too_large"},
        )
        raise ParseError("Integration request exceeds the configured size limit.")

    timestamp = request.headers.get("X-GP-Integration-Timestamp", "")
    request_id = request.headers.get("X-GP-Integration-Request-ID", "")
    signature = request.headers.get("X-GP-Integration-Signature", "")
    if (
        not timestamp.isascii()
        or not timestamp.isdecimal()
        or len(timestamp) > 12
        or not request_id
        or len(request_id) > 128
        or not re.fullmatch(r"sha256=[0-9a-f]{64}", signature)
    ):
        _record_auth_failure("malformed_auth_headers")
        raise IntegrationAuthenticationFailed(
            "Valid marketplace integration headers are required."
        )

    if abs(time.time() - int(timestamp)) > settings.MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS:
        _record_auth_failure("timestamp_out_of_window")
        raise IntegrationAuthenticationFailed(
            "Marketplace integration timestamp is outside the allowed window."
        )

    signed_path = request.get_full_path().encode("utf-8")
    canonical = b"\n".join(
        (
            timestamp.encode("ascii"),
            request_id.encode("utf-8"),
            request.method.upper().encode("ascii"),
            signed_path,
            raw_body,
        )
    )
    expected = hmac.new(
        settings.MARKETPLACE_INTEGRATION_SECRET.encode("utf-8"),
        canonical,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature[7:], expected):
        _record_auth_failure("invalid_signature")
        raise IntegrationAuthenticationFailed(
            "Marketplace integration signature is invalid."
        )
    return raw_body, request_id


def _record_auth_failure(reason):
    record_audit(
        None,
        "marketplace.integration_auth_rejected",
        "marketplace_integration",
        "",
        {"reason": reason},
    )
