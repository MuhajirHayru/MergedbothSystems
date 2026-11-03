import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import UUID

from django.conf import settings
from django.contrib.auth import login
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .marketplace_client import (
    marketplace_base_url,
    marketplace_credential_identity,
    store_marketplace_credential,
)
from .models import LogisticsUser, MarketplaceDriverIdentity
from .services import record_audit


class MarketplaceSessionSerializer(serializers.Serializer):
    marketplace_access_token = serializers.CharField(
        max_length=8192, trim_whitespace=True, required=False
    )


def _resolve_marketplace_access_token(request, serializer):
    """Accept the driver credential from the request body or a bearer header.

    The Marketplace browser page sends the credential as a bearer token, while
    the token refresh call sends it in the JSON body. Both are accepted so a
    rotated credential never needs a second code path.
    """
    token = serializer.validated_data.get("marketplace_access_token")
    if token:
        return token
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip() or None
    return None


def _missing_marketplace_token_response():
    return Response(
        {"marketplace_access_token": ["This field is required."]},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _is_safe_marketplace_url(base_url):
    parsed = urlsplit(base_url)
    return bool(
        parsed.scheme == "https"
        or parsed.scheme == "http"
        and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ) and bool(parsed.netloc)


class MarketplaceDriverSessionExchangeView(APIView):
    """Exchange a Marketplace bearer token for a DriverApp browser session."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        origin = request.headers.get("Origin", "")
        if origin not in settings.MARKETPLACE_LOGIN_ALLOWED_ORIGINS:
            return Response(
                {"detail": "Marketplace sign-in origin is not allowed."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = MarketplaceSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        access_token = _resolve_marketplace_access_token(request, serializer)
        if not access_token:
            return _missing_marketplace_token_response()
        base_url = settings.GREENPATH_MARKETPLACE_API_BASE_URL
        if not base_url or not _is_safe_marketplace_url(base_url):
            return Response(
                {"detail": "Marketplace identity verification is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        identity_request = Request(
            f"{base_url}/api/v1/auth/me/",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
            method="GET",
        )
        try:
            with urlopen(identity_request, timeout=5) as upstream:
                identity_payload = json.loads(upstream.read(65536).decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
            return Response(
                {"detail": "Marketplace identity could not be verified."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not isinstance(identity_payload, dict):
            return Response(
                {"detail": "Marketplace identity could not be verified."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        canonical_user = identity_payload.get("user", {})
        if not isinstance(canonical_user, dict):
            canonical_user = {}
        if (
            canonical_user.get("role") != "DRIVER"
            or canonical_user.get("status") != "APPROVED"
        ):
            return Response(
                {"detail": "An approved Marketplace driver account is required."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            canonical_user_id = UUID(str(canonical_user["id"]))
        except (KeyError, TypeError, ValueError):
            return Response(
                {"detail": "Marketplace identity could not be verified."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        identity = MarketplaceDriverIdentity.objects.select_related("user").filter(
            marketplace_user_id=canonical_user_id,
            account_status="APPROVED",
            account_active=True,
            application_status="approved",
            documents_verified=True,
            driver_authorized=True,
            license_expiry__gt=timezone.localdate(),
        ).first()
        if identity is None or not identity.user.is_active or identity.user.role != LogisticsUser.Role.DRIVER:
            return Response(
                {"detail": "Marketplace driver authorization has not synchronized."},
                status=status.HTTP_403_FORBIDDEN,
            )

        login(request, identity.user, backend="django.contrib.auth.backends.ModelBackend")
        request.session.cycle_key()
        store_marketplace_credential(
            request,
            access_token,
            canonical_user_id,
        )
        record_audit(
            identity.user,
            "auth.marketplace_session_established",
            "marketplace_driver_identity",
            identity.pk,
            {"canonical_user_id": str(canonical_user_id), "revision": identity.revision},
        )
        return Response(
            {"authenticated": True, "role": "driver", "user_id": str(identity.user_id)},
            status=status.HTTP_200_OK,
        )


class MarketplaceDriverTokenRefreshView(APIView):
    """Refresh the cached Marketplace credential without ending the DriverApp session.

    The Marketplace rotates its short-lived access token in the browser. The
    DriverApp mirrors that credential server-side so the driver can keep using
    the wallet view without re-authenticating the whole app.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        origin = request.headers.get("Origin", "")
        if origin and origin not in settings.MARKETPLACE_LOGIN_ALLOWED_ORIGINS:
            return Response(
                {"detail": "Marketplace sign-in origin is not allowed."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = MarketplaceSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token = _resolve_marketplace_access_token(request, serializer)
        if not token:
            return _missing_marketplace_token_response()
        canonical_user_id = marketplace_credential_identity(request)
        if canonical_user_id is None:
            return Response(
                {"detail": "This session is not linked to a Marketplace account."},
                status=status.HTTP_403_FORBIDDEN,
            )
        base_url = marketplace_base_url()
        if not base_url or not _is_safe_marketplace_url(base_url):
            return Response(
                {"detail": "Marketplace identity verification is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        identity_request = Request(
            f"{base_url}/api/v1/auth/me/",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {token}",
            },
            method="GET",
        )
        try:
            with urlopen(identity_request, timeout=5) as upstream:
                identity_payload = json.loads(upstream.read(65536).decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
            return Response(
                {"detail": "Marketplace identity could not be verified."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        canonical_user = identity_payload.get("user", {}) if isinstance(identity_payload, dict) else {}
        if not isinstance(canonical_user, dict):
            canonical_user = {}
        try:
            presented_user_id = str(UUID(str(canonical_user["id"])))
        except (KeyError, TypeError, ValueError):
            return Response(
                {"detail": "Marketplace identity could not be verified."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if presented_user_id != canonical_user_id:
            return Response(
                {"detail": "This Marketplace account does not match the signed-in driver."},
                status=status.HTTP_403_FORBIDDEN,
            )
        store_marketplace_credential(request, token, presented_user_id)
        record_audit(
            request.user,
            "auth.marketplace_credential_refreshed",
            "marketplace_driver_identity",
            request.user.pk,
            {"canonical_user_id": presented_user_id},
        )
        return Response({"refreshed": True}, status=status.HTTP_200_OK)
