"""Agricultural market intelligence — product distribution, scarcity, coverage.

The core value of an agricultural marketplace: knowing what grows where,
what's running low, and where the supply gaps are. All from real records.
"""

from collections import defaultdict
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from products.models import Product, ProductStatus
from registrations.models import AdministrativeLocation
from users.models import Role
from users.permissions import IsAuthenticatedRole


def _ancestor_chain(location):
    chain = []
    seen = set()
    node = location
    while node is not None and node.pk not in seen:
        seen.add(node.pk)
        chain.append(node)
        node = node.parent
    return chain


class AgriculturalIntelView(APIView):
    """GET /api/v1/auth/agricultural-intel/ — product/regional market intelligence."""

    def get_permissions(self):
        return []

    def get(self, request):
        products = Product.objects.select_related(
            "owner__registration__location", "owner__driver_profile"
        ).filter(
            status__in=[ProductStatus.ACTIVE, ProductStatus.SOLD],
        ).exclude(quantity__lte=0)

        # --- Product distribution by region
        region_products = defaultdict(lambda: {
            "total_products": 0, "total_quantity": 0.0, "total_value": 0.0,
            "categories": defaultdict(int), "scarce": [],
            "farmers": set(), "weredas": set(),
        })

        total_weredas_covered = set()
        all_categories = defaultdict(lambda: {"total": 0, "low_stock": 0})

        for p in products:
            owner = p.owner
            # Primary: structured registration location hierarchy
            reg = getattr(owner, "registration", None)
            loc = reg.location if reg else None
            chain = _ancestor_chain(loc) if loc else []
            by_level = {}
            for node in chain:
                depth = {"REGION": 0, "SUBCITY": 1, "ZONE": 1, "WOREDA": 2, "KEBELE": 3}.get(node.level, 4)
                by_level.setdefault(depth, node)
            region = by_level.get(0)
            wereda = by_level.get(2)

            # Fallback: User.location free-text field (always populated at registration)
            user_loc_text = (owner.location or "").strip()

            # Region key: structured hierarchy first, then user location text
            if region:
                rkey = region.name
            elif user_loc_text:
                rkey = user_loc_text
            else:
                rkey = "Location not set"

            if wereda:
                total_weredas_covered.add(wereda.pk)
            bucket = region_products[rkey]
            bucket["total_products"] += 1
            bucket["total_quantity"] += float(p.quantity)
            bucket["total_value"] += float(p.quantity) * float(p.price_per_unit)
            bucket["categories"][p.category] += 1
            bucket["farmers"].add(owner.pk)
            if wereda:
                bucket["weredas"].add(wereda.pk)

            cat_bucket = all_categories[p.category]
            cat_bucket["total"] += 1
            if p.quantity <= 10:
                cat_bucket["low_stock"] += 1
                bucket["scarce"].append({
                    "title": p.title, "category": p.category,
                    "quantity": str(p.quantity), "unit": p.unit_of_measure,
                    "price": str(p.price_per_unit), "farmer": owner.full_name,
                    "region": rkey,
                })

        # --- Scarce products (quantity <= 10 across ALL products)
        scarce_all = []
        for p in products.order_by("quantity")[:20]:
            if float(p.quantity) <= 10:
                reg = getattr(getattr(p.owner, "registration", None), "location", None)
                chain = _ancestor_chain(reg) if reg else []
                region_name = next(
                    (n.name for n in chain if n.level == "REGION"), "Unknown"
                )
                scarce_all.append({
                    "id": str(p.pk), "title": p.title, "category": p.category,
                    "quantity": str(p.quantity), "unit": p.unit_of_measure,
                    "price_per_unit": str(p.price_per_unit),
                    "farmer": p.owner.full_name, "region": region_name,
                })

        # --- Region summary rows
        region_rows = []
        for rname, bucket in sorted(region_products.items(), key=lambda x: -x[1]["total_products"]):
            region_rows.append({
                "region": rname,
                "total_products": bucket["total_products"],
                "total_quantity": f"{bucket['total_quantity']:.1f}",
                "total_value_etb": f"{bucket['total_value']:.2f}",
                "active_farmers": len(bucket["farmers"]),
                "weredas_covered": len(bucket["weredas"]),
                "top_category": max(bucket["categories"], key=bucket["categories"].get) if bucket["categories"] else "—",
            })

        # --- Category distribution
        category_rows = [
            {"category": cat, "total": v["total"], "low_stock": v["low_stock"]}
            for cat, v in sorted(all_categories.items(), key=lambda x: -x[1]["total"])
        ]

        total_active = Product.objects.filter(status=ProductStatus.ACTIVE).count()
        total_scarce = Product.objects.filter(
            status=ProductStatus.ACTIVE, quantity__lte=10
        ).count()

        return Response({
            "success": True,
            "summary": {
                "total_active_products": total_active,
                "total_scarce_products": total_scarce,
                "total_weredas_covered": len(total_weredas_covered),
                "total_categories": len(all_categories),
            },
            "regions": region_rows,
            "categories": category_rows,
            "scarce_products": scarce_all[:20],
        })


class ProductRegionalDistributionView(APIView):
    """GET /api/v1/auth/product-regions/ — which products exist in which regions."""

    def get_permissions(self):
        return []

    def get(self, request):
        products = Product.objects.select_related(
            "owner__registration__location"
        ).filter(status=ProductStatus.ACTIVE)

        by_region_product = defaultdict(lambda: {
            "product_title": "", "category": "", "quantity": 0.0,
            "unit": "", "farmers": set(), "avg_price": 0.0,
        })

        for p in products:
            reg = getattr(p.owner, "registration", None)
            loc = reg.location if reg else None
            chain = _ancestor_chain(loc) if loc else []
            region = next((n for n in chain if n.level == "REGION"), None)
            rkey = region.name if region else "Unassigned"
            key = (rkey, p.category, p.title)
            bucket = by_region_product[key]
            bucket["product_title"] = p.title
            bucket["category"] = p.category
            bucket["quantity"] += float(p.quantity)
            bucket["unit"] = p.unit_of_measure
            bucket["farmers"].add(p.owner.pk)
            bucket["avg_price"] = float(p.price_per_unit)

        rows = []
        for (rkey, cat, title), bucket in sorted(by_region_product.items()):
            rows.append({
                "region": rkey, "product": title, "category": cat,
                "total_quantity": f"{bucket['quantity']:.1f}",
                "unit": bucket["unit"],
                "farmer_count": len(bucket["farmers"]),
                "avg_price": f"{bucket['avg_price']:.2f}",
            })

        return Response({"success": True, "rows": rows})
