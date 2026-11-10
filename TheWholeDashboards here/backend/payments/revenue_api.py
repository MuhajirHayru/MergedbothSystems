"""Revenue method configuration, charge records, freight settlements and ads."""
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AuditLog, Role

from .financial_api import FinancialBaseView
from .financial_models import (
    AdvertisingPackage,
    AdvertisingPurchase,
    RevenueCharge,
    RevenueMethod,
)
from .revenue_engine import (
    active_methods, freight_settlement_row, purchase_advertising_package,
    revenue_source_enabled,
)


class RevenueMethodSerializer(serializers.ModelSerializer):
    method_display = serializers.CharField(source="get_method_display", read_only=True)
    transaction_type_display = serializers.CharField(source="get_transaction_type_display", read_only=True)
    payer_display = serializers.CharField(source="get_payer_display", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")
    effective_status = serializers.SerializerMethodField()

    def get_effective_status(self, obj):
        now = timezone.now()
        if not obj.approved_at or not obj.approved_by_id:
            return "DRAFT"
        if not obj.enabled or (obj.disabled_at and obj.disabled_at <= now):
            return "DISABLED"
        if obj.effective_from > now:
            return "SCHEDULED"
        if obj.effective_to and obj.effective_to <= now:
            return "EXPIRED"
        if not revenue_source_enabled(obj.method):
            return "BLOCKED"
        current = active_methods(obj.transaction_type, at=now).get(obj.method)
        return "IN_FORCE" if current and current.pk == obj.pk else "SUPERSEDED"

    class Meta:
        model = RevenueMethod
        fields = "__all__"
        read_only_fields = (
            "id", "created_by", "approved_by", "approved_at", "created_at", "updated_at",
            "disabled_at", "method_display", "transaction_type_display", "payer_display", "approved_by_name", "effective_status",
        )

    def validate(self, attrs):
        method = attrs.get("method", getattr(self.instance, "method", None))
        if method in RevenueMethod.COMMISSION_METHODS:
            amount_fields = (
                "rate", "fixed_fee", "unit_fee", "seller_rate", "seller_fixed_fee",
                "buyer_rate", "buyer_fixed_fee",
            )
            nonzero = [name for name in amount_fields if Decimal(str(attrs.get(name, getattr(self.instance, name, 0)) or 0)) != 0]
            share = Decimal(str(attrs.get("company_share_percentage", getattr(self.instance, "company_share_percentage", 100))))
            if nonzero or share != Decimal("100"):
                raise serializers.ValidationError(
                    "Commission amounts and tax are set in Financial Controls. Here configure only the payer; use separate seller and buyer commission methods when both pay."
                )
        return attrs


class RevenueChargeSerializer(serializers.ModelSerializer):
    method_display = serializers.SerializerMethodField()
    payer_name = serializers.SerializerMethodField()
    generating_name = serializers.SerializerMethodField()
    third_party_name = serializers.SerializerMethodField()

    class Meta:
        model = RevenueCharge
        fields = "__all__"
        read_only_fields = tuple(f.name for f in RevenueCharge._meta.fields)

    def get_method_display(self, obj):
        try:
            return RevenueMethod.Method(obj.method).label
        except ValueError:
            return obj.method

    def get_payer_name(self, obj):
        return obj.payer_user.full_name if obj.payer_user_id else obj.get_payer_party_display()

    def get_generating_name(self, obj):
        return obj.generating_user.full_name if obj.generating_user_id else None

    def get_third_party_name(self, obj):
        return obj.third_party_payee.full_name if obj.third_party_payee_id else None


class AdvertisingPackageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdvertisingPackage
        fields = "__all__"
        read_only_fields = ("id", "created_by", "created_at", "updated_at")


class AdvertisingPurchaseSerializer(serializers.ModelSerializer):
    package_name = serializers.CharField(source="package.name", read_only=True)

    class Meta:
        model = AdvertisingPurchase
        fields = "__all__"
        read_only_fields = tuple(f.name for f in RevenueCharge._meta.fields)


class RevenueMethodListCreateView(FinancialBaseView):
    """GET every revenue method; POST a new draft configuration (Super Admin only)."""

    def get(self, request):
        transaction_type = request.query_params.get("transaction_type")
        rows = RevenueMethod.objects.select_related("approved_by").all()
        if transaction_type:
            rows = rows.filter(transaction_type=transaction_type)
        return Response({
            "success": True,
            "methods": RevenueMethodSerializer(rows, many=True).data,
            "choices": {
                "transaction_types": [{"value": v, "label": l} for v, l in RevenueMethod.TransactionType.choices],
                "methods": [{"value": v, "label": l} for v, l in RevenueMethod.Method.choices],
                "payers": [{"value": v, "label": l} for v, l in RevenueMethod.Payer.choices],
                "calculations": [{"value": v, "label": l} for v, l in RevenueMethod.Calculation.choices],
            },
        })

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can configure revenue methods.")
        serializer = RevenueMethodSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = serializer.save(created_by=request.user)
        AuditLog.objects.create(
            actor=request.user, action="REVENUE_METHOD_CREATED", target=str(row.pk),
            detail=f"{row.transaction_type}/{row.method} payer={row.payer}",
        )
        return Response(RevenueMethodSerializer(row).data, status=201)


class RevenueMethodActionView(FinancialBaseView):
    """POST approve|deactivate — Super Admin only, never edits historical rows."""

    def post(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can approve revenue methods.")
        row = RevenueMethod.objects.filter(pk=pk).first()
        if row is None:
            raise NotFound("Revenue method not found.")
        action = (request.data.get("action") or "").upper()
        if action == "APPROVE":
            if row.approved_by_id:
                raise ValidationError({"action": "This revenue method is already approved."})
            row.approved_by = request.user
            from django.utils import timezone
            row.approved_at = timezone.now()
            row.save()
        elif action == "DEACTIVATE":
            if not row.enabled:
                raise ValidationError({"action": "This revenue method is already inactive."})
            row.enabled = False
            from django.utils import timezone
            row.disabled_at = timezone.now()
            row.save(update_fields=["enabled", "disabled_at", "updated_at"])
        else:
            raise ValidationError({"action": "Choose APPROVE or DEACTIVATE."})
        AuditLog.objects.create(
            actor=request.user, action=f"REVENUE_METHOD_{action}", target=str(row.pk),
            detail=f"{row.transaction_type}/{row.method}",
        )
        return Response(RevenueMethodSerializer(row).data)


class RevenueChargeListView(FinancialBaseView):
    """GET every recorded fee with payer, earned amount and third-party payable."""

    def get(self, request):
        rows = RevenueCharge.objects.select_related(
            "payer_user", "generating_user", "third_party_payee", "journal_entry",
        ).all()
        for field, lookup in (
            ("method", "method"), ("payer_party", "payer_party"),
            ("settlement_status", "settlement_status"), ("source_type", "source_type"),
            ("transaction_type", "transaction_type"), ("source_reference", "source_reference__icontains"),
        ):
            value = request.query_params.get(field)
            if value:
                rows = rows.filter(**{lookup: value})
        totals = {
            "charged": Decimal("0.00"),
            "collected": Decimal("0.00"),
            "company_earned": Decimal("0.00"),
            "third_party_payable": Decimal("0.00"),
        }
        by_method = {}
        for row in rows[:2000]:
            totals["charged"] += row.amount_charged
            totals["collected"] += row.amount_collected
            totals["company_earned"] += row.amount_company_earned
            totals["third_party_payable"] += row.third_party_payable
            bucket = by_method.setdefault(row.method, {
                "method": row.method,
                "charged": Decimal("0.00"), "collected": Decimal("0.00"),
                "company_earned": Decimal("0.00"), "third_party_payable": Decimal("0.00"),
                "count": 0,
            })
            bucket["charged"] += row.amount_charged
            bucket["collected"] += row.amount_collected
            bucket["company_earned"] += row.amount_company_earned
            bucket["third_party_payable"] += row.third_party_payable
            bucket["count"] += 1
        return Response({
            "success": True,
            "totals": {key: str(value) for key, value in totals.items()},
            "by_method": [
                {**bucket, **{k: str(bucket[k]) for k in ("charged", "collected", "company_earned", "third_party_payable")}}
                for bucket in sorted(by_method.values(), key=lambda b: b["method"])
            ],
            "charges": RevenueChargeSerializer(rows[:500], many=True).data,
            "count": rows.count(),
        })


class RevenueChargeDetailView(FinancialBaseView):
    def get(self, request, pk):
        row = RevenueCharge.objects.select_related(
            "payer_user", "generating_user", "third_party_payee", "journal_entry", "rule",
        ).filter(pk=pk).first()
        if row is None:
            raise NotFound("Revenue charge not found.")
        payload = RevenueChargeSerializer(row).data
        payload["journal_entry"] = None
        if row.journal_entry_id:
            from .financial_api import FinancialJournalEntrySerializer

            payload["journal_entry"] = FinancialJournalEntrySerializer(row.journal_entry).data
        return Response({"success": True, "charge": payload})


class FreightSettlementListView(FinancialBaseView):
    """GET freight settlements with shipper, payer, driver, provider and margin."""

    def get(self, request):
        from .financial_models import DeliveryFeePayment

        rows = DeliveryFeePayment.objects.filter(
            status=DeliveryFeePayment.Status.VERIFIED
        ).select_related("agreement__order__wholesaler", "agreement__order__retailer", "agreement__driver_payee")
        return Response({
            "success": True,
            "settlements": [freight_settlement_row(payment) for payment in rows[:500]],
        })


class AdvertisingPackageListCreateView(FinancialBaseView):
    def get(self, request):
        rows = AdvertisingPackage.objects.all()
        if request.query_params.get("active") in ("1", "true", "True"):
            rows = rows.filter(active=True)
        return Response({"success": True, "packages": AdvertisingPackageSerializer(rows, many=True).data})

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can create advertising packages.")
        serializer = AdvertisingPackageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        package = serializer.save(created_by=request.user)
        AuditLog.objects.create(
            actor=request.user, action="ADVERTISING_PACKAGE_CREATED", target=package.name,
            detail=f"{package.price} ETB / {package.duration_days}d",
        )
        return Response(AdvertisingPackageSerializer(package).data, status=201)


class AdvertisingPurchaseView(APIView):
    """POST — the advertiser (wholesaler or retailer) pays for the package."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        package = AdvertisingPackage.objects.filter(pk=pk).first()
        if package is None:
            raise NotFound("Advertising package not found.")
        try:
            purchase, charge = purchase_advertising_package(
                package, request.user, actor=request.user,
                payment_reference=(request.data.get("payment_reference") or "").strip(),
            )
        except ValueError as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response({
            "success": True,
            "purchase": AdvertisingPurchaseSerializer(purchase).data,
            "charge": RevenueChargeSerializer(charge).data,
        }, status=201)
