"""Parts 19.3/22 — geographic driver administration for the hierarchy.

Drivers register with a kebele/wereda location. The admin whose scope covers
that location (wereda admin → wereda; zonal → the zone's weredas; regional →
the region; top user admin → global) sees and manages those drivers. Everyone
outside the scope sees nothing. Approval/rejection still flow through the
existing pending-users endpoints, which use the same scoping.
"""

from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from registrations.models import RegistrationDocument
from registrations.services import users_visible_to_admin
from users.permissions import IsAuthenticatedRole
from users.models import AccountStatus, Role, User

from payments.models import OrderShipmentDetails


class ScopedDriverListView(APIView):
    """GET /api/v1/admin/drivers/ — drivers within the caller's geographic scope."""

    def get_permissions(self):
        return [IsAuthenticatedRole(
            (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN,
             Role.ZONAL_ADMIN, Role.WEREDA_ADMIN, Role.USER_ADMIN,
             Role.LOGISTICS_MANAGER)
        )]

    def get(self, request):
        user = request.user
        # The logistics tracker needs platform-wide driver access for freight
        # coordination (Part 26.4) — geographic restriction stays for hierarchy admins.
        if user.role == Role.LOGISTICS_MANAGER:
            drivers = User.objects.filter(
                role=Role.DRIVER
            ).select_related("registration__location", "driver_profile")
        else:
            drivers = users_visible_to_admin(
                user,
                User.objects.filter(role=Role.DRIVER).select_related("registration__location", "driver_profile"),
            )
        params = request.query_params
        if params.get("status"):
            drivers = drivers.filter(status=params["status"])
        search = (params.get("search") or "").strip()
        if search:
            drivers = drivers.filter(
                Q(full_name__icontains=search) | Q(email__icontains=search)
                | Q(registration__driving_license_number__icontains=search)
                | Q(registration__vehicle_registration__icontains=search)
            )
        rows = []
        for driver in drivers[:200]:
            reg = getattr(driver, "registration", None)
            location = reg.location if reg else None
            docs_ok = True
            if reg is not None:
                verified = set(reg.documents.filter(
                    verification_status=RegistrationDocument.VerificationStatus.VERIFIED
                ).values_list("document_type", flat=True))
                required = {"IDENTITY_DOCUMENT", "DRIVING_LICENSE", "VEHICLE_REGISTRATION"}
                docs_ok = required.issubset(verified)
            shipments = OrderShipmentDetails.objects.filter(
                order__farmer=driver,
                authorized_at__isnull=False,
            ).count()
            profile = getattr(driver, "driver_profile", None)
            is_available = profile.is_available if profile is not None else False
            rows.append({
                "id": str(driver.pk),
                "full_name": driver.full_name,
                "email": driver.email,
                "status": driver.status,
                "is_available": is_available,
                "location": str(location) if location else None,
                "location_id": str(location.pk) if location else None,
                "driving_license": reg.driving_license_number if reg else "",
                "vehicle_type": reg.vehicle_type if reg else "",
                "vehicle_registration": reg.vehicle_registration if reg else "",
                "cargo_capacity_kg": str(reg.cargo_capacity_kg) if reg and reg.cargo_capacity_kg else None,
                "documents_verified": docs_ok,
                "authorized_shipments": shipments,
                "registered_at": driver.created_at.isoformat() if driver.created_at else None,
            })
        return Response({
            "success": True,
            "summary": {
                "total": drivers.count(),
                "pending": drivers.filter(status=AccountStatus.PENDING).count(),
                "approved": drivers.filter(status=AccountStatus.APPROVED).count(),
                "suspended": drivers.filter(status=AccountStatus.SUSPENDED).count(),
            },
            "drivers": rows,
        })
