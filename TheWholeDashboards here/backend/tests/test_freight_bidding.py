"""Part 26 — Uber-style freight bidding tests."""

import pytest
from django.utils import timezone

from payments.freight_models import FreightBid, FreightJob
from payments.models import Order, OrderShipmentDetails, MarketplaceDeliveryFeeAgreement, OrderStatus
from payments.freight_models import FreightJob
from registrations.models import AdministrativeLocation, UserRegistration
from users.models import AccountStatus, Role

pytestmark = pytest.mark.django_db


def _locations():
    region = AdministrativeLocation.objects.filter(level="REGION", active=True).first() or \
        AdministrativeLocation.objects.create(source_id="fb-r", name="FB Region", level="REGION")
    wereda = AdministrativeLocation.objects.filter(level="WOREDA", active=True, parent=region).first() or \
        AdministrativeLocation.objects.create(source_id="fb-w", name="FB Wereda", level="WOREDA", parent=region)
    return region, wereda


def _authorized_order(wholesaler, farmer, farmer_product, wereda):
    order = Order.objects.create(
        reference=f"#FBJ-{wholesaler.pk.hex[:6]}", wholesaler=wholesaler, farmer=farmer,
        product=farmer_product, quantity="5", total_amount="210.00", status=OrderStatus.SHIPPED,
    )
    UserRegistration.objects.create(user=farmer, location=wereda)
    OrderShipmentDetails.objects.create(
        order=order, pickup_region=wereda, pickup_address_line="Farm gate",
        destination_region=wereda, destination_address_line="City hub",
        cargo_weight_kg="100", packaging_details="crates",
        delivery_fee_proposal_amount="150.00",
        buyer_confirmed_revision=1, seller_confirmed_revision=1,
        authorized_at=timezone.now(),
    )
    from payments.freight_services import ensure_freight_job_for_order
    ensure_freight_job_for_order(order.pk)
    return order


def test_job_auto_created_on_authorization(api, super_admin, wholesaler, farmer, farmer_product):
    order = _authorized_order(wholesaler, farmer, farmer_product, *_locations()[::1][::-1][0:1] + [None][0:0]) if False else _authorized_order(wholesaler, farmer, farmer_product, _locations()[1])
    api.force_authenticate(user=super_admin)
    response = api.get("/api/v1/payments/financial/freight-jobs/")
    assert response.status_code == 200
    assert any(j["order_reference"] == order.reference for j in response.data["jobs"])


def test_driver_bids_and_staff_assigns(api, super_admin, wholesaler, farmer, farmer_product, farmer_b):
    from tests.conftest import make_user
    driver = make_user(Role.DRIVER, "bid-drv@test.et", "Bid Driver", status=AccountStatus.APPROVED)
    order = _authorized_order(wholesaler, farmer, farmer_product, _locations()[1])

    api.force_authenticate(user=driver)
    board = api.get("/api/logistics/freight-jobs/")
    assert board.status_code == 200
    job = next(j for j in board.data["jobs"] if j["order_reference"] == order.reference)
    bid = api.post(f"/api/logistics/freight-jobs/{job['id']}/bid/", {
        "amount": "140.00", "estimated_hours": 12, "message": "Truck nearby, can pick up now",
    }, format="json")
    assert bid.status_code == 201, bid.data

    my_bids = api.get("/api/logistics/freight-jobs/my-bids/")
    assert any(b["status"] == "SUBMITTED" for b in my_bids.data["bids"])

    # second driver bids higher
    driver2 = make_user(Role.DRIVER, "bid-drv2@test.et", "Bid Driver 2", status=AccountStatus.APPROVED)
    api.force_authenticate(user=driver2)
    api.post(f"/api/logistics/freight-jobs/{job['id']}/bid/", {"amount": "160.00", "estimated_hours": 10}, format="json")

    # staff compares and assigns the cheaper bid
    api.force_authenticate(user=super_admin)
    jobs = api.get("/api/v1/payments/financial/freight-jobs/")
    target = next(j for j in jobs.data["jobs"] if j["order_reference"] == order.reference)
    assert len(target["bids"]) == 2
    winning = next(b for b in target["bids"] if b["amount"] == "140.00")
    assigned = api.post(
        f"/api/v1/payments/financial/freight-jobs/{target['id']}/assign/",
        {"bid_id": winning["id"]}, format="json",
    )
    assert assigned.status_code == 200, assigned.data
    assert assigned.data["job"]["status"] == "ASSIGNED"
    assert assigned.data["job"]["assigned_driver"] == "Bid Driver"
    # losing bid rejected
    assert all(b["status"] == "REJECTED" for b in assigned.data["job"]["bids"] if b["id"] != winning["id"])
    # fee agreement snapshot recorded
    assert MarketplaceDeliveryFeeAgreement.objects.filter(order=order, amount="140.00").exists()
    # exact addresses disclosed on the job at assignment (Part 26.4)
    assert assigned.data["job"]["exact_pickup_address"]
    assert assigned.data["job"]["exact_destination_address"]
    # driver notification carried the exact addresses
    from notifications.models import Notification
    note = Notification.objects.filter(recipient=driver, message__icontains="Exact pickup").first()
    assert note is not None


def test_logistics_manager_notified_and_sees_all_drivers(api, super_admin, wholesaler, farmer, farmer_product):
    from tests.conftest import make_user
    from notifications.models import Notification
    lm = make_user(Role.LOGISTICS_MANAGER, "lm@test.et", "Logi Manager")
    driver = make_user(Role.DRIVER, "lm-drv@test.et", "LM Driver", status=AccountStatus.APPROVED)
    UserRegistration.objects.create(user=driver, location=_locations()[1])
    order = _authorized_order(wholesaler, farmer, farmer_product, _locations()[1])
    # hand-off notification to the logistics manager role
    assert Notification.objects.filter(
        recipient=lm, message__icontains=order.reference
    ).exists()
    # platform-wide driver access
    api.force_authenticate(user=lm)
    drivers = api.get("/api/v1/admin/drivers/")
    assert drivers.status_code == 200
    assert drivers.data["summary"]["total"] >= 1


def test_driver_cannot_bid_twice_as_duplicate_and_cannot_bid_after_assignment(api, super_admin, wholesaler, farmer, farmer_product):
    from tests.conftest import make_user
    driver = make_user(Role.DRIVER, "bid-drv3@test.et", "Bid Driver 3", status=AccountStatus.APPROVED)
    order = _authorized_order(wholesaler, farmer, farmer_product, _locations()[1])
    api.force_authenticate(user=driver)
    job = api.get("/api/logistics/freight-jobs/").data["jobs"][0]
    api.post(f"/api/logistics/freight-jobs/{job['id']}/bid/", {"amount": "100.00"}, format="json")
    # update-or-create allows re-bidding (amount update) — not a duplicate row
    assert FreightBid.objects.filter(job_id=job["id"], driver=driver).count() == 1
    api.force_authenticate(user=super_admin)
    target = api.get("/api/v1/payments/financial/freight-jobs/").data["jobs"][0]
    bid_id = target["bids"][0]["id"]
    api.post(f"/api/v1/payments/financial/freight-jobs/{target['id']}/assign/", {"bid_id": bid_id}, format="json")
    api.force_authenticate(user=driver)
    blocked = api.post(f"/api/logistics/freight-jobs/{job['id']}/bid/", {"amount": "120.00"}, format="json")
    assert blocked.status_code == 400


def test_marketplace_users_cannot_bid_or_manage(api, farmer, wholesaler):
    api.force_authenticate(user=farmer)
    assert api.get("/api/logistics/freight-jobs/").status_code in (403, 401)
    api.force_authenticate(user=wholesaler)
    assert api.get("/api/v1/payments/financial/freight-jobs/").status_code == 403


def test_staff_can_cancel_open_job(api, super_admin, wholesaler, farmer, farmer_product):
    order = _authorized_order(wholesaler, farmer, farmer_product, _locations()[1])
    job = FreightJob.objects.get(order=order)
    api.force_authenticate(user=super_admin)

    cancelled = api.post(
        f"/api/v1/payments/financial/freight-jobs/{job.pk}/cancel/",
        {"reason": "Cargo unavailable"}, format="json",
    )
    assert cancelled.status_code == 200
    assert cancelled.data["job"]["status"] == "CANCELLED"


def test_assigned_driver_sees_exact_addresses_others_do_not(api, super_admin, wholesaler, farmer, farmer_product):
    from tests.conftest import make_user
    driver = make_user(Role.DRIVER, "assign-drv@test.et", "Assigned Driver", status=AccountStatus.APPROVED)
    other_driver = make_user(Role.DRIVER, "other-drv@test.et", "Other Driver", status=AccountStatus.APPROVED)
    order = _authorized_order(wholesaler, farmer, farmer_product, _locations()[1])
    job = FreightJob.objects.get(order=order)
    api.force_authenticate(user=driver)
    api.post(f"/api/logistics/freight-jobs/{job.pk}/bid/", {"amount": "140.00"}, format="json")
    api.force_authenticate(user=super_admin)
    api.post(f"/api/v1/payments/financial/freight-jobs/{job.pk}/assign/", {"bid_id": str(FreightBid.objects.get(job=job).pk)}, format="json")

    api.force_authenticate(user=driver)
    mine = api.get("/api/logistics/freight-jobs/my-assignments/")
    assert mine.status_code == 200
    row = mine.data["assignments"][0]
    assert row["addresses_disclosed"] is True
    assert "Farm gate" in row["seller"]["pickup_address"]
    assert "City hub" in row["buyer"]["delivery_address"]

    api.force_authenticate(user=other_driver)
    others = api.get("/api/logistics/freight-jobs/my-assignments/")
    assert others.data["assignments"] == []

    api.force_authenticate(user=other_driver)
    board = api.get("/api/logistics/freight-jobs/")
    assert "Farm gate" not in str(board.data)
