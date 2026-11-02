"""Regional price reports API for market price transparency.

Aggregates only persisted, completed order records into regional price
statistics. No values are invented and no financial state is mutated.
"""

from datetime import timedelta
from decimal import Decimal

from django.db.models import Avg, Count, DecimalField, ExpressionWrapper, F, Max, Min, Q, Sum
from django.db.models.functions import Coalesce, TruncDate, TruncMonth, TruncWeek
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.models import Order, OrderStatus

GROUP_FUNCTIONS = {
    "day": TruncDate("created_at"),
    "week": TruncWeek("created_at"),
    "month": TruncMonth("created_at"),
}

UNIT_PRICE = ExpressionWrapper(
    F("total_amount") / F("quantity"),
    output_field=DecimalField(max_digits=14, decimal_places=2),
)


def _as_float(value):
    return float(value if value is not None else Decimal("0.00"))


class RegionalPriceReportsView(APIView):
    """GET /api/v1/dashboard/regional-price-reports/.

    Query parameters:
        region: optional seller/buyer location filter.
        category: optional product category filter.
        days: look-back window in days (1-365, default 30).
        group_by: ``day``, ``week`` or ``month`` (default ``day``).
        include_historical: include the time series (default true).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = int(request.query_params.get("days", 30))
        except (TypeError, ValueError):
            days = 30
        days = max(1, min(days, 365))

        region = request.query_params.get("region", "").strip()
        category = request.query_params.get("category", "").strip()
        group_by = request.query_params.get("group_by", "day")
        include_historical = (
            request.query_params.get("include_historical", "true").lower() != "false"
        )

        today = timezone.localdate()
        start_date = today - timedelta(days=days - 1)

        filters = Q(
            status=OrderStatus.COMPLETED,
            created_at__date__gte=start_date,
            created_at__date__lte=today,
        )
        if region:
            filters &= (
                Q(farmer__location__iexact=region)
                | Q(wholesaler__location__iexact=region)
                | Q(retailer__location__iexact=region)
            )
        if category:
            filters &= Q(product__category__iexact=category)

        orders = (
            Order.objects.filter(filters)
            .select_related("product", "farmer", "wholesaler", "retailer")
            .annotate(unit_price=UNIT_PRICE)
        )

        data = {
            "summary": self._summary(orders),
            "time_series": self._time_series(orders, group_by) if include_historical else [],
            "category_breakdown": self._category_breakdown(orders),
            "regional_comparison": [] if region else self._regional_comparison(orders),
            "metadata": {
                "days": days,
                "start_date": start_date.isoformat(),
                "end_date": today.isoformat(),
                "group_by": group_by if group_by in GROUP_FUNCTIONS else "day",
                "region_filter": region or "All Regions",
                "category_filter": category or "All Categories",
                "total_orders_analyzed": orders.count(),
            },
        }
        return Response(data)

    def _summary(self, orders):
        if not orders.exists():
            return {
                "avg_price_per_unit": 0.0,
                "min_price": 0.0,
                "max_price": 0.0,
                "total_volume": 0.0,
                "total_value": 0.0,
                "most_traded_product": None,
                "most_traded_volume": 0.0,
                "price_trend": "stable",
            }

        stats = orders.aggregate(
            avg_price=Avg("unit_price"),
            min_price=Min("unit_price"),
            max_price=Max("unit_price"),
            total_volume=Sum("quantity"),
            total_value=Sum("total_amount"),
        )
        most_traded = (
            orders.values("product__title")
            .annotate(volume=Sum("quantity"))
            .order_by("-volume")
            .first()
        )
        return {
            "avg_price_per_unit": _as_float(stats["avg_price"]),
            "min_price": _as_float(stats["min_price"]),
            "max_price": _as_float(stats["max_price"]),
            "total_volume": _as_float(stats["total_volume"]),
            "total_value": _as_float(stats["total_value"]),
            "most_traded_product": most_traded["product__title"] if most_traded else None,
            "most_traded_volume": _as_float(most_traded["volume"]) if most_traded else 0.0,
            "price_trend": self._price_trend(orders),
        }

    def _price_trend(self, orders):
        rows = (
            orders.annotate(period=TruncWeek("created_at"))
            .values("period")
            .annotate(avg_price=Avg("unit_price"))
            .order_by("period")
        )
        points = [row["avg_price"] for row in rows if row["avg_price"] is not None]
        if len(points) < 2 or points[0] == 0:
            return "stable"
        change = (Decimal(points[-1]) - Decimal(points[0])) / Decimal(points[0]) * 100
        if change > 5:
            return "increasing"
        if change < -5:
            return "decreasing"
        return "stable"

    def _time_series(self, orders, group_by):
        trunc = GROUP_FUNCTIONS.get(group_by, GROUP_FUNCTIONS["day"])
        rows = (
            orders.annotate(period=trunc)
            .values("period")
            .annotate(
                avg_price=Avg("unit_price"),
                min_price=Min("unit_price"),
                max_price=Max("unit_price"),
                volume=Sum("quantity"),
                order_count=Count("id"),
            )
            .order_by("period")
        )
        return [
            {
                "period": row["period"].isoformat() if row["period"] else "",
                "avg_price": _as_float(row["avg_price"]),
                "min_price": _as_float(row["min_price"]),
                "max_price": _as_float(row["max_price"]),
                "volume": _as_float(row["volume"]),
                "order_count": row["order_count"],
            }
            for row in rows
        ]

    def _category_breakdown(self, orders):
        rows = list(
            orders.values("product__category")
            .annotate(
                avg_price=Avg("unit_price"),
                min_price=Min("unit_price"),
                max_price=Max("unit_price"),
                volume=Sum("quantity"),
                order_count=Count("id"),
            )
            .order_by("-volume")
        )
        total_volume = sum(Decimal(row["volume"] or 0) for row in rows)
        result = []
        for row in rows:
            volume = Decimal(row["volume"] or 0)
            result.append(
                {
                    "category": row["product__category"] or "Unknown",
                    "avg_price": _as_float(row["avg_price"]),
                    "price_range": (
                        f"{_as_float(row['min_price']):.2f} - "
                        f"{_as_float(row['max_price']):.2f}"
                    ),
                    "volume": _as_float(volume),
                    "order_count": row["order_count"],
                    "market_share_percentage": round(
                        float(volume / total_volume * 100), 1
                    )
                    if total_volume
                    else 0.0,
                }
            )
        return result

    def _regional_comparison(self, orders):
        rows = list(
            orders.annotate(seller_location=Coalesce("farmer__location", "wholesaler__location"))
            .values("seller_location")
            .annotate(
                avg_price=Avg("unit_price"),
                volume=Sum("quantity"),
                order_count=Count("id"),
                unique_products=Count("product__title", distinct=True),
            )
            .exclude(seller_location="")
            .order_by("-volume")
        )
        prices = [Decimal(row["avg_price"] or 0) for row in rows]
        market_avg = (sum(prices) / len(prices)) if prices else Decimal("0")

        def score(price):
            if not market_avg:
                return "average"
            ratio = Decimal(price) / market_avg
            if ratio < Decimal("0.9"):
                return "highly_competitive"
            if ratio < Decimal("0.95"):
                return "competitive"
            if ratio > Decimal("1.1"):
                return "premium"
            if ratio > Decimal("1.05"):
                return "above_average"
            return "average"

        return [
            {
                "region": row["seller_location"],
                "avg_price": _as_float(row["avg_price"]),
                "volume": _as_float(row["volume"]),
                "order_count": row["order_count"],
                "unique_products": row["unique_products"],
                "price_competitiveness": score(row["avg_price"] or 0),
            }
            for row in rows
        ]
