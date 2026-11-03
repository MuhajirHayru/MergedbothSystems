"""Part 20 — master audit center tests."""

import pytest

from users.audit import category_for
from users.models import AuditLog

pytestmark = pytest.mark.django_db


def test_audit_records_are_append_only(super_admin):
    entry = AuditLog.objects.create(actor=super_admin, action="x_test", detail="original")
    with pytest.raises(Exception):
        entry.detail = "tampered"
        entry.save()
    with pytest.raises(Exception):
        entry.delete()


def test_login_success_and_failure_are_audited(api, super_admin):
    # a failed attempt with a bogus account
    response = api.post(
        "/api/v1/auth/login/",
        {"email": "ghost@example.invalid", "password": "nope"},
        format="json",
    )
    assert response.status_code == 400
    failed = AuditLog.objects.filter(action="login_failed", success=False).order_by("-created_at").first()
    assert failed is not None
    assert "ghost@example.invalid" in failed.target

    # a successful attempt (password fixture per conftest make_user)
    from tests.conftest import make_user
    from users.models import AccountStatus, Role

    user = make_user(Role.WHOLESALER, "login-audit@test.et", "Login Audit")
    ok = api.post(
        "/api/v1/auth/login/",
        {"email": "login-audit@test.et", "password": "demo1234"},
        format="json",
    )
    assert ok.status_code == 200
    success = AuditLog.objects.filter(action="login_success", actor=user).order_by("-created_at").first()
    assert success is not None


def test_summary_buckets_and_totals(api, super_admin):
    from django.utils import timezone

    api.force_authenticate(user=super_admin)
    AuditLog.objects.create(actor=super_admin, action="escrow_released", detail="d")
    AuditLog.objects.create(actor=super_admin, action="login_failed", detail="d", success=False)
    response = api.get("/api/v1/superadmin/audit/summary/?days=30")
    assert response.status_code == 200
    body = response.data
    assert body["totals"]["total_activities"] >= 2
    assert body["totals"]["failed"] >= 1
    categories = {row["category"] for row in body["by_category"]}
    assert "Financial" in categories and "Security" in categories
    assert isinstance(body["trend"], list)


def test_summary_requires_privileged_role(api, farmer):
    api.force_authenticate(user=farmer)
    response = api.get("/api/v1/superadmin/audit/summary/")
    assert response.status_code == 403


def test_csv_export_contains_rows_and_is_audited(api, super_admin):
    api.force_authenticate(user=super_admin)
    AuditLog.objects.create(actor=super_admin, action="escrow_released", detail="export-check")
    response = api.get("/api/v1/superadmin/audit/export/?days=30")
    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    body = response.content.decode()
    assert "escrow_released" in body
    assert AuditLog.objects.filter(action="audit_export").exists()


def test_user_activity_view(api, super_admin, farmer):
    api.force_authenticate(user=super_admin)
    AuditLog.objects.create(actor=farmer, action="order_created", detail="user activity check")
    response = api.get(f"/api/v1/superadmin/audit/user-activity/{farmer.pk}/")
    assert response.status_code == 200
    body = response.data
    assert body["user"]["id"] == str(farmer.pk)
    assert body["totals"]["recorded_events"] >= 1
    assert any(e["action"] == "order_created" for e in body["entries"])


def test_category_mapping():
    assert category_for("login_failed") == "Security"
    assert category_for("ESCROW_RELEASE") == "Financial"
    assert category_for("DISCOUNT_CAMPAIGN_CREATED") == "Financial"
    assert category_for("order_accepted") == "Marketplace"
    assert category_for("something_unusual") == "System"
