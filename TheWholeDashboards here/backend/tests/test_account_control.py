"""Part 22 — account control and emergency management tests."""

import pytest

from users.models import AccountStatus, AuditLog, PlatformSettings, Role

pytestmark = pytest.mark.django_db


def _staff_url():
    return "/api/v1/superadmin/accounts/bulk-status/"


def test_bulk_suspend_requires_reason_and_records_it(api, super_admin, farmer, farmer_b):
    api.force_authenticate(user=super_admin)
    no_reason = api.post(
        _staff_url(),
        {"user_ids": [str(farmer.pk)], "action": "suspend"},
        format="json",
    )
    assert no_reason.status_code == 400
    assert "reason" in no_reason.data["error"]

    response = api.post(
        _staff_url(),
        {"user_ids": [str(farmer.pk)], "action": "suspend", "reason": "Fraud investigation"},
        format="json",
    )
    assert response.status_code == 200
    farmer.refresh_from_db()
    assert farmer.status == AccountStatus.SUSPENDED and farmer.is_active is False
    assert AuditLog.objects.filter(
        action="user_suspended", target=farmer.email, detail__contains="Fraud investigation"
    ).exists()


def test_cannot_modify_own_account_and_last_sa_protected(api, super_admin, farmer):
    api.force_authenticate(user=super_admin)
    # own account skipped regardless of action
    own = api.post(
        _staff_url(),
        {"user_ids": [str(super_admin.pk)], "action": "deactivate", "reason": "self test"},
        format="json",
    )
    assert own.data["skipped"][0]["reason"] == "You cannot change your own account here."
    super_admin.refresh_from_db()
    assert super_admin.status == AccountStatus.APPROVED

    # a second Super Admin can be suspended while at least one active SA remains
    from tests.conftest import make_user

    sa2 = make_user(Role.SUPER_ADMIN, "sa2@test.et", "Second SA", is_staff=True, is_superuser=True)
    suspended = api.post(
        _staff_url(),
        {"user_ids": [str(sa2.pk)], "action": "suspend", "reason": "review"},
        format="json",
    )
    assert suspended.status_code == 200
    assert suspended.data["processed"][0]["status"] == AccountStatus.SUSPENDED
    # the last-SA guard is defense-in-depth behind the self-action rule: with
    # only the actor left active, disabling themselves is refused twice over.
    last = api.post(
        _staff_url(),
        {"user_ids": [str(super_admin.pk)], "action": "suspend", "reason": "try last SA"},
        format="json",
    )
    assert any("own account" in s["reason"] for s in last.data["skipped"])
    assert super_admin.status == AccountStatus.APPROVED


def test_reactivate_restores_access(api, super_admin, farmer):
    farmer.suspend(actor=super_admin, reason="temp")
    api.force_authenticate(user=super_admin)
    response = api.post(
        _staff_url(),
        {"user_ids": [str(farmer.pk)], "action": "reactivate", "reason": "cleared"},
        format="json",
    )
    assert response.status_code == 200
    farmer.refresh_from_db()
    assert farmer.status == AccountStatus.APPROVED and farmer.is_active is True


def test_orders_disabled_flag_blocks_order_creation(api, super_admin, wholesaler, farmer_product):
    config = PlatformSettings.load()
    config.orders_disabled = True
    config.save(update_fields=["orders_disabled"])
    api.force_authenticate(user=wholesaler)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1"},
        format="json",
    )
    assert response.status_code == 400
    assert "temporarily disabled" in str(response.data)

    config.orders_disabled = False
    config.save(update_fields=["orders_disabled"])
    ok = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1"},
        format="json",
    )
    assert ok.status_code == 201


def test_campaign_pause_blocks_coupons(api, super_admin, wholesaler, farmer_product, farmer):
    from payments.discount_models import DiscountCampaign
    from django.utils import timezone
    from datetime import timedelta

    campaign = DiscountCampaign.objects.create(
        name="T", code="PAUSE1", discount_type="FIXED", discount_value="5",
        funding_source="PLATFORM", product=farmer_product,
        starts_at=timezone.now() - timedelta(hours=1), created_by=farmer,
    )
    config = PlatformSettings.load()
    config.discount_campaigns_disabled = True
    config.save(update_fields=["discount_campaigns_disabled"])
    api.force_authenticate(user=wholesaler)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.pk), "quantity": "1", "coupon_code": "PAUSE1"},
        format="json",
    )
    assert response.status_code == 400
    assert "temporarily paused" in str(response.data)


def test_marketplace_users_cannot_use_bulk_control(api, farmer, farmer_b):
    api.force_authenticate(user=farmer)
    response = api.post(
        _staff_url(),
        {"user_ids": [str(farmer_b.pk)], "action": "suspend", "reason": "nope"},
        format="json",
    )
    assert response.status_code == 403
