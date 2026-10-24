"""Driver profile endpoints backed by the canonical Marketplace account.

Names, phone numbers, and profile pictures are owned by the Marketplace. The
DriverApp mirrors only what it needs for session display and forwards every
write over the driver's server-side Marketplace credential.
"""

from django.http import HttpResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .marketplace_errors import marketplace_error_response
from .marketplace_client import (
    MarketplaceInvalid,
    MarketplaceUnauthenticated,
    MarketplaceUnavailable,
    marketplace_credential,
    marketplace_delete,
    marketplace_fetch_binary,
    marketplace_get,
    marketplace_patch,
    marketplace_upload,
)
from .models import DriverProfile, LogisticsUser
from .services import record_audit

MARKETPLACE_ME_PATH = "/api/v1/auth/me/"
MARKETPLACE_PROFILE_PATH = "/api/v1/auth/profile/"
MARKETPLACE_PHOTO_PATH = "/api/v1/auth/profile/photo/"

MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024
ALLOWED_PHOTO_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _require_driver(user):
    return user.role == LogisticsUser.Role.DRIVER


def _linked_profile(request):
    """Return the canonical Marketplace profile for this session."""
    token = marketplace_credential(request)
    if token is None:
        return None, None
    profile = marketplace_get(MARKETPLACE_ME_PATH, token)
    if not isinstance(profile, dict) or not isinstance(profile.get("user"), dict):
        raise MarketplaceUnavailable("The Marketplace returned an unreadable profile.")
    return token, profile["user"]


def _sync_local_profile(user, profile):
    """Refresh only the locally mirrored display fields."""
    full_name = (profile.get("full_name") or "").strip()
    if full_name:
        first_name, _, last_name = full_name.partition(" ")
        user.first_name = first_name[:150]
        user.last_name = last_name[:150]
        user.save(update_fields=["first_name", "last_name"])
    phone = (profile.get("phone") or "").strip()
    if phone:
        DriverProfile.objects.filter(user=user).update(phone_number=phone[:32])


class DriverProfileView(APIView):
    """Read or update the signed-in driver's canonical profile fields."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not _require_driver(request.user):
            return Response(
                {"detail": "Only driver accounts have a driver profile."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            _, profile = _linked_profile(request)
        except (MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        if profile is None:
            driver_profile = getattr(request.user, "driver_profile", None)
            application = getattr(driver_profile, "application", None)
            full_name = " ".join(
                part for part in (request.user.first_name, request.user.last_name) if part
            ).strip()
            return Response(
                {
                    "linked": False,
                    "profile": {
                        "full_name": full_name or request.user.username,
                        "email": request.user.email,
                        "phone": getattr(driver_profile, "phone_number", ""),
                        "location": "",
                        "profile_photo": None,
                        "status": "APPROVED" if request.user.is_active else "SUSPENDED",
                        "role": "DRIVER",
                        "approval": getattr(application, "status", ""),
                    },
                    "editable": {"full_name": False, "phone": False, "photo": False},
                    "detail": (
                        "Open DriverApp from your Marketplace driver account to manage "
                        "your canonical profile."
                    ),
                }
            )
        return Response(
            {
                "linked": True,
                "profile": profile,
                "editable": {"full_name": True, "phone": True, "photo": True},
                "detail": "",
            }
        )

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def patch(self, request):
        if not _require_driver(request.user):
            return Response(
                {"detail": "Only driver accounts have a driver profile."},
                status=status.HTTP_403_FORBIDDEN,
            )
        payload = {}
        full_name = (request.data.get("full_name") or "").strip()
        phone = (request.data.get("phone") or "").strip()
        if full_name:
            if len(full_name) > 255:
                return Response(
                    {"detail": "Full name must be 255 characters or fewer."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            payload["full_name"] = full_name
        if phone:
            if len(phone) > 32:
                return Response(
                    {"detail": "Phone number must be 32 characters or fewer."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            payload["phone"] = phone
        if not payload:
            return Response(
                {"detail": "Provide a full name or phone number to update."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        token = marketplace_credential(request)
        if token is None:
            return Response(
                {
                    "detail": (
                        "Open DriverApp from your Marketplace driver account before "
                        "editing your profile."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            result = marketplace_patch(MARKETPLACE_PROFILE_PATH, token, payload)
        except (MarketplaceInvalid, MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        profile = result.get("user") if isinstance(result, dict) else None
        if not isinstance(profile, dict):
            try:
                _, profile = _linked_profile(request)
            except (MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
                return marketplace_error_response(error)
        if isinstance(profile, dict):
            _sync_local_profile(request.user, profile)
        record_audit(
            request.user,
            "driver.profile_updated",
            "marketplace_user",
            request.user.pk,
            {"fields": sorted(payload)},
        )
        return Response({"success": True, "profile": profile})


class DriverProfilePhotoView(APIView):
    """Display, replace, or remove the driver's Marketplace profile picture."""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        if not _require_driver(request.user):
            return Response(
                {"detail": "Only driver accounts have a profile picture."},
                status=status.HTTP_403_FORBIDDEN,
            )
        token = marketplace_credential(request)
        if token is None:
            return Response(
                {"detail": "No Marketplace profile picture is linked."},
                status=status.HTTP_404_NOT_FOUND,
            )
        try:
            _, profile = _linked_profile(request)
            photo_url = (profile or {}).get("profile_photo") or ""
            content, content_type = marketplace_fetch_binary(photo_url, token)
        except MarketplaceUnauthenticated as error:
            return marketplace_error_response(error)
        except MarketplaceUnavailable:
            return Response(
                {"detail": "No profile picture is stored."},
                status=status.HTTP_404_NOT_FOUND,
            )
        response = HttpResponse(content, content_type=content_type)
        response["Cache-Control"] = "private, max-age=60"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def post(self, request):
        if not _require_driver(request.user):
            return Response(
                {"detail": "Only driver accounts have a profile picture."},
                status=status.HTTP_403_FORBIDDEN,
            )
        upload = request.FILES.get("profile_photo")
        if upload is None:
            return Response(
                {"detail": "Choose an image to upload."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if upload.size > MAX_PROFILE_PHOTO_BYTES:
            return Response(
                {"detail": "Profile images must be 5 MB or smaller."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        content_type = (upload.content_type or "").lower()
        if content_type not in ALLOWED_PHOTO_TYPES:
            return Response(
                {"detail": "Upload a JPEG, PNG, or WebP image."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        token = marketplace_credential(request)
        if token is None:
            return Response(
                {
                    "detail": (
                        "Open DriverApp from your Marketplace driver account before "
                        "changing your picture."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            result = marketplace_upload(
                MARKETPLACE_PHOTO_PATH,
                token,
                field_name="profile_photo",
                file_name=upload.name or "profile-photo",
                file_bytes=upload.read(),
                content_type=content_type,
            )
        except (MarketplaceInvalid, MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        profile = result.get("user") if isinstance(result, dict) else None
        record_audit(
            request.user,
            "driver.profile_photo_updated",
            "marketplace_user",
            request.user.pk,
            {"content_type": content_type, "size": upload.size},
        )
        return Response({"success": True, "profile": profile})

    def delete(self, request):
        if not _require_driver(request.user):
            return Response(
                {"detail": "Only driver accounts have a profile picture."},
                status=status.HTTP_403_FORBIDDEN,
            )
        token = marketplace_credential(request)
        if token is None:
            return Response(
                {"detail": "No Marketplace profile picture is linked."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            marketplace_delete(MARKETPLACE_PHOTO_PATH, token)
        except (MarketplaceInvalid, MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        record_audit(
            request.user,
            "driver.profile_photo_removed",
            "marketplace_user",
            request.user.pk,
            {},
        )
        return Response({"success": True, "profile": None})
