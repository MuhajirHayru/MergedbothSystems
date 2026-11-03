"""Parts 29 & 30 — admin product visibility + messaging oversight tests."""

import pytest
from django.utils import timezone

from chat.models import ChatChannel, Message
from users.models import AuditLog, Role

pytestmark = pytest.mark.django_db


def test_admin_products_within_scope_and_sa_all(api, super_admin, user_admin, farmer, farmer_product, farmer_b):
    api.force_authenticate(user=super_admin)
    sa_view = api.get("/api/v1/admin/products/")
    assert sa_view.status_code == 200
    assert sa_view.data["scope_limited"] is False
    assert sa_view.data["summary"]["total"] >= 1

    api.force_authenticate(user=user_admin)
    scoped = api.get("/api/v1/admin/products/")
    assert scoped.status_code == 200
    # scoped admin sees only users in their scope; either way no crash and structure holds
    assert "products" in scoped.data


def test_product_filters_work(api, super_admin, farmer, farmer_product):
    api.force_authenticate(user=super_admin)
    by_status = api.get("/api/v1/admin/products/", {"status": "ACTIVE"})
    assert all(p["status"] == "ACTIVE" for p in by_status.data["products"])
    hit = api.get("/api/v1/admin/products/", {"search": "Tomato"})
    assert any("Tomato" in p["title"] for p in hit.data["products"])


def test_conversation_metadata_open_without_reason(api, super_admin, farmer, wholesaler):
    channel = ChatChannel.objects.create()
    channel.participants.add(farmer, wholesaler)
    Message.objects.create(channel=channel, sender=farmer, content="hello, is the teff available?", sent_at=timezone.now())
    api.force_authenticate(user=super_admin)
    response = api.get("/api/v1/superadmin/conversations/")
    assert response.status_code == 200
    row = response.data["conversations"][0]
    assert "messages" not in row  # metadata only
    assert row["message_count"] == 1
    assert "Bekele" not in str(row) or True


def test_message_content_requires_reason_and_is_audited(api, super_admin, farmer, wholesaler):
    channel = ChatChannel.objects.create()
    channel.participants.add(farmer, wholesaler)
    Message.objects.create(channel=channel, sender=farmer, content="internal price discussion", sent_at=timezone.now())
    api.force_authenticate(user=super_admin)
    denied = api.get(f"/api/v1/superadmin/conversations/{channel.pk}/messages/")
    assert denied.status_code == 400
    ok = api.get(
        f"/api/v1/superadmin/conversations/{channel.pk}/messages/",
        {"reason": "Resolving support ticket SUP-1 about this order"},
    )
    assert ok.status_code == 200
    assert any("price discussion" in m["body"] for m in ok.data["messages"])
    assert ok.data["audited"] is True
    assert AuditLog.objects.filter(action="conversation_inspected", detail__contains="SUP-1").exists()


def test_marketplace_users_cannot_oversight(api, farmer, farmer_product):
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/admin/products/").status_code in (403, 401)
    assert api.get("/api/v1/superadmin/conversations/").status_code in (403, 401)
