import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from registrations.models import AdministrativeLocation


class FinancialConfiguration(models.Model):
    class Kind(models.TextChoices):
        DELIVERY = "DELIVERY", "Delivery pricing"
        COMMISSION = "COMMISSION", "Marketplace commission"
        TAX = "TAX", "Tax"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        APPROVED = "APPROVED", "Approved"
        SUPERSEDED = "SUPERSEDED", "Superseded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    name = models.CharField(max_length=120)
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    rules = models.JSONField(default=dict)
    source = models.CharField(max_length=255, blank=True, default="")
    source_url = models.URLField(max_length=500, blank=True, default="")
    reason = models.TextField()
    effective_from = models.DateTimeField()
    effective_to = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="financial_configurations_created")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="financial_configurations_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "financial_configurations"
        ordering = ["kind", "-version"]
        constraints = [
            models.UniqueConstraint(fields=["kind", "version"], name="unique_financial_configuration_version"),
            models.CheckConstraint(condition=models.Q(version__gt=0), name="financial_configuration_positive_version"),
        ]
        indexes = [models.Index(fields=["kind", "status", "effective_from"])]

    def clean(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValidationError({"effective_to": "Must be later than effective_from."})
        if self.status == self.Status.APPROVED and (not self.approved_by_id or not self.approved_at):
            raise ValidationError("Approved configurations require an approver and approval time.")
        if self.kind == self.Kind.TAX and self.status == self.Status.APPROVED and not (self.source and self.source_url):
            raise ValidationError("Approved tax rules require an authoritative source and source URL.")


class FinancialAccount(models.Model):
    class Category(models.TextChoices):
        ASSET = "ASSET", "Asset"
        LIABILITY = "LIABILITY", "Liability"
        EQUITY = "EQUITY", "Equity"
        REVENUE = "REVENUE", "Revenue"
        EXPENSE = "EXPENSE", "Expense"

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=16, choices=Category.choices)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "financial_accounts"
        ordering = ["code"]


class FinancialJournalEntry(models.Model):
    class Status(models.TextChoices):
        POSTED = "POSTED", "Posted"
        REVERSED = "REVERSED", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=100, unique=True)
    category = models.CharField(max_length=40)
    description = models.TextField(blank=True, default="")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="ETB")
    debit_account = models.ForeignKey(FinancialAccount, on_delete=models.PROTECT, related_name="debit_entries")
    credit_account = models.ForeignKey(FinancialAccount, on_delete=models.PROTECT, related_name="credit_entries")
    order_reference = models.CharField(max_length=64, blank=True, default="")
    related_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="financial_entries")
    location = models.ForeignKey(AdministrativeLocation, on_delete=models.PROTECT, null=True, blank=True, related_name="financial_entries")
    configuration = models.ForeignKey(FinancialConfiguration, on_delete=models.PROTECT, null=True, blank=True, related_name="journal_entries")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.POSTED)
    source = models.CharField(max_length=64)
    source_reference = models.CharField(max_length=100)
    idempotency_key = models.CharField(max_length=120, unique=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="financial_entries_posted")
    posted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="financial_entries_created")
    created_at = models.DateTimeField(default=timezone.now)
    reverses = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="reversals")

    class Meta:
        db_table = "financial_journal_entries"
        ordering = ["-created_at", "id"]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="financial_journal_positive_amount")]
        indexes = [models.Index(fields=["category", "created_at"]), models.Index(fields=["source", "source_reference"])]

    def clean(self):
        if self.debit_account_id and self.credit_account_id and self.debit_account_id == self.credit_account_id:
            raise ValidationError("Debit and credit accounts must differ.")
        if self.reverses_id and self.status != self.Status.REVERSED:
            raise ValidationError("A reversal entry must use REVERSED status.")

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Posted financial journal entries are immutable; create a reversal instead.")
        if not self.posted_by_id:
            self.posted_by_id = self.actor_id
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Financial journal entries cannot be deleted.")


class FinancialOrderSnapshot(models.Model):
    class Status(models.TextChoices):
        SETTLED = "SETTLED", "Settled"
        REFUNDED = "REFUNDED", "Refunded"
        TAX_UNRESOLVED = "TAX_UNRESOLVED", "Tax treatment unresolved"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.OneToOneField("payments.Order", on_delete=models.PROTECT, related_name="financial_snapshot")
    configuration = models.ForeignKey(FinancialConfiguration, on_delete=models.PROTECT, null=True, blank=True, related_name="order_snapshots")
    gross_order_value = models.DecimalField(max_digits=14, decimal_places=2)
    seller_role = models.CharField(max_length=20, blank=True, default="")
    seller_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="financial_order_snapshots")
    commission_rate = models.DecimalField(max_digits=9, decimal_places=6, default=Decimal("0"))
    commission_fixed_fee = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    commission_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    service_fee_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    seller_proceeds = models.DecimalField(max_digits=14, decimal_places=2)
    tax_configuration = models.ForeignKey(FinancialConfiguration, on_delete=models.PROTECT, null=True, blank=True, related_name="tax_order_snapshots")
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default="ETB")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SETTLED)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError("Financial order snapshots are immutable.")
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Financial order snapshots cannot be deleted.")

    class Meta:
        db_table = "financial_order_snapshots"
        constraints = [models.CheckConstraint(condition=models.Q(gross_order_value__gt=0), name="financial_order_gross_positive")]


class DeliveryPricingConfiguration(models.Model):
    class Model(models.TextChoices):
        PLATFORM_RETAINED = "A", "Platform-retained service fee"
        SEPARATE_FEE = "B", "Separate platform fee"

    class FeeType(models.TextChoices):
        FIXED = "FIXED", "Fixed amount"
        PERCENTAGE = "PERCENTAGE", "Percentage"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    pricing_model = models.CharField(max_length=1, choices=Model.choices)
    fee_type = models.CharField(max_length=12, choices=FeeType.choices)
    fee_value = models.DecimalField(max_digits=12, decimal_places=4)
    maximum_fee = models.DecimalField(max_digits=12, decimal_places=2)
    minimum_fee = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    category = models.CharField(max_length=48, blank=True, default="*")
    region = models.ForeignKey(AdministrativeLocation, null=True, blank=True, on_delete=models.PROTECT, related_name="delivery_pricing_regions")
    zone = models.ForeignKey(AdministrativeLocation, null=True, blank=True, on_delete=models.PROTECT, related_name="delivery_pricing_zones")
    wereda = models.ForeignKey(AdministrativeLocation, null=True, blank=True, on_delete=models.PROTECT, related_name="delivery_pricing_weredas")
    vehicle_category = models.CharField(max_length=48, blank=True, default="*")
    business_agreement_reference = models.CharField(max_length=100, blank=True, default="")
    effective_from = models.DateTimeField()
    effective_to = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="delivery_pricing_created")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_pricing_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "delivery_pricing_configurations"
        ordering = ["-effective_from", "-created_at"]
        constraints = [models.CheckConstraint(condition=models.Q(fee_value__gte=0), name="delivery_pricing_fee_nonnegative"), models.CheckConstraint(condition=models.Q(maximum_fee__gt=0), name="delivery_pricing_max_positive"), models.CheckConstraint(condition=models.Q(minimum_fee__gte=0), name="delivery_pricing_min_nonnegative")]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk, payments__isnull=False).exists():
            original = type(self).objects.get(pk=self.pk)
            protected = ("name", "pricing_model", "fee_type", "fee_value", "minimum_fee", "maximum_fee", "category", "region_id", "zone_id", "wereda_id", "vehicle_category", "business_agreement_reference", "effective_from")
            if any(getattr(original, field) != getattr(self, field) for field in protected):
                raise ValidationError("Pricing configurations used by payments are immutable; deactivate and create a replacement rule.")
        self.full_clean()
        return super().save(*args, **kwargs)

    def clean(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValidationError({"effective_to": "Must be later than effective_from."})
        if self.minimum_fee > self.maximum_fee:
            raise ValidationError({"minimum_fee": "Must not exceed maximum_fee."})
        if self.pricing_model == self.Model.PLATFORM_RETAINED and self.minimum_fee >= self.maximum_fee:
            raise ValidationError({"minimum_fee": "Platform-retained minimum must remain below the maximum."})


class DeliveryFeePayment(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending verification"
        VERIFIED = "VERIFIED", "Verified"
        PARTIAL = "PARTIAL", "Partially verified"
        FAILED = "FAILED", "Failed"
        REFUNDED = "REFUNDED", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    agreement = models.ForeignKey("payments.MarketplaceDeliveryFeeAgreement", on_delete=models.PROTECT, related_name="customer_payments")
    pricing_configuration = models.ForeignKey(DeliveryPricingConfiguration, on_delete=models.PROTECT, null=True, blank=True, related_name="payments")
    tax_configuration = models.ForeignKey(FinancialConfiguration, on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_payments")
    pricing_model = models.CharField(max_length=1, choices=DeliveryPricingConfiguration.Model.choices)
    fee_type = models.CharField(max_length=12, choices=DeliveryPricingConfiguration.FeeType.choices)
    fee_value = models.DecimalField(max_digits=12, decimal_places=4)
    customer_amount = models.DecimalField(max_digits=14, decimal_places=2)
    driver_charge = models.DecimalField(max_digits=14, decimal_places=2)
    platform_fee = models.DecimalField(max_digits=14, decimal_places=2)
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    payment_reference = models.CharField(max_length=100, unique=True)
    verification_evidence = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    journal_entry = models.OneToOneField("payments.FinancialJournalEntry", on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_collection")
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_payments_verified")
    verified_at = models.DateTimeField(null=True, blank=True)
    compensation_paid_at = models.DateTimeField(null=True, blank=True)
    compensation_payment_reference = models.CharField(max_length=100, blank=True, default="")
    compensation_paid_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_compensations_paid")
    compensation_journal_entry = models.OneToOneField("payments.FinancialJournalEntry", on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_compensation_payment")
    compensation_journal_entry = models.OneToOneField("payments.FinancialJournalEntry", on_delete=models.PROTECT, null=True, blank=True, related_name="delivery_compensation_payment")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "delivery_fee_payments"
        constraints = [models.CheckConstraint(condition=models.Q(customer_amount__gt=0), name="delivery_payment_positive_amount")]


class FinancialRefundRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        EXECUTING = "EXECUTING", "Executing"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        RECONCILED = "RECONCILED", "Reconciled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("payments.Order", on_delete=models.PROTECT, related_name="financial_refunds")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    reason = models.TextField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    payment_reference = models.CharField(max_length=100, blank=True, default="")
    approval_reference = models.CharField(max_length=100, blank=True, default="")
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="financial_refunds_submitted")
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="financial_refunds_reviewed")
    journal_entry = models.OneToOneField("payments.FinancialJournalEntry", on_delete=models.PROTECT, null=True, blank=True, related_name="financial_refund")
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "financial_refund_requests"
        ordering = ["-created_at"]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="financial_refund_positive_amount")]


class FinancialOperatingExpense(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"
        PAID = "PAID", "Paid"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.CharField(max_length=48)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="ETB")
    description = models.TextField()
    incurred_on = models.DateField()
    department = models.CharField(max_length=120, blank=True, default="")
    location = models.ForeignKey(AdministrativeLocation, on_delete=models.PROTECT, null=True, blank=True, related_name="operating_expenses")
    receipt_reference = models.CharField(max_length=255, blank=True, default="")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="expenses_submitted")
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="expenses_reviewed")
    review_reason = models.TextField(blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    journal_entry = models.OneToOneField(FinancialJournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="operating_expense")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "financial_operating_expenses"
        ordering = ["-incurred_on", "-created_at"]
        indexes = [models.Index(fields=["status", "incurred_on"])]
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name="financial_expense_positive_amount")]


class FinancialPayrollRecord(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        PENDING = "PENDING", "Pending approval"
        APPROVED = "APPROVED", "Approved"
        PAID = "PAID", "Paid"
        REJECTED = "REJECTED", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payroll_records")
    period_start = models.DateField()
    period_end = models.DateField()
    base_amount = models.DecimalField(max_digits=14, decimal_places=2)
    allowances = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    deductions = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    currency = models.CharField(max_length=3, default="ETB")
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    payment_reference = models.CharField(max_length=100, blank=True, default="")
    prepared_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="payroll_prepared")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_approved")
    paid_at = models.DateTimeField(null=True, blank=True)
    journal_entry = models.OneToOneField(FinancialJournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="payroll_record")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "financial_payroll_records"
        ordering = ["-period_start", "employee_id"]
        constraints = [
            models.UniqueConstraint(fields=["employee", "period_start", "period_end"], name="unique_employee_payroll_period"),
            models.CheckConstraint(condition=models.Q(base_amount__gte=0), name="payroll_nonnegative_base"),
            models.CheckConstraint(condition=models.Q(allowances__gte=0), name="payroll_nonnegative_allowances"),
            models.CheckConstraint(condition=models.Q(deductions__gte=0), name="payroll_nonnegative_deductions"),
            models.CheckConstraint(condition=models.Q(tax_amount__gte=0), name="payroll_nonnegative_tax"),
        ]

    @property
    def net_amount(self):
        return self.base_amount + self.allowances - self.deductions - self.tax_amount


class EmployeeProfile(models.Model):
    """Part 25 — staff employee registry (separate from marketplace participants)."""

    class EmploymentStatus(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        INACTIVE = "INACTIVE", "Inactive"
        TERMINATED = "TERMINATED", "Terminated"

    class ContractType(models.TextChoices):
        PERMANENT = "PERMANENT", "Permanent"
        CONTRACT = "CONTRACT", "Contract"
        PART_TIME = "PART_TIME", "Part time"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="employee_profile")
    employee_code = models.CharField(max_length=20, unique=True, blank=True)
    department = models.CharField(max_length=120, blank=True, default="")
    job_title = models.CharField(max_length=120, blank=True, default="")
    employment_status = models.CharField(max_length=12, choices=EmploymentStatus.choices, default=EmploymentStatus.ACTIVE)
    contract_type = models.CharField(max_length=12, choices=ContractType.choices, default=ContractType.PERMANENT)
    hired_at = models.DateField(null=True, blank=True)
    monthly_base_salary = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="employees_created")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employee_profiles"
        ordering = ["employee_code"]
        constraints = [
            models.UniqueConstraint(fields=["user"], name="unique_employee_per_user"),
        ]

    def save(self, *args, **kwargs):
        if not self.employee_code:
            last = EmployeeProfile.objects.order_by("-created_at").first()
            seq = (int(last.employee_code.split("-")[-1]) + 1) if last and last.employee_code.startswith("GP-EMP-") else 1
            self.employee_code = f"GP-EMP-{seq:04d}"
        super().save(*args, **kwargs)

    def clean(self):
        staff_roles = ("USER_ADMIN", "FINANCIAL_MANAGER", "SUPER_ADMIN", "CUSTOMER_SUPPORT",
                       "TOP_USER_ADMIN", "REGIONAL_ADMIN", "ZONAL_ADMIN", "WEREDA_ADMIN")
        if self.user_id and self.user.role not in staff_roles:
            raise ValidationError({"user": "Only staff accounts can be registered as employees."})

    def __str__(self):
        return f"{self.employee_code} {self.user}"
