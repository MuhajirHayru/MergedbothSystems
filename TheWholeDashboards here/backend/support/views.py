"""Part 21 — customer support APIs.

Requester side (any authenticated user):
- POST /api/v1/support/tickets/               submit a question/complaint
- GET  /api/v1/support/tickets/               own tickets with history (paginated)
- POST /api/v1/support/tickets/<id>/reply/    add information / reopen if answered

Staff side (CUSTOMER_SUPPORT + SUPER_ADMIN):
- GET  /api/v1/support/inbox/                 unified inbox with filters + summary (paginated)
- POST /api/v1/support/inbox/<id>/action/     assign/reassign, respond, prioritise, close, reopen
- POST /api/v1/support/inbox/bulk/            bulk assign / categorise / prioritise / answer / close

Both list endpoints answer with ``success``/``summary``/``pagination``/``tickets``.
``summary`` always describes the *filtered* set, and ``pagination.total_items``
matches it, so a page never disagrees with its own totals.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.paginator import EmptyPage, Paginator
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, ParseError, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from greenpath.exceptions import BusinessRuleError
from notifications.services import notify
from registrations.models import AdministrativeLocation
from users.audit import log_action
from users.models import Role, User
from users.permissions import IsAuthenticatedRole
from users.superadmin_statistics import (
    _build_region_canonicalizer,
    _norm_key,
    _region_of,
)

from .models import SupportTicket, SupportTicketMessage

STAFF_ROLES = (Role.CUSTOMER_SUPPORT, Role.SUPER_ADMIN)

# Page 1 of each list keeps the sizes the API already returned (50 for a
# requester's own tickets, 100 for the staff inbox) so existing screens look
# identical; later pages are now reachable instead of silently truncated.
REQUESTER_PAGE_SIZE = 50
INBOX_PAGE_SIZE = 100
MAX_PAGE_SIZE = 100

ACTIVE_STATUSES = (SupportTicket.Status.OPEN, SupportTicket.Status.IN_PROGRESS)

TICKET_STATUS_FIELDS = ("status", "unanswered", "answered_at", "answered_by", "closed_at", "updated_at")

# Everything ``_ticket_row`` touches. Without these the serializer runs one
# query per ticket for the requester and one per message for its author.
TICKET_RELATIONS = ("requester", "assigned_to")
TICKET_PREFETCHES = ("messages__author",)


def _staff(user):
    return user.role in STAFF_ROLES


def _ticket_queryset():
    return SupportTicket.objects.select_related(*TICKET_RELATIONS).prefetch_related(
        *TICKET_PREFETCHES
    )


def _ticket_history(ticket):
    """History from the prefetched ``messages`` cache (no queries per ticket)."""
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


def _fresh_ticket_row(pk):
    """Re-read a ticket after a mutation so the response includes the new message.

    ``_ticket_queryset()`` caches ``messages``; a row created inside the same
    request would otherwise be missing from the serialized history.
    """
    return _ticket_row(_ticket_queryset().get(pk=pk))


def _ticket_row(ticket, requester_region=None):
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
        "requester_region": requester_region or "Unspecified",
        "assigned_to": ticket.assigned_to.full_name if ticket.assigned_to else None,
        "assigned_to_id": str(ticket.assigned_to_id) if ticket.assigned_to_id else None,
        "related_order_reference": ticket.related_order_reference,
        "created_at": ticket.created_at.isoformat(),
        "answered_at": ticket.answered_at.isoformat() if ticket.answered_at else None,
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
        "messages": _ticket_history(ticket),
    }


def _positive_int(raw, field, default):
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ParseError({field: "Use a whole number."})
    if value < 1:
        raise ParseError({field: "Use a number of 1 or more."})
    return value


def _paginate(queryset, request, default_page_size):
    """Paginate a queryset and return ``(page, metadata)``.

    ``Paginator`` issues exactly one COUNT and one LIMIT/OFFSET query, and its
    count is the same filtered set the summary is computed from.
    """
    page_number = _positive_int(request.query_params.get("page"), "page", 1)
    page_size = min(
        _positive_int(request.query_params.get("page_size"), "page_size", default_page_size),
        MAX_PAGE_SIZE,
    )
    paginator = Paginator(queryset, page_size)
    try:
        page = paginator.page(page_number)
    except EmptyPage:
        raise NotFound("That page contains no tickets.")
    return page, {
        "page": page.number,
        "page_size": page_size,
        "total_pages": paginator.num_pages,
        "total_items": paginator.count,
        "has_next": page.has_next(),
        "has_previous": page.has_previous(),
    }


def _resolve_assignee(request, raw):
    """Staff member named by ``assignee_id`` (or the acting staff user for ``me``)."""
    from django.contrib.auth import get_user_model

    if raw in (None, ""):
        return None
    if raw == "me":
        return request.user if request.user.role in STAFF_ROLES else None
    try:
        return get_user_model().objects.filter(pk=raw, role__in=STAFF_ROLES).first()
    except (DjangoValidationError, ValueError):
        return None


class SupportTicketListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tickets = _ticket_queryset().filter(requester=request.user).order_by("-created_at")
        summary = tickets.aggregate(
            total=Count("id"),
            open=Count("id", filter=Q(status=SupportTicket.Status.OPEN)),
            answered=Count("id", filter=Q(status=SupportTicket.Status.ANSWERED)),
            closed=Count("id", filter=Q(status=SupportTicket.Status.CLOSED)),
        )
        page, pagination = _paginate(tickets, request, REQUESTER_PAGE_SIZE)
        return Response({
            "success": True,
            "summary": summary,
            "pagination": pagination,
            "tickets": [_ticket_row(t) for t in page],
        })

    def post(self, request):
        subject = (request.data.get("subject") or "").strip()
        body = (request.data.get("body") or "").strip()
        if not subject or not body:
            raise ValidationError({"subject": "Subject and message are required."})
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
            raise NotFound("Ticket not found.")
        body = (request.data.get("body") or "").strip()
        if not body:
            raise ValidationError({"body": "Write a message first."})
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
            notify(
                roles=(Role.CUSTOMER_SUPPORT,),
                type="SYSTEM",
                message=f"Support ticket {ticket.reference} updated by the requester.",
                actor=request.user,
                target_url="/support",
            )
        ticket.refresh_from_db()
        return Response({"success": True, "ticket": _ticket_row(ticket)})


class SupportInboxView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole(STAFF_ROLES)]

    def get(self, request):
        tickets = _ticket_queryset().order_by("-created_at")
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
        created_from = params.get("created_from") or params.get("from")
        created_to = params.get("created_to") or params.get("to")
        try:
            if created_from:
                tickets = tickets.filter(created_at__date__gte=created_from)
            if created_to:
                tickets = tickets.filter(created_at__date__lte=created_to)
        except (ValueError, TypeError):
            raise ValidationError({"created_from": "Invalid date (use YYYY-MM-DD)."})

        # Requester region map (canonical Ethiopian regions) — powers the
        # region filter, the per-region answered/unanswered summary, and the
        # region shown on each row.
        region_by_user = {}
        requester_ids = list(tickets.values_list("requester_id", flat=True).distinct())
        if requester_ids:
            user_rows = User.objects.filter(id__in=requester_ids).values(
                "id", "location",
                "registration__location__name", "registration__location__level",
                "registration__location__parent__name", "registration__location__parent__level",
                "registration__location__parent__parent__name",
                "registration__location__parent__parent__level",
                "registration__location__parent__parent__parent__name",
            )
            raw_region_by_user = {row["id"]: _region_of(row) for row in user_rows}
            canonical_names = list(
                AdministrativeLocation.objects.filter(
                    level__in=["REGION", "CITY"], active=True,
                ).values_list("name", flat=True)
            )
            canonical_by_key = {_norm_key(n): n.strip() for n in canonical_names}
            free = set()
            if canonical_names:
                free = {
                    r for r in set(raw_region_by_user.values())
                    if r != "Unspecified" and _norm_key(r) not in canonical_by_key
                }
            resolution = _build_region_canonicalizer(free, canonical_by_key) if free else {}
            region_by_user = {
                uid: ((resolution.get(r) or "Unspecified") if r in free else r)
                for uid, r in raw_region_by_user.items()
            }

        region_param = (params.get("region") or "").strip()
        if region_param:
            matched_ids = [uid for uid, r in region_by_user.items() if r == region_param]
            tickets = tickets.filter(requester_id__in=matched_ids)

        # One aggregate instead of six COUNT round-trips for the same rows.
        summary = tickets.aggregate(
            total_incoming=Count("id"),
            unanswered=Count("id", filter=Q(unanswered=True)),
            assigned=Count("id", filter=Q(assigned_to__isnull=False, status__in=ACTIVE_STATUSES)),
            urgent=Count("id", filter=Q(priority=SupportTicket.Priority.URGENT, status__in=ACTIVE_STATUSES)),
            answered=Count("id", filter=Q(status=SupportTicket.Status.ANSWERED)),
            closed=Count("id", filter=Q(status=SupportTicket.Status.CLOSED)),
        )
        summary["by_category"] = list(
            tickets.order_by()
            .values("category")
            .annotate(total=Count("id"))
            .order_by("-total")
        )

        # Per-region answered/unanswered breakdown across the filtered set.
        by_region_acc = {}
        for row in tickets.values("requester_id", "status", "unanswered"):
            region = region_by_user.get(row["requester_id"], "Unspecified")
            acc = by_region_acc.setdefault(region, {"total": 0, "answered": 0, "unanswered": 0})
            acc["total"] += 1
            if row["unanswered"]:
                acc["unanswered"] += 1
            if row["status"] == SupportTicket.Status.ANSWERED:
                acc["answered"] += 1
        summary["by_region"] = [
            {"region": region, **counts}
            for region, counts in sorted(by_region_acc.items(), key=lambda kv: -kv[1]["total"])
        ]

        page, pagination = _paginate(tickets, request, INBOX_PAGE_SIZE)
        return Response({
            "success": True,
            "summary": summary,
            "pagination": pagination,
            "tickets": [_ticket_row(t, region_by_user.get(t.requester_id)) for t in page],
        })


class SupportInboxActionView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole(STAFF_ROLES)]

    def post(self, request, pk):
        ticket = _ticket_queryset().filter(pk=pk).first()
        if ticket is None:
            raise NotFound("Ticket not found.")
        action = request.data.get("action")

        with transaction.atomic():
            if action == "assign":
                assignee = _resolve_assignee(request, request.data.get("assignee_id"))
                if assignee is None:
                    raise ValidationError({"assignee_id": "Pick a support staff member."})
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
                return Response({"success": True, "ticket": _fresh_ticket_row(ticket.pk)})

            if action == "respond":
                body = (request.data.get("body") or "").strip()
                if not body:
                    raise ValidationError({"body": "Write the response first."})
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
                return Response({"success": True, "ticket": _fresh_ticket_row(ticket.pk)})

            if action == "priority":
                priority = request.data.get("priority")
                if priority not in SupportTicket.Priority.values:
                    raise ValidationError({"priority": "Unknown priority."})
                ticket.priority = priority
                ticket.save(update_fields=["priority", "updated_at"])
                return Response({"success": True, "ticket": _fresh_ticket_row(ticket.pk)})

            if action == "close":
                if ticket.status not in (SupportTicket.Status.ANSWERED, SupportTicket.Status.IN_PROGRESS):
                    raise BusinessRuleError("Only answered or investigated tickets can be closed.")
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
                return Response({"success": True, "ticket": _fresh_ticket_row(ticket.pk)})

            if action == "reopen":
                if ticket.status != SupportTicket.Status.CLOSED:
                    raise BusinessRuleError("Only closed tickets can be reopened.")
                ticket.status = SupportTicket.Status.OPEN
                ticket.closed_at = None
                ticket.unanswered = True
                ticket.save(update_fields=TICKET_STATUS_FIELDS)
                return Response({"success": True, "ticket": _fresh_ticket_row(ticket.pk)})

        raise ValidationError({"action": "Unknown action."})


class SupportBulkActionView(APIView):
    """Part 21.3 — bulk assign / categorise / prioritise / answer / close."""

    def get_permissions(self):
        return [IsAuthenticatedRole(STAFF_ROLES)]

    def post(self, request):
        ids = request.data.get("ticket_ids") or []
        action = request.data.get("action")
        if not isinstance(ids, list) or not ids:
            raise ValidationError({"ticket_ids": "Select at least one ticket."})
        tickets = SupportTicket.objects.filter(pk__in=ids).select_related("requester")
        results = {"processed": 0, "skipped": 0}

        with transaction.atomic():
            if action == "assign":
                assignee = _resolve_assignee(request, request.data.get("assignee_id"))
                if assignee is None:
                    raise ValidationError({"assignee_id": "Pick a support staff member."})
                for ticket in tickets:
                    ticket.assigned_to = assignee
                    if ticket.status == SupportTicket.Status.OPEN:
                        ticket.status = SupportTicket.Status.IN_PROGRESS
                    ticket.save(update_fields=["assigned_to", "status", "updated_at"])
                    results["processed"] += 1

            elif action == "category":
                category = request.data.get("category")
                if category not in SupportTicket.Category.values:
                    raise ValidationError({"category": "Unknown category."})
                results["processed"] = tickets.update(category=category, updated_at=timezone.now())

            elif action == "priority":
                priority = request.data.get("priority")
                if priority not in SupportTicket.Priority.values:
                    raise ValidationError({"priority": "Unknown priority."})
                results["processed"] = tickets.update(priority=priority, updated_at=timezone.now())

            elif action == "respond":
                body = (request.data.get("body") or "").strip()
                if not body:
                    raise ValidationError({"body": "Write the common response first."})
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
                raise ValidationError({"action": "Unknown bulk action."})

            log_action(
                request, actor=request.user, action=f"support_bulk_{action}",
                detail=f"{results['processed']} tickets processed, {results['skipped']} skipped.",
            )
        return Response({"success": True, **results})
