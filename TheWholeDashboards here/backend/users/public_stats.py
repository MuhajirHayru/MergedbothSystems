from django.db.models import Count
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User
from registrations.models import AdministrativeLocation


class PublicStatsView(APIView):
    """GET /api/v1/auth/public-stats/ — landing page statistics (no auth)."""

    permission_classes = []

    def get(self, request):
        total_users = User.objects.filter(is_active=True).count()
        total_regions = AdministrativeLocation.objects.filter(
            level="REGION", active=True
        ).count()
        total_drivers = User.objects.filter(
            role="DRIVER", is_active=True
        ).count()
        return Response({
            "success": True,
            "stats": {
                "total_users": total_users,
                "total_regions": total_regions,
                "total_drivers": total_drivers,
            },
        })
