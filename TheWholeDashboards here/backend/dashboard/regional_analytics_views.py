"""Part 19 — regional analytics endpoints (Super Admin and hierarchy admins)."""

from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsAuthenticatedRole
from users.models import Role

from .regional_analytics import admin_activity_report, regional_drilldown, regional_overview

ANALYTICS_ROLES = (
    Role.SUPER_ADMIN,
    Role.TOP_USER_ADMIN,
    Role.REGIONAL_ADMIN,
    Role.ZONAL_ADMIN,
    Role.WEREDA_ADMIN,
    Role.USER_ADMIN,
)


class RegionalAnalyticsView(APIView):
    """GET /api/v1/reports/regional-analytics/ — region comparison + trends."""

    def get_permissions(self):
        return [IsAuthenticatedRole(ANALYTICS_ROLES)]

    def get(self, request):
        return Response({"success": True, **regional_overview()})


class RegionalDrilldownView(APIView):
    """GET /api/v1/reports/regional-analytics/<uuid:location_id>/ — node drill-down."""

    def get_permissions(self):
        return [IsAuthenticatedRole(ANALYTICS_ROLES)]

    def get(self, request, location_id):
        data = regional_drilldown(location_id)
        if data is None:
            return Response({"success": False, "error": "Unknown administrative location."}, status=404)
        return Response({"success": True, **data})


class AdminActivityView(APIView):
    """GET /api/v1/reports/admin-activity/?days=90 — staff action oversight."""

    def get_permissions(self):
        return [IsAuthenticatedRole((Role.SUPER_ADMIN, Role.TOP_USER_ADMIN))]

    def get(self, request):
        try:
            days = int(request.query_params.get("days", 90))
        except (TypeError, ValueError):
            days = 90
        days = max(1, min(days, 365))
        return Response({"success": True, **admin_activity_report(days=days)})
