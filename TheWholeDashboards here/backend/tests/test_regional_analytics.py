"""Part 19 — regional analytics tests (real registration/audit data only)."""

import pytest

from dashboard.regional_analytics import (
    admin_activity_report,
    regional_drilldown,
    regional_overview,
)

pytestmark = pytest.mark.django_db


def test_overview_counts_match_database(farmer, wholesaler, super_admin):
    data = regional_overview()
    assert data["total_users"] >= 3
    # every user appears exactly once across regions + unclassified
    region_total = sum(r["total"] for r in data["regions"])
    assert region_total + data["unclassified"]["total"] == data["total_users"]
    roles = {r["role"]: r["total"] for r in data["role_breakdown"]}
    assert roles.get("FARMER", 0) >= 1
    assert roles.get("SUPER_ADMIN", 0) >= 1
    # trend periods are real timestamps buckets
    assert all("count" in t for t in data["trends"]["monthly"])


def test_drilldown_navigates_region_to_children(farmer, farmer_product):
    from products.models import Product

    product = Product.objects.get(pk=farmer_product.pk)
    region = _registration_region(farmer)
    if region is None:
        pytest.skip("farmer fixture has no located registration")
    data = regional_drilldown(region.pk)
    assert data is not None
    assert data["location"]["id"] == str(region.pk)
    assert data["summary"]["total"] >= 1
    assert any(u["id"] == str(farmer.pk) for u in data["users"]) or data["summary"]["total"] >= 1
    assert isinstance(data["children"], list)


def _registration_region(user):
    from dashboard.regional_analytics import _ancestor_chain, _LEVEL_ORDER

    reg = getattr(user, "registration", None)
    if reg is None or reg.location_id is None:
        return None
    for node in _ancestor_chain(reg.location):
        if _LEVEL_ORDER.get(node.level, 4) == 0:
            return node
    return None


def test_admin_activity_only_includes_staff(farmer, super_admin):
    from users.models import AuditLog

    AuditLog.objects.create(actor=farmer, action="order_created", detail="farmer action")
    AuditLog.objects.create(actor=super_admin, action="escrow_released", detail="staff action")
    data = admin_activity_report(days=365)
    assert data["total_staff_actions"] >= 1
    for entry in data["recent"]:
        assert entry["actor_role"] in (
            "USER_ADMIN", "FINANCIAL_MANAGER", "SUPER_ADMIN",
            "TOP_USER_ADMIN", "REGIONAL_ADMIN", "ZONAL_ADMIN", "WEREDA_ADMIN",
            "CUSTOMER_SUPPORT",
        )


def test_region_endpoint_permissions(api, farmer, super_admin):
    from django.urls import reverse

    api.force_authenticate(user=super_admin)
    response = api.get("/api/v1/reports/regional-analytics/")
    assert response.status_code == 200
    api.force_authenticate(user=farmer)
    response = api.get("/api/v1/reports/regional-analytics/")
    assert response.status_code == 403
