"""Transport agreement management + quotation API (logistics module).

- `/payments/transport-agreements/` — Super Admin manages the standing
  driver agreements; drivers read their own active agreement (read-only).
- `/payments/transport-quotes/` — Logistics Manager / Super Admin request a
  transparent quotation from the driver's active agreement (road distance
  via OSRM or a manager-entered distance).
"""
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AuditLog, Role
from users.permissions import IsRole

from .freight_models import DriverTransportAgreement


class _AgreementReadPermission(IsRole):
    allowed_roles = ("SUPER_ADMIN", "DRIVER")


class _AgreementManagePermission(IsRole):
    allowed_roles = ("SUPER_ADMIN",)


class _QuotePermission(IsRole):
    allowed_roles = ("SUPER_ADMIN", "LOGISTICS_MANAGER", "FINANCIAL_MANAGER", "TOP_USER_ADMIN")
from .transport_pricing import active_agreement_for, compute_transport_quote, road_distance_km

User = get_user_model()


def _parse_date(value, field, errors):
    from django.utils.dateparse import parse_date

    parsed = parse_date(str(value or "").strip())
    if parsed is None:
        errors[field] = "Use the YYYY-MM-DD date format."
    return parsed


class TransportAgreementListCreateView(APIView):
    """GET: own agreements (drivers) or all (Super Admin). POST: Super Admin only."""

    permission_classes = [_AgreementReadPermission]


    def get(self, request):
        if request.user.role == Role.SUPER_ADMIN:
            agreements = DriverTransportAgreement.objects.select_related("driver").order_by("-created_at")
        elif request.user.role == Role.DRIVER:
            agreements = DriverTransportAgreement.objects.filter(driver=request.user).order_by("-created_at")
        else:
            raise PermissionDenied("Only the Super Admin and drivers can view transport agreements.")
        rows = [
            {
                "id": str(a.pk),
                "driver_id": str(a.driver_id),
                "driver_email": a.driver.email,
                "driver_name": a.driver.full_name,
                "vehicle_category": a.vehicle_category,
                "rate_per_km": str(a.rate_per_km),
                "rate_per_quintal": str(a.rate_per_quintal),
                "start_date": a.start_date.isoformat(),
                "expiry_date": a.expiry_date.isoformat(),
                "status": a.status,
                "usable": a.is_usable(),
                "notes": a.notes,
            }
            for a in agreements
        ]
        return Response({"agreements": rows})

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can create transport agreements.")
        errors = {}
        driver_id = request.data.get("driver")
        driver = User.objects.filter(pk=driver_id, role=Role.DRIVER).first() if driver_id else None
        if driver is None:
            errors["driver"] = "Choose a registered driver."
        try:
            rate_per_km = Decimal(str(request.data.get("rate_per_km") or 0))
            rate_per_quintal = Decimal(str(request.data.get("rate_per_quintal") or 0))
        except Exception:
            errors["rate_per_km"] = "Rates must be numbers."
            rate_per_km = rate_per_quintal = None
        start = _parse_date(request.data.get("start_date"), "start_date", errors)
        expiry = _parse_date(request.data.get("expiry_date"), "expiry_date", errors)
        if errors:
            return Response({"success": False, "error": errors}, status=status.HTTP_400_BAD_REQUEST)
        try:
            agreement = DriverTransportAgreement.objects.create(
                driver=driver,
                vehicle_category=str(request.data.get("vehicle_category") or "").strip()[:120],
                rate_per_km=rate_per_km,
                rate_per_quintal=rate_per_quintal,
                start_date=start,
                expiry_date=expiry,
                notes=str(request.data.get("notes") or "").strip()[:300],
            )
        except ValidationError as exc:
            return Response({"success": False, "error": exc.message_dict}, status=status.HTTP_400_BAD_REQUEST)
        AuditLog.objects.create(
            actor=request.user,
            action="transport_agreement_created",
            target=str(agreement.pk),
            detail=f"{driver.email}: {agreement.rate_per_km}/km, {agreement.rate_per_quintal}/quintal",
        )
        return Response({"success": True, "id": str(agreement.pk), "status": agreement.status}, status=status.HTTP_201_CREATED)


class TransportAgreementDetailView(APIView):
    """PATCH: Super Admin updates rates/dates/status (drivers never)."""

    permission_classes = [_AgreementManagePermission]


    def patch(self, request, pk=None):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can modify transport agreements.")
        agreement = DriverTransportAgreement.objects.filter(pk=pk).first()
        if agreement is None:
            return Response({"success": False, "error": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)
        changes = {}
        for field in ("rate_per_km", "rate_per_quintal"):
            if field in request.data:
                setattr(agreement, field, request.data[field])
                changes[field] = str(request.data[field])
        for field in ("vehicle_category", "notes"):
            if field in request.data:
                setattr(agreement, field, str(request.data[field]).strip()[:300])
                changes[field] = getattr(agreement, field)
        for field in ("start_date", "expiry_date"):
            if field in request.data:
                from django.utils.dateparse import parse_date

                parsed = parse_date(str(request.data[field]))
                if parsed is None:
                    return Response({"success": False, "error": {field: "Use YYYY-MM-DD."}}, status=status.HTTP_400_BAD_REQUEST)
                setattr(agreement, field, parsed)
                changes[field] = str(parsed)
        if "status" in request.data:
            new_status = str(request.data["status"]).upper()
            if new_status not in DriverTransportAgreement.Status.values:
                return Response({"success": False, "error": {"status": "Unknown status."}}, status=status.HTTP_400_BAD_REQUEST)
            agreement.status = new_status
            changes["status"] = new_status
            if new_status == DriverTransportAgreement.Status.ACTIVE:
                agreement.approved_by = request.user
                agreement.approved_at = timezone.now()
                changes["approved"] = True
        try:
            agreement.full_clean()
            agreement.save()
        except ValidationError as exc:
            return Response({"success": False, "error": exc.message_dict}, status=status.HTTP_400_BAD_REQUEST)
        AuditLog.objects.create(
            actor=request.user,
            action="transport_agreement_updated",
            target=str(agreement.pk),
            detail=str(changes),
        )
        return Response({"success": True, "status": agreement.status, "changes": changes})


class TransportQuoteView(APIView):
    permission_classes = [_QuotePermission]

    """POST /payments/transport-quotes/ — transparent pricing breakdown.

    Body: driver_id, weight_kg, and either distance_km (manager-entered) or
    pickup/destination coordinates (road distance resolved via OSRM).
    """


    def post(self, request):
        from decimal import Decimal

        if request.user.role not in (Role.SUPER_ADMIN, Role.LOGISTICS_MANAGER, Role.FINANCIAL_MANAGER, Role.TOP_USER_ADMIN):
            raise PermissionDenied("Only logistics staff can request transport quotations.")
        driver = User.objects.filter(pk=request.data.get("driver_id"), role=Role.DRIVER).first()
        if driver is None:
            return Response({"success": False, "error": "Choose a registered driver."}, status=status.HTTP_400_BAD_REQUEST)
        weight_kg = request.data.get("weight_kg")
        distance_km = request.data.get("distance_km")
        pickup = request.data.get("pickup")
        destination = request.data.get("destination")
        if distance_km in (None, "") and pickup and destination:
            try:
                distance_km = road_distance_km(
                    (float(pickup[0]), float(pickup[1])), (float(destination[0]), float(destination[1]))
                )
            except Exception:
                distance_km = None
            if distance_km is None:
                return Response(
                    {"success": False, "error": "The road distance service is unreachable — enter the road distance in KM manually."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        if distance_km in (None, ""):
            return Response({"success": False, "error": "Provide the road distance in KM or pickup/destination coordinates."}, status=status.HTTP_400_BAD_REQUEST)
        agreement = active_agreement_for(driver, str(request.data.get("vehicle_category") or ""))
        if agreement is None:
            return Response(
                {"success": False, "error": "The driver has no active transport agreement — use the bidding flow for this shipment."},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            quote = compute_transport_quote(
                distance_km=Decimal(str(distance_km)), weight_kg=Decimal(str(weight_kg)), agreement=agreement
            )
        except ValueError as exc:
            return Response({"success": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({"success": False, "error": "Provide the shipment weight in kilograms."}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"success": True, "driver": driver.email, "quote": quote})
