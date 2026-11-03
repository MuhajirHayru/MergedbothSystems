"""Parts 29 & 30 — admin product visibility and messaging oversight.

Part 29: authorized User Admins inspect products listed by users inside their
geographic scope; Super Admin sees everything.
Part 30: Super Admin can list conversations with metadata, and open message
content only with a recorded reason — every inspection is audited. Message
content is never exposed to other roles.
"""

from django.db.models import Count, Q, Sum
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from chat.models import ChatChannel, Message
from products.models import Product
from registrations.services import users_visible_to_admin
from users.audit import log_action
from users.models import AuditLog, Role
from users.permissions import IsAuthenticatedRole

OVERSIGHT_ROLES = (Role.SUPER_ADMIN, Role.USER_ADMIN, Role.TOP_USER_ADMIN)


class AdminProductVisibilityView(APIView):
    """GET /api/v1/admin/products/ — Part 29 product visibility within scope."""

    def get_permissions(self):
        return [IsAuthenticatedRole(OVERSIGHT_ROLES)]

    def get(self, request):
        user = request.user
        qs = Product.objects.select_related("owner").order_by("-created_at")
        scoped = False
        if user.role != Role.SUPER_ADMIN:
            visible_ids = users_visible_to_admin(user).values("pk")
            qs = qs.filter(owner_id__in=visible_ids)
            scoped = True
        params = request.query_params
        if params.get("seller"):
            qs = qs.filter(owner_id=params["seller"])
        if params.get("category"):
            qs = qs.filter(category=params["category"])
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        if params.get("region"):
            qs = qs.filter(owner__administrative_scope__location_id=params["region"])
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(owner__full_name__icontains=search))
        rows = [
            {
                "id": str(p.pk),
                "title": p.title,
                "seller": p.owner.full_name,
                "seller_role": p.owner.role,
                "category": p.category,
                "quantity": str(p.quantity),
                "price_per_unit": str(p.price_per_unit),
                "status": p.status,
                "unit": p.unit_of_measure,
                "listed_at": p.created_at.isoformat(),
            }
            for p in qs[:200]
        ]
        return Response({
            "success": True,
            "scope_limited": scoped,
            "summary": {"total": qs.count()},
            "products": rows,
        })


class ConversationOversightView(APIView):
    """GET /api/v1/superadmin/conversations/ — metadata only (Part 30)."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN,))]

    def get(self, request):
        search = (request.query_params.get("search") or "").strip()
        channels = ChatChannel.objects.all().order_by("-created_at")
        if search:
            channels = channels.filter(participants__full_name__icontains=search)
        rows = []
        for channel in channels[:100]:
            participants = list(channel.participants.all())
            last_message = channel.messages.order_by("-sent_at").first()
            rows.append({
                "id": str(channel.pk),
                "participants": [p.full_name for p in participants],
                "participant_roles": [p.role for p in participants],
                "message_count": channel.messages.count(),
                "last_message_at": last_message.sent_at.isoformat() if last_message else None,
                "created_at": channel.created_at.isoformat(),
            })
        return Response({
            "success": True,
            "note": "Message content requires a recorded reason and is audited.",
            "conversations": rows,
        })


class ConversationMessagesView(APIView):
    """GET /api/v1/superadmin/conversations/<id>/messages/?reason=... — audited content access."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN,))]

    def get(self, request, pk):
        reason = (request.query_params.get("reason") or "").strip()
        if len(reason) < 10:
            return Response(
                {"success": False, "error": {"reason": "A specific reason (10+ characters) is required to open a conversation."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        channel = ChatChannel.objects.filter(pk=pk).first()
        if channel is None:
            return Response({"success": False, "error": "Conversation not found."}, status=404)
        log_action(
            request,
            actor=request.user,
            action="conversation_inspected",
            target=str(channel.pk),
            detail=f"Reason: {reason}",
        )
        messages = channel.messages.order_by("sent_at")[:300]
        return Response({
            "success": True,
            "audited": True,
            "messages": [
                {
                    "id": str(m.pk),
                    "sender": m.sender.full_name if m.sender else "system",
                    "body": m.content,
                    "created_at": m.sent_at.isoformat() if m.sent_at else None,
                }
                for m in messages
            ],
        })
