"""Part 21 — customer support APIs.

Requester side (any authenticated user):
- POST /api/v1/support/tickets/               submit a question/complaint
- GET  /api/v1/support/tickets/               own tickets with history
- POST /api/v1/support/tickets/<id>/reply/    add information / reopen if answered

Staff side (CUSTOMER_SUPPORT + SUPER_ADMIN):
- GET  /api/v1/support/inbox/                 unified inbox with filters + summary
- POST /api/v1/support/inbox/<id>/assign/     assign/reassign
- POST /api/v1/support/inbox/<id>/respond/    answer a ticket (moves to ANSWERED, notifies user)
- POST /api/v1/support/inbox/bulk/            bulk assign / categorise / prioritise / close
"""

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.services import notify
from users.audit import log_action
from users.models import AuditLog, Role
from rest_framework.permissions import IsAuthenticated
from users.permissions import IsAuthenticatedRole

from .models import SupportTicket, SupportTicketMessage

STAFF_ROLES = (Role.CUSTOMER_SUPPORT, Role.SUPER_ADMIN)

TICKET_STATUS_FIELDS = ("status", "unanswered", "answered_at", "answered_by", "closed_at", "updated_at")


def _staff(user):
    return user.role in STAFF_ROLES


def _ticket_history(ticket):
    return [
        {
            "id": str(m.pk),
            "author_kind": m.author_kind,
            "author_name": m.author.full_name if m.author else "System",
            "body": m.body,
            "created_at": m.created_at.isoformat(),
        }
        for m in ticket.messages.all()
    ]


def _ticket_row(ticket):
    return {
        "id": str(ticket.pk),
        "reference": ticket.reference,
        "subject": ticket.subject,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "unanswered": ticket.unanswered,
        "requester": ticket.requester.full_name,
        "requester_id": str(ticket.requester_id),
        "requester_role": ticket.requester.role,
        "assigned_to": ticket.assigned_to.full_name if ticket.assigned_to else None,
        "assigned_to_id": str(ticket.assigned_to_id) if ticket.assigned_to_id else None,
        "related_order_reference": ticket.related_order_reference,
        "created_at": ticket.created_at.isoformat(),
        "answered_at": ticket.answered_at.isoformat() if ticket.answered_at else None,
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
        "messages": _ticket_history(ticket),
    }


class SupportTicketListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tickets = SupportTicket.objects.filter(requester=request.user).order_by("-created_at")
        return Response({
            "success": True,
            "summary": {
                "total": tickets.count(),
                "open": tickets.filter(status=SupportTicket.Status.OPEN).count(),
                "answered": tickets.filter(status=SupportTicket.Status.ANSWERED).count(),
                "closed": tickets.filter(status=SupportTicket.Status.CLOSED).count(),
            },
            "tickets": [_ticket_row(t) for t in tickets[:50]],
        })

    def post(self, request):
        subject = (request.data.get("subject") or "").strip()
        body = (request.data.get("body") or "").strip()
        if not subject or not body:
            return Response(
                {"success": False, "error": {"subject": "Subject and message are required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        category = request.data.get("category") or SupportTicket.Category.OTHER
        if category not in SupportTicket.Category.values:
            category = SupportTicket.Category.OTHER
        with transaction.atomic():
            ticket = SupportTicket.objects.create(
                requester=request.user,
                category=category,
                priority=SupportTicket.Priority.NORMAL,
                subject=subject[:200],
                related_order_reference=(request.data.get("related_order_reference") or "").strip()[:32],
            )
            SupportTicketMessage.objects.create(
                ticket=ticket, author=request.user,
                author_kind=SupportTicketMessage.Author.REQUESTER, body=body,
            )
            notify(
                roles=(Role.CUSTOMER_SUPPORT, Role.SUPER_ADMIN),
                type="SYSTEM",
                message=f"New support request {ticket.reference}: {ticket.subject}",
                actor=request.user,
                target_url="/support",
            )
        return Response({"success": True, "ticket": _ticket_row(ticket)}, status=201)


class SupportTicketReplyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        ticket = SupportTicket.objects.filter(pk=pk, requester=request.user).first()
        if ticket is None:
            return Response({"success": False, "error": "Ticket not found."}, status=404)
        body = (request.data.get("body") or "").strip()
        if not body:
            return Response(
                {"success": False, "error": {"body": "Write a message first."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reopen = bool(request.data.get("reopen")) and ticket.status == SupportTicket.Status.ANSWERED
        with transaction.atomic():
            SupportTicketMessage.objects.create(
                ticket=ticket, author=request.user,
                author_kind=SupportTicketMessage.Author.REQUESTER, body=body,
            )
            updates = {"unanswered": True, "updated_at": timezone.now()}
            if reopen:
                updates.update(status=SupportTicket.Status.OPEN, answered_at=None, answered_by=None)
            SupportTicket.objects.filter(pk=ticket.pk).update(**updates)
            if _staff_query_needs_ping():
                notify(
                    roles=(Role.CUSTOMER_SUPPORT,),
                    type="SYSTEM",
                    message=f"Support ticket {ticket.reference} updated by the requester.",
                    actor=request.user,
                    target_url="/support",
                )
        ticket.refresh_from_db()
        return Response({"success": True, "ticket": _ticket_row(ticket)})


def _staff_query_needs_ping():
    return True


class SupportInboxView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole(STAFF_ROLES)]

    def get(self, request):
        tickets = SupportTicket.objects.select_related("requester", "assigned_to").order_by("-created_at")
        params = request.query_params
        if params.get("status"):
            tickets = tickets.filter(status=params["status"])
        if params.get("category"):
            tickets = tickets.filter(category=params["category"])
        if params.get("priority"):
            tickets = tickets.filter(priority=params["priority"])
        if params.get("unanswered") in ("true", "1"):
            tickets = tickets.filter(unanswered=True)
        if params.get("assigned") == "me":
            tickets = tickets.filter(assigned_to=request.user)
        if params.get("requester"):
            tickets = tickets.filter(requester__full_name__icontains=params["requester"])
        summary = {
            "total_incoming": tickets.count(),
            "unanswered": tickets.filter(unanswered=True).count(),
            "assigned": tickets.filter(assigned_to__isnull=False, status__in=(
                SupportTicket.Status.OPEN, SupportTicket.Status.IN_PROGRESS
            )).count(),
            "urgent": tickets.filter(priority=SupportTicket.Priority.URGENT, status__in=(
                SupportTicket.Status.OPEN, SupportTicket.Status.IN_PROGRESS
            )).count(),
            "answered": tickets.filter(status=SupportTicket.Status.ANSWERED).count(),
            "closed": tickets.filter(status=SupportTicket.Status.CLOSED).count(),
            "by_category": list(
                tickets.values("category").annotate(total=__import__("django.db.models", fromlist=["Count"]).Count("id")).order_by("-total")
            ),
        }
        return Response({
            "success": True,
            "summary": summary,
            "tickets": [_ticket_row(t) for t in tickets[:100]],
        })


class SupportInboxActionView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole(STAFF_ROLES)]

    def post(self, request, pk):
        ticket = SupportTicket.objects.select_related("requester", "assigned_to").filter(pk=pk).first()
        if ticket is None:
            return Response({"success": False, "error": "Ticket not found."}, status=404)
        action = request.data.get("action")

        with transaction.atomic():
            if action == "assign":
                assignee_id = request.data.get("assignee_id")
                if assignee_id == "me":
                    assignee = request.user if request.user.role in (
                        "CUSTOMER_SUPPORT", "SUPER_ADMIN"
                    ) else None
                else:
                    assignee = SupportTicket._meta.get_field("assigned_to").related_model.objects.filter(
                        pk=assignee_id, role__in=("CUSTOMER_SUPPORT", "SUPER_ADMIN")
                    ).first() if assignee_id else None
                if assignee is None:
                    return Response(
                        {"success": False, "error": {"assignee_id": "Pick a support staff member."}},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                ticket.assigned_to = assignee
                if ticket.status == SupportTicket.Status.OPEN:
                    ticket.status = SupportTicket.Status.IN_PROGRESS
                ticket.save(update_fields=["assigned_to", "status", "updated_at"])
                SupportTicketMessage.objects.create(
                    ticket=ticket, author=request.user, author_kind=SupportTicketMessage.Author.SYSTEM,
                    body=f"Ticket assigned to {assignee.full_name}.",
                )
                log_action(request, actor=request.user, action="support_ticket_assigned",
                           target=ticket.reference, detail=f"Assigned to {assignee.full_name}.")
                return Response({"success": True, "ticket": _ticket_row(ticket)})

            if action == "respond":
                body = (request.data.get("body") or "").strip()
                if not body:
                    return Response(
                        {"success": False, "error": {"body": "Write the response first."}},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                SupportTicketMessage.objects.create(
                    ticket=ticket, author=request.user,
                    author_kind=SupportTicketMessage.Author.STAFF, body=body,
                )
                ticket.unanswered = False
                ticket.status = SupportTicket.Status.ANSWERED
                ticket.answered_at = timezone.now()
                ticket.answered_by = request.user
                ticket.save(update_fields=TICKET_STATUS_FIELDS)
                notify(
                    user_ids=[ticket.requester_id],
                    type="SYSTEM",
                    message=f"Support responded to {ticket.reference}: {ticket.subject}",
                    actor=request.user,
                    target_url="/support",
                )
                log_action(request, actor=request.user, action="support_ticket_answered",
                           target=ticket.reference, detail=body[:200])
                return Response({"success": True, "ticket": _ticket_row(ticket)})

            if action == "priority":
                priority = request.data.get("priority")
                if priority not in SupportTicket.Priority.values:
                    return Response({"success": False, "error": {"priority": "Unknown priority."}}, status=400)
                ticket.priority = priority
                ticket.save(update_fields=["priority", "updated_at"])
                return Response({"success": True, "ticket": _ticket_row(ticket)})

            if action == "close":
                if ticket.status not in (SupportTicket.Status.ANSWERED, SupportTicket.Status.IN_PROGRESS):
                    return Response(
                        {"success": False, "error": "Only answered or investigated tickets can be closed."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                ticket.status = SupportTicket.Status.CLOSED
                ticket.closed_at = timezone.now()
                ticket.unanswered = False
                ticket.save(update_fields=TICKET_STATUS_FIELDS)
                notify(
                    user_ids=[ticket.requester_id],
                    type="SYSTEM",
                    message=f"Support ticket {ticket.reference} was closed.",
                    actor=request.user,
                    target_url="/support",
                )
                log_action(request, actor=request.user, action="support_ticket_closed", target=ticket.reference)
                return Response({"success": True, "ticket": _ticket_row(ticket)})

            if action == "reopen":
                if ticket.status != SupportTicket.Status.CLOSED:
                    return Response({"success": False, "error": "Only closed tickets can be reopened."}, status=400)
                ticket.status = SupportTicket.Status.OPEN
                ticket.closed_at = None
                ticket.unanswered = True
                ticket.save(update_fields=TICKET_STATUS_FIELDS)
                return Response({"success": True, "ticket": _ticket_row(ticket)})

        return Response({"success": False, "error": {"action": "Unknown action."}}, status=400)


class SupportBulkActionView(APIView):
    """Part 21.3 — bulk assign / categorise / prioritise / answer / close."""

    def get_permissions(self):
        return [IsAuthenticatedRole(STAFF_ROLES)]

    def post(self, request):
        ids = request.data.get("ticket_ids") or []
        action = request.data.get("action")
        if not isinstance(ids, list) or not ids:
            return Response({"success": False, "error": {"ticket_ids": "Select at least one ticket."}}, status=400)
        tickets = SupportTicket.objects.filter(pk__in=ids).select_related("requester")
        results = {"processed": 0, "skipped": 0}

        with transaction.atomic():
            if action == "assign":
                assignee = SupportTicket._meta.get_field("assigned_to").related_model.objects.filter(
                    pk=request.data.get("assignee_id"), role__in=("CUSTOMER_SUPPORT", "SUPER_ADMIN")
                ).first()
                if assignee is None:
                    return Response({"success": False, "error": {"assignee_id": "Pick a support staff member."}}, status=400)
                for ticket in tickets:
                    ticket.assigned_to = assignee
                    if ticket.status == SupportTicket.Status.OPEN:
                        ticket.status = SupportTicket.Status.IN_PROGRESS
                    ticket.save(update_fields=["assigned_to", "status", "updated_at"])
                    results["processed"] += 1

            elif action == "category":
                category = request.data.get("category")
                if category not in SupportTicket.Category.values:
                    return Response({"success": False, "error": {"category": "Unknown category."}}, status=400)
                results["processed"] = tickets.update(category=category, updated_at=timezone.now())

            elif action == "priority":
                priority = request.data.get("priority")
                if priority not in SupportTicket.Priority.values:
                    return Response({"success": False, "error": {"priority": "Unknown priority."}}, status=400)
                results["processed"] = tickets.update(priority=priority, updated_at=timezone.now())

            elif action == "respond":
                body = (request.data.get("body") or "").strip()
                if not body:
                    return Response({"success": False, "error": {"body": "Write the common response first."}}, status=400)
                for ticket in tickets:
                    # only tickets the requester can legitimately receive this answer for
                    if ticket.status in (SupportTicket.Status.CLOSED,):
                        results["skipped"] += 1
                        continue
                    SupportTicketMessage.objects.create(
                        ticket=ticket, author=request.user,
                        author_kind=SupportTicketMessage.Author.STAFF, body=body,
                    )
                    ticket.unanswered = False
                    ticket.status = SupportTicket.Status.ANSWERED
                    ticket.answered_at = timezone.now()
                    ticket.answered_by = request.user
                    ticket.save(update_fields=TICKET_STATUS_FIELDS)
                    notify(
                        user_ids=[ticket.requester_id],
                        type="SYSTEM",
                        message=f"Support responded to {ticket.reference}: {ticket.subject}",
                        actor=request.user,
                        target_url="/support",
                    )
                    results["processed"] += 1

            elif action == "close":
                for ticket in tickets:
                    if ticket.status not in (SupportTicket.Status.ANSWERED, SupportTicket.Status.IN_PROGRESS):
                        results["skipped"] += 1
                        continue
                    ticket.status = SupportTicket.Status.CLOSED
                    ticket.closed_at = timezone.now()
                    ticket.unanswered = False
                    ticket.save(update_fields=TICKET_STATUS_FIELDS)
                    results["processed"] += 1

            else:
                return Response({"success": False, "error": {"action": "Unknown bulk action."}}, status=400)

            log_action(
                request, actor=request.user, action=f"support_bulk_{action}",
                detail=f"{results['processed']} tickets processed, {results['skipped']} skipped.",
            )
        return Response({"success": True, **results})
