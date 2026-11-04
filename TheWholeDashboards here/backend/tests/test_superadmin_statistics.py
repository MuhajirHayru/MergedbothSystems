"""Tests for the dedicated Super Admin statistics endpoint (Part: stats API)."""

import pytest
from django.utils import timezone
from datetime import timedelta

from products.models import ProductType
from users.models import Role

from tests.conftest import make_user

STATS_URL = "/api/v1/superadmin/statistics/"


def _get(api, user=None, **params):
    if user is not None:
        api.force_authenticate(user=user)
    return api.get(STATS_URL, params or None, format="json")


# ---------------------------------------------------------------- permissions

@pytest.mark.django_db
def test_anonymous_is_rejected(api):
    assert _get(api).status_code == 401


@pytest.mark.django_db
def test_non_privileged_roles_are_rejected(api, farmer, wholesaler):
    assert _get(api, farmer).status_code == 403
    assert _get(api, wholesaler).status_code == 403


@pytest.mark.django_db
def test_super_admin_and_financial_manager_are_allowed(api, super_admin, financial_manager):
    assert _get(api, super_admin).status_code == 200
    assert _get(api, financial_manager).status_code == 200


# ---------------------------------------------------------------- aggregation

@pytest.mark.django_db
def test_role_and_status_counts_are_accurate(api, super_admin, farmer, farmer_b, wholesaler, driver):
    response = _get(api, super_admin)
    data = response.json()
    assert data["success"] is True
    # The three role fixtures plus the super admin himself.
    assert data["users"]["by_role"][Role.FARMER] == 2
    assert data["users"]["by_role"][Role.DRIVER] == 1
    assert data["users"]["by_status"]["APPROVED"] >= 4
    assert data["users"]["total"] == data["users"]["by_role"][Role.FARMER] + 1 + 1 + 1


@pytest.mark.django_db
def test_order_gmv_and_status_counts(api, super_admin, order, farmer_product):
    response = _get(api, super_admin)
    data = response.json()
    orders = data["marketplace"]["orders"]
    assert orders["by_status"].get("Processing") == 1
    assert orders["total"] == 1
    assert float(orders["gmv"]) == 1250.0


@pytest.mark.django_db
def test_regional_rows_group_users_by_location_text(api, super_admin, farmer, farmer_b):
    """farmer=Amhara, farmer_b=Oromia — both resolvable without a hierarchy."""
    data = _get(api, super_admin).json()
    regions = {row["region"]: row for row in data["regional"]}
    assert regions["Amhara"]["farmersCount"] == 1
    assert regions["Oromia"]["farmersCount"] == 1
    amhara = regions["Amhara"]
    assert amhara["totalUsers"] == amhara["farmersCount"] + amhara["wholesalersCount"] + amhara["retailersCount"] + amhara["driversCount"]


@pytest.mark.django_db
def test_orders_are_mapped_to_the_seller_region(api, super_admin, order):
    """The order's value lands in the farmer's region, not the buyer's."""
    data = _get(api, super_admin).json()
    amhara = next(r for r in data["regional"] if r["region"] == "Amhara")
    assert amhara["totalTransactions"] == 1
    assert float(amhara["totalTransactionValueETB"]) == 1250.0


@pytest.mark.django_db
def test_escrow_liability_from_wallets(api, super_admin, wholesaler, driver):
    data = _get(api, super_admin).json()
    # wholesaler wallet 100000 + driver wallet 500 available.
    assert float(data["financial"]["wallet_available"]) == 100500.0
    assert float(data["financial"]["wallet_held_escrow"]) == 0.0


@pytest.mark.django_db
def test_revenue_is_reported_unavailable_not_fabricated(api, super_admin):
    """No commission ledger exists — revenue/payables must be null, never invented."""
    data = _get(api, super_admin).json()
    assert data["financial"]["platform_revenue"] is None
    assert data["financial"]["seller_payables"] is None
    assert "ledger" in data["financial"]["unavailable_note"]


# ---------------------------------------------------------------- date filter

@pytest.mark.django_db
def test_from_to_filters_orders_and_counts_new_users(api, super_admin, farmer, order):
    # Backdate the order far into the past.
    Order = type(order)
    Order.objects.filter(pk=order.pk).update(created_at=timezone.now() - timedelta(days=90))

    recent_from = (timezone.now() - timedelta(days=7)).isoformat()
    data = _get(api, super_admin, **{"from": recent_from}).json()
    assert data["marketplace"]["orders"]["total"] == 0
    assert data["users"]["new_in_period"] >= 1

    old_from = (timezone.now() - timedelta(days=120)).isoformat()
    data = _get(api, super_admin, **{"from": old_from}).json()
    assert data["marketplace"]["orders"]["total"] == 1


@pytest.mark.django_db
def test_invalid_date_returns_400(api, super_admin):
    response = _get(api, super_admin, **{"from": "not-a-date"})
    assert response.status_code == 400


# ---------------------------------------------------------------- emptiness

@pytest.mark.django_db
def test_zero_means_checked_and_empty(api, super_admin):
    """A pristine platform reports explicit zeros — never nulls — for counts."""
    data = _get(api, super_admin).json()
    assert data["marketplace"]["orders"]["total"] == 0
    assert data["marketplace"]["orders"]["gmv"] == "0.00"
    assert data["logistics"]["freight_jobs"]["total"] == 0
    assert data["support"]["tickets"]["total"] == 0
    # ...while genuinely unsupported figures stay null.
    assert data["financial"]["platform_revenue"] is None


# ---------------------------------------------------------------- performance

@pytest.mark.django_db
def test_no_n_plus_one(api, super_admin, farmer, farmer_b, wholesaler, driver, order, django_assert_max_num_queries):
    with django_assert_max_num_queries(35):
        _get(api, super_admin)
