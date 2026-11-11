from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import AuditLog, Role, User
from users.permissions import IsAuthenticatedRole
from registrations.models import AdministrativeLocation
from payments.financial_models import (
    FinancialJournalEntry,
    FinancialPayrollRecord,
    StaffCompensation,
    RevenueSourceConfig,
    SubscriptionPlan,
    UserSubscription,
)
from users.superadmin_statistics import (
    _build_region_canonicalizer,
    _norm_key,
    _region_of,
)
from .discount_models import DiscountCampaign, DiscountRedemption
from .financial_models import (
    EmployeeProfile,
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

    def validate_kind(self, value):
        # Delivery pricing has its own approval path and configuration model;
        # a DELIVERY financial configuration is never read by any engine.
        if value == FinancialConfiguration.Kind.DELIVERY:
            raise serializers.ValidationError(
                "Delivery pricing is configured in the delivery pricing rules, not here."
            )
        return value

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
        read_only_fields = ("id", "reference", "category", "amount", "currency",
                            "debit_account", "credit_account", "order_reference",
                            "related_user", "location", "configuration", "status",
                            "source", "source_reference", "idempotency_key", "actor",
                            "posted_by", "created_at", "reverses")


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
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_email = serializers.CharField(source="employee.email", read_only=True)
    employee_region = serializers.SerializerMethodField()
    prepared_by_name = serializers.CharField(source="prepared_by.full_name", read_only=True, default="")
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default="")

    class Meta:
        model = FinancialPayrollRecord
        fields = "__all__"
        read_only_fields = ("id", "status", "approved_by", "paid_at", "journal_entry", "prepared_by", "created_at", "net_amount")

    def get_employee_region(self, obj):
        if not obj.employee_id:
            return "Unspecified"
        emp = obj.employee
        reg = getattr(emp, "registration", None)
        loc = reg.location if reg else None
        row = {
            "location": emp.location,
            "registration__location__name": getattr(loc, "name", None),
            "registration__location__level": getattr(loc, "level", None),
            "registration__location__parent__name": getattr(getattr(loc, "parent", None), "name", None),
            "registration__location__parent__level": getattr(getattr(loc, "parent", None), "level", None),
            "registration__location__parent__parent__name": getattr(getattr(getattr(loc, "parent", None), "parent", None), "name", None),
            "registration__location__parent__parent__level": getattr(getattr(getattr(loc, "parent", None), "parent", None), "level", None),
            "registration__location__parent__parent__parent__name": None,
        }
        return _region_of(row) or "Unspecified"

    class Meta:
        model = FinancialPayrollRecord
        fields = "__all__"
        read_only_fields = ("id", "status", "approved_by", "paid_at", "journal_entry", "prepared_by", "created_at", "net_amount")

    def create(self, validated_data):
        validated_data["prepared_by"] = self.context["request"].user
        return super().create(validated_data)


class FinancialBaseView(APIView):
    permission_classes = [IsAuthenticated, IsAuthenticatedRole]
    allowed_roles = (Role.SUPER_ADMIN, Role.FINANCIAL_MANAGER)

    def get_permissions(self):
        return [IsAuthenticated(), IsAuthenticatedRole(self.allowed_roles)]


class FinancialPayrollDetailView(FinancialBaseView):
    """GET/PATCH/DELETE one payroll invoice.

    Super Admin: full CRUD over any record. Financial Manager: may edit or
    delete their own records while still PENDING (maker-checker stays intact —
    APPROVED/PAID records are immutable to everyone).
    """

    def get(self, request, pk):
        from django.shortcuts import get_object_or_404
        record = get_object_or_404(FinancialPayrollRecord, pk=pk)
        return Response(FinancialPayrollSerializer(record).data)

    def _permission_error(self, request, record):
        is_super = request.user.role == Role.SUPER_ADMIN
        is_own = record.prepared_by_id == request.user.id
        if not (is_super or (is_own and record.status == FinancialPayrollRecord.Status.PENDING)):
            raise PermissionDenied(
                "Only Super Admin may modify this record, or its preparer while still pending."
            )

    def patch(self, request, pk):
        from django.shortcuts import get_object_or_404
        record = get_object_or_404(FinancialPayrollRecord, pk=pk)
        if record.status not in (FinancialPayrollRecord.Status.PENDING, FinancialPayrollRecord.Status.DRAFT):
            raise PermissionDenied("Only pending salary invoices can be edited.")
        self._permission_error(request, record)
        serializer = FinancialPayrollSerializer(record, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        from payments.payroll_calc import compute_payroll
        computed = compute_payroll(
            serializer.validated_data.get("base_amount", record.base_amount),
            serializer.validated_data.get("allowances", record.allowances),
            serializer.validated_data.get("commission_amount", record.commission_amount),
            serializer.validated_data.get("deductions", record.deductions),
        )
        serializer.validated_data["tax_amount"] = computed["income_tax"]
        serializer.validated_data["pension_employee"] = computed["pension_employee"]
        serializer.validated_data["pension_employer"] = computed["pension_employer"]
        updated = serializer.save()
        AuditLog.objects.create(actor=request.user, action="PAYROLL_INVOICE_EDITED", target=str(record.pk))
        return Response(FinancialPayrollSerializer(updated).data)

    def delete(self, request, pk):
        from django.shortcuts import get_object_or_404
        record = get_object_or_404(FinancialPayrollRecord, pk=pk)
        if record.status not in (FinancialPayrollRecord.Status.PENDING, FinancialPayrollRecord.Status.DRAFT):
            raise PermissionDenied("Only pending salary invoices can be deleted.")
        self._permission_error(request, record)
        detail = f"{record.employee.email} period {record.period_start}-{record.period_end} net {record.net_amount}"
        record.delete()
        AuditLog.objects.create(actor=request.user, action="PAYROLL_INVOICE_DELETED", target=pk, detail=detail)
        return Response({"success": True, "deleted": pk})


class StaffAttendanceView(FinancialBaseView):
    """GET /payments/financial/attendance/<user_id>/?month=YYYY-MM

    Daily attendance derived from the immutable audit trail: sign-ins, actions,
    approvals, first/last activity and the active span (screen time) per day,
    plus absent days for the month to date.
    """

    def get(self, request, user_id):
        from django.shortcuts import get_object_or_404
        from django.db.models import Min, Max
        staff = get_object_or_404(User, pk=user_id)

        month_raw = (request.query_params.get("month") or "").strip()
        now = timezone.localtime()
        if month_raw:
            try:
                year, month = int(month_raw[:4]), int(month_raw[5:7])
            except (ValueError, TypeError):
                raise ValidationError({"month": "Use YYYY-MM."})
            if not 1 <= month <= 12:
                raise ValidationError({"month": "Month must be 1-12."})
        else:
            year, month = now.year, now.month

        month_start = timezone.make_aware(timezone.datetime(year, month, 1))
        next_month = (month_start + timezone.timedelta(days=32)).replace(day=1)
        entries = AuditLog.objects.filter(
            actor_id=staff.pk, created_at__gte=month_start, created_at__lt=next_month,
        ).order_by("created_at")

        days = {}
        for e in entries:
            day = timezone.localtime(e.created_at).date().isoformat()
            d = days.setdefault(day, {
                "date": day, "logins": 0, "logouts": 0, "actions": 0, "approvals": 0,
                "first_seen": None, "last_seen": None,
            })
            d["actions"] += 1
            if e.action == "login_success":
                d["logins"] += 1
            if e.action == "logout":
                d["logouts"] += 1
            if e.action in ("user_approved", "admin_account_approved", "staff_approved"):
                d["approvals"] += 1
            t = timezone.localtime(e.created_at).strftime("%H:%M:%S")
            if d["first_seen"] is None:
                d["first_seen"] = t
            d["last_seen"] = t

        for d in days.values():
            from datetime import datetime as dt
            if d["first_seen"] and d["last_seen"]:
                span = (dt.strptime(d["last_seen"], "%H:%M:%S") - dt.strptime(d["first_seen"], "%H:%M:%S")).total_seconds() / 60
                d["active_minutes"] = round(span)
            else:
                d["active_minutes"] = 0

        present_days = len(days)
        import calendar
        days_in_month = calendar.monthrange(year, month)[1]
        today = now.date()
        elapsed = days_in_month if (year, month) != (today.year, today.month) else today.day
        absent_days = max(0, elapsed - present_days)

        return Response({
            "success": True,
            "staff": {"id": str(staff.pk), "full_name": staff.full_name, "role": staff.role, "region": None},
            "month": f"{year:04d}-{month:02d}",
            "summary": {
                "present_days": present_days,
                "absent_days": absent_days,
                "elapsed_days": elapsed,
                "total_logins": sum(d["logins"] for d in days.values()),
                "total_actions": sum(d["actions"] for d in days.values()),
                "total_approvals": sum(d["approvals"] for d in days.values()),
                "total_active_minutes": sum(d["active_minutes"] for d in days.values()),
                "avg_active_minutes": round(sum(d["active_minutes"] for d in days.values()) / present_days) if present_days else 0,
            },
            "days": [days[k] for k in sorted(days)],
        })


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
    @staticmethod
    def _validate_rule_numbers(kind, rules):
        """Reject invalid rule math before an approval can reach settlement."""
        if not isinstance(rules, list) or not rules:
            raise ValidationError(
                "Approve only a draft that contains a non-empty 'rules' list."
            )

        bounded_rates = {"rate", "buyer_fee_rate"}
        nonnegative_values = {
            "fixed_fee", "unit_fee", "buyer_fee_fixed", "buyer_fee_unit_fee",
            "min_commission", "max_commission", "tax_base", "min_quantity",
            "max_quantity", "min_value", "max_value",
        }
        for index, rule in enumerate(rules):
            prefix = f"Rule {index + 1}"
            if not isinstance(rule, dict):
                raise ValidationError(f"{prefix} must be an object.")
            if kind == FinancialConfiguration.Kind.TAX and rule.get("fee_payer"):
                if str(rule["fee_payer"]).lower() not in {
                    "seller", "buyer", "requesting_party", "contractual_party",
                }:
                    raise ValidationError(
                        f"{prefix} fee_payer must be seller, buyer, requesting_party, or contractual_party."
                    )
            calculation = str(rule.get("calculation", "percentage")).lower()
            if kind == FinancialConfiguration.Kind.COMMISSION and calculation not in {
                "percentage", "fixed", "per_unit",
            }:
                raise ValidationError(
                    f"{prefix} calculation must be percentage, fixed, or per_unit."
                )
            if kind == FinancialConfiguration.Kind.COMMISSION and calculation == "per_unit":
                unit = str(rule.get("unit", "quintal")).strip().lower()
                if unit not in {"quintal", "quintals"}:
                    raise ValidationError(f"{prefix} unit must be quintal.")
            buyer_calculation = str(rule.get("buyer_fee_calculation", "none")).lower()
            if kind == FinancialConfiguration.Kind.COMMISSION and buyer_calculation not in {
                "none", "percentage", "fixed", "per_unit",
            }:
                raise ValidationError(
                    f"{prefix} buyer_fee_calculation must be none, percentage, fixed, or per_unit."
                )
            for field in bounded_rates:
                if field not in rule:
                    continue
                try:
                    value = Decimal(str(rule[field]))
                except (InvalidOperation, TypeError, ValueError) as exc:
                    raise ValidationError(f"{prefix} {field} must be a valid decimal.") from exc
                if not value.is_finite() or value < 0 or value > 1:
                    raise ValidationError(
                        f"{prefix} {field} must be between 0 and 1 (100%)."
                    )
            for field in nonnegative_values:
                if field not in rule or rule[field] in (None, "", "*"):
                    continue
                try:
                    value = Decimal(str(rule[field]))
                except (InvalidOperation, TypeError, ValueError) as exc:
                    raise ValidationError(f"{prefix} {field} must be a valid decimal.") from exc
                if not value.is_finite() or value < 0:
                    raise ValidationError(f"{prefix} {field} must be zero or greater.")
            for low, high in (
                ("min_commission", "max_commission"),
                ("min_quantity", "max_quantity"),
                ("min_value", "max_value"),
            ):
                if rule.get(low) not in (None, "", "*") and rule.get(high) not in (None, "", "*"):
                    if Decimal(str(rule[low])) > Decimal(str(rule[high])):
                        raise ValidationError(f"{prefix} {low} cannot exceed {high}.")
            try:
                int(rule.get("priority", 0) or 0)
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"{prefix} priority must be an integer.") from exc

    def post(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can approve financial configuration.")
        with transaction.atomic():
            obj = FinancialConfiguration.objects.select_for_update().get(pk=pk)
            if obj.status != FinancialConfiguration.Status.DRAFT:
                raise ValidationError("Only draft configurations can be approved.")
            if obj.kind == FinancialConfiguration.Kind.TAX and not (obj.source and obj.source_url):
                raise ValidationError("Tax rules require an authoritative source and URL; statutory rates are not inferred.")
            rules = obj.rules.get("rules") if isinstance(obj.rules, dict) else None
            if not isinstance(rules, list) or not rules:
                raise ValidationError(
                    "Approve only a draft that contains a non-empty 'rules' list; "
                    "an approved rule with no rules would silently stop charging."
                )
            self._validate_rule_numbers(obj.kind, rules)
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
        # Statutory figures are recomputed authoritatively on the server —
        # the client's tax/pension values are treated as previews only.
        from payments.payroll_calc import compute_payroll
        computed = compute_payroll(
            serializer.validated_data.get("base_amount"),
            serializer.validated_data.get("allowances"),
            serializer.validated_data.get("commission_amount"),
            serializer.validated_data.get("deductions"),
        )
        serializer.validated_data["tax_amount"] = computed["income_tax"]
        serializer.validated_data["pension_employee"] = computed["pension_employee"]
        serializer.validated_data["pension_employer"] = computed["pension_employer"]
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

class DeliveryPricingListView(FinancialBaseView):
    def get(self, request):
        return Response(DeliveryPricingSerializer(DeliveryPricingConfiguration.objects.all(), many=True).data)

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin may set delivery pricing rules.")
        serializer = DeliveryPricingSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        # The engine only resolves approved rules (approved_by + approved_at), so
        # a Super Admin rule must be stamped on creation or it can never apply.
        config = serializer.save(
            created_by=request.user,
            approved_by=request.user,
            approved_at=timezone.now(),
        )
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
            from .models import MarketplaceDeliveryFeeReview
            if not agreement.buyer_accepted_at or not MarketplaceDeliveryFeeReview.objects.filter(
                agreement=agreement, decision=MarketplaceDeliveryFeeReview.Decision.APPROVED
            ).exists():
                raise ValueError("Only a buyer-accepted, financially approved delivery agreement can be charged.")
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


class DeliveryPaymentVerifyView(APIView):
    """Buyer or finance staff requests server-side Chapa verification."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from .financial_services import verify_delivery_payment
        from .chapa import ChapaGatewayError
        payment = DeliveryFeePayment.objects.select_related("agreement__order").filter(pk=pk).first()
        if payment is None:
            raise NotFound("Delivery payment not found.")
        order = payment.agreement.order
        allowed = request.user.pk == order.buyer.pk or request.user.role in (Role.FINANCIAL_MANAGER, Role.SUPER_ADMIN)
        if not allowed:
            raise PermissionDenied("Only the buyer or financial staff can verify this delivery payment.")
        try:
            result = verify_delivery_payment(
                payment.pk, actor=request.user, evidence_reference="chapa-server-verification"
            )
        except ChapaGatewayError as error:
            raise ValidationError({"payment": "The provider could not verify this payment yet. Retry after checkout completes."}) from error
        except ValueError as error:
            raise ValidationError({"payment": str(error)}) from error
        return Response({
            "id": str(result.pk), "status": result.status,
            "customer_amount": str(result.customer_amount),
            "driver_charge": str(result.driver_charge),
            "platform_fee": str(result.platform_fee),
            "driver_credited_at": result.compensation_paid_at,
        })


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
        search = (request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(reference__icontains=search)
                | Q(source_reference__icontains=search)
                | Q(order_reference__icontains=search)
                | Q(actor__full_name__icontains=search)
                | Q(category__icontains=search)
            )
        return Response(FinancialJournalEntrySerializer(qs, many=True).data)


class FinancialSummaryView(FinancialBaseView):
    def get(self, request):
        from .financial_reporting import FinancialReportView

        report = FinancialReportView().get(request)
        if report.status_code >= 400:
            return report
        data = report.data
        count = FinancialJournalEntry.objects.filter(
            status=FinancialJournalEntry.Status.POSTED,
            created_at__date__gte=data["start"],
            created_at__date__lte=data["end"],
        ).count()
        revenue = data.get("platform_revenue")
        profit = data.get("net_profit")
        return Response({
            "currency": data.get("currency", "ETB"),
            "period": data.get("period"),
            "start": data.get("start"),
            "end": data.get("end"),
            "ledger_entries": count,
            "revenue": revenue,
            "recognized_platform_revenue": revenue,
            "profit": profit,
            "profit_status": "AVAILABLE" if profit is not None else "INCOMPLETE",
            "unresolved_completed_orders": data.get("unresolved_completed_orders", 0),
            "unavailable_figures": data.get("unavailable_figures", []),
            "note": (
                "Profit remains incomplete until product acquisition cost / cost of goods sold is recorded."
                if profit is None else "Revenue and profit are derived from posted financial records."
            ),
        })


class DiscountCampaignSerializer(serializers.ModelSerializer):
    effective_status = serializers.CharField(read_only=True)
    total_redemptions = serializers.SerializerMethodField()
    total_discount_amount = serializers.SerializerMethodField()

    class Meta:
        model = DiscountCampaign
        fields = [
            "id", "name", "code", "description", "discount_type", "discount_value",
            "max_discount_amount", "min_order_value", "first_order_only",
            "funding_source", "product", "product_category", "seller",
            "usage_limit", "per_user_limit", "starts_at", "ends_at",
            "is_active", "effective_status", "total_redemptions",
            "total_discount_amount", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ("id", "created_by", "created_at", "updated_at")

    def get_total_redemptions(self, obj):
        return obj.redemptions.count()

    def get_total_discount_amount(self, obj):
        total = obj.redemptions.aggregate(s=Sum("discount_amount"))["s"]
        return str(total) if total is not None else "0.00"

    def validate(self, attrs):
        starts_at = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError({"ends_at": "Must be later than starts_at."})
        discount_type = attrs.get("discount_type", getattr(self.instance, "discount_type", None))
        discount_value = attrs.get("discount_value", getattr(self.instance, "discount_value", None))
        max_cap = attrs.get("max_discount_amount", getattr(self.instance, "max_discount_amount", None))
        if discount_type == DiscountCampaign.DiscountType.PERCENTAGE:
            if discount_value is None or not (Decimal("0") <= discount_value <= Decimal("100")):
                raise serializers.ValidationError(
                    {"discount_value": "Percentage discounts use percent (0-100)."}
                )
            if max_cap is None:
                raise serializers.ValidationError(
                    {"max_discount_amount": "Percentage discounts require a maximum cap."}
                )
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class DiscountCampaignListView(FinancialBaseView):
    def get(self, request):
        campaigns = DiscountCampaign.objects.select_related("product", "seller").order_by("-created_at")
        status_param = request.query_params.get("status")
        if status_param:
            campaigns = [c for c in campaigns if c.effective_status == status_param.upper()]
        return Response(DiscountCampaignSerializer(campaigns, many=True).data)

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can create discount campaigns.")
        serializer = DiscountCampaignSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        campaign = serializer.save()
        AuditLog.objects.create(
            actor=request.user, action="DISCOUNT_CAMPAIGN_CREATED",
            target=str(campaign.pk), detail=f"{campaign.code} {campaign.discount_type} {campaign.discount_value} {campaign.funding_source}",
        )
        return Response(DiscountCampaignSerializer(campaign).data, status=201)


class DiscountCampaignActionView(FinancialBaseView):
    @transaction.atomic
    def post(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can activate or deactivate campaigns.")
        campaign = DiscountCampaign.objects.select_for_update().get(pk=pk)
        action = request.data.get("action")
        if action == "activate":
            campaign.is_active = True
        elif action == "deactivate":
            campaign.is_active = False
        else:
            raise ValidationError({"action": "Use 'activate' or 'deactivate'."})
        campaign.save(update_fields=["is_active", "updated_at"])
        AuditLog.objects.create(
            actor=request.user, action=f"DISCOUNT_CAMPAIGN_{action.upper()}",
            target=str(campaign.pk), detail=(request.data.get("reason") or "").strip(),
        )
        return Response(DiscountCampaignSerializer(campaign).data)


class DiscountCampaignUpdateView(FinancialBaseView):
    def put(self, request, pk):
        return self._update(request, pk)

    def patch(self, request, pk):
        return self._update(request, pk)

    @transaction.atomic
    def _update(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can edit discount campaigns.")
        campaign = DiscountCampaign.objects.select_for_update().get(pk=pk)
        serializer = DiscountCampaignSerializer(campaign, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        # Once a coupon has been used, the commercial terms are locked: the
        # redemption snapshots must stay truthful about what buyers were promised.
        protected = ("code", "discount_type", "funding_source")
        if campaign.redemptions.exists():
            changing = [
                field for field in protected
                if field in serializer.validated_data
                and serializer.validated_data[field] != getattr(campaign, field)
            ]
            if changing:
                raise ValidationError(
                    {field: "This field is locked because the coupon has already been redeemed." for field in changing}
                )
        updated = serializer.save()
        AuditLog.objects.create(
            actor=request.user, action="DISCOUNT_CAMPAIGN_UPDATED",
            target=str(updated.pk),
            detail=f"{updated.code} active={updated.is_active} value={updated.discount_value}",
        )
        return Response(DiscountCampaignSerializer(updated).data)


class DiscountRedemptionListView(FinancialBaseView):
    def get(self, request):
        redemptions = DiscountRedemption.objects.select_related("campaign", "order", "user").order_by("-created_at")
        campaign_id = request.query_params.get("campaign")
        if campaign_id:
            redemptions = redemptions.filter(campaign_id=campaign_id)
        summary = redemptions.aggregate(
            count=Count("id"), total_discount=Sum("discount_amount")
        )
        return Response({
            "summary": {
                "count": summary["count"],
                "total_discount_amount": str(summary["total_discount"] or Decimal("0")),
            },
            "redemptions": [
                {
                    "id": str(r.pk),
                    "campaign": r.campaign.name,
                    "code": r.code_snapshot,
                    "order_reference": r.order.reference,
                    "buyer": r.user.full_name,
                    "original_amount": str(r.original_amount),
                    "discount_amount": str(r.discount_amount),
                    "final_amount": str(r.final_amount),
                    "funded_by": r.funded_by,
                    "applied_at": r.created_at,
                }
                for r in redemptions[:200]
            ],
        })


class FinancialTransactionDetailView(FinancialBaseView):
    """GET /payments/financial/ledger/<id>/ — one entry with its related set."""

    def get(self, request, pk):
        entry = FinancialJournalEntry.objects.select_related(
            "debit_account", "credit_account", "actor", "configuration", "related_user"
        ).filter(pk=pk).first()
        if entry is None:
            raise ValidationError("Journal entry not found.")
        related = FinancialJournalEntry.objects.filter(
            source_reference=entry.source_reference
        ).exclude(pk=entry.pk).select_related("debit_account", "credit_account")
        return Response({
            "entry": FinancialJournalEntrySerializer(entry).data,
            "category": entry.category,
            "order_reference": entry.order_reference,
            "related_entries": FinancialJournalEntrySerializer(related, many=True).data,
        })


class ProfitAndLossView(FinancialBaseView):
    """GET /payments/financial/pnl/?start&end — Part 24.3, sourced from the ledger.

    Revenue: MARKETPLACE_COMMISSION + DELIVERY_SERVICE_REVENUE postings.
    Expenses: PROMOTION_EXPENSE, operating expenses and payroll postings.
    When nothing has been posted in the window the figures are reported as
    unavailable rather than zero.
    """

    def get(self, request):
        from datetime import date as _date

        from django.db.models import Sum

        qs = FinancialJournalEntry.objects.filter(status=FinancialJournalEntry.Status.POSTED)
        try:
            start = request.query_params.get("start")
            end = request.query_params.get("end")
            if start:
                _date.fromisoformat(start)
                qs = qs.filter(created_at__date__gte=start)
            if end:
                _date.fromisoformat(end)
                qs = qs.filter(created_at__date__lte=end)
        except ValueError as exc:
            raise ValidationError("start and end must be ISO dates.") from exc

        revenue_categories = (
            "MARKETPLACE_COMMISSION", "DELIVERY_SERVICE_REVENUE", "MARKETPLACE_BUYER_FEE",
            "MARKETPLACE_TRANSACTION_FEE", "INSPECTION_REVENUE", "SUBSCRIPTION_REVENUE",
            "ADVERTISING_REVENUE", "OTHER_REVENUE",
        )
        promotion = qs.filter(category="PROMOTION_EXPENSE").aggregate(s=Sum("amount"))["s"]
        payroll = qs.filter(category__startswith="PAYROLL").aggregate(s=Sum("amount"))["s"]
        operating = qs.filter(category="OPERATING_EXPENSE").aggregate(s=Sum("amount"))["s"]
        _q = lambda v: Decimal(v).quantize(Decimal("0.01")) if v is not None else None
        revenue_rows = []
        revenue_total = Decimal("0")
        for category in revenue_categories:
            amount = _q(qs.filter(category=category).aggregate(s=Sum("amount"))["s"])
            revenue_rows.append({"category": category, "amount": str(amount) if amount is not None else None})
            revenue_total += amount or Decimal("0")
        revenue_total = _q(revenue_total)
        promotion_q, payroll_q, operating_q = _q(promotion), _q(payroll), _q(operating)
        expense_total = _q(
            (promotion_q or Decimal("0")) + (payroll_q or Decimal("0")) + (operating_q or Decimal("0"))
        )

        # Payer responsibility summary, sourced from the recorded revenue charges.
        from .financial_models import RevenueCharge

        charge_qs = RevenueCharge.objects.all()
        if start:
            charge_qs = charge_qs.filter(created_at__date__gte=start)
        if end:
            charge_qs = charge_qs.filter(created_at__date__lte=end)
        payer_totals = {}
        for charge in charge_qs:
            bucket = payer_totals.setdefault(charge.payer_party, Decimal("0"))
            payer_totals[charge.payer_party] = bucket + charge.amount_company_earned
        by_payer = [
            {"payer_party": party, "company_earned": str(_q(amount))}
            for party, amount in sorted(payer_totals.items())
        ]

        has_revenue_data = qs.filter(category__in=revenue_categories).exists()
        has_expense_data = any(v is not None for v in (promotion, payroll, operating))
        gross_profit = revenue_total - expense_total if (has_revenue_data or has_expense_data) else None
        return Response({
            "success": True,
            "window": {"start": start or None, "end": end or None},
            "revenue": {
                "available": has_revenue_data,
                "lines": revenue_rows,
                "total": str(revenue_total) if has_revenue_data else None,
                "by_payer": by_payer,
            },
            "expenses": {
                "available": has_expense_data,
                "promotion": str(promotion_q) if promotion_q is not None else None,
                "payroll": str(payroll_q) if payroll_q is not None else None,
                "operating": str(operating_q) if operating_q is not None else None,
                "total": str(expense_total) if has_expense_data else None,
            },
            "gross_profit": str(gross_profit) if gross_profit is not None else None,
            "net_profit": str(gross_profit) if gross_profit is not None else None,
            "note": "Escrow, wallet balances, seller payables, driver compensation payable and tax liabilities are never counted as profit.",
        })


class StaffCompensationSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source="user.full_name", read_only=True)
    staff_role = serializers.CharField(source="user.role", read_only=True)

    class Meta:
        model = StaffCompensation
        fields = ["id", "user", "staff_name", "staff_role", "base_monthly_salary", "monthly_commission", "updated_at"]
        read_only_fields = ["id", "updated_at"]


class StaffCompensationView(FinancialBaseView):
    """GET/PUT the salary + commission settings of one staff member.

    Super Admin sets them (at creation or later); the Financial Manager reads
    them to prepare the month-end payroll invoice.
    """

    def get(self, request, user_id):
        target = User.objects.filter(pk=user_id).first()
        if target is None:
            raise NotFound("Staff account not found.")
        comp = getattr(target, "staff_compensation", None)
        return Response({
            "user_id": str(target.pk),
            "full_name": target.full_name,
            "role": target.role,
            "base_monthly_salary": str(comp.base_monthly_salary) if comp else None,
            "monthly_commission": str(comp.monthly_commission) if comp else None,
        })

    def put(self, request, user_id):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can set staff compensation.")
        staff_roles = (
            Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN,
            Role.ZONAL_ADMIN, Role.WEREDA_ADMIN, Role.USER_ADMIN,
            Role.FINANCIAL_MANAGER, Role.LOGISTICS_MANAGER, Role.CUSTOMER_SUPPORT,
        )
        target = User.objects.filter(pk=user_id, role__in=staff_roles).first()
        if target is None:
            raise NotFound("Staff account not found.")
        try:
            base = Decimal(str(request.data.get("base_monthly_salary", "0")))
            commission = Decimal(str(request.data.get("monthly_commission", "0")))
        except Exception:
            raise ValidationError({"base_monthly_salary": "Salary and commission must be numbers."})
        if base < 0 or commission < 0:
            raise ValidationError({"base_monthly_salary": "Values must not be negative."})
        comp, _created = StaffCompensation.objects.get_or_create(user=target)
        comp.base_monthly_salary = base
        comp.monthly_commission = commission
        comp.set_by = request.user
        comp.save()
        AuditLog.objects.create(
            actor=request.user, action="STAFF_COMPENSATION_SET",
            target=target.email,
            detail=f"base {base} + commission {commission} {comp.currency if hasattr(comp, 'currency') else 'ETB'}/month",
        )
        return Response(StaffCompensationSerializer(comp).data)


class RevenueSourceConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = RevenueSourceConfig
        fields = ["id", "source", "enabled", "default_percentage_rate", "default_fixed_fee", "description", "updated_at"]


def _ensure_revenue_sources():
    if RevenueSourceConfig.objects.count() == 0:
        for source, desc in RevenueSourceConfig.Source.choices:
            RevenueSourceConfig.objects.create(source=source, description=desc)


class RevenueSourceListView(FinancialBaseView):
    """GET /payments/financial/revenue-sources/ — every source + config."""

    def get(self, request):
        _ensure_revenue_sources()
        configs = RevenueSourceConfig.objects.order_by("source")
        return Response({
            "success": True,
            "sources": RevenueSourceConfigSerializer(configs, many=True).data,
        })


class RevenueSourceUpdateView(FinancialBaseView):
    """PUT /payments/financial/revenue-sources/<source>/ — Super Admin only."""

    def put(self, request, source):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can change revenue source settings.")
        _ensure_revenue_sources()
        config = RevenueSourceConfig.objects.filter(source=source).first()
        if config is None:
            raise NotFound("Unknown revenue source.")
        if "enabled" in request.data:
            config.enabled = bool(request.data["enabled"])
        if "default_percentage_rate" in request.data:
            config.default_percentage_rate = Decimal(str(request.data["default_percentage_rate"] or 0))
        if "default_fixed_fee" in request.data:
            config.default_fixed_fee = Decimal(str(request.data["default_fixed_fee"] or 0))
        if "description" in request.data:
            config.description = str(request.data["description"] or "")[:255]
        config.updated_by = request.user
        config.save()
        AuditLog.objects.create(
            actor=request.user, action="REVENUE_SOURCE_UPDATED",
            target=config.source,
            detail=f"enabled={config.enabled} pct={config.default_percentage_rate} fixed={config.default_fixed_fee}",
        )
        return Response(RevenueSourceConfigSerializer(config).data)


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    subscriber_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = SubscriptionPlan
        fields = ["id", "name", "participant_role", "price", "duration_days", "benefits", "active", "subscriber_count", "created_at"]
        read_only_fields = ["id", "created_at", "subscriber_count"]


class SubscriptionPlanListView(FinancialBaseView):
    """GET/POST /payments/financial/subscription-plans/"""

    def get(self, request):
        plans = SubscriptionPlan.objects.all().annotate(
            subscriber_count=Count("user_subscriptions", filter=Q(user_subscriptions__status="ACTIVE"))
        ).order_by("participant_role", "price")
        return Response(SubscriptionPlanSerializer(plans, many=True).data)

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can create subscription plans.")
        serializer = SubscriptionPlanSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        plan = serializer.save(created_by=request.user)
        AuditLog.objects.create(actor=request.user, action="SUBSCRIPTION_PLAN_CREATED", target=plan.name)
        return Response(SubscriptionPlanSerializer(plan).data, status=201)


class SubscriptionPlanDeactivateView(FinancialBaseView):
    """POST /payments/financial/subscription-plans/<pk>/deactivate/ — SA only."""

    def post(self, request, pk):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only the Super Admin can deactivate plans.")
        plan = SubscriptionPlan.objects.filter(pk=pk).first()
        if plan is None:
            raise NotFound("Plan not found.")
        plan.active = False
        plan.save(update_fields=["active"])
        return Response({"success": True, "plan": plan.name})


class SubscribeView(APIView):
    """POST /api/v1/payments/subscribe/ — a user subscribes to a plan.

    Posts SUBSCRIPTION_REVENUE to the ledger and activates the subscription
    until now + duration_days.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        plan = SubscriptionPlan.objects.filter(pk=request.data.get("plan"), active=True).first()
        if plan is None:
            raise NotFound("Plan not found or inactive.")
        if plan.participant_role not in ("*", request.user.role):
            raise PermissionDenied("This plan is not available for your role.")
        payment_reference = (request.data.get("payment_reference") or "").strip() or f"SUB-{str(plan.pk)[:8].upper()}-{int(timezone.now().timestamp())}"
        from .financial_services import post_journal_entry
        with transaction.atomic():
            subscription = UserSubscription.objects.create(
                user=request.user, plan=plan,
                expires_at=timezone.now() + timezone.timedelta(days=plan.duration_days),
                payment_reference=payment_reference,
            )
            post_journal_entry(
                reference=f"subscription:{subscription.pk}", category="SUBSCRIPTION_REVENUE",
                amount=plan.price, currency="ETB",
                debit_code="ASSET:CASH", debit_name="Cash / provider settlement", debit_category="ASSET",
                credit_code="REVENUE:SUBSCRIPTION", credit_name="Subscription revenue", credit_category="REVENUE",
                source="SUBSCRIPTION", source_reference=payment_reference, actor=request.user,
                description=f"Subscription {plan.name} for {request.user.full_name}",
                related_user=request.user,
            )
            from .revenue_engine import apply_subscription_revenue

            apply_subscription_revenue(subscription, actor=request.user)
        return Response({
            "success": True,
            "subscription": {
                "id": str(subscription.pk), "plan": plan.name,
                "expires_at": subscription.expires_at.isoformat(),
            },
            "amount": str(plan.price),
        }, status=201)


class OtherRevenueView(FinancialBaseView):
    """POST /payments/financial/other-revenue/ — record inspection, advertising
    or other approved revenue against an optional order reference (SA/FM)."""

    ALLOWED = ("INSPECTION_REVENUE", "ADVERTISING_REVENUE", "OTHER_REVENUE")

    def post(self, request):
        category = request.data.get("category")
        if category not in self.ALLOWED:
            raise ValidationError({"category": f"Choose one of: {', '.join(self.ALLOWED)}."})
        amount = Decimal(str(request.data.get("amount") or 0))
        if amount <= 0:
            raise ValidationError({"amount": "Amount must be greater than zero."})
        reference = (request.data.get("reference") or "").strip() or f"OTHER-{int(timezone.now().timestamp())}"
        from .financial_services import post_journal_entry
        entry = post_journal_entry(
            reference=reference, category=category,
            amount=amount, currency="ETB",
            debit_code="ASSET:CASH", debit_name="Cash / provider settlement", debit_category="ASSET",
            credit_code="REVENUE:OTHER", credit_name="Other platform revenue", credit_category="REVENUE",
            source="OTHER_REVENUE", source_reference=reference, actor=request.user,
            description=(request.data.get("notes") or "")[:250],
        )
        AuditLog.objects.create(actor=request.user, action="OTHER_REVENUE_RECORDED", target=reference, detail=f"{category} {amount}")
        return Response({"success": True, "reference": entry.reference, "amount": str(amount)}, status=201)


class EmployeeRegistrySerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.full_name", read_only=True)
    user_role = serializers.CharField(source="user.role", read_only=True)
    user_email = serializers.CharField(source="user.email", read_only=True)

    class Meta:
        model = EmployeeProfile
        fields = ["id", "user", "user_name", "user_role", "user_email", "employee_code",
                  "department", "job_title", "employment_status", "contract_type",
                  "hired_at", "monthly_base_salary", "created_at"]
        read_only_fields = ("id", "employee_code", "created_at")

    STAFF_ROLES = ("USER_ADMIN", "FINANCIAL_MANAGER", "SUPER_ADMIN", "CUSTOMER_SUPPORT",
                   "TOP_USER_ADMIN", "REGIONAL_ADMIN", "ZONAL_ADMIN", "WEREDA_ADMIN")

    def validate_user(self, value):
        if value.role not in self.STAFF_ROLES:
            raise serializers.ValidationError(
                "Only staff accounts can be registered as employees."
            )
        if EmployeeProfile.objects.filter(user=value).exclude(pk=self.instance.pk if self.instance else None).exists():
            raise serializers.ValidationError("This account already has an employee profile.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        validated_data["created_by"] = self.context["request"].user
        return super().create(validated_data)


class EmployeeRegistryView(FinancialBaseView):
    """GET/POST/PATCH /payments/financial/employees/ — Part 25 employee registry."""

    def get(self, request):
        employees = EmployeeProfile.objects.select_related("user").order_by("employee_code")
        summary = {
            "total": employees.count(),
            "active": employees.filter(employment_status="ACTIVE").count(),
            "inactive": employees.filter(employment_status="INACTIVE").count(),
            "monthly_payroll_expense": str(employees.filter(employment_status="ACTIVE").aggregate(
                s=Sum("monthly_base_salary"))["s"] or 0),
            "by_department": list(employees.values("department").annotate(total=Count("id")).order_by("-total")),
        }

        # Every staff user is an employee for payroll purposes — from Top User
        # Admin down to Wereda admins, plus Logistics, Customer Support and
        # Financial Managers. Region resolves through the canonical hierarchy.
        staff_roles = (
            Role.SUPER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN,
            Role.ZONAL_ADMIN, Role.WEREDA_ADMIN, Role.USER_ADMIN,
            Role.FINANCIAL_MANAGER, Role.LOGISTICS_MANAGER, Role.CUSTOMER_SUPPORT,
        )
        staff_rows = list(
            User.objects.filter(role__in=staff_roles)
            .select_related("registration__location")
            .values(
                "id", "full_name", "email", "role", "status", "is_active",
                "location",
                "registration__location__name", "registration__location__level",
                "registration__location__parent__name", "registration__location__parent__level",
                "registration__location__parent__parent__name",
                "registration__location__parent__parent__level",
                "registration__location__parent__parent__parent__name",
            )
        )
        raw_region = {row["id"]: _region_of(row) for row in staff_rows}
        canonical_names = list(
            AdministrativeLocation.objects.filter(
                level__in=["REGION", "CITY"], active=True,
            ).values_list("name", flat=True)
        )
        canonical_by_key = {_norm_key(n): n.strip() for n in canonical_names}
        free = {
            r for r in set(raw_region.values())
            if r != "Unspecified" and canonical_names and _norm_key(r) not in canonical_by_key
        }
        resolution = _build_region_canonicalizer(free, canonical_by_key) if free else {}
        region_by_user = {
            uid: ((resolution.get(r) or "Unspecified") if r in free else r)
            for uid, r in raw_region.items()
        }

        # This-month activity per staff member, from the immutable audit log:
        # sign-ins, total recorded actions, and approvals they performed.
        month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_activity = {
            row["actor_id"]: row
            for row in AuditLog.objects.filter(
                created_at__gte=month_start, actor_id__in=[r["id"] for r in staff_rows]
            ).values("actor_id").annotate(
                logins=Count("id", filter=Q(action="login_success")),
                actions=Count("id"),
                approvals=Count("id", filter=Q(action__in=["user_approved", "admin_account_approved", "staff_approved"])),
            )
        }
        compensation_by_user = {
            comp.user_id: comp
            for comp in StaffCompensation.objects.select_related("user")
        }
        payroll_components = FinancialPayrollRecord.objects.values("employee_id").annotate(
            records=Count("id"),
            paid=Count("id", filter=Q(status="PAID")),
            unpaid=Count("id", filter=Q(status="APPROVED")),
            pending=Count("id", filter=Q(status="PENDING")),
            base=Sum("base_amount", filter=Q(status="PAID")),
            allowances=Sum("allowances", filter=Q(status="PAID")),
            deductions=Sum("deductions", filter=Q(status="PAID")),
            tax=Sum("tax_amount", filter=Q(status="PAID")),
        )
        payroll_by_employee = {}
        for row in payroll_components:
            net_paid = (
                (row["base"] or 0) + (row["allowances"] or 0)
                - (row["deductions"] or 0) - (row["tax"] or 0)
            )
            payroll_by_employee[row["employee_id"]] = {**row, "net_paid": net_paid}
        staff = []
        for row in staff_rows:
            agg = payroll_by_employee.get(row["id"], {})
            comp = compensation_by_user.get(row["id"])
            activity = month_activity.get(row["id"], {})
            staff.append({
                "id": str(row["id"]),
                "full_name": row["full_name"],
                "email": row["email"],
                "role": row["role"],
                "status": row["status"],
                "is_active": row["is_active"],
                "region": region_by_user.get(row["id"], "Unspecified"),
                "payroll_records": agg.get("records") or 0,
                "payroll_paid": agg.get("paid") or 0,
                "payroll_unpaid": agg.get("unpaid") or 0,
                "payroll_pending": agg.get("pending") or 0,
                "total_net_paid": str(agg.get("net_paid") or "0.00"),
                "base_monthly_salary": str(comp.base_monthly_salary) if comp else None,
                "monthly_commission": str(comp.monthly_commission) if comp else None,
                "month_logins": activity.get("logins") or 0,
                "month_actions": activity.get("actions") or 0,
                "month_approvals": activity.get("approvals") or 0,
            })
        staff.sort(key=lambda s: (-s["payroll_records"], s["full_name"]))

        return Response({
            "summary": summary,
            "employees": EmployeeRegistrySerializer(employees, many=True).data,
            "staff": staff,
        })

    def post(self, request):
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can register employees.")
        serializer = EmployeeRegistrySerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        employee = serializer.save()
        AuditLog.objects.create(actor=request.user, action="EMPLOYEE_REGISTERED",
                                target=str(employee.pk), detail=f"{employee.employee_code} {employee.user.full_name}")
        return Response(EmployeeRegistrySerializer(employee).data, status=201)

    def patch(self, request):
        employee = EmployeeProfile.objects.filter(pk=request.data.get("id")).first()
        if employee is None:
            raise ValidationError({"id": "Employee not found."})
        if request.user.role != Role.SUPER_ADMIN:
            raise PermissionDenied("Only Super Admin can edit employees.")
        serializer = EmployeeRegistrySerializer(employee, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        employee = serializer.save()
        AuditLog.objects.create(actor=request.user, action="EMPLOYEE_UPDATED",
                                target=str(employee.pk), detail=f"{employee.employee_code} status={employee.employment_status}")
        return Response(EmployeeRegistrySerializer(employee).data)


class PayrollSummaryView(FinancialBaseView):
    """GET /payments/financial/payroll/summary/ — Part 25 dashboard totals."""

    def get(self, request):
        qs = FinancialPayrollRecord.objects.select_related("employee")
        month_start = timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return Response({
            "success": True,
            "employees": {"total": EmployeeProfile.objects.count(),
                          "active": EmployeeProfile.objects.filter(employment_status="ACTIVE").count(),
                          "inactive": EmployeeProfile.objects.filter(employment_status="INACTIVE").count(),
                          "terminated": EmployeeProfile.objects.filter(employment_status="TERMINATED").count()},
            "pending_approvals": qs.filter(status="PENDING").count(),
            "paid": {"count": qs.filter(status="PAID").count(),
                     "amount": str(qs.filter(status="PAID").aggregate(s=Sum("deductions") + Sum("base_amount") + Sum("allowances") - Sum("deductions"))["s"] or 0)},
            "unpaid": {"count": qs.filter(status__in=("APPROVED", "PENDING", "DRAFT")).count(),
                       "amount": str(qs.filter(status="APPROVED").aggregate(s=Sum("base_amount") + Sum("allowances") - Sum("deductions"))["s"] or 0)},
            "tax_and_liabilities": str(qs.exclude(status="REJECTED").aggregate(s=Sum("tax_amount"))["s"] or 0),
            "current_month_records": qs.filter(created_at__gte=month_start).count(),
        })


class MyPayslipsView(APIView):
    """GET /api/v1/auth/my-payslips/ — an employee sees only their own records."""

    def get_permissions(self):
        return [IsAuthenticated()]

    def get(self, request):
        records = FinancialPayrollRecord.objects.filter(employee=request.user).order_by("-period_start")
        return Response({
            "success": True,
            "payslips": [
                {"id": str(r.pk), "period": f"{r.period_start} → {r.period_end}",
                 "base_amount": str(r.base_amount), "allowances": str(r.allowances),
                 "deductions": str(r.deductions), "tax_amount": str(r.tax_amount),
                 "net": str(r.base_amount + r.allowances - r.deductions - r.tax_amount),
                 "status": r.status, "paid_at": r.paid_at.isoformat() if r.paid_at else None}
                for r in records
            ],
        })
