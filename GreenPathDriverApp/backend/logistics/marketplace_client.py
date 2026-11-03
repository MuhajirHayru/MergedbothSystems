"""Server-side bridge to the GreenPath Marketplace API for the DriverApp.

The DriverApp never keeps a second ledger. Balances, fees, and payouts stay
authoritative in the Marketplace wallet, so the DriverApp only forwards the
driver's own Marketplace credential and renders what the Marketplace returns.
"""

import base64
import binascii
import json
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timezone as datetime_timezone

from django.conf import settings
from django.utils import timezone

SESSION_ACCESS_TOKEN_KEY = "marketplace_access_token"
SESSION_ACCESS_EXPIRES_KEY = "marketplace_access_expires_at"
SESSION_ACCESS_IDENTITY_KEY = "marketplace_access_user_id"

MARKETPLACE_WALLET_PATH = "/api/v1/wallet/"
MARKETPLACE_TRANSACTIONS_PATH = "/api/v1/wallet/transactions/"
MARKETPLACE_PAYOUTS_PATH = "/api/v1/wallet/payouts/"


class MarketplaceUnavailable(Exception):
    """The Marketplace could not be reached or answered with an error."""


class MarketplaceUnauthenticated(Exception):
    """The stored Marketplace credential is no longer accepted."""


class MarketplaceInvalid(Exception):
    """The Marketplace rejected the submitted values.

    Only raised for calls that ask for field feedback, so existing wallet calls
    keep their current error contract.
    """

    def __init__(self, message, errors=None):
        super().__init__(message)
        self.errors = errors or {}


def _decode_jwt_expiry(token):
    """Read the exp claim so the cached credential is not used past its lifetime.

    The token was already validated against the Marketplace when it was issued
    to this session, so this only bounds local reuse; it is never used to
    decide whether a request is allowed.
    """
    try:
        payload_segment = token.split(".")[1]
        padding = "=" * (-len(payload_segment) % 4)
        payload = json.loads(
            base64.urlsafe_b64decode(payload_segment + padding).decode("utf-8")
        )
    except (IndexError, ValueError, binascii.Error, UnicodeDecodeError):
        return None
    expires_at = payload.get("exp")
    if not isinstance(expires_at, (int, float)):
        return None
    return datetime.fromtimestamp(expires_at, tz=datetime_timezone.utc)


def store_marketplace_credential(request, token, canonical_user_id):
    """Cache the driver's Marketplace credential in the server-side session."""
    expires_at = _decode_jwt_expiry(token)
    request.session[SESSION_ACCESS_TOKEN_KEY] = token
    request.session[SESSION_ACCESS_IDENTITY_KEY] = str(canonical_user_id)
    request.session[SESSION_ACCESS_EXPIRES_KEY] = (
        expires_at.timestamp() if expires_at is not None else None
    )
    request.session.modified = True


def clear_marketplace_credential(request):
    for key in (
        SESSION_ACCESS_TOKEN_KEY,
        SESSION_ACCESS_EXPIRES_KEY,
        SESSION_ACCESS_IDENTITY_KEY,
    ):
        request.session.pop(key, None)
    request.session.modified = True


def _mint_marketplace_token_for_driver(request, user):
    try:
        identity = getattr(user, "marketplace_identity", None)
        if not identity or not identity.marketplace_user_id:
            return None
        base_url = marketplace_base_url()
        secret = getattr(settings, "MARKETPLACE_INTEGRATION_SECRET", "")
        if not base_url or not secret or len(secret) < 32:
            return None

        import hashlib
        import hmac
        import time
        import uuid

        path = "/api/v1/auth/driver-token/"
        payload_bytes = json.dumps({"marketplace_user_id": str(identity.marketplace_user_id)}).encode("utf-8")
        timestamp = str(int(time.time()))
        request_id = str(uuid.uuid4())
        canonical = b"\n".join([
            timestamp.encode("ascii"),
            request_id.encode("ascii"),
            b"POST",
            path.encode("ascii"),
            payload_bytes,
        ])
        signature = hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
        req = urllib.request.Request(
            f"{base_url}{path}",
            data=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-GP-Integration-Timestamp": timestamp,
                "X-GP-Integration-Request-ID": request_id,
                "X-GP-Integration-Signature": f"sha256={signature}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            access = data.get("access")
            if access:
                store_marketplace_credential(request, access, identity.marketplace_user_id)
                return access
    except Exception:
        pass
    return None


def marketplace_credential(request):
    """Return the cached credential when it is still usable, else auto-mint via HMAC for drivers."""
    token = request.session.get(SESSION_ACCESS_TOKEN_KEY)
    if token:
        expires_at = request.session.get(SESSION_ACCESS_EXPIRES_KEY)
        if expires_at is not None:
            try:
                if timezone.now().timestamp() < float(expires_at):
                    return token
            except (TypeError, ValueError):
                pass
        else:
            return token

    user = getattr(request, "user", None)
    if user and getattr(user, "is_authenticated", False):
        minted = _mint_marketplace_token_for_driver(request, user)
        if minted:
            return minted
    return None


def marketplace_credential_identity(request):
    """Return the canonical Marketplace user id cached for this session."""
    value = request.session.get(SESSION_ACCESS_IDENTITY_KEY)
    return str(value) if value else None


def marketplace_base_url():
    base_url = settings.GREENPATH_MARKETPLACE_API_BASE_URL.strip()
    return base_url.rstrip("/") if base_url else ""


def marketplace_get(path, token, *, timeout=10):
    """Perform an authenticated GET against the Marketplace API."""
    return _request("GET", path, token, timeout=timeout)


def marketplace_post(
    path, token, payload, *, timeout=10, headers=None, surface_validation=False
):
    """Perform an authenticated JSON POST against the Marketplace API."""
    return _request(
        "POST",
        path,
        token,
        payload=payload,
        timeout=timeout,
        headers=headers,
        surface_validation=surface_validation,
    )


def marketplace_patch(path, token, payload, *, headers=None, surface_validation=True):
    """Perform an authenticated JSON PATCH against the Marketplace API."""
    return _request(
        "PATCH",
        path,
        token,
        payload=payload,
        headers=headers,
        surface_validation=surface_validation,
    )


def marketplace_delete(path, token, *, headers=None, surface_validation=True):
    """Perform an authenticated DELETE against the Marketplace API."""
    return _request(
        "DELETE",
        path,
        token,
        headers=headers,
        surface_validation=surface_validation,
    )


def marketplace_upload(
    path,
    token,
    *,
    field_name,
    file_name,
    file_bytes,
    content_type,
    fields=None,
    timeout=25,
):
    """Upload one file plus optional scalar fields as multipart/form-data."""
    boundary = f"----GreenPathDriverApp{secrets.token_hex(16)}"
    body = bytearray()
    for key, value in (fields or {}).items():
        body.extend(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    body.extend(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field_name}"; '
            f'filename="{file_name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
    )
    body.extend(file_bytes)
    body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return _request(
        "POST",
        path,
        token,
        body=bytes(body),
        content_type=f"multipart/form-data; boundary={boundary}",
        timeout=timeout,
        surface_validation=True,
    )


def marketplace_fetch_binary(url, token, *, timeout=15):
    """Fetch an authorized Marketplace media URL and return (bytes, content type)."""
    if not url:
        raise MarketplaceUnavailable("No profile image is stored for this account.")
    if not url.lower().startswith(("http://", "https://")):
        base_url = marketplace_base_url()
        if not base_url:
            raise MarketplaceUnavailable("Marketplace access is not configured.")
        url = f"{base_url}{url if url.startswith('/') else '/' + url}"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "image/*",
            "Authorization": f"Bearer {token}",
            "User-Agent": "GreenPathDriverApp/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            content = response.read()
            content_type = response.headers.get_content_type() or "image/jpeg"
            return content, content_type
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise MarketplaceUnauthenticated(
                "Your Marketplace access has expired. Re-open DriverApp from your "
                "Marketplace driver account to refresh it."
            ) from error
        raise MarketplaceUnavailable(
            "The profile image could not be loaded from the Marketplace."
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise MarketplaceUnavailable(
            "The Marketplace is temporarily unreachable. Please try again shortly."
        ) from error


def _validation_message(payload):
    """Turn a Marketplace error body into one readable sentence."""
    if isinstance(payload, str) and payload.strip():
        return payload.strip()
    if not isinstance(payload, dict):
        return "The Marketplace rejected the request."
    for key in ("detail", "error", "message", "non_field_errors"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, str) and first.strip():
                return first.strip()
    for value in payload.values():
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, str) and first.strip():
                return first.strip()
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "The Marketplace rejected the request."


def _request(
    method,
    path,
    token,
    *,
    payload=None,
    body=None,
    content_type=None,
    timeout=10,
    headers=None,
    surface_validation=False,
):
    base_url = marketplace_base_url()
    if not base_url:
        raise MarketplaceUnavailable("Marketplace access is not configured.")
    data = None
    request_headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "GreenPathDriverApp/1.0",
    }
    if headers:
        request_headers.update(headers)
    if body is not None:
        data = body
        if content_type:
            request_headers["Content-Type"] = content_type
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise MarketplaceUnauthenticated(
                "Your Marketplace access has expired. Re-open DriverApp from your "
                "Marketplace driver account to refresh it."
            ) from error
        if surface_validation and error.code == 400:
            try:
                body = json.loads(error.read().decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                body = {}
            raise MarketplaceInvalid(
                _validation_message(body),
                body if isinstance(body, dict) else {},
            ) from error
        raise MarketplaceUnavailable(
            "The Marketplace could not complete the request. Please try again shortly."
        ) from error
    except (urllib.error.URLError, TimeoutError, UnicodeDecodeError) as error:
        raise MarketplaceUnavailable(
            "The Marketplace is temporarily unreachable. Please try again shortly."
        ) from error
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise MarketplaceUnavailable("The Marketplace returned an unreadable response.") from error
