"""Regional price reports API coverage."""

from decimal import Decimal

import pytest

from payments.models import Order, OrderStatus
from products.models import Product

pytestmark = pytest.mark.django_db


URL = "/api/v1/dashboard/regional-price-reports/"


def _make_order(reference, product, buyer, price, quantity=10, status=OrderStatus.COMPLETED):
    return Order.objects.create(
        reference=reference,
        wholesaler=buyer,
        farmer=product.owner,
        product=product,
        quantity=quantity,
        total_amount=Decimal(price) * quantity,
        status=status,
    )


@pytest.fixture
def priced_orders(db, farmer, wholesaler, farmer_product):
    completed = _make_order("#RPR-1", farmer_product, wholesaler, "30.00")
    _make_order("#RPR-2", farmer_product, wholesaler, "40.00", status=OrderStatus.PROCESSING)
    return completed


def test_requires_authentication(api):
    assert api.get(URL).status_code == 401


def test_returns_aggregates_for_completed_orders(auth, priced_orders):
    response = auth.get(URL)
    assert response.status_code == 200
    payload = response.json()
    assert payload["metadata"]["total_orders_analyzed"] == 1
    assert payload["summary"]["avg_price_per_unit"] == 30.0
    assert payload["summary"]["total_volume"] == 10.0
    assert payload["summary"]["total_value"] == 300.0
    assert payload["category_breakdown"][0]["category"] == priced_orders.product.category


def test_excludes_non_completed_orders(auth, priced_orders):
    payload = auth.get(URL).json()
    assert payload["metadata"]["total_orders_analyzed"] == 1


def test_category_filter(auth, priced_orders):
    category = priced_orders.product.category
    payload = auth.get(URL, {"category": category}).json()
    assert payload["metadata"]["category_filter"] == category
    assert payload["metadata"]["total_orders_analyzed"] == 1


def test_region_filter(auth, priced_orders):
    payload = auth.get(URL, {"region": "Amhara"}).json()
    assert payload["metadata"]["region_filter"] == "Amhara"
    assert payload["metadata"]["total_orders_analyzed"] == 1
    assert payload["regional_comparison"] == []


def test_no_data_returns_zero_summary(auth):
    payload = auth.get(URL).json()
    assert payload["metadata"]["total_orders_analyzed"] == 0
    assert payload["summary"]["avg_price_per_unit"] == 0.0
    assert payload["summary"]["total_value"] == 0.0


@pytest.mark.parametrize("raw,expected", [("invalid", 30), ("0", 1), ("400", 365)])
def test_days_parameter_is_clamped(auth, raw, expected):
    payload = auth.get(URL, {"days": raw}).json()
    assert payload["metadata"]["days"] == expected


@pytest.mark.parametrize("group_by", ["day", "week", "month"])
def test_group_by_values(auth, priced_orders, group_by):
    response = auth.get(URL, {"group_by": group_by})
    assert response.status_code == 200
    assert response.json()["metadata"]["group_by"] == group_by
