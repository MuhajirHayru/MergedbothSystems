"""Part 27.3 — wishlist APIs (ownership enforced server-side)."""

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from products.models import Product
from users.permissions import IsAuthenticatedRole
from users.models import Role

from .models import WishlistItem

BUYER_ROLES = (Role.WHOLESALER, Role.RETAILER)


def _row(item, request):
    product = item.product
    return {
        "id": str(item.pk),
        "note": item.note,
        "added_at": item.created_at.isoformat(),
        "product": {
            "id": str(product.pk),
            "title": product.title,
            "category": product.category,
            "price_per_unit": str(product.price_per_unit),
            "unit": product.unit_of_measure,
            "status": product.status,
            "quantity": str(product.quantity),
            "available": product.status == "ACTIVE",
            "still_listed": not product.is_deleted if hasattr(product, "is_deleted") else True,
        },
    }


class WishlistView(APIView):
    def get_permissions(self):
        return [IsAuthenticatedRole(BUYER_ROLES)]

    def get(self, request):
        items = WishlistItem.objects.filter(user=request.user).select_related("product")
        return Response({
            "success": True,
            "count": items.count(),
            "items": [_row(i, request) for i in items],
        })

    def post(self, request):
        product_id = request.data.get("product")
        product = Product.objects.filter(pk=product_id).first()
        if product is None:
            return Response({"success": False, "error": {"product": "Unknown product."}}, status=400)
        item, created = WishlistItem.objects.get_or_create(
            user=request.user, product=product,
            defaults={"note": (request.data.get("note") or "").strip()[:200]},
        )
        if not created and request.data.get("note") is not None:
            item.note = (request.data.get("note") or "").strip()[:200]
            item.save(update_fields=["note"])
        return Response({"success": True, "item": _row(item, request),
                         "created": created}, status=201 if created else 200)

    def delete(self, request):
        product_id = request.data.get("product")
        deleted, _ = WishlistItem.objects.filter(user=request.user, product_id=product_id).delete()
        if not deleted:
            return Response({"success": False, "error": "That product is not in your wishlist."}, status=404)
        return Response({"success": True, "deleted": deleted})
