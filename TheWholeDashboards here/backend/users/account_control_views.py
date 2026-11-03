"""Part 22 — system-wide account control (Super Admin).

POST /api/v1/superadmin/accounts/bulk-status/
  { user_ids: [...], action: activate|deactivate|suspend|reinstate, reason: "..." }

Protections required by Part 22:
- a reason is mandatory and recorded per affected user;
- you cannot act on your own account here;
- the last active Super Admin can never be disabled/suspended — an
  independently usable Super Admin account always remains;
- every status change goes through the existing User status methods, which
  audit and queue DriverApp authorization updates.
"""

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AccountStatus, AuditLog, Role, User
from users.permissions import IsSuperAdmin

ACTIONS = {
    "suspend": ("suspend", AccountStatus.SUSPENDED, "Suspended by platform control: {reason}"),
    "reinstate": ("reinstate", AccountStatus.APPROVED, ""),
    "deactivate": ("deactivate", AccountStatus.DEACTIVATED, ""),
    "activate": ("reinstate", AccountStatus.APPROVED, ""),
    "reactivate": ("reinstate", AccountStatus.APPROVED, ""),
}


class BulkAccountStatusView(APIView):
    def get_permissions(self):
        return [IsSuperAdmin()]

    @transaction.atomic
    def post(self, request):
        user_ids = request.data.get("user_ids") or []
        action = request.data.get("action")
        reason = (request.data.get("reason") or "").strip()
        if not isinstance(user_ids, list) or not user_ids:
            return Response(
                {"success": False, "error": {"user_ids": "Select at least one account."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if action not in ACTIONS:
            return Response(
                {"success": False, "error": {"action": "Use activate, deactivate, suspend or reinstate."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not reason:
            return Response(
                {"success": False, "error": {"reason": "A reason is required for every account action."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        method_name, target_status, audit_template = ACTIONS[action]
        users = list(User.objects.select_related("administrative_scope").filter(pk__in=user_ids))

        active_super_admins = User.objects.filter(
            role=Role.SUPER_ADMIN,
            status=AccountStatus.APPROVED,
            is_active=True,
        ).exclude(pk__in=[u.pk for u in users if u.pk != request.user.pk])

        results = {"processed": [], "skipped": []}
        for user in users:
            if user.pk == request.user.pk:
                results["skipped"].append({"id": str(user.pk), "reason": "You cannot change your own account here."})
                continue
            if user.role == Role.SUPER_ADMIN and target_status != AccountStatus.APPROVED:
                remaining = active_super_admins.exclude(pk=user.pk).count()
                if remaining == 0:
                    results["skipped"].append({
                        "id": str(user.pk),
                        "reason": "Cannot disable the last active Super Admin account.",
                    })
                    continue
            if action == "suspend":
                user.suspend(actor=request.user, reason=reason)  # audits with the reason
            else:
                getattr(user, method_name)(actor=request.user)
                AuditLog.objects.create(
                    actor=request.user,
                    action="user_reactivated" if action == "activate" else f"user_{action}",
                    target=str(user.pk),
                    detail=f"Platform account control: {action}. Reason: {reason}",
                )
            results["processed"].append({"id": str(user.pk), "status": user.status})

        return Response({"success": True, **results})
