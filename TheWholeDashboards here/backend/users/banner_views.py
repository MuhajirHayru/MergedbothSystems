"""Part 23 — promotional banner management (Super Admin) and public delivery."""

import json

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import parsers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.audit import log_action
from users.models import Banner, WebsiteContent
from users.permissions import IsAuthenticatedRole, IsSuperAdmin
from users.models import Role


def _serialize_banner(banner: Banner, request=None) -> dict:
    image_url = None
    if banner.image:
        image_url = request.build_absolute_uri(banner.image.url) if request else banner.image.url
    return {
        "id": banner.pk,
        "title": banner.title,
        "description": banner.description,
        "image_url": image_url,
        "destination_url": banner.destination_url,
        "display_order": banner.display_order,
        "starts_at": banner.starts_at.isoformat() if banner.starts_at else None,
        "ends_at": banner.ends_at.isoformat() if banner.ends_at else None,
        "is_active": banner.is_active,
        "scheduled_now": banner.is_active and banner.currently_scheduled,
        "updated_at": banner.updated_at.isoformat(),
    }


class PublicBannerListView(APIView):
    """GET /api/v1/auth/banners/ — active, currently scheduled banners in order."""

    permission_classes = []

    def get(self, request):
        banners = [
            _serialize_banner(b, request)
            for b in Banner.objects.filter(is_active=True)
            if b.currently_scheduled
        ]
        return Response({"success": True, "banners": banners})


class BannerAdminView(APIView):
    """GET/POST /api/v1/superadmin/banners/ — full list + create (Part 23)."""

    permission_classes = [IsSuperAdmin]
    parser_classes = [parsers.JSONParser, parsers.FormParser, parsers.MultiPartParser]

    def get(self, request):
        banners = [
            _serialize_banner(b, request) for b in Banner.objects.all()
        ]
        return Response({"success": True, "banners": banners})

    def post(self, request):
        data = request.data
        try:
            with transaction.atomic():
                banner = Banner.objects.create(
                    title=(data.get("title") or "").strip()[:120],
                    description=(data.get("description") or "").strip(),
                    destination_url=(data.get("destination_url") or "").strip()[:500],
                    display_order=int(data.get("display_order") or 0),
                    starts_at=_parse_dt(data.get("starts_at")),
                    ends_at=_parse_dt(data.get("ends_at")),
                    is_active=str(data.get("is_active", "true")).lower() != "false",
                    image=request.FILES.get("image"),
                    created_by=request.user,
                    updated_by=request.user,
                )
                banner.full_clean(exclude=["image"])
        except ValidationError as exc:
            return Response(
                {"success": False, "error": exc.message_dict if hasattr(exc, "message_dict") else {"detail": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except (TypeError, ValueError):
            return Response(
                {"success": False, "error": {"display_order": "Display order must be a whole number."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        log_action(request, actor=request.user, action="banner_created", target=str(banner.pk), detail=banner.title)
        return Response({"success": True, "banner": _serialize_banner(banner, request)}, status=201)


class BannerDetailView(APIView):
    """PATCH/DELETE /api/v1/superadmin/banners/<id>/ — edit, deactivate, remove."""

    permission_classes = [IsSuperAdmin]
    parser_classes = [parsers.JSONParser, parsers.FormParser, parsers.MultiPartParser]

    def patch(self, request, pk):
        banner = Banner.objects.filter(pk=pk).first()
        if banner is None:
            return Response({"success": False, "error": "Banner not found."}, status=404)
        data = request.data
        try:
            with transaction.atomic():
                for field in ("title", "description", "destination_url"):
                    if field in data:
                        setattr(banner, field, (data.get(field) or "").strip()[:500] if field == "destination_url" else (data.get(field) or "").strip())
                if "display_order" in data:
                    banner.display_order = int(data["display_order"] or 0)
                if "starts_at" in data:
                    banner.starts_at = _parse_dt(data.get("starts_at"))
                if "ends_at" in data:
                    banner.ends_at = _parse_dt(data.get("ends_at"))
                if "is_active" in data:
                    banner.is_active = str(data.get("is_active")).lower() != "false"
                if request.FILES.get("image"):
                    banner.image = request.FILES["image"]
                banner.updated_by = request.user
                banner.full_clean(exclude=["image"])
                banner.save()
        except ValidationError as exc:
            return Response(
                {"success": False, "error": exc.message_dict if hasattr(exc, "message_dict") else {"detail": str(exc)}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except (TypeError, ValueError):
            return Response(
                {"success": False, "error": {"display_order": "Display order must be a whole number."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        log_action(request, actor=request.user, action="banner_updated", target=str(banner.pk), detail=banner.title)
        return Response({"success": True, "banner": _serialize_banner(banner, request)})

    def delete(self, request, pk):
        banner = Banner.objects.filter(pk=pk).first()
        if banner is None:
            return Response({"success": False, "error": "Banner not found."}, status=404)
        title = banner.title
        banner.delete()
        log_action(request, actor=request.user, action="banner_deleted", target=str(pk), detail=title)
        return Response({"success": True})


class BannerReorderView(APIView):
    """POST /api/v1/superadmin/banners/reorder/ { order: [id, id, ...] }."""

    permission_classes = [IsSuperAdmin]

    def post(self, request):
        order = request.data.get("order") or []
        if not isinstance(order, list):
            return Response({"success": False, "error": {"order": "Provide the banner id list in order."}}, status=400)
        with transaction.atomic():
            for index, banner_id in enumerate(order):
                Banner.objects.filter(pk=banner_id).update(display_order=index)
        log_action(request, actor=request.user, action="banner_reordered", detail=f"{len(order)} banners")
        return Response({"success": True})


def _parse_dt(value):
    if not value:
        return None
    from django.utils.dateparse import parse_datetime

    parsed = parse_datetime(str(value))
    if parsed is None:
        raise ValidationError({"starts_at": "Use ISO datetime (YYYY-MM-DDTHH:MM)."})
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed
