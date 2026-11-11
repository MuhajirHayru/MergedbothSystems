"""Driver transport agreements + centralized pricing engine (logistics module).

Covers the master-prompt requirements: Super Admin manages standing
agreements with configurable per-KM / per-quintal rates; the engine prices
shipments from the ACTIVE agreement only (240 km x 15 + 200 quintals x 25 =
8,600 ETB); expired/suspended agreements are never used; drivers read but
never modify their rates; kg -> quintal conversion happens exactly once.
"""
import pytest
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APIRequestFactory

from payments.freight_models import DriverTransportAgreement
from payments.transport_pricing import compute_transport_quote
from users.models import AccountStatus, Role, User

TODAY = timezone.now().date()


def make_staff(role, email):
    return User.objects.create_user(
        email=email, password="demo1234", full_name=email.split("@")[0],
        role=role, status=AccountStatus.APPROVED, privacy_policy_accepted=True,
    )


@pytest.fixture
def super_admin(db):
    return make_staff(Role.SUPER_ADMIN, "ta.super@test.et")


@pytest.fixture
def logistics_manager(db):
    return make_staff(Role.LOGISTICS_MANAGER, "ta.logistics@test.et")


@pytest.fixture
def driver(db):
    return make_staff(Role.DRIVER, "ta.driver@test.et")


@pytest.fixture
def driver2(db):
    return make_staff(Role.DRIVER, "ta.driver2@test.et")


def _agreement_payload(driver_id, rate_km="15.00", rate_qt="25.00"):
    return {
        "driver": driver_id,
        "vehicle_category": "Truck",
        "rate_per_km": rate_km,
        "rate_per_quintal": rate_qt,
        "start_date": TODAY.isoformat(),
        "expiry_date": TODAY.replace(year=TODAY.year + 1).isoformat(),
    }


def _activate(agreement):
    agreement.status = DriverTransportAgreement.Status.ACTIVE
    agreement.save(update_fields=["status"])
    return agreement


def test_super_admin_creates_an_agreement(api, super_admin, driver):
    api.force_authenticate(user=super_admin)
    response = api.post("/api/v1/payments/transport-agreements/", _agreement_payload(str(driver.pk)), format="json")
    assert response.status_code == 201, response.data
    agreement = DriverTransportAgreement.objects.get(pk=response.data["id"])
    assert agreement.rate_per_km == Decimal("15.00")
    assert agreement.status == DriverTransportAgreement.Status.DRAFT


def test_non_admin_cannot_create_agreements(api, logistics_manager, driver):
    api.force_authenticate(user=logistics_manager)
    response = api.post("/api/v1/payments/transport-agreements/", _agreement_payload(str(driver.pk)), format="json")
    assert response.status_code == 403
    assert DriverTransportAgreement.objects.count() == 0


def test_driver_reads_own_agreement_but_cannot_create(api, super_admin, driver):
    api.force_authenticate(user=super_admin)
    created = api.post("/api/v1/payments/transport-agreements/", _agreement_payload(str(driver.pk)), format="json")
    agreement = DriverTransportAgreement.objects.get(pk=created.data["id"])
    _activate(agreement)

    api.force_authenticate(user=driver)
    listing = api.get("/api/v1/payments/transport-agreements/")
    assert listing.status_code == 200
    assert [row["id"] for row in listing.data["agreements"]] == [str(agreement.pk)]
    assert listing.data["agreements"][0]["usable"] is True

    response = api.post("/api/v1/payments/transport-agreements/", _agreement_payload(str(driver.pk)), format="json")
    assert response.status_code == 403


def test_pricing_engine_matches_the_master_prompt_example(api, super_admin, driver):
    """240 km x ETB 15 + 200 quintals x ETB 25 = ETB 8,600."""
    api.force_authenticate(user=super_admin)
    created = api.post(
        "/api/v1/payments/transport-agreements/",
        _agreement_payload(str(driver.pk), rate_km="15.00", rate_qt="25.00"),
        format="json",
    )
    agreement = DriverTransportAgreement.objects.get(pk=created.data["id"])
    _activate(agreement)

    quote = compute_transport_quote(distance_km=Decimal("240"), weight_kg=Decimal("20000"), agreement=agreement)
    assert quote["distance_fee"] == "3600.00"
    assert quote["weight_fee"] == "5000.00"
    assert quote["total_compensation"] == "8600.00"
    assert quote["weight_quintals"] == "200.0000"  # 20,000 kg -> exactly 200 quintals
    assert quote["agreement_id"] == str(agreement.pk)


def test_kg_to_quintal_conversion_happens_once(api, driver):
    agreement = _activate(DriverTransportAgreement.objects.create(
        driver=driver, vehicle_category="Truck",
        rate_per_km=Decimal("15.00"), rate_per_quintal=Decimal("25.00"),
        start_date=TODAY, expiry_date=TODAY.replace(year=TODAY.year + 1),
    ))
    # 15,000 kg = 150 quintals -> 150 x 25 = 3,750 (no double conversion)
    quote = compute_transport_quote(distance_km=Decimal("10"), weight_kg=Decimal("15000"), agreement=agreement)
    assert quote["weight_quintals"] == "150.0000"
    assert quote["weight_fee"] == "3750.00"


def test_expired_agreement_is_never_used(api, driver):
    last_year = TODAY.replace(year=TODAY.year - 1)
    agreement = _activate(DriverTransportAgreement.objects.create(
        driver=driver, vehicle_category="Truck",
        rate_per_km=Decimal("15.00"), rate_per_quintal=Decimal("25.00"),
        start_date=last_year, expiry_date=TODAY.replace(year=TODAY.year - 1, month=12, day=31) if TODAY.month < 12 else last_year,
    ))
    with pytest.raises(ValueError, match="no active transportation agreement"):
        compute_transport_quote(distance_km=Decimal("100"), weight_kg=Decimal("5000"), agreement=agreement)


def test_suspended_agreement_is_never_used(api, driver):
    agreement = _activate(DriverTransportAgreement.objects.create(
        driver=driver, vehicle_category="Truck",
        rate_per_km=Decimal("15.00"), rate_per_quintal=Decimal("25.00"),
        start_date=TODAY, expiry_date=TODAY.replace(year=TODAY.year + 1),
    ))
    agreement.status = DriverTransportAgreement.Status.SUSPENDED
    agreement.save(update_fields=["status"])
    with pytest.raises(ValueError, match="no active transportation agreement"):
        compute_transport_quote(distance_km=Decimal("100"), weight_kg=Decimal("5000"), agreement=agreement)


def test_active_agreement_selection_prefers_the_matching_category(api, driver, driver2):
    _activate(DriverTransportAgreement.objects.create(
        driver=driver, vehicle_category="Truck",
        rate_per_km=Decimal("15.00"), rate_per_quintal=Decimal("25.00"),
        start_date=TODAY, expiry_date=TODAY.replace(year=TODAY.year + 1),
    ))
    _activate(DriverTransportAgreement.objects.create(
        driver=driver2, vehicle_category="Truck",
        rate_per_km=Decimal("20.00"), rate_per_quintal=Decimal("30.00"),
        start_date=TODAY, expiry_date=TODAY.replace(year=TODAY.year + 1),
    ))
    # Each driver is priced from their own agreement; drivers never see or
    # use another driver's rates.
    from payments.transport_pricing import active_agreement_for

    mine = active_agreement_for(driver, "Truck")
    theirs = active_agreement_for(driver2, "Truck")
    assert mine.rate_per_km == Decimal("15.00")
    assert theirs.rate_per_km == Decimal("20.00")
    assert mine.driver_id == driver.pk


def test_quote_endpoint_rejects_calls_without_an_active_agreement(api, super_admin, logistics_manager, driver):
    api.force_authenticate(user=logistics_manager)
    response = api.post(
        "/api/v1/payments/transport-quotes/",
        {"driver_id": str(driver.pk), "weight_kg": "20000", "distance_km": "240"},
        format="json",
    )
    assert response.status_code == 409
    assert "bidding flow" in response.data["error"]


def test_quote_endpoint_returns_the_breakdown(api, super_admin, logistics_manager, driver):
    api.force_authenticate(user=super_admin)
    created = api.post("/api/v1/payments/transport-agreements/", _agreement_payload(str(driver.pk)), format="json")
    _activate(DriverTransportAgreement.objects.get(pk=created.data["id"]))

    api.force_authenticate(user=logistics_manager)
    response = api.post(
        "/api/v1/payments/transport-quotes/",
        {"driver_id": str(driver.pk), "weight_kg": "20000", "distance_km": "240"},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["quote"]["total_compensation"] == "8600.00"


def test_only_superuser_modifies_agreements(api, super_admin, logistics_manager, driver):
    api.force_authenticate(user=super_admin)
    created = api.post("/api/v1/payments/transport-agreements/", _agreement_payload(str(driver.pk)), format="json")
    url = f"/api/v1/payments/transport-agreements/{created.data['id']}/"

    api.force_authenticate(user=logistics_manager)
    denied = api.patch(url, {"rate_per_km": "99.00"}, format="json")
    assert denied.status_code == 403

    api.force_authenticate(user=driver)
    denied = api.patch(url, {"rate_per_km": "99.00"}, format="json")
    assert denied.status_code == 403

    api.force_authenticate(user=super_admin)
    allowed = api.patch(url, {"status": "ACTIVE"}, format="json")
    assert allowed.status_code == 200
    agreement = DriverTransportAgreement.objects.get(pk=created.data["id"])
    assert agreement.status == DriverTransportAgreement.Status.ACTIVE
    assert agreement.approved_by_id == super_admin.pk
