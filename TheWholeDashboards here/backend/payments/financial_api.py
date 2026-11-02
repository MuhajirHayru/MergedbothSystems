from datetime import date

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AuditLog, Role
from users.permissions import IsAuthenticatedRole
from .financial_models import (
    FinancialAccount,
    FinancialConfiguration,
    FinancialJournalEntry,
    FinancialOperatingExpense,
    FinancialPayrollRecord,
    DeliveryPricingConfiguration,
    DeliveryFeePayment,
    FinancialRefundRequest,
)


class FinancialConfigurationSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialConfiguration
        fields = "__all__"
        read_only_fields = ("id", "version", "status", "created_by", "approved_by", "approved_at", "created_at")

    def validate_rules(self, value):
        if not isinstance(value, dict) or not value:
            raise serializers.ValidationError("Rules must be a non-empty object.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        kind = validated_data["kind"]
        latest = FinancialConfiguration.objects.select_for_update().filter(kind=kind).order_by("-version").first()
        validated_data.update(version=(latest.version + 1 if latest else 1), created_by=self.context["request"].user)
        return super().create(validated_data)


class FinancialAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialAccount
        fields = "__all__"
        read_only_fields = fields


class FinancialJournalEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialJournalEntry
        fields = "__all__"
        read_only_fields = fields


class FinancialExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialOperatingExpense
        fields = "__all__"
        read_only_fields = ("id", "status", "submitted_by", "reviewed_by", "review_reason", "reviewed_at", "journal_entry", "created_at")

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero.")
        return value

    def create(self, validated_data):
        validated_data["submitted_by"] = self.context["request"].user
        return super().create(validated_data)


class FinancialPayrollSerializer(serializers.ModelSerializer):
    net_amount = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = FinancialPayrollRecord
        fields = "__all__"
        read_only_fields = ("id", "status", "approved_by", "paid_at", "journal_entry", "prepared_by", "created_at", "net_amount")

    def validate(self, attrs):
        start = attrs.get("period_start", getattr(self.instance, "period_start", None))
        end = attrs.get("period_end", getattr(self.instance, "period_end", None))
        if start and end and end < start:
            raise serializers.ValidationError({"period_end": "Must be on or after period_start."})
        return attrs

    def create(self, validated_data):
        validated_data["prepared_by"] = self.context["request"].user
        return super().create(validated_data)


class FinancialBaseView(APIView):
    permission_classes = [IsAuthenticated, IsAuthenticatedRole]
    allowed_roles = (Role.SUPER_ADMIN, Role.FINANCIAL_MANAGER)

    def get_permissions(self):
        return [IsAuthenticated(), IsAuthenticatedRole(self.allowed_roles)]


class FinancialConfigurationListView(FinancialBaseView):
    def get(self, request):
        queryset = FinancialConfiguration.objects.all()
        if request.query_params.get("kind"):
            queryset = queryset.filter(kind=request.query_params["kind"])
        return Response(FinancialConfigurationSerializer(queryset, many=True).data)

    def post(self, request):
        serializer = FinancialConfigurationSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        obj = serializer.save()
        AuditLog.objects.create(actor=request.user, action="FINANCIAL_CONFIGURATION_DRAFTED", target=str(obj.id), detail=f"{obj.kind} v{obj.version}")
        return Response(FinancialConfigurationSerializer(obj).data, status=201)


class FinancialConfigurationApproveView(FinancialBaseView):
    def post(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can approve financial configuration.")
        with transaction.atomic():
            obj = FinancialConfiguration.objects.select_for_update().get(pk=pk)
            if obj.status != FinancialConfiguration.Status.DRAFT:
                raise ValidationError("Only draft configurations can be approved.")
            if obj.kind == FinancialConfiguration.Kind.TAX and not (obj.source and obj.source_url):
                raise ValidationError("Tax rules require an authoritative source and URL; statutory rates are not inferred.")
            if obj.effective_to and obj.effective_to <= obj.effective_from:
                raise ValidationError("effective_to must be later than effective_from.")
            FinancialConfiguration.objects.filter(kind=obj.kind, status=FinancialConfiguration.Status.APPROVED).update(status=FinancialConfiguration.Status.SUPERSEDED)
            obj.status = FinancialConfiguration.Status.APPROVED
            obj.approved_by = request.user
            obj.approved_at = timezone.now()
            obj.save(update_fields=["status", "approved_by", "approved_at"])
            AuditLog.objects.create(actor=request.user, action="FINANCIAL_CONFIGURATION_APPROVED", target=str(obj.id), detail=f"{obj.kind} v{obj.version}")
        return Response(FinancialConfigurationSerializer(obj).data)


class FinancialExpenseListView(FinancialBaseView):
    def get(self, request):
        return Response(FinancialExpenseSerializer(FinancialOperatingExpense.objects.select_related("location", "submitted_by", "reviewed_by"), many=True).data)

    def post(self, request):
        serializer = FinancialExpenseSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return Response(FinancialExpenseSerializer(serializer.save()).data, status=201)


class FinancialExpenseActionView(FinancialBaseView):
    @transaction.atomic
    def post(self, request, pk):
        item = FinancialOperatingExpense.objects.select_for_update().get(pk=pk)
        action = request.data.get("action")
        reason = (request.data.get("reason") or "").strip()
        if action == "pay":
            if request.user.role != Role.SUPER_ADMIN:
                raise PermissionDenied("Only Super Admin can mark an expense as paid.")
            from .financial_services import pay_approved_expense
            try:
                item = pay_approved_expense(pk, actor=request.user, payment_reference=(request.data.get("payment_reference") or "").strip())
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc
            return Response(FinancialExpenseSerializer(item).data)
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can review expenses.")
        if action not in ("approve", "reject"): 
            raise ValidationError({"action": "Use approve, reject, or pay."})
        if action == "reject" and not reason:
            raise ValidationError({"reason": "A rejection reason is required."})
        if item.status != FinancialOperatingExpense.Status.PENDING:
            raise ValidationError("Only pending expenses may be reviewed.")
        if item.submitted_by_id == request.user.id:
            raise ValidationError("Expense submitter cannot review their own expense.")
        item.status = FinancialOperatingExpense.Status.APPROVED if action == "approve" else FinancialOperatingExpense.Status.REJECTED
        item.reviewed_by = request.user
        item.review_reason = reason
        item.reviewed_at = timezone.now()
        item.save(update_fields=["status", "reviewed_by", "review_reason", "reviewed_at"])
        AuditLog.objects.create(actor=request.user, action=f"FINANCIAL_EXPENSE_{action.upper()}D", target=str(item.id), detail=reason or item.description)
        return Response(FinancialExpenseSerializer(item).data)


class FinancialPayrollListView(FinancialBaseView):
    def get(self, request):
        qs = FinancialPayrollRecord.objects.select_related("employee", "prepared_by", "approved_by")
        return Response(FinancialPayrollSerializer(qs, many=True).data)

    def post(self, request):
        serializer = FinancialPayrollSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return Response(FinancialPayrollSerializer(serializer.save()).data, status=201)


class FinancialPayrollActionView(FinancialBaseView):
    @transaction.atomic
    def post(self, request, pk):
        item = FinancialPayrollRecord.objects.select_for_update().get(pk=pk)
        action = request.data.get("action")
        if action != "submit" and request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can approve, reject, or pay payroll.")
        if action == "submit" and item.prepared_by_id != request.user.id:
            raise PermissionDenied("Only the preparer can submit this payroll record.")
        if action == "pay":
            if request.user.role != Role.SUPER_ADMIN:
                raise PermissionDenied("Only Super Admin can mark payroll as paid.")
            from .financial_services import pay_approved_payroll
            try:
                item = pay_approved_payroll(pk, actor=request.user, payment_reference=(request.data.get("payment_reference") or "").strip())
            except ValueError as exc:
                raise ValidationError(str(exc)) from exc
            return Response(FinancialPayrollSerializer(item).data)
        if action not in ("submit", "approve", "reject"):
            raise ValidationError({"action": "Use submit, approve, reject, or pay."})
        if action == "submit" and item.status == FinancialPayrollRecord.Status.DRAFT:
            item.status = FinancialPayrollRecord.Status.PENDING
        elif action == "approve" and item.status == FinancialPayrollRecord.Status.PENDING:
            if request.user.role != Role.SUPER_ADMIN:
                raise PermissionDenied("Only Super Admin can approve payroll.")
            if item.prepared_by_id == request.user.id:
                raise ValidationError("Payroll preparer cannot approve the same payroll record.")
            item.status = FinancialPayrollRecord.Status.APPROVED
            item.approved_by = request.user
        elif action == "reject" and item.status == FinancialPayrollRecord.Status.PENDING:
            reason = (request.data.get("reason") or "").strip()
            if not reason:
                raise ValidationError({"reason": "A rejection reason is required."})
            if item.prepared_by_id == request.user.id:
                raise ValidationError("Payroll preparer cannot reject the same payroll record.")
            item.status = FinancialPayrollRecord.Status.REJECTED
        else:
            raise ValidationError("Invalid payroll status transition.")
        item.save(update_fields=["status", "approved_by"])
        AuditLog.objects.create(actor=request.user, action=f"PAYROLL_{action.upper()}D", target=str(item.id), detail=request.data.get("reason", ""))
        return Response(FinancialPayrollSerializer(item).data)


class DeliveryPricingSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryPricingConfiguration
        fields = "__all__"
        read_only_fields = ("id", "active", "created_by", "approved_by", "approved_at", "created_at")

    def validate(self, attrs):
        user = self.context["request"].user
        if user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin may configure delivery pricing.")
        if attrs.get("pricing_model") not in DeliveryPricingConfiguration.Model.values or attrs.get("fee_type") not in DeliveryPricingConfiguration.FeeType.values:
            raise serializers.ValidationError("Select a supported model and fee type.")
        value = attrs.get("fee_value", 0)
        if value <= 0:
            raise serializers.ValidationError({"fee_value": "Fee must be greater than zero."})
        if attrs.get("fee_type") == DeliveryPricingConfiguration.FeeType.PERCENTAGE and value > 100:
            raise serializers.ValidationError({"fee_value": "Percentage must be between 0 and 100."})
        minimum = attrs.get("minimum_fee", 0)
        maximum = attrs.get("maximum_fee", 0)
        if minimum < 0 or maximum <= 0 or minimum > maximum:
            raise serializers.ValidationError("Fee minimum and maximum are inconsistent.")
        effective_from = attrs.get("effective_from")
        effective_to = attrs.get("effective_to")
        if effective_to and effective_from and effective_to <= effective_from:
            raise serializers.ValidationError({"effective_to": "Must follow effective_from."})
        return attrs

    def create(self, validated_data):
        user = self.context["request"].user
        validated_data.update(created_by=user, approved_by=user, approved_at=timezone.now(), active=True)
        return super().create(validated_data)


class DeliveryPricingListView(FinancialBaseView):
    def get(self, request):
        return Response(DeliveryPricingSerializer(DeliveryPricingConfiguration.objects.all(), many=True).data)

    def post(self, request):
        serializer = DeliveryPricingSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        config = serializer.save()
        AuditLog.objects.create(actor=request.user, action="DELIVERY_PRICING_APPROVED", target=str(config.pk), detail=f"{config.pricing_model} {config.fee_type} {config.fee_value}")
        return Response(DeliveryPricingSerializer(config).data, status=201)


class DeliveryCompensationActionView(FinancialBaseView):
    def post(self, request, pk):
        from .financial_services import pay_delivery_compensation
        try:
            payment = pay_delivery_compensation(pk, actor=request.user, payment_reference=(request.data.get("payment_reference") or "").strip())
        except ValueError as error:
            raise ValidationError(str(error)) from error
        return Response({"id": str(payment.pk), "status": payment.status, "compensation_paid_at": payment.compensation_paid_at, "payment_reference": payment.compensation_payment_reference, "journal_entry": str(payment.compensation_journal_entry_id)})


class DeliveryPricingActionView(FinancialBaseView):
    def post(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin may deactivate delivery pricing rules.")
        with transaction.atomic():
            config = DeliveryPricingConfiguration.objects.select_for_update().get(pk=pk)
            if not config.active:
                return Response(DeliveryPricingSerializer(config).data)
            if config.payments.exists():
                config.effective_to = min(config.effective_to, timezone.now()) if config.effective_to else timezone.now()
                config.active = False
                config.save(update_fields=["effective_to", "active"])
            else:
                config.active = False
                config.save(update_fields=["active"])
            AuditLog.objects.create(actor=request.user, action="DELIVERY_PRICING_DEACTIVATED", target=str(config.pk), detail=(request.data.get("reason") or "").strip())
        return Response(DeliveryPricingSerializer(config).data)


class DeliveryPaymentCreateView(FinancialBaseView):
    def post(self, request, agreement_id):
        from .models import MarketplaceDeliveryFeeAgreement
        from .financial_services import create_delivery_payment
        agreement = MarketplaceDeliveryFeeAgreement.objects.select_related("order").get(pk=agreement_id)
        try:
            if "verified_amount" in request.data or "evidence_reference" in request.data or "tax_amount" in request.data:
                raise PermissionDenied("Delivery payment amount, evidence, and tax are calculated or verified by the backend.")
            item = create_delivery_payment(
                agreement=agreement, actor=request.user,
                payment_reference=request.data.get("payment_reference", ""),
            )
        except ValueError as error:
            raise ValidationError(str(error)) from error
        return Response({"id": str(item.pk), "status": item.status, "pricing_model": item.pricing_model,
                         "customer_amount": str(item.customer_amount), "driver_charge": str(item.driver_charge),
                         "platform_fee": str(item.platform_fee), "tax_amount": str(item.tax_amount) if item.tax_amount is not None else None}, status=201)


class FinancialRefundListView(FinancialBaseView):
    def get(self, request):
        return Response(list(FinancialRefundRequest.objects.values("id", "order__reference", "amount", "reason", "status", "payment_reference", "approval_reference", "created_at", "paid_at")))

    def post(self, request):
        from .models import Order
        from decimal import Decimal, InvalidOperation
        try:
            amount = Decimal(str(request.data.get("amount")))
        except (InvalidOperation, TypeError, ValueError) as error:
            raise ValidationError({"amount": "Enter a valid refund amount."}) from error
        if amount <= 0:
            raise ValidationError({"amount": "Refund amount must be positive."})
        order = Order.objects.get(pk=request.data.get("order_id"))
        item = FinancialRefundRequest.objects.create(order=order, amount=amount, reason=request.data.get("reason", ""), submitted_by=request.user)
        AuditLog.objects.create(actor=request.user, action="FINANCIAL_REFUND_REQUESTED", target=str(item.pk), detail=str(item.amount))
        return Response({"id": str(item.pk), "status": item.status}, status=201)


class FinancialRefundActionView(FinancialBaseView):
    def post(self, request, pk):
        from .financial_services import process_financial_refund
        try:
            item = process_financial_refund(pk, actor=request.user, action=request.data.get("action"), reference=request.data.get("reference", ""), successful=request.data.get("successful"))
        except ValueError as error:
            raise ValidationError(str(error)) from error
        return Response({"id": str(item.pk), "status": item.status, "journal_entry": str(item.journal_entry_id) if item.journal_entry_id else None})


class RegionalFinancialReportView(FinancialBaseView):
    def get(self, request):
        from .financial_models import FinancialOrderSnapshot
        from .models import OrderStatus
        level = request.query_params.get("level", "REGION").upper()
        if level not in ("REGION", "ZONE", "WOREDA", "KEBELE"):
            raise ValidationError({"level": "Use REGION, ZONE, WOREDA, or KEBELE."})
        end = request.query_params.get("end")
        qs = FinancialOrderSnapshot.objects.filter(order__status=OrderStatus.COMPLETED)
        if end:
            qs = qs.filter(created_at__date__lte=end)
        location_field = {"REGION": "pickup_region", "ZONE": "pickup_zone", "WOREDA": "pickup_wereda", "KEBELE": "pickup_kebele"}[level]
        group_field = f"order__shipment_details__{location_field}"
        rows = list(qs.values("order__shipment_details__" + location_field + "__id", "order__shipment_details__" + location_field + "__name").annotate(gmv=Sum("gross_order_value"), commission=Sum("commission_amount"), service_fee=Sum("service_fee_amount")))
        complete_ids = set(qs.exclude(tax_amount__isnull=True).values_list("order__shipment_details__" + location_field + "__id", flat=True))
        for row in rows:
            location_id = row["order__shipment_details__" + location_field + "__id"]
            row["profit_available"] = bool(location_id and location_id in complete_ids)
            row["platform_revenue"] = str(row["commission"] or 0)
            row["gross_profit"] = None
            row["net_profit"] = None
        return Response({"level": level, "location_rule": "Order pickup location; records without explicit matching hierarchy location are excluded.", "results": rows, "available": ["gmv", "commission", "service_fee"], "unavailable": ["delivery_revenue", "driver_compensation", "taxes", "operating_expenses", "payroll", "gross_profit", "net_profit"]})


class FinancialReconciliationView(FinancialBaseView):
    def get(self, request):
        from .financial_services import reconcile_financial_sources
        return Response(reconcile_financial_sources())


class FinancialAccountListView(FinancialBaseView):
    def get(self, request):
        return Response(FinancialAccountSerializer(FinancialAccount.objects.all(), many=True).data)


class FinancialLedgerListView(FinancialBaseView):
    def get(self, request):
        qs = FinancialJournalEntry.objects.select_related("debit_account", "credit_account", "actor", "configuration")
        try:
            if request.query_params.get("start"):
                date.fromisoformat(request.query_params["start"])
                qs = qs.filter(created_at__date__gte=request.query_params["start"])
            if request.query_params.get("end"):
                date.fromisoformat(request.query_params["end"])
                qs = qs.filter(created_at__date__lte=request.query_params["end"])
        except ValueError as exc:
            raise ValidationError("start and end must be ISO dates.") from exc
        if request.query_params.get("category"):
            qs = qs.filter(category=request.query_params["category"])
        return Response(FinancialJournalEntrySerializer(qs, many=True).data)


class FinancialSummaryView(FinancialBaseView):
    def get(self, request):
        count = FinancialJournalEntry.objects.filter(status=FinancialJournalEntry.Status.POSTED).count()
        return Response({"currency": "ETB", "ledger_entries": count, "revenue": "UNTRACKED", "profit": "UNTRACKED", "note": "Revenue and profit are not reported until source transactions are completely integrated into the ledger."})
