"""Part 27.3 — wishlist ownership and lifecycle tests."""

import pytest

from payments.models import WishlistItem
from users.models import Role

pytestmark = pytest.mark.django_db


def test_add_list_remove_own_wishlist(api, wholesaler, farmer_product):
    api.force_authenticate(user=wholesaler)
    added = api.post("/api/v1/payments/wishlist/", {"product": str(farmer_product.pk), "note": "restock Monday"}, format="json")
    assert added.status_code == 201
    assert added.data["item"]["note"] == "restock Monday"
    assert added.data["item"]["product"]["available"] is True

    listing = api.get("/api/v1/payments/wishlist/")
    assert listing.data["count"] == 1
    assert listing.data["items"][0]["product"]["id"] == str(farmer_product.pk)

    removed = api.delete("/api/v1/payments/wishlist/", {"product": str(farmer_product.pk)}, format="json")
    assert removed.status_code == 200
    assert api.get("/api/v1/payments/wishlist/").data["count"] == 0


def test_duplicate_add_is_idempotent(api, wholesaler, farmer_product):
    api.force_authenticate(user=wholesaler)
    assert api.post("/api/v1/payments/wishlist/", {"product": str(farmer_product.pk)}, format="json").status_code == 201
    again = api.post("/api/v1/payments/wishlist/", {"product": str(farmer_product.pk)}, format="json")
    assert again.status_code == 200 and again.data["created"] is False
    assert WishlistItem.objects.filter(user=wholesaler).count() == 1


def test_wishlist_is_private_per_user(api, wholesaler, wholesaler_b, farmer_product):
    api.force_authenticate(user=wholesaler)
    api.post("/api/v1/payments/wishlist/", {"product": str(farmer_product.pk)}, format="json")
    api.force_authenticate(user=wholesaler_b)
    assert api.get("/api/v1/payments/wishlist/").data["count"] == 0
    # wholesaler_b cannot delete wholesaler's entry
    assert api.delete("/api/v1/payments/wishlist/", {"product": str(farmer_product.pk)}, format="json").status_code == 404
    assert WishlistItem.objects.filter(user=wholesaler).count() == 1


def test_unknown_product_rejected(api, wholesaler):
    api.force_authenticate(user=wholesaler)
    unknown = api.post("/api/v1/payments/wishlist/", {"product": "00000000-0000-0000-0000-000000000000"}, format="json")
    assert unknown.status_code == 400


def test_farmer_role_blocked_from_wishlist(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/payments/wishlist/").status_code == 403
