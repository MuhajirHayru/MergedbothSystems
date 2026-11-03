"""Part 23 — banner management tests."""

import pytest
from django.utils import timezone
from datetime import timedelta

from users.models import AuditLog, Banner

pytestmark = pytest.django_db if False else pytest.mark.django_db


def test_banner_crud_and_public_visibility(api, super_admin):
    api.force_authenticate(user=super_admin)
    created = api.post(
        "/api/v1/superadmin/banners/",
        {"title": "Harvest Promo", "description": "20% off", "display_order": 1},
        format="json",
    )
    assert created.status_code == 201, created.data
    banner_id = created.data["banner"]["id"]

    public = api.get("/api/v1/auth/banners/")
    assert public.status_code == 200
    assert [b["title"] for b in public.data["banners"]] == ["Harvest Promo"]

    hidden = api.patch(
        f"/api/v1/superadmin/banners/{banner_id}/", {"is_active": "false"}, format="json"
    )
    assert hidden.status_code == 200
    assert api.get("/api/v1/auth/banners/").data["banners"] == []

    deleted = api.delete(f"/api/v1/superadmin/banners/{banner_id}/")
    assert deleted.status_code == 200
    assert not Banner.objects.filter(pk=banner_id).exists()
    assert AuditLog.objects.filter(action="banner_created").exists()
    assert AuditLog.objects.filter(action="banner_deleted").exists()


def test_scheduling_window_controls_public_visibility(api, super_admin):
    api.force_authenticate(user=super_admin)
    future = api.post(
        "/api/v1/superadmin/banners/",
        {"title": "Scheduled", "starts_at": (timezone.now() + timedelta(days=2)).isoformat()},
        format="json",
    )
    assert future.status_code == 201
    assert future.data["banner"]["scheduled_now"] is False
    assert api.get("/api/v1/auth/banners/").data["banners"] == []


def test_invalid_window_rejected(api, super_admin):
    api.force_authenticate(user=super_admin)
    bad = api.post(
        "/api/v1/superadmin/banners/",
        {"title": "Bad", "starts_at": timezone.now().isoformat(),
         "ends_at": (timezone.now() - timedelta(days=1)).isoformat()},
        format="json",
    )
    assert bad.status_code == 400


def test_public_list_needs_no_auth(api):
    assert api.get("/api/v1/auth/banners/").status_code == 200


def test_non_admin_cannot_manage(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/superadmin/banners/").status_code == 403
    assert api.post("/api/v1/superadmin/banners/", {"title": "x"}, format="json").status_code == 403
