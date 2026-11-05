"""Super Admin messaging insights — GET /api/v1/superadmin/messaging-insights/.

Aggregate communication intelligence computed from the real chat records:
conversation and message volumes, unread and voice-message counts, moderation
breakdown, sender-role distribution, activity windows and a 14-day trend.

Privacy posture: this endpoint returns COUNTS only — never message bodies,
participants' contact details or conversation content. Opening an individual
conversation remains gated by the existing reason-logged oversight endpoints.
"""

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from datetime import timedelta
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from chat.models import ChatChannel, Message, MessageKind, MessageModerationStatus
from users.models import Role
from users.permissions import IsSuperAdmin


class SuperAdminMessagingInsightsView(APIView):
    """Counts-only messaging intelligence for the Super Admin command centre."""

    def get_permissions(self):
        return [IsAuthenticated(), IsSuperAdmin()]

    def get(self, request):
        now = timezone.now()
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        totals = Message.objects.aggregate(
            total=Count("id"),
            unread=Count("id", filter=Q(is_read=False)),
            voice=Count("id", filter=Q(kind=MessageKind.VOICE)),
        )
        moderation = dict(
            Message.objects.values_list("moderation_status")
            .annotate(total=Count("id"))
            .values_list("moderation_status", "total")
        )
        by_kind = dict(
            Message.objects.values_list("kind")
            .annotate(total=Count("id"))
            .values_list("kind", "total")
        )
        channels_total = ChatChannel.objects.count()
        active_channels_7d = (
            Message.objects.filter(sent_at__gte=now - timedelta(days=7))
            .values("channel_id").distinct().count()
        )

        window_counts = {
            "today": Message.objects.filter(sent_at__gte=today).count(),
            "last_7_days": Message.objects.filter(sent_at__gte=now - timedelta(days=7)).count(),
            "last_30_days": Message.objects.filter(sent_at__gte=now - timedelta(days=30)).count(),
        }

        trend_rows = (
            Message.objects.filter(sent_at__gte=now - timedelta(days=13))
            .values(day=TruncDate("sent_at"))
            .annotate(total=Count("id"))
            .order_by("day")
        )
        trend_map = {row["day"].isoformat(): row["total"] for row in trend_rows}
        trend = []
        # TruncDate buckets in the local timezone, so the label loop must use
        # local dates too — otherwise near-midnight UTC messages shift a day.
        for offset in range(13, -1, -1):
            day = (timezone.localdate() - timedelta(days=offset)).isoformat()
            trend.append({"day": day, "messages": trend_map.get(day, 0)})

        by_role_rows = (
            Message.objects.values("sender__role", "sender__full_name")
            .annotate(total=Count("id"))
            .order_by("-total")[:10]
        )
        by_role = [
            {
                "role": row["sender__role"] or "UNKNOWN",
                "actor": row["sender__full_name"] or "Unknown user",
                "messages": row["total"],
            }
            for row in by_role_rows
        ]

        return Response({
            "success": True,
            "generated_at": now.isoformat(),
            "totals": {
                "conversations": channels_total,
                "messages": totals["total"] or 0,
                "unread": totals["unread"] or 0,
                "voice_messages": totals["voice"] or 0,
                "active_conversations_7d": active_channels_7d,
                "by_kind": by_kind,
                "by_moderation_status": moderation,
            },
            "activity": window_counts,
            "trend_14d": trend,
            "top_senders_by_role": by_role,
            "unavailable": [
                "failed_or_undelivered: delivery failure is not tracked by the chat model",
                "per_region: chat participants are not consistently linked to a region",
            ],
        })
