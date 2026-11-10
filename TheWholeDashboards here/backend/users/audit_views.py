"""Part 20 — master audit center endpoints (summary, export, user activity)."""

import csv
from datetime import timedelta

from django.http import HttpResponse
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.audit import category_for
from users.models import AuditLog, Role
from users.permissions import IsAuthenticatedRole

SUMMARY_ROLES = (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.USER_ADMIN, Role.FINANCIAL_MANAGER)


def _window(request, default_days=30):
    try:
        days = int(request.query_params.get("days", default_days))
    except (TypeError, ValueError):
        days = default_days
    days = max(1, min(days, 366))
    start = timezone.now() - timedelta(days=days)
    return days, start


class AuditSummaryView(APIView):
    """GET /api/v1/superadmin/audit/summary/?days=30 — Part 20.1 dashboard totals."""

    def get_permissions(self):
        return [IsAuthenticatedRole(SUMMARY_ROLES)]

    def get(self, request):
        days, start = _window(request)
        qs = AuditLog.objects.filter(created_at__gte=start)
        total = qs.count()
        failed = qs.filter(success=False).count()

        category_rows = defaultdict_count(qs)
        trend_rows = (
            qs.extra(select={"day": "date(created_at)"})
            .values("day")
            .annotate(total=Count("id"), failed=Count("id", filter=Q(success=False)))
            .order_by("day")
        )
        role_rows = (
            qs.exclude(actor=None)
            .values("actor__role")
            .annotate(total=Count("id"))
            .order_by("-total")
        )
        login_success = qs.filter(action="login_success").count()
        login_failed = qs.filter(action="login_failed", success=False).count()

        return Response({
            "success": True,
            "window_days": days,
            "totals": {
                "total_activities": total,
                "successful": total - failed,
                "failed": failed,
                "successful_logins": login_success,
                "failed_logins": login_failed,
            },
            "by_category": category_rows,
            "by_role": [
                {"role": row["actor__role"], "total": row["total"]} for row in role_rows
            ],
            "trend": [
                {"day": str(row["day"]), "total": row["total"], "failed": row["failed"]}
                for row in trend_rows
            ],
        })


def defaultdict_count(qs):
    counts = {}
    for values in qs.values_list("action").iterator():
        category = category_for(values[0])
        counts[category] = counts.get(category, 0) + 1
    return [
        {"category": k, "total": v}
        for k, v in sorted(counts.items(), key=lambda kv: -kv[1])
    ]


class AuditExportView(APIView):
    """GET /api/v1/superadmin/audit/export/?days=N — CSV export (audited itself)."""

    def get_permissions(self):
        return [IsAuthenticatedRole(SUMMARY_ROLES)]

    @staticmethod
    def _safe_cell(value):
        """Neutralize CSV formula injection: a cell starting with = + - @ or TAB
        is prefixed with a single quote so spreadsheet apps treat it as text."""
        text = str(value)
        if text[:1] in ("=", "+", "-", "@", chr(9), chr(13)):
            return f"'{text}"
        return text

    def get(self, request):
        from users.models import AuditLog as AL

        days, start = _window(request, default_days=90)
        qs = AL.objects.filter(created_at__gte=start).select_related("actor").order_by("-created_at")[:10000]
        # UTF-8 BOM so Excel/LibreOffice render Amharic and other non-Latin text correctly.
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="greenpath-audit-{timezone.localdate()}.csv"'
        response.write("﻿")
        writer = csv.writer(response)
        writer.writerow([
            "id", "timestamp", "actor", "actor_role", "action", "category",
            "target", "detail", "success", "ip_address", "user_agent",
        ])
        safe = self._safe_cell
        for entry in qs:
            writer.writerow([
                safe(entry.pk),
                safe(entry.created_at.isoformat()),
                safe(entry.actor.full_name if entry.actor else "system"),
                safe(entry.actor.role if entry.actor else ""),
                safe(entry.action),
                safe(category_for(entry.action)),
                safe(entry.target),
                safe(entry.detail),
                safe("success" if entry.success else "failed"),
                safe(entry.ip_address or ""),
                safe(entry.user_agent),
            ])
        AL.objects.create(
            actor=request.user,
            action="audit_export",
            target="csv",
            detail=f"Exported {qs.count()} audit rows (window {days}d).",
        )
        return response


class UserActivityView(APIView):
    """GET /api/v1/superadmin/audit/user-activity/<uuid:user_id>/ — Part 20.3."""

    def get_permissions(self):
        return [IsAuthenticatedRole(SUMMARY_ROLES)]

    def get(self, request, user_id):
        from django.contrib.auth import get_user_model

        user = get_user_model().objects.filter(pk=user_id).first()
        if user is None:
            return Response({"success": False, "error": "Unknown user."}, status=status.HTTP_404_NOT_FOUND)
        entries = AuditLog.objects.filter(Q(actor=user) | Q(target=str(user.pk))).order_by("-created_at")[:200]
        by_action = (
            AuditLog.objects.filter(Q(actor=user) | Q(target=str(user.pk)))
            .values("action")
            .annotate(total=Count("id"))
            .order_by("-total")[:15]
        )
        return Response({
            "success": True,
            "user": {
                "id": str(user.pk),
                "full_name": user.full_name,
                "role": user.role,
                "status": user.status,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "last_login": user.last_login.isoformat() if getattr(user, "last_login", None) else None,
            },
            "totals": {
                "recorded_events": AuditLog.objects.filter(Q(actor=user) | Q(target=str(user.pk))).count(),
                "failed_logins": AuditLog.objects.filter(
                    action="login_failed", success=False, target__iexact=user.email
                ).count(),
            },
            "by_action": [{"action": row["action"], "total": row["total"]} for row in by_action],
            "entries": [
                {
                    "id": e.pk,
                    "action": e.action,
                    "category": category_for(e.action),
                    "detail": e.detail[:300],
                    "target": e.target,
                    "success": e.success,
                    "created_at": e.created_at.isoformat(),
                }
                for e in entries
            ],
        })
