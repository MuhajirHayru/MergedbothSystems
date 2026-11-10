"""Tests for System Administration: announcement lifecycle + oversight pagination."""

import pytest
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from notifications.models import Announcement, Notification
from payments.models import Order, Wallet
from users.models import AccountStatus, AuditLog, Role

from tests.conftest import make_user

BROADCAST_URL = "/api/v1/superadmin/broadcast/"
HISTORY_URL = "/api/v1/superadmin/broadcasts/"
ORDERS_URL = "/api/v1/superadmin/orders-oversight/"
WALLETS_URL = "/api/v1/superadmin/wallets-oversight/"


@pytest.fixture
def sa_api(db, super_admin):
    client = APIClient()
    client.force_authenticate(user=super_admin)
    return client


# ------------------------------------------------------------ broadcast send

@pytest.mark.django_db
def test_broadcast_creates_announcement_notifications_and_audit(sa_api, super_admin, farmer, wholesaler):
    res = sa_api.post(BROADCAST_URL, {"message": "Scheduled maintenance tonight."}, format="json")
    assert res.status_code == 201
    # farmer + wholesaler + the super admin themself are all approved users.
    assert res.data["recipients"] == 3
    assert res.data["sent_to"] == 3
    assert res.data["expires_at"] is None

    announcement = Announcement.objects.get(pk=res.data["announcement_id"])
    assert announcement.message == "Scheduled maintenance tonight."
    assert announcement.recipient_count == 3
    assert announcement.ended_at is None
    # Every active approved user got a linked notification.
    assert Notification.objects.filter(announcement=announcement).count() == 3
    assert Notification.objects.filter(announcement=announcement, recipient=farmer).exists()
    # Accountability row recorded.
    assert AuditLog.objects.filter(
        actor=super_admin, action="announcement_broadcast"
    ).count() == 1


@pytest.mark.django_db
def test_broadcast_expires_hours_validation(sa_api, super_admin):
    res = sa_api.post(BROADCAST_URL, {"message": "x", "expires_hours": "abc"}, format="json")
    assert res.status_code == 400
    res = sa_api.post(BROADCAST_URL, {"message": "x", "expires_hours": 0}, format="json")
    assert res.status_code == 400
    res = sa_api.post(BROADCAST_URL, {"message": "x", "expires_hours": 721}, format="json")
    assert res.status_code == 400

    res = sa_api.post(BROADCAST_URL, {"message": "One day only", "expires_hours": 24}, format="json")
    assert res.status_code == 201
    a = Announcement.objects.get(pk=res.data["announcement_id"])
    expected = timezone.now() + timedelta(hours=24)
    assert abs((a.expires_at - expected).total_seconds()) < 60


@pytest.mark.django_db
def test_broadcast_requires_message_and_permission(api, sa_api):
    res = sa_api.post(BROADCAST_URL, {"message": "  "}, format="json")
    assert res.status_code == 400
    farmer = make_user(Role.FARMER, "no.broadcast@test.et")
    api.force_authenticate(user=farmer)
    assert api.post(BROADCAST_URL, {"message": "hi"}, format="json").status_code == 403


# --------------------------------------------------------- broadcast history

@pytest.mark.django_db
def test_history_lists_broadcasts_with_date_and_status_filters(sa_api, super_admin):
    sa_api.post(BROADCAST_URL, {"message": "Alpha"}, format="json")
    sa_api.post(BROADCAST_URL, {"message": "Beta", "expires_hours": 1}, format="json")

    res = sa_api.get(HISTORY_URL).json()
    assert res["summary"]["total"] == 2
    assert res["broadcasts"][0]["message"] == "Beta"  # newest first

    res = sa_api.get(HISTORY_URL, {"status": "active"}).json()
    assert res["summary"]["total"] == 2

    # End the newest one, then filter.
    end_id = res["broadcasts"][0]["id"]
    sa_api.post(f"{HISTORY_URL}{end_id}/end/")
    res = sa_api.get(HISTORY_URL, {"status": "ended"}).json()
    assert res["summary"]["total"] == 1
    assert res["broadcasts"][0]["message"] == "Beta"

    # Date filter: tomorrow's window excludes everything.
    tomorrow = (timezone.now() + timedelta(days=1)).date().isoformat()
    res = sa_api.get(HISTORY_URL, {"from": tomorrow}).json()
    assert res["summary"]["total"] == 0


@pytest.mark.django_db
def test_end_broadcast_removes_notifications_but_keeps_history(sa_api, super_admin, farmer):
    res = sa_api.post(BROADCAST_URL, {"message": "Cleanup me"}, format="json")
    aid = res.data["announcement_id"]
    assert Notification.objects.filter(announcement_id=aid).count() >= 1

    end = sa_api.post(f"{HISTORY_URL}{aid}/end/")
    assert end.status_code == 200
    assert end.data["removed_notifications"] >= 1
    # Inboxes cleared...
    assert Notification.objects.filter(announcement_id=aid).count() == 0
    # ...history retained with ended stamp + audit row.
    a = Announcement.objects.get(pk=aid)
    assert a.ended_at is not None
    assert AuditLog.objects.filter(action="announcement_ended").count() == 1

    # Ending again is idempotent.
    again = sa_api.post(f"{HISTORY_URL}{aid}/end/")
    assert again.data["already_ended"] is True


@pytest.mark.django_db
def test_expired_announcement_is_swept_on_history_read(sa_api, super_admin, farmer):
    res = sa_api.post(BROADCAST_URL, {"message": "Self-expiring"}, format="json")
    aid = res.data["announcement_id"]
    Announcement.objects.filter(pk=aid).update(
        expires_at=timezone.now() - timedelta(minutes=5)
    )
    assert Notification.objects.filter(announcement_id=aid).count() >= 1

    res = sa_api.get(HISTORY_URL).json()
    row = next(b for b in res["broadcasts"] if b["id"] == aid)
    assert row["status"] == "ended"
    assert Notification.objects.filter(announcement_id=aid).count() == 0


# ------------------------------------------------------- oversight pagination

@pytest.mark.django_db
def test_orders_oversight_pagination(sa_api, wholesaler, farmer_product, farmer):
    for i in range(7):
        Order.objects.create(
            reference=f"#ORD-PG-{i}", wholesaler=wholesaler,
            farmer=farmer_product.owner, product=farmer_product,
            quantity=1, total_amount=10 + i, status="Processing",
        )
    res = sa_api.get(ORDERS_URL, {"page": 1, "page_size": 3}).json()
    assert res["summary"]["total"] == 7
    assert len(res["orders"]) == 3
    assert res["summary"]["has_next"] is True

    res = sa_api.get(ORDERS_URL, {"page": 3, "page_size": 3}).json()
    assert len(res["orders"]) == 1
    assert res["summary"]["has_next"] is False


@pytest.mark.django_db
def test_wallets_oversight_search_role_and_pagination(sa_api, wholesaler, farmer):
    Wallet.objects.create(user=farmer, available_balance="11.50")
    res = sa_api.get(WALLETS_URL, {"search": "Meles"}).json()
    assert res["summary"]["total_wallets"] == 1
    assert res["wallets"][0]["email"] == "wholesaler@test.et"

    res = sa_api.get(WALLETS_URL, {"role": "FARMER"}).json()
    assert res["summary"]["total_wallets"] == 1
    assert res["wallets"][0]["user"] == "Abebe Farmer"

    resp = sa_api.get(WALLETS_URL, {"role": "NOT_A_ROLE"})
    assert resp.status_code == 400

    res = sa_api.get(WALLETS_URL, {"page_size": 1, "page": 2}).json()
    assert len(res["wallets"]) == 1
    assert res["summary"]["has_next"] is False
