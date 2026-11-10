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
from registrations.services import users_visible_to_admin
from users.models import Role
from users.permissions import IsAuthenticatedRole
from users.superadmin_statistics import (
    _build_region_canonicalizer,
    _norm_key,
)


# Staff roles allowed to read platform-wide product intelligence.
_INTEL_ROLES = (
    Role.SUPER_ADMIN, Role.FINANCIAL_MANAGER, Role.LOGISTICS_MANAGER,
    Role.USER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN,
    Role.ZONAL_ADMIN, Role.WEREDA_ADMIN, Role.CUSTOMER_SUPPORT,
)


def _canonicalize_region_keys(region_products, wereda_totals):
    """Merge free-text region buckets into canonical regions.

    Uses the shared reference-walk + alias resolver from the statistics
    module. Unresolvable labels are merged into 'Unspecified' so no counts
    are lost.
    """
    canonical_nodes = list(
        AdministrativeLocation.objects.filter(
            level__in=["REGION", "CITY"], active=True,
        ).values_list("name", flat=True)
    )
    if not canonical_nodes:
        return region_products, wereda_totals
    canonical_by_key = {_norm_key(name): name.strip() for name in canonical_nodes}
    free_text = {
        r for r in region_products
        if r != "Unspecified" and _norm_key(r) not in canonical_by_key
    }
    if not free_text:
        return region_products, wereda_totals

    resolution = _build_region_canonicalizer(free_text, canonical_by_key)
    for raw in free_text:
        target = resolution.get(raw) or "Unspecified"
        if target == raw:
            continue
        bucket = region_products.pop(raw)
        merged = region_products.setdefault(target, {
            "total_products": 0, "total_quantity": 0.0, "total_value": 0.0,
            "categories": defaultdict(int), "scarce": [],
            "farmers": set(), "weredas": set(), "types": defaultdict(int),
        })
        merged["total_products"] += bucket["total_products"]
        merged["total_quantity"] += bucket["total_quantity"]
        merged["total_value"] += bucket["total_value"]
        for cat, n in bucket["categories"].items():
            merged["categories"][cat] += n
        for t, n in bucket.get("types", {}).items():
            merged["types"][t] += n
        merged["farmers"] |= bucket["farmers"]
        merged["weredas"] |= bucket["weredas"]
        merged["scarce"].extend(bucket["scarce"])
        wereda_totals |= bucket["weredas"]
    return region_products, wereda_totals


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
    """GET /api/v1/auth/agricultural-intel/ — product/regional market intelligence.

    Staff-only: platform-wide product data is not public.
    """

    def get_permissions(self):
        return [IsAuthenticatedRole(_INTEL_ROLES)]

    def get(self, request):
        products = Product.objects.select_related(
            "owner__registration__location", "owner__driver_profile"
        ).filter(
            status__in=[ProductStatus.ACTIVE, ProductStatus.SOLD],
        ).exclude(quantity__lte=0)
        # Geographic scope enforcement: hierarchy admins only see products of
        # sellers inside their area; Super Admin and Top User Admin see all.
        products = products.filter(
            owner_id__in=users_visible_to_admin(request.user).values("pk")
        )

        # --- Product distribution by region
        region_products = defaultdict(lambda: {
            "total_products": 0, "total_quantity": 0.0, "total_value": 0.0,
            "categories": defaultdict(int), "types": defaultdict(int),
            "scarce": [], "farmers": set(), "weredas": set(),
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
                rkey = "Unspecified"

            if wereda:
                total_weredas_covered.add(wereda.pk)
            bucket = region_products[rkey]
            bucket["total_products"] += 1
            bucket["total_quantity"] += float(p.quantity)
            bucket["total_value"] += float(p.quantity) * float(p.price_per_unit)
            bucket["categories"][p.category] += 1
            bucket["types"][p.product_type] += 1
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

        region_products, total_weredas_covered = _canonicalize_region_keys(
            region_products, total_weredas_covered,
        )

        # --- Scarce products (quantity <= 10 across ALL products)
        scarce_all = []
        for p in products.order_by("quantity")[:20]:
            if float(p.quantity) <= 10:
                reg = getattr(getattr(p.owner, "registration", None), "location", None)
                chain = _ancestor_chain(reg) if reg else []
                region_name = next(
                    (n.name for n in chain if n.level in ("REGION", "CITY")), "Unknown"
                )
                scarce_all.append({
                    "id": str(p.pk), "title": p.title, "category": p.category,
                    "quantity": str(p.quantity), "unit": p.unit_of_measure,
                    "price_per_unit": str(p.price_per_unit),
                    "farmer": p.owner.full_name, "region": region_name,
                })

        # --- Region summary rows (with most/least category + type split)
        region_rows = []
        for rname, bucket in sorted(region_products.items(), key=lambda x: -x[1]["total_products"]):
            cats = bucket["categories"]
            region_rows.append({
                "region": rname,
                "total_products": bucket["total_products"],
                "total_quantity": f"{bucket['total_quantity']:.1f}",
                "total_value_etb": f"{bucket['total_value']:.2f}",
                "active_farmers": len(bucket["farmers"]),
                "weredas_covered": len(bucket["weredas"]),
                "top_category": max(cats, key=cats.get) if cats else "—",
                "least_category": min(cats, key=cats.get) if cats else "—",
                "category_counts": {k: v for k, v in sorted(cats.items(), key=lambda kv: -kv[1])},
                "farmer_listings": bucket["types"].get("FARMER_LISTING", 0),
                "wholesaler_listings": bucket["types"].get("WHOLESALER_LISTING", 0),
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
                "total_listed_value_etb": f"{sum(float(r['total_value_etb']) for r in region_rows):.2f}",
            },
            "regions": region_rows,
            "categories": category_rows,
            "scarce_products": scarce_all[:20],
        })


class ProductRegionalDistributionView(APIView):
    """GET /api/v1/auth/product-regions/ — which products exist in which regions.

    Staff-only: platform-wide product data is not public.
    """

    def get_permissions(self):
        return [IsAuthenticatedRole(_INTEL_ROLES)]

    def get(self, request):
        products = Product.objects.select_related(
            "owner__registration__location"
        ).filter(status=ProductStatus.ACTIVE).filter(
            owner_id__in=users_visible_to_admin(request.user).values("pk")
        )

        by_region_product = defaultdict(lambda: {
            "product_title": "", "category": "", "quantity": 0.0,
            "unit": "", "farmers": set(), "avg_price": 0.0,
            "sellers": set(), "zones": defaultdict(float),
            "zone_wereda": defaultdict(lambda: defaultdict(float)),
        })

        for p in products:
            reg = getattr(p.owner, "registration", None)
            loc = reg.location if reg else None
            chain = _ancestor_chain(loc) if loc else []
            region = next((n for n in chain if n.level in ("REGION", "CITY")), None)
            zone = next((n for n in chain if n.level in ("ZONE", "SUBCITY", "DISTRICT")), None)
            wereda = next((n for n in chain if n.level == "WOREDA"), None)
            rkey = region.name if region else (p.owner.location or "").strip() or "Unassigned"
            zkey = zone.name if zone else "Zone not recorded"
            wkey = wereda.name if wereda else "Wereda not recorded"
            key = (rkey, p.category, p.title)
            bucket = by_region_product[key]
            bucket["product_title"] = p.title
            bucket["category"] = p.category
            bucket["product_type"] = p.product_type
            bucket["status"] = p.status
            bucket["quantity"] += float(p.quantity)
            bucket["unit"] = p.unit_of_measure
            bucket["farmers"].add(p.owner.pk)
            bucket["sellers"].add(p.owner.full_name)
            bucket["avg_price"] = float(p.price_per_unit)
            bucket["zones"][zkey] += float(p.quantity)
            bucket["zone_wereda"][zkey][wkey] += float(p.quantity)

        rows = []
        for (rkey, cat, title), bucket in sorted(by_region_product.items()):
            rows.append({
                "region": rkey, "product": title, "category": cat,
                "product_type": bucket["product_type"],
                "status": bucket["status"],
                "total_quantity": f"{bucket['quantity']:.1f}",
                "unit": bucket["unit"],
                "farmer_count": len(bucket["farmers"]),
                "sellers": sorted(bucket["sellers"]),
                "avg_price": f"{bucket['avg_price']:.2f}",
                "zones": {z: f"{q:.1f}" for z, q in sorted(bucket["zones"].items())},
                "zone_wereda": {
                    z: {w: f"{q:.1f}" for w, q in sorted(weredas.items())}
                    for z, weredas in sorted(bucket["zone_wereda"].items())
                },
            })

        # Same region canonicalization as the intel view: free-text and
        # sub-region labels roll up to the canonical Ethiopian regions.
        canonical_nodes = list(
            AdministrativeLocation.objects.filter(
                level__in=["REGION", "CITY"], active=True,
            ).values_list("name", flat=True)
        )
        if canonical_nodes:
            canonical_by_key = {_norm_key(name): name.strip() for name in canonical_nodes}
            distinct_keys = {r["region"] for r in rows}
            free_text = {
                k for k in distinct_keys
                if k not in ("Unassigned", "Unspecified") and _norm_key(k) not in canonical_by_key
            }
            if free_text:
                resolution = _build_region_canonicalizer(free_text, canonical_by_key)
                for r in rows:
                    if r["region"] in free_text:
                        r["region"] = resolution.get(r["region"]) or "Unspecified"

        return Response({"success": True, "rows": rows})
