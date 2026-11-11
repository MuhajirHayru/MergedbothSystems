"""Centralized transportation pricing engine (Stage: logistics module).

Computes driver transport quotations from the driver's ACTIVE transport
agreement:

    Distance Fee  = road distance (KM) x agreed rate per KM
    Weight Fee    = shipment quantity (quintals) x agreed rate per quintal
    Total         = Distance Fee + Weight Fee

1 Ethiopian quintal = 100 kilograms; kilograms convert to quintals exactly
once (never double-converted or double-charged). The quotation stores the
agreement version (id + rates) that produced it; later agreement changes
never alter an already-issued quotation.
"""
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

from .freight_models import DriverTransportAgreement

KG_PER_QUINTAL = Decimal("100")


def active_agreement_for(driver, vehicle_category="", on=None):
    """Return the driver's usable agreement for the category, or None.

    Expired, suspended and draft agreements are never returned: the caller
    falls back to the bidding flow for un-agreed drivers.
    """
    on = on or timezone.now().date()
    candidates = DriverTransportAgreement.objects.filter(
        driver=driver,
        status=DriverTransportAgreement.Status.ACTIVE,
        start_date__lte=on,
        expiry_date__gte=on,
    ).order_by("-updated_at")
    if vehicle_category:
        exact = candidates.filter(vehicle_category__iexact=vehicle_category).first()
        if exact:
            return exact
    # No category requested (or none matches): the driver's newest usable
    # agreement prices the shipment.
    return candidates.first()


def compute_transport_quote(*, distance_km, weight_kg, agreement):
    """Transparent quotation from an active agreement.

    Returns the full breakdown (no hidden rounding) with two-decimal money
    figures. Raises ValueError when the agreement is not usable — an expired
    or suspended agreement must never price a new shipment.
    """
    distance = Decimal(str(distance_km))
    weight_kg = Decimal(str(weight_kg))
    if distance <= 0:
        raise ValueError("Road distance must be greater than zero.")
    if weight_kg <= 0:
        raise ValueError("Shipment weight must be greater than zero.")

    today = timezone.now().date()
    if not agreement.is_usable(on=today):
        raise ValueError(
            "The driver has no active transportation agreement for this shipment."
        )

    quintals = (weight_kg / KG_PER_QUINTAL).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    distance_fee = (distance * agreement.rate_per_km).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    weight_fee = (quintals * agreement.rate_per_quintal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total = (distance_fee + weight_fee).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return {
        "agreement_id": str(agreement.pk),
        "agreement_status": agreement.status,
        "agreement_expiry": agreement.expiry_date.isoformat(),
        "rate_per_km": str(agreement.rate_per_km),
        "rate_per_quintal": str(agreement.rate_per_quintal),
        "distance_km": str(distance),
        "weight_kg": str(weight_kg),
        "weight_quintals": str(quintals),
        "distance_fee": str(distance_fee),
        "weight_fee": str(weight_fee),
        "total_compensation": str(total),
        "currency": "ETB",
    }


def road_distance_km(pickup, destination):
    """Actual road distance in KM between two (lat, lng) points via OSRM.

    Never uses straight-line distance: the driving route is requested from
    the public OSRM router. Returns None when the service is unreachable or
    the route cannot be calculated, so the caller can fall back to a
    manager-entered distance instead of guessing.
    """
    import urllib.request

    if not pickup or not destination:
        return None
    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{pickup[1]},{pickup[0]};{destination[1]},{destination[0]}"
        "?overview=false"
    )
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            import json

            data = json.loads(resp.read().decode())
        distance_m = data["routes"][0]["distance"]
        km = Decimal(str(distance_m)) / Decimal("1000")
        return km.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    except Exception:
        return None
