"""Part 26 — freight oversight board tests."""

import pytest
from django.utils import timezone

from payments.models import MarketplaceDeliveryFeeAgreement, Order, OrderStatus, OrderShipmentDetails
from users.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def logistics_manager(db):
    from tests.conftest import make_user
    return make_user(Role.LOGISTICS_MANAGER, "logistics@test.et", "Logi Manager")


def _authorized_order(farmer, wholesaler, farmer_product, farmer_product_region=None, reference="#FRB-1"):
    order = Order.objects.create(
        reference=reference, wholesaler=wholesaler, farmer=farmer,
        product=farmer_product, quantity="5", total_amount="210.00",
        status=OrderStatus.SHIPPED,
    )
    from registrations.models import AdministrativeLocation
    region = AdministrativeLocation.objects.filter(level="REGION", active=True).first()
    if region is None:
        region = AdministrativeLocation.objects.create(
            source_id="test-region-1", name="Test Region", level="REGION", active=True,
        )
    OrderShipmentDetails.objects.create(
        order=order,
        pickup_region=region, pickup_address_line="Farm gate km 12",
        destination_region=region, destination_address_line="Bole warehouse",
        cargo_weight_kg="120", packaging_details="crates",
        delivery_fee_proposal_amount="150.00",
        buyer_confirmed_revision=1, seller_confirmed_revision=1,
        authorized_at=timezone.now(),
    )
    return order


def test_board_lists_authorized_shipments_with_agreement(api, super_admin, farmer, wholesaler, farmer_product):
    order = _authorized_order(farmer, wholesaler, farmer_product)
    api.force_authenticate(user=super_admin)
    response = api.get("/api/v1/payments/financial/freight-board/")
    assert response.status_code == 200
    row = next((r for r in response.data["shipments"] if r["order_reference"] == "#FRB-1"), None)
    assert row is not None
    assert row["cargo_weight_kg"] in ("120", "120.00")
    assert row["agreement"] is None  # no agreement recorded yet
    assert response.data["summary"]["awaiting_agreement"] >= 1


def test_board_shows_pricing_snapshot_when_agreed(api, super_admin, farmer, wholesaler, farmer_product):
    order = _authorized_order(farmer, wholesaler, farmer_product)
    MarketplaceDeliveryFeeAgreement.objects.create(
        order=order, source_event_id="3f2b6f0a-1111-4a2a-9c9c-e2efb1000001", driver_shipment_id=77,
        driver_external_user_id="drv-1", driver_proposal_version=1,
        amount="150.00", buyer_accepted_at=timezone.now(), driver_accepted_at=timezone.now(),
        pricing_model_snapshot="A", driver_charge_snapshot="135.00", platform_fee_snapshot="15.00",
    )
    api.force_authenticate(user=super_admin)
    response = api.get("/api/v1/payments/financial/freight-board/", {"search": "#FRB-1"})
    row = next(r for r in response.data["shipments"] if r["order_reference"] == "#FRB-1")
    assert row["agreement"]["pricing_model"] == "A"
    assert row["agreement"]["driver_charge"] == "135.00"
    assert row["payment_status"] is None


def test_logistics_manager_and_fm_can_read_farmer_cannot(api, farmer, logistics_manager, financial_manager):
    api.force_authenticate(user=logistics_manager)
    assert api.get("/api/v1/payments/financial/freight-board/").status_code == 200
    api.force_authenticate(user=financial_manager)
    assert api.get("/api/v1/payments/financial/freight-board/").status_code == 200
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/payments/financial/freight-board/").status_code == 403


def test_search_filters(api, super_admin, farmer, wholesaler, farmer_product):
    _authorized_order(farmer, wholesaler, farmer_product)
    api.force_authenticate(user=super_admin)
    hit = api.get("/api/v1/payments/financial/freight-board/", {"search": "Bole warehouse"})
    assert len(hit.data["shipments"]) >= 1
    miss = api.get("/api/v1/payments/financial/freight-board/", {"search": "nonexistent-place"})
    assert all(r["order_reference"] != "#FRB-1" for r in miss.data["shipments"])


def test_board_paginates_and_searches_participants(api, super_admin, farmer, wholesaler, farmer_product):
    _authorized_order(farmer, wholesaler, farmer_product, reference="#FRB-PAGE-1")
    _authorized_order(farmer, wholesaler, farmer_product, reference="#FRB-PAGE-2")
    api.force_authenticate(user=super_admin)

    first_page = api.get("/api/v1/payments/financial/freight-board/", {"page": 1, "page_size": 1})
    assert first_page.status_code == 200
    assert len(first_page.data["shipments"]) == 1
    assert first_page.data["pagination"]["total_items"] == 2
    assert first_page.data["pagination"]["has_next"] is True
    assert first_page.data["summary"]["authorized_shipments"] == 2
    assert first_page.data["summary"]["awaiting_agreement"] == 2
    assert first_page.data["regions"]

    participant_search = api.get(
        "/api/v1/payments/financial/freight-board/", {"search": farmer.full_name}
    )
    assert participant_search.status_code == 200
    assert participant_search.data["pagination"]["total_items"] == 2


def test_board_rejects_invalid_page_parameters(api, super_admin):
    api.force_authenticate(user=super_admin)
    response = api.get("/api/v1/payments/financial/freight-board/", {"page": 0})
    assert response.status_code == 400


def test_board_returns_registered_driver_coordinates_without_geocoding(api, logistics_manager):
    from logistics.models import DriverApplication, DriverProfile
    from tests.conftest import make_user

    driver = make_user(
        Role.DRIVER, "map-driver@test.et", "Map Driver", location="Registered farm address",
        latitude="9.145000", longitude="38.765000",
    )
    profile = DriverProfile.objects.create(
        user=driver, phone_number="+251900000002", is_available=True,
    )
    DriverApplication.objects.create(
        profile=profile, legal_full_name="Map Driver", status=DriverApplication.Status.APPROVED,
        vehicle_type="Truck", cargo_capacity_kg="2500.00", service_region="Amhara",
    )
    api.force_authenticate(user=logistics_manager)

    response = api.get("/api/v1/payments/financial/freight-board/")

    assert response.status_code == 200
    row = next(item for item in response.data["drivers"] if item["id"] == str(driver.pk))
    assert row["registered_location"] == {
        "address": "Registered farm address",
        "latitude": "9.145000",
        "longitude": "38.765000",
    }
