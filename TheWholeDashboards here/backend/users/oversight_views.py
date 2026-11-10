"""Parts 29 & 30 — admin product visibility and messaging oversight.

Part 29: authorized User Admins inspect products listed by users inside their
geographic scope; Super Admin sees everything.
Part 30: Super Admin can list conversations with metadata, and open message
content only with a recorded reason — every inspection is audited. Message
content is never exposed to other roles.
"""

import json

from django.db.models import Count, Q, Sum
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from chat.models import ChatChannel, Message
from products.models import Product, ProductStatus
from registrations.models import AdministrativeLocation
from registrations.services import admin_dashboard_feature_enabled, location_descendant_ids, users_visible_to_admin
from users.audit import log_action
from users.models import AuditLog, Role
from users.permissions import IsAuthenticatedRole

OVERSIGHT_ROLES = (
    Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN,
    Role.ZONAL_ADMIN, Role.WEREDA_ADMIN, Role.USER_ADMIN,
)


class AdminProductVisibilityView(APIView):
    """GET /api/v1/admin/products/ — Part 29 product visibility within scope."""

    def get_permissions(self):
        return [IsAuthenticatedRole(OVERSIGHT_ROLES)]

    def patch(self, request):
        """Activate or deactivate a listing — enforced in marketplace discovery.

        Body: {product_id, status: "ACTIVE"|"INACTIVE", reason}. Super Admin and
        authorized oversight roles only; scoped admins may only act on listings
        within their visible user set. Every change is audited.
        """
        from django.utils import timezone as dj_tz

        user = request.user
        if not admin_dashboard_feature_enabled(user, "product_oversight"):
            return Response({"success": False, "error": "Product oversight is disabled for this administrator."}, status=403)
        product_id = request.data.get("product_id")
        new_status = request.data.get("status")
        reason = (request.data.get("reason") or "").strip()
        if not product_id or new_status not in (ProductStatus.ACTIVE, ProductStatus.INACTIVE):
            return Response(
                {"success": False, "error": "product_id and status (ACTIVE|INACTIVE) are required."},
                status=400,
            )
        if len(reason) < 5:
            return Response(
                {"success": False, "error": "A reason of at least 5 characters is required for a visibility change."},
                status=400,
            )
        try:
            product = Product.objects.select_related("owner").get(pk=product_id)
        except Product.DoesNotExist:
            return Response({"success": False, "error": "Listing not found."}, status=404)
        if user.role != Role.SUPER_ADMIN:
            visible_ids = users_visible_to_admin(user).values("pk")
            if not visible_ids.filter(pk=product.owner_id).exists():
                return Response({"success": False, "error": "This listing is outside your administrative scope."}, status=403)
        if product.status == new_status:
            return Response({"success": False, "error": f"Listing is already {new_status.lower()}."}, status=400)
        previous = product.status
        product.status = new_status
        product.save(update_fields=["status", "updated_at"])
        AuditLog.objects.create(
            actor=user,
            action="product_visibility_changed",
            target=str(product.pk),
            detail=json.dumps({
                "listing": product.title,
                "seller": product.owner.full_name,
                "previous": previous,
                "new": new_status,
                "reason": reason,
            }, sort_keys=True, default=str),
        )
        return Response({
            "success": True,
            "product": {"id": str(product.pk), "title": product.title, "status": product.status},
            "previous_status": previous,
        })

    def get(self, request):
        user = request.user
        if not admin_dashboard_feature_enabled(user, "product_oversight"):
            return Response({"success": False, "error": "Product oversight is disabled for this administrator."}, status=403)
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
            location = AdministrativeLocation.objects.filter(pk=params["region"], active=True).first()
            if location is None:
                return Response({"success": False, "error": "Choose an active administrative location."}, status=400)
            qs = qs.filter(owner__registration__location_id__in=location_descendant_ids(location))
        search = (params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(owner__full_name__icontains=search))
        total = qs.count()
        try:
            page = max(1, int(params.get("page", 1)))
            page_size = min(100, max(1, int(params.get("page_size", 50))))
        except (TypeError, ValueError):
            return Response({"success": False, "error": "page and page_size must be positive integers."}, status=400)
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
            for p in qs[(page - 1) * page_size:page * page_size]
        ]
        return Response({
            "success": True,
            "scope_limited": scoped,
            "summary": {"total": total},
            "pagination": {
                "page": page,
                "page_size": page_size,
                "pages": (total + page_size - 1) // page_size,
                "count": total,
            },
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
