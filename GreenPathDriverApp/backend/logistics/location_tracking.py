from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from .models import DriverShipmentLocation, LogisticsUser, Shipment
from .services import record_audit
from .shipment_services import (
    ShipmentConflict,
    driver_meets_shipment_requirements,
    is_active_assigned_driver,
    is_active_shipment_buyer,
    marketplace_order_is_authorized,
)


TRACKABLE_SHIPMENT_STATUSES = {
    Shipment.Status.ASSIGNED,
    Shipment.Status.PICKUP_PENDING,
    Shipment.Status.PICKUP_ARRIVED,
    Shipment.Status.PICKED_UP,
    Shipment.Status.IN_TRANSIT,
    Shipment.Status.DELIVERY_ATTEMPTED,
    Shipment.Status.DELIVERY_CONFIRMATION_REQUESTED,
}


def _location_response(shipment, location=None):
    now = timezone.now()
    max_stale = settings.DRIVER_LOCATION_STALE_AFTER_SECONDS
    if location is None:
        sharing_status = "stopped"
        is_sharing = False
        last_updated_at = None
        location_data = None
    else:
        is_sharing = (
            location.sharing_stopped_at is None
            and location.sharing_expires_at > now
        )
        last_updated_at = location.received_at
        has_coordinates = location.latitude is not None
        if location.sharing_stopped_at is not None:
            sharing_status = "stopped"
        elif is_sharing and location.observed_at is None:
            sharing_status = "starting"
        elif (
            has_coordinates
            and (
                not is_sharing
                or now - location.observed_at > timedelta(seconds=max_stale)
            )
        ):
            sharing_status = "stale"
        elif is_sharing:
            sharing_status = "sharing"
        else:
            sharing_status = "stopped"
        location_data = (
            {
                "latitude": str(location.latitude),
                "longitude": str(location.longitude),
                "accuracy_meters": str(location.accuracy_meters),
                "observed_at": location.observed_at,
            }
            if has_coordinates
            else None
        )

    return {
        "shipment_id": shipment.pk,
        "shipment_status": shipment.status,
        "sharing_status": sharing_status,
        "is_sharing": is_sharing,
        "location": location_data,
        "last_updated_at": last_updated_at,
        "stale_after_seconds": max_stale,
    }


def _get_authorized_shipment(shipment_id, user, *, lock=False):
    shipments = Shipment.objects.select_related(
        "buyer", "assigned_driver"
    )
    if lock:
        shipments = shipments.select_for_update()
    shipment = shipments.filter(pk=shipment_id).first()
    if shipment is None:
        raise NotFound("Shipment was not found.")

    is_assigned_driver = is_active_assigned_driver(shipment, user)
    is_buyer = is_active_shipment_buyer(shipment, user)
    if not (is_assigned_driver or is_buyer):
        raise NotFound("Shipment was not found.")
    if not marketplace_order_is_authorized(shipment):
        raise NotFound("Shipment was not found.")
    return shipment, is_assigned_driver, is_buyer


def _require_trackable(shipment):
    if shipment.status not in TRACKABLE_SHIPMENT_STATUSES:
        raise ShipmentConflict(
            "Location sharing is unavailable for this shipment status."
        )
    if not shipment.order_verified or shipment.assigned_driver_id is None:
        raise ShipmentConflict(
            "Location sharing requires a marketplace-authorized driver assignment."
        )


@transaction.atomic
def start_location_sharing(shipment_id, driver):
    shipment, is_assigned_driver, _ = _get_authorized_shipment(
        shipment_id, driver, lock=True
    )
    if not is_assigned_driver:
        raise NotFound("Shipment was not found.")
    _require_trackable(shipment)
    if not driver_meets_shipment_requirements(driver, shipment):
        raise PermissionDenied(
            "The assigned driver is no longer eligible for this shipment."
        )

    now = timezone.now()
    location, created = DriverShipmentLocation.objects.get_or_create(
        shipment=shipment,
        defaults={
            "driver": driver,
            "sharing_started_at": now,
            "sharing_expires_at": now
            + timedelta(seconds=settings.DRIVER_LOCATION_SESSION_TIMEOUT_SECONDS),
        },
    )
    if not created:
        location.driver = driver
        location.sharing_started_at = now
        location.sharing_stopped_at = None
        location.sharing_expires_at = now + timedelta(
            seconds=settings.DRIVER_LOCATION_SESSION_TIMEOUT_SECONDS
        )
        location.save(
            update_fields=[
                "driver",
                "sharing_started_at",
                "sharing_stopped_at",
                "sharing_expires_at",
            ]
        )
    record_audit(
        driver,
        "shipment.location_sharing_started",
        "shipment",
        shipment.pk,
        {"shipment_id": shipment.pk},
    )
    return _location_response(shipment, location)


@transaction.atomic
def update_driver_location(shipment_id, driver, values):
    shipment, is_assigned_driver, _ = _get_authorized_shipment(
        shipment_id, driver, lock=True
    )
    if not is_assigned_driver:
        raise NotFound("Shipment was not found.")
    _require_trackable(shipment)
    if not driver_meets_shipment_requirements(driver, shipment):
        raise PermissionDenied(
            "The assigned driver is no longer eligible for this shipment."
        )

    location = (
        DriverShipmentLocation.objects.select_for_update()
        .filter(shipment=shipment, driver=driver)
        .first()
    )
    now = timezone.now()
    if (
        location is None
        or location.sharing_stopped_at is not None
        or location.sharing_expires_at <= now
    ):
        raise ShipmentConflict(
            "Location sharing has stopped or expired. Start sharing again."
        )

    observed_at = values["observed_at"]
    age = now - observed_at
    if age > timedelta(seconds=settings.DRIVER_LOCATION_MAX_AGE_SECONDS):
        raise ValidationError({"observed_at": "Location update is too old."})
    if age < -timedelta(seconds=settings.DRIVER_LOCATION_FUTURE_SKEW_SECONDS):
        raise ValidationError(
            {"observed_at": "Location timestamp is too far in the future."}
        )
    if (
        location.observed_at is not None
        and observed_at <= location.observed_at
    ):
        raise ValidationError(
            {"observed_at": "Location updates must be newer than the last accepted update."}
        )
    if values["accuracy_meters"] > settings.DRIVER_LOCATION_MAX_ACCURACY_METERS:
        raise ValidationError(
            {
                "accuracy_meters": (
                    "GPS accuracy exceeds the configured maximum of "
                    f"{settings.DRIVER_LOCATION_MAX_ACCURACY_METERS} meters."
                )
            }
        )

    location.latitude = values["latitude"]
    location.longitude = values["longitude"]
    location.accuracy_meters = values["accuracy_meters"]
    location.observed_at = observed_at
    location.received_at = now
    location.sharing_expires_at = now + timedelta(
        seconds=settings.DRIVER_LOCATION_SESSION_TIMEOUT_SECONDS
    )
    location.save(
        update_fields=[
            "latitude",
            "longitude",
            "accuracy_meters",
            "observed_at",
            "received_at",
            "sharing_expires_at",
        ]
    )
    return _location_response(shipment, location)


@transaction.atomic
def stop_location_sharing(shipment_id, driver):
    shipment = (
        Shipment.objects.select_for_update()
        .filter(pk=shipment_id, assigned_driver=driver)
        .first()
    )
    if (
        shipment is None
        or not driver.is_active
        or driver.role != LogisticsUser.Role.DRIVER
    ):
        raise NotFound("Shipment was not found.")
    location = DriverShipmentLocation.objects.select_for_update().filter(
        shipment=shipment, driver=driver
    ).first()
    if location is not None and location.sharing_stopped_at is None:
        location.sharing_stopped_at = timezone.now()
        location.sharing_expires_at = location.sharing_stopped_at
        location.save(update_fields=["sharing_stopped_at", "sharing_expires_at"])
        record_audit(
            driver,
            "shipment.location_sharing_stopped",
            "shipment",
            shipment.pk,
            {"shipment_id": shipment.pk},
        )
    return _location_response(shipment, location)


def get_shipment_location(shipment_id, user):
    shipment, _, _ = _get_authorized_shipment(shipment_id, user)
    location = DriverShipmentLocation.objects.filter(shipment=shipment).first()
    if (
        location is not None
        and location.driver_id != shipment.assigned_driver_id
    ):
        return _location_response(shipment)
    if location is not None and not driver_meets_shipment_requirements(
        location.driver, shipment
    ):
        raise NotFound("Shipment was not found.")
    return _location_response(shipment, location)
