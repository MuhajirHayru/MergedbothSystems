"""Tests for messaging insights and the extended statistics accountability."""

import pytest
from datetime import timedelta

from chat.models import ChatChannel, Message, MessageKind, MessageModerationStatus
from django.utils import timezone
from rest_framework.test import APIClient
from users.models import Role

from tests.conftest import make_user

INSIGHTS_URL = "/api/v1/superadmin/messaging-insights/"
STATS_URL = "/api/v1/superadmin/statistics/"


@pytest.fixture
def sa_api(db, super_admin):
    client = APIClient()
    client.force_authenticate(user=super_admin)
    return client


@pytest.mark.django_db
def test_messaging_insights_requires_authentication(api):
    assert api.get(INSIGHTS_URL).status_code == 401


@pytest.mark.django_db
def test_messaging_insights_rejects_non_admin(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get(INSIGHTS_URL).status_code == 403


@pytest.mark.django_db
def test_messaging_insights_counts_are_accurate(sa_api, farmer, wholesaler):
    channel = ChatChannel.objects.create()
    channel.participants.add(farmer, wholesaler)
    now = timezone.now()
    Message.objects.create(channel=channel, sender=farmer, content="hello", kind=MessageKind.TEXT, sent_at=now)
    Message.objects.create(channel=channel, sender=wholesaler, content="hi", kind=MessageKind.TEXT, sent_at=now)
    Message.objects.create(channel=channel, sender=farmer, content="voice note", kind=MessageKind.VOICE, sent_at=now)
    # sent_at is auto_now_add; backdate via update to exercise the time windows.
    old = now - timedelta(days=10)
    Message.objects.create(channel=channel, sender=wholesaler, content="old", kind=MessageKind.TEXT)
    Message.objects.filter(content="old").update(sent_at=old)

    response = sa_api.get(INSIGHTS_URL)
    assert response.status_code == 200
    data = response.json()
    assert data["totals"]["messages"] == 4
    assert data["totals"]["voice_messages"] == 1
    assert data["totals"]["conversations"] == 1
    assert data["totals"]["active_conversations_7d"] == 1
    assert data["activity"]["today"] == 3
    assert data["activity"]["last_7_days"] == 3
    assert data["activity"]["last_30_days"] == 4
    trend_total = sum(point["messages"] for point in data["trend_14d"])
    assert trend_total == 4  # the 10-day-old message is inside the 14-day window
    by_role = {row["role"]: row["messages"] for row in data["top_senders_by_role"]}
    assert by_role.get(Role.FARMER) == 2
    assert by_role.get(Role.WHOLESALER) == 2


@pytest.mark.django_db
def test_messaging_insights_unread_and_moderation(sa_api, farmer, wholesaler):
    channel = ChatChannel.objects.create()
    channel.participants.add(farmer, wholesaler)
    Message.objects.create(channel=channel, sender=farmer, content="a", kind=MessageKind.TEXT, is_read=False)
    Message.objects.create(channel=channel, sender=wholesaler, content="b", kind=MessageKind.TEXT, is_read=True,
                           moderation_status=MessageModerationStatus.PENDING_REVIEW)
    data = sa_api.get(INSIGHTS_URL).json()
    assert data["totals"]["unread"] == 1
    assert data["totals"]["by_moderation_status"].get("PENDING_REVIEW") == 1


@pytest.mark.django_db
def test_messaging_insights_returns_no_message_bodies(sa_api, farmer, wholesaler):
    """Privacy: the insights payload must contain counts only."""
    channel = ChatChannel.objects.create()
    channel.participants.add(farmer, wholesaler)
    Message.objects.create(channel=channel, sender=farmer, content="SECRET-CONTENT-XYZ", kind=MessageKind.TEXT)
    body = sa_api.get(INSIGHTS_URL).content.decode()
    assert "SECRET-CONTENT-XYZ" not in body
    assert "content" not in body


@pytest.mark.django_db
def test_statistics_includes_regional_status_and_staff_counts(sa_api, super_admin, driver):
    data = sa_api.get(STATS_URL).json()
    addis = next(r for r in data["regional"] if r["region"] == "Addis Ababa")
    assert addis["driversCount"] == 1
    assert addis["approvedCount"] >= 1
    # The conftest super_admin has no location, so staff appears under "Unspecified".
    unspecified = next(r for r in data["regional"] if r["region"] == "Unspecified")
    assert unspecified["staffCount"] >= 1


@pytest.mark.django_db
def test_statistics_administrative_accountability(api, sa_api, super_admin):
    # Approve a pending user through the real endpoint so an audit row exists.
    pending = make_user(Role.FARMER, "pending.stats@test.et", status="PENDING")
    api.force_authenticate(user=super_admin)
    api.post(f"/api/v1/admin/users/{pending.pk}/approve/", {}, format="json")
    data = sa_api.get(STATS_URL).json()
    actors = data["administrative"]["by_actor"]
    sa_entry = next(a for a in actors if a["actor_id"] == str(super_admin.pk))
    assert sa_entry["approvals"] >= 1
    assert data["administrative"]["pending_by_region"] == [] or all(
        row["pending"] >= 0 for row in data["administrative"]["pending_by_region"]
    )
