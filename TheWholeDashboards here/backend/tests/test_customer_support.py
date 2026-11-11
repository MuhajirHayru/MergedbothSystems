"""Part 21 — customer support module tests."""

import pytest
from django.core.exceptions import ValidationError
from django.db import connection
from django.test.utils import CaptureQueriesContext

from support.models import SupportTicket, SupportTicketMessage
from users.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def support_staff(db):
    from tests.conftest import make_user

    return make_user(Role.CUSTOMER_SUPPORT, "support@test.et", "Selam Support")


def test_user_submits_ticket_and_staff_gets_notified(api, farmer, support_staff):
    from notifications.models import Notification

    api.force_authenticate(user=farmer)
    response = api.post(
        "/api/v1/support/tickets/",
        {"subject": "Payment did not arrive", "body": "My escrow release is pending for 3 days.",
         "category": "PAYMENT", "related_order_reference": "#ORD531782"},
        format="json",
    )
    assert response.status_code == 201, response.data
    ticket = response.data["ticket"]
    assert ticket["reference"].startswith("SUP-")
    assert ticket["status"] == "OPEN" and ticket["unanswered"] is True
    assert len(ticket["messages"]) == 1
    assert Notification.objects.filter(
        recipient=support_staff, message__contains=ticket["reference"]
    ).exists()


def test_support_inbox_filters_and_summary(api, farmer, support_staff):
    api.force_authenticate(user=farmer)
    first = api.post("/api/v1/support/tickets/", {"subject": "Q1", "body": "b", "category": "ORDER"}, format="json")
    api.post("/api/v1/support/tickets/", {"subject": "Q2", "body": "b", "category": "PAYMENT"}, format="json")

    api.force_authenticate(user=support_staff)
    api.post(
        f"/api/v1/support/inbox/{first.data['ticket']['id']}/action/",
        {"action": "priority", "priority": "URGENT"},
        format="json",
    )
    inbox = api.get("/api/v1/support/inbox/")
    assert inbox.status_code == 200
    assert inbox.data["summary"]["total_incoming"] == 2
    assert inbox.data["summary"]["unanswered"] == 2
    assert any(row["id"] == str(support_staff.pk) for row in inbox.data["assignees"])

    filtered = api.get("/api/v1/support/inbox/", {"category": "PAYMENT"})
    assert len(filtered.data["tickets"]) == 1
    assert filtered.data["tickets"][0]["subject"] == "Q2"

    priority_filtered = api.get("/api/v1/support/inbox/", {"priority": "URGENT", "requester": farmer.full_name})
    assert priority_filtered.status_code == 200
    assert priority_filtered.data["pagination"]["total_items"] == 1
    assert priority_filtered.data["tickets"][0]["subject"] == "Q1"


def test_assign_respond_and_user_receives_response(api, farmer, support_staff):
    from notifications.models import Notification

    api.force_authenticate(user=farmer)
    created = api.post("/api/v1/support/tickets/", {"subject": "Help", "body": "b"}, format="json")
    ticket_id = created.data["ticket"]["id"]

    api.force_authenticate(user=support_staff)
    assigned = api.post(f"/api/v1/support/inbox/{ticket_id}/action/", {"action": "assign", "assignee_id": str(support_staff.pk)}, format="json")
    assert assigned.status_code == 200
    assert assigned.data["ticket"]["assigned_to"] == "Selam Support"
    assert assigned.data["ticket"]["status"] == "IN_PROGRESS"

    answered = api.post(f"/api/v1/support/inbox/{ticket_id}/action/", {"action": "respond", "body": "We fixed the escrow hold; funds release within 24h."}, format="json")
    assert answered.status_code == 200
    ticket = answered.data["ticket"]
    assert ticket["status"] == "ANSWERED" and ticket["unanswered"] is False
    assert ticket["messages"][-1]["author_kind"] == "STAFF"
    assert Notification.objects.filter(recipient=farmer, message__contains=ticket["reference"]).exists()


def test_answered_ticket_reopens_with_requester_reply(api, farmer, support_staff):
    api.force_authenticate(user=farmer)
    created = api.post("/api/v1/support/tickets/", {"subject": "Q", "body": "b"}, format="json")
    ticket_id = created.data["ticket"]["id"]
    api.force_authenticate(user=support_staff)
    api.post(f"/api/v1/support/inbox/{ticket_id}/action/", {"action": "respond", "body": "answer"}, format="json")
    api.force_authenticate(user=farmer)
    reply = api.post(f"/api/v1/support/tickets/{ticket_id}/reply/", {"body": "still broken", "reopen": True}, format="json")
    assert reply.status_code == 200
    assert reply.data["ticket"]["status"] == "OPEN"
    assert reply.data["ticket"]["unanswered"] is True


def test_bulk_respond_moves_tickets_to_answered(api, farmer, farmer_b, support_staff):
    api.force_authenticate(user=farmer)
    t1 = api.post("/api/v1/support/tickets/", {"subject": "A", "body": "b"}, format="json").data["ticket"]["id"]
    api.force_authenticate(user=farmer_b)
    t2 = api.post("/api/v1/support/tickets/", {"subject": "B", "body": "b"}, format="json").data["ticket"]["id"]

    api.force_authenticate(user=support_staff)
    bulk = api.post(
        "/api/v1/support/inbox/bulk/",
        {"action": "respond", "ticket_ids": [t1, t2], "body": "Scheduled maintenance completed; please retry."},
        format="json",
    )
    assert bulk.status_code == 200
    assert bulk.data["processed"] == 2
    assert SupportTicket.objects.filter(pk=t1, status="ANSWERED", unanswered=False).exists()
    assert SupportTicket.objects.filter(pk=t2, status="ANSWERED", unanswered=False).exists()


def test_marketplace_user_cannot_access_inbox(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/support/inbox/").status_code == 403
    response = api.post("/api/v1/support/inbox/bulk/", {"action": "close", "ticket_ids": []}, format="json")
    assert response.status_code == 403


def test_users_only_see_their_own_tickets(api, farmer, farmer_b):
    api.force_authenticate(user=farmer)
    mine = api.post("/api/v1/support/tickets/", {"subject": "Mine", "body": "b"}, format="json").data["ticket"]
    api.force_authenticate(user=farmer_b)
    listing = api.get("/api/v1/support/tickets/")
    refs = [t["reference"] for t in listing.data["tickets"]]
    assert mine["reference"] not in refs
    foreign = api.get(f"/api/v1/support/inbox/{mine['id']}/action/")
    assert foreign.status_code in (403, 404, 405)


def test_ticket_messages_are_append_only(farmer, support_staff):
    ticket = SupportTicket.objects.create(requester=farmer, subject="S")
    message = SupportTicketMessage.objects.create(ticket=ticket, author=farmer, author_kind="REQUESTER", body="x")
    with pytest.raises(Exception):
        message.body = "tampered"
        message.save()
    with pytest.raises(Exception):
        message.delete()
