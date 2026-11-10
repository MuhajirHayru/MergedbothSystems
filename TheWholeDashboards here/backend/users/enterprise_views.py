"""Enterprise APIs — reports center, driver performance, system health, user detail.

All endpoints return real database aggregates. No mock data.
"""

import csv
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AuditLog, Role
from users.models import User
from users.permissions import IsAuthenticatedRole, IsSuperAdmin
from payments.models import Order, OrderStatus, Wallet
from payments.freight_models import FreightBid, FreightJob
from payments.discount_models import DiscountCampaign, DiscountRedemption
from support.models import SupportTicket


def _date_range(request):
    days = min(int(request.query_params.get("days", 30)), 366)
    start = timezone.now() - timedelta(days=days)
    return start, days


def _csv_response(headers, rows, filename):
    import csv as csv_mod
    import io
    buf = io.StringIO()
    writer = csv_mod.writer(buf)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    resp = HttpResponse(buf.getvalue(), content_type="text/csv")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp


# ---------------------------------------------------------------------------
# Reports Center — all report types with CSV export
# ---------------------------------------------------------------------------

class ReportsCenterView(APIView):
    """GET /api/v1/reports/center/?type=<type>&days=<N> — unified reports."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.FINANCIAL_MANAGER, Role.TOP_USER_ADMIN))]

    def get(self, request):
        report_type = request.query_params.get("type", "sales")
        start, days = _date_range(request)

        if report_type == "sales":
            return self._sales_report(start, days)
        elif report_type == "users":
            return self._users_report(start, days)
        elif report_type == "revenue":
            return self._revenue_report(start, days)
        elif report_type == "logistics":
            return self._logistics_report(start, days)
        return Response({"success": False, "error": "Unknown report type."}, status=400)

    def _sales_report(self, start, days):
        from payments.models import Order, OrderStatus
        orders = Order.objects.filter(created_at__gte=start).select_related("product", "wholesaler", "farmer", "retailer")
        rows = [
            {
                "reference": o.reference, "date": o.created_at.isoformat(),
                "product": o.product.title, "quantity": str(o.quantity),
                "buyer": o.buyer.full_name, "seller": o.seller.full_name,
                "total": str(o.total_amount), "discount": str(o.discount_amount),
                "payable": str(o.payable_amount), "status": o.status,
            }
            for o in orders
        ]
        total_gmv = sum(float(r["total"]) for r in rows)
        return Response({
            "success": True, "report_type": "sales", "window_days": days,
            "summary": {"total_orders": len(rows), "total_gmv": f"{total_gmv:.2f}"},
            "rows": rows,
        })

    def _users_report(self, start, days):
        users = User.objects.filter(created_at__gte=start).select_related("registration__location")
        by_role = {}
        for u in users:
            by_role[u.role] = by_role.get(u.role, 0) + 1
        return Response({
            "success": True, "report_type": "users", "window_days": days,
            "summary": {"new_users": users.count(), "by_role": by_role},
            "rows": [
                {"id": str(u.pk), "name": u.full_name, "email": u.email,
                 "role": u.role, "status": u.status, "registered": u.created_at.isoformat()}
                for u in users
            ],
        })

    def _revenue_report(self, start, days):
        from payments.financial_models import FinancialJournalEntry
        entries = FinancialJournalEntry.objects.filter(
            created_at__gte=start,
            category__in=["MARKETPLACE_COMMISSION", "DELIVERY_SERVICE_REVENUE",
                          "PROMOTION_EXPENSE", "OPERATING_EXPENSE", "TAX_LIABILITY"],
        ).order_by("-created_at")
        by_category = {}
        for e in entries:
            by_category.setdefault(e.category, {"count": 0, "total": 0})
            by_category[e.category]["count"] += 1
            by_category[e.category]["total"] += float(e.amount)
        revenue = sum(v["total"] for k, v in by_category.items() if "COMMISSION" in k or "REVENUE" in k)
        expenses = sum(v["total"] for k, v in by_category.items() if "EXPENSE" in k)
        return Response({
            "success": True, "report_type": "revenue", "window_days": days,
            "summary": {"revenue": f"{revenue:.2f}", "expenses": f"{expenses:.2f}",
                        "net": f"{revenue - expenses:.2f}"},
            "by_category": by_category,
            "rows": [
                {"id": str(e.pk), "date": e.created_at.isoformat(), "category": e.category,
                 "amount": str(e.amount), "reference": e.source_reference, "status": e.status}
                for e in entries[:100]
            ],
        })

    def _logistics_report(self, start, days):
        from payments.freight_models import FreightJob, FreightBid
        jobs = FreightJob.objects.filter(published_at__gte=start).select_related(
            "order", "assigned_driver"
        )
        return Response({
            "success": True, "report_type": "logistics", "window_days": days,
            "summary": {
                "total_jobs": jobs.count(),
                "assigned": jobs.filter(status=FreightJob.Status.ASSIGNED).count(),
                "completed": jobs.filter(status=FreightJob.Status.COMPLETED).count(),
                "open": jobs.filter(status=FreightJob.Status.OPEN).count(),
                "total_bids": FreightBid.objects.filter(job__published_at__gte=start).count(),
            },
            "rows": [
                {"order": j.order.reference, "product": j.order.product.title,
                 "pickup": j.pickup_summary, "destination": j.destination_summary,
                 "status": j.status, "driver": j.assigned_driver.full_name if j.assigned_driver else None,
                 "fee": str(j.assigned_fee) if j.assigned_fee else None,
                 "bids": j.bids.count(), "published": j.published_at.isoformat()}
                for j in jobs[:100]
            ],
        })


class ReportExportView(APIView):
    """GET /api/v1/reports/center/export/?type=<type>&days=<N> — CSV export."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.FINANCIAL_MANAGER, Role.TOP_USER_ADMIN))]

    def get(self, request):
        report_type = request.query_params.get("type", "sales")
        start, days = _date_range(request)
        if report_type == "sales":
            orders = Order.objects.filter(created_at__gte=start).select_related("product", "wholesaler")
            rows = [[o.reference, o.created_at.isoformat(), o.product.title,
                     str(o.quantity), str(o.total_amount), str(o.discount_amount),
                     str(o.payable_amount), o.status, o.buyer.full_name, o.seller.full_name]
                    for o in orders]
            headers = ["Reference", "Date", "Product", "Qty", "Total", "Discount", "Payable", "Status", "Buyer", "Seller"]
        elif report_type == "users":
            users = User.objects.filter(created_at__gte=start)
            rows = [[str(u.pk), u.full_name, u.email, u.role, u.status, u.created_at.isoformat()]
                    for u in users]
            headers = ["ID", "Name", "Email", "Role", "Status", "Registered"]
        elif report_type == "logistics":
            jobs = FreightJob.objects.filter(published_at__gte=start).select_related("order", "assigned_driver")
            rows = [[j.order.reference, j.order.product.title, j.pickup_summary,
                     j.destination_summary, j.status,
                     j.assigned_driver.full_name if j.assigned_driver else "",
                     str(j.assigned_fee) if j.assigned_fee else "", str(j.bids.count())]
                    for j in jobs]
            headers = ["Order", "Product", "Pickup", "Destination", "Status", "Driver", "Fee", "Bids"]
        else:
            return HttpResponse("Unknown report type", status=400)

        return _csv_response(headers, rows, f"greenpath-{report_type}-{days}d.csv")


# ---------------------------------------------------------------------------
# Driver Performance — per-driver metrics for logistics manager
# ---------------------------------------------------------------------------

class DriverPerformanceView(APIView):
    """GET /api/v1/payments/financial/driver-performance/ — per-driver metrics."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER, Role.FINANCIAL_MANAGER))]

    def get(self, request):
        drivers = User.objects.filter(role=Role.DRIVER, is_active=True).select_related(
            "registration__location", "driver_profile"
        )
        rows = []
        for d in drivers:
            profile = getattr(d, "driver_profile", None)
            from payments.freight_models import FreightJob
            assigned = FreightJob.objects.filter(assigned_driver=d)
            completed = assigned.filter(status=FreightJob.Status.COMPLETED).count()
            active = assigned.filter(status=FreightJob.Status.ASSIGNED).count()
            total_earned = sum(
                float(j.assigned_fee or 0) for j in assigned.filter(status=FreightJob.Status.COMPLETED)
            )
            rows.append({
                "id": str(d.pk),
                "name": d.full_name,
                "email": d.email,
                "status": d.status,
                "is_available": profile.is_available if profile else False,
                "location": str(getattr(getattr(d, "registration", None), "location", "")) or None,
                "assigned_deliveries": assigned.count(),
                "completed_deliveries": completed,
                "active_deliveries": active,
                "total_earned_etb": f"{total_earned:.2f}",
            })
        return Response({"success": True, "drivers": rows})


# ---------------------------------------------------------------------------
# System Health — real API/DB/service checks
# ---------------------------------------------------------------------------

class SystemHealthDetailedView(APIView):
    """GET /api/v1/superadmin/health-detailed/ — comprehensive system health.

    Every service entry reflects a real probe or a real configuration check —
    never a hardcoded status string.
    """

    def get_permissions(self):
        return [IsSuperAdmin()]

    def get(self, request):
        import time

        from django.conf import settings
        from django.core.cache import cache as dj_cache
        from django.db import connection

        from payments.models import MarketplaceIntegrationOutbox

        # Database: real connectivity probe with measured latency.
        started = time.perf_counter()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db_ok = True
            db_latency_ms = round((time.perf_counter() - started) * 1000, 1)
        except Exception:
            db_ok = False
            db_latency_ms = -1

        # Cache: real round-trip through the configured cache backend.
        try:
            dj_cache.set("health_check", "ok", 10)
            cache_ok = dj_cache.get("health_check") == "ok"
        except Exception:
            cache_ok = False

        # Chapa: real configuration probe (booleans only — never expose keys).
        chapa_key_ok = bool(
            getattr(settings, "CHAPA_TEST_MODE", False)
            and (getattr(settings, "CHAPA_SECRET_KEY", "") or "").startswith("CHASECK_TEST-")
        )
        chapa_webhook_ok = bool(getattr(settings, "CHAPA_WEBHOOK_SECRET", ""))
        chapa_status = "configured" if chapa_key_ok else "not_configured"
        if chapa_key_ok:
            chapa_detail = (
                "Sandbox key configured · "
                + ("webhook secret set" if chapa_webhook_ok else "webhook secret missing (callbacks disabled)")
            )
        else:
            chapa_detail = "No Chapa test secret key configured — payments disabled"

        # DriverApp integration: real outbox counters (pending/blocked reveal
        # a stalled or failing event feed).
        outbox_pending = MarketplaceIntegrationOutbox.objects.filter(
            status__in=[MarketplaceIntegrationOutbox.Status.PENDING, MarketplaceIntegrationOutbox.Status.SENDING],
        ).count()
        outbox_delivered = MarketplaceIntegrationOutbox.objects.filter(
            status=MarketplaceIntegrationOutbox.Status.DELIVERED,
        ).count()
        outbox_blocked = MarketplaceIntegrationOutbox.objects.filter(
            status=MarketplaceIntegrationOutbox.Status.BLOCKED,
        ).count()
        driverapp_status = "operational" if outbox_blocked == 0 else "degraded"
        if outbox_pending + outbox_delivered + outbox_blocked == 0:
            driverapp_detail = "No integration events yet (feed idle)"
        else:
            driverapp_detail = f"{outbox_pending} pending · {outbox_delivered} delivered · {outbox_blocked} blocked"

        # WebSocket: honest configuration check. Whether the ASGI server is
        # actually serving sockets cannot be proven from inside the request
        # process, so the status is "configured", never a claimed "running".
        asgi_app = getattr(settings, "ASGI_APPLICATION", None)
        channels_installed = "channels" in getattr(settings, "INSTALLED_APPS", [])
        ws_configured = bool(asgi_app) and channels_installed
        ws_status = "configured" if ws_configured else "not_configured"
        ws_detail = (
            f"ASGI application: {asgi_app} · channels installed"
            if ws_configured
            else "ASGI application or channels not configured"
        )

        # Recent failures: real count of failed administrative actions.
        last_hour = timezone.now() - timedelta(hours=1)
        recent_errors = AuditLog.objects.filter(
            created_at__gte=last_hour, success=False
        ).count()

        services = [
            {
                "name": "Database",
                "status": "operational" if db_ok else "down",
                "detail": f"SQLite ({'connected' if db_ok else 'disconnected'}{f' · {db_latency_ms} ms' if db_ok else ''})",
            },
            {
                "name": "Cache",
                "status": "operational" if cache_ok else "degraded",
                "detail": "In-memory cache round-trip OK" if cache_ok else "Cache round-trip failed",
            },
            {"name": "Chapa Payment Gateway", "status": chapa_status, "detail": chapa_detail},
            {"name": "DriverApp Integration", "status": driverapp_status, "detail": driverapp_detail},
            {"name": "WebSocket Server", "status": ws_status, "detail": ws_detail},
        ]

        overall = "operational" if db_ok and cache_ok and chapa_key_ok else "degraded"
        return Response({
            "success": True,
            "status": overall,
            "services": services,
            "error_rate_last_hour": recent_errors,
            "db_latency_ms": db_latency_ms,
            "checked_at": timezone.now().isoformat(),
        })


class AllOrdersOversightView(APIView):
    """GET /api/v1/superadmin/orders-oversight/ — all orders platform-wide.

    Supports ``page``/``page_size`` pagination (25 per page by default).
    """

    def get_permissions(self):
        return [IsSuperAdmin()]

    def get(self, request):
        from payments.models import Order, OrderStatus
        orders = Order.objects.select_related(
            "product", "wholesaler", "farmer", "retailer"
        ).order_by("-created_at")
        params = request.query_params
        if params.get("status"):
            orders = orders.filter(status=params["status"])
        search = (params.get("search") or "").strip()
        if search:
            orders = orders.filter(
                Q(reference__icontains=search)
                | Q(product__title__icontains=search)
                | Q(wholesaler__full_name__icontains=search)
                | Q(farmer__full_name__icontains=search)
            )
        matched = orders.count()
        page, page_size = _page_params(request)
        start = (page - 1) * page_size
        rows = []
        for o in orders[start:start + page_size]:
            buyer = o.buyer
            seller = o.seller
            rows.append({
                "id": str(o.pk),
                "reference": o.reference,
                "product": o.product.title,
                "quantity": str(o.quantity),
                "total": str(o.total_amount),
                "discount": str(o.discount_amount),
                "payable": str(o.payable_amount),
                "status": o.status,
                "payment_status": o.payment_status,
                "buyer": buyer.full_name if buyer else None,
                "seller": seller.full_name if seller else None,
                "created_at": o.created_at.isoformat(),
            })
        return Response({
            "success": True,
            "summary": {
                "total": matched,
                "page": page,
                "page_size": page_size,
                "has_next": start + page_size < matched,
                "completed": orders.filter(status="Completed").count(),
                "pending": orders.filter(status__in=["Pending seller approval", "Accepted", "Processing", "Confirmed"]).count(),
                "disputed": orders.filter(status="Disputed").count(),
            },
            "orders": rows,
        })


def _page_params(request, default_size=25, max_size=100):
    """Shared pagination parsing for oversight lists."""
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = min(max_size, max(1, int(request.query_params.get("page_size", default_size))))
    except (TypeError, ValueError):
        page_size = default_size
    return page, page_size


class AllWalletsOversightView(APIView):
    """GET /api/v1/superadmin/wallets-oversight/ — all user wallets.

    Supports ``search`` (name/email), ``role`` filter and ``page``/``page_size``
    pagination. Summary totals always cover the entire platform, not the page.
    """

    def get_permissions(self):
        return [IsSuperAdmin()]

    def get(self, request):
        from payments.models import Wallet as W
        from users.models import Role

        wallets = W.objects.select_related("user").order_by("-available_balance")
        search = (request.query_params.get("search") or "").strip()
        role = (request.query_params.get("role") or "").strip()
        if search:
            wallets = wallets.filter(
                Q(user__full_name__icontains=search) | Q(user__email__icontains=search)
            )
        if role:
            if role not in Role.values:
                return Response(
                    {"success": False, "error": {"message": "Unknown role filter."}},
                    status=400,
                )
            wallets = wallets.filter(user__role=role)

        total_available = wallets.aggregate(s=Sum("available_balance"))["s"] or 0
        total_held = wallets.aggregate(s=Sum("held_balance"))["s"] or 0
        matched = wallets.count()

        page, page_size = _page_params(request)
        start = (page - 1) * page_size
        rows = list(wallets[start:start + page_size])
        return Response({
            "success": True,
            "summary": {
                "total_wallets": matched,
                "total_available": str(total_available),
                "total_held": str(total_held),
                "page": page,
                "page_size": page_size,
                "has_next": start + page_size < matched,
            },
            "wallets": [
                {
                    "id": str(w.pk),
                    "user": w.user.full_name,
                    "email": w.user.email,
                    "role": w.user.role,
                    "available": str(w.available_balance),
                    "held": str(w.held_balance),
                    "currency": w.currency,
                }
                for w in rows
            ],
        })


def _expire_due_announcements():
    """End any announcements whose expiry has passed.

    Expiry is enforced when the history is read (no scheduler required): the
    remaining in-app notifications are removed exactly like a manual "end".
    """
    from notifications.models import Announcement
    due = Announcement.objects.filter(ended_at__isnull=True, expires_at__lte=timezone.now())
    for a in due:
        a.notifications.all().delete()
        a.ended_at = timezone.now()
        a.save(update_fields=["ended_at"])


class AnnouncementHistoryView(APIView):
    """GET /api/v1/superadmin/broadcasts/ — announcement history.

    Query params: ``from``/``to`` (ISO dates filter created_at), ``status``
    (active|ended), ``page``/``page_size``. Reading the history also enforces
    pending expiries.
    """

    def get_permissions(self):
        return [IsSuperAdmin()]

    def get(self, request):
        from notifications.models import Announcement
        _expire_due_announcements()

        rows = Announcement.objects.all()
        date_from = request.query_params.get("from")
        date_to = request.query_params.get("to")
        try:
            if date_from:
                rows = rows.filter(created_at__date__gte=date_from)
            if date_to:
                rows = rows.filter(created_at__date__lte=date_to)
        except (ValueError, TypeError):
            return Response({"success": False, "error": {"message": "Invalid date filter (use YYYY-MM-DD)."}}, status=400)
        status = (request.query_params.get("status") or "").strip()
        if status == "active":
            rows = rows.filter(ended_at__isnull=True).exclude(expires_at__lte=timezone.now())
        elif status == "ended":
            rows = rows.filter(ended_at__isnull=False)

        matched = rows.count()
        page, page_size = _page_params(request, default_size=10, max_size=50)
        start = (page - 1) * page_size
        return Response({
            "success": True,
            "summary": {"total": matched, "page": page, "page_size": page_size, "has_next": start + page_size < matched},
            "broadcasts": [
                {
                    "id": str(a.pk),
                    "message": a.message,
                    "created_by": a.created_by.full_name if a.created_by else None,
                    "recipient_count": a.recipient_count,
                    "still_in_inboxes": a.notifications.count(),
                    "unread_remaining": a.notifications.filter(is_read=False).count(),
                    "created_at": a.created_at.isoformat(),
                    "expires_at": a.expires_at.isoformat() if a.expires_at else None,
                    "ended_at": a.ended_at.isoformat() if a.ended_at else None,
                    "status": "ended" if a.ended_at else "active",
                }
                for a in rows[start:start + page_size]
            ],
        })


class AnnouncementEndView(APIView):
    """POST /api/v1/superadmin/broadcasts/{id}/end/ — remove a broadcast from all inboxes.

    The Announcement row is retained (ended_at stamped) as the accountable
    history record; deleting it from history is not possible by design.
    """

    def get_permissions(self):
        return [IsSuperAdmin()]

    def post(self, request, pk):
        from django.shortcuts import get_object_or_404
        from notifications.models import Announcement
        announcement = get_object_or_404(Announcement, pk=pk)
        if announcement.ended_at:
            return Response({"success": True, "already_ended": True, "ended_at": announcement.ended_at.isoformat()})
        removed = announcement.notifications.all().delete()[0] or 0
        announcement.ended_at = timezone.now()
        announcement.save(update_fields=["ended_at"])
        AuditLog.objects.create(
            actor=request.user, action="announcement_ended",
            detail=f"{announcement.message[:200]} — {removed} notifications removed",
        )
        return Response({"success": True, "already_ended": False, "removed_notifications": removed, "ended_at": announcement.ended_at.isoformat()})
