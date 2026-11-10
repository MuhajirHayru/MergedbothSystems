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
    # Payer responsibility captured on the append-only ledger itself so every
    # report, receipt and transaction detail can name the revenue source and
    # the participant who paid it.
    revenue_method = models.CharField(max_length=40, blank=True, default="")
    payer_party = models.CharField(max_length=24, blank=True, default="")
    payer_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="financial_entries_paid",
    )

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
    buyer_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="buyer_fee_snapshots")
    buyer_fee_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    tax_configuration = models.ForeignKey(FinancialConfiguration, on_delete=models.PROTECT, null=True, blank=True, related_name="tax_order_snapshots")
    tax_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    tax_payer_party = models.CharField(max_length=24, blank=True, default="")
    tax_payer_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True,
        related_name="tax_payer_order_snapshots",
    )
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


class RevenueSourceConfig(models.Model):
    """Central enable/disable + rate control for each platform revenue source.

    One row per source (created by migration). Rates here are the platform
    defaults; the commission rule engine may scope them further per
    transaction. Super Admin only.
    """

    class Source(models.TextChoices):
        MARKETPLACE_COMMISSION = "MARKETPLACE_COMMISSION", "Transaction commission"
        BUYER_FEE = "BUYER_FEE", "Buyer service fee"
        FREIGHT_MARGIN = "FREIGHT_MARGIN", "Freight coordination margin"
        INSPECTION = "INSPECTION", "Inspection & verification fees"
        SUBSCRIPTION = "SUBSCRIPTION", "Subscriptions & memberships"
        ADVERTISING = "ADVERTISING", "Advertising & promotions"

    source = models.CharField(max_length=32, choices=Source.choices, unique=True)
    enabled = models.BooleanField(default=True)
    default_percentage_rate = models.DecimalField(
        max_digits=9, decimal_places=6, default=Decimal("0")
    )
    default_fixed_fee = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    description = models.CharField(max_length=255, blank=True, default="")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="revenue_sources_updated",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "revenue_source_configs"
        ordering = ["source"]

    def __str__(self):
        return f"{self.get_source_display()} ({'on' if self.enabled else 'off'})"


class SubscriptionPlan(models.Model):
    """Configurable membership plan for eligible platform participants."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    participant_role = models.CharField(max_length=32)
    price = models.DecimalField(max_digits=14, decimal_places=2)
    duration_days = models.PositiveIntegerField(default=30)
    benefits = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="subscription_plans_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "subscription_plans"
        ordering = ["participant_role", "price"]

    def __str__(self):
        return f"{self.name} ({self.price} ETB / {self.duration_days}d)"


class UserSubscription(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscriptions"
    )
    plan = models.ForeignKey(
        SubscriptionPlan, on_delete=models.PROTECT, related_name="user_subscriptions"
    )
    started_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    status = models.CharField(
        max_length=12,
        choices=[("ACTIVE", "Active"), ("EXPIRED", "Expired"), ("CANCELLED", "Cancelled")],
        default="ACTIVE",
    )
    payment_reference = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_subscriptions"
        ordering = ["-created_at"]

    @property
    def is_current(self) -> bool:
        return self.status == "ACTIVE" and self.expires_at > timezone.now()


class StaffCompensation(models.Model):
    """Monthly salary and commission settings for a staff account.

    Set by the Super Admin at staff creation (and editable later); the
    Financial Manager's end-of-month payroll is prepared from these values.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_compensation"
    )
    base_monthly_salary = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    monthly_commission = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="compensation_set",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "staff_compensation"

    def __str__(self):
        return f"{self.user.full_name}: {self.base_monthly_salary} + {self.monthly_commission} commission"


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
    commission_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    pension_employee = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
    pension_employer = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0.00"))
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
            models.CheckConstraint(condition=models.Q(commission_amount__gte=0), name="payroll_nonnegative_commission"),
            models.CheckConstraint(condition=models.Q(pension_employee__gte=0), name="payroll_nonnegative_pension_employee"),
            models.CheckConstraint(condition=models.Q(pension_employer__gte=0), name="payroll_nonnegative_pension_employer"),
        ]

    @property
    def net_amount(self):
        return (
            self.base_amount + self.allowances + self.commission_amount
            - self.deductions - self.pension_employee - self.tax_amount
        )

    @property
    def employer_cost(self):
        """Total employer cost: net paid into the wallet + employer pension."""
        return self.net_amount + self.pension_employer


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


class RevenueMethod(models.Model):
    """Super Admin configuration of one revenue method and who pays it.

    One row per (transaction type, method). Rows are only effective once an
    approver and approval time are recorded; the engine never charges a
    participant from an unapproved row. Historical rows are preserved — a new
    configuration is a new row with a later ``effective_from``.
    """

    class TransactionType(models.TextChoices):
        FARMER_WHOLESALER = "FARMER_WHOLESALER", "Farmer → Wholesaler"
        WHOLESALER_RETAILER = "WHOLESALER_RETAILER", "Wholesaler → Retailer/Reseller"
        FREIGHT = "FREIGHT", "Freight service"
        SUBSCRIPTION = "SUBSCRIPTION", "Subscription"
        ADVERTISING = "ADVERTISING", "Advertising"

    class Method(models.TextChoices):
        SELLER_COMMISSION = "SELLER_COMMISSION", "Seller commission"
        BUYER_COMMISSION = "BUYER_COMMISSION", "Buyer commission"
        PER_QUINTAL_FEE = "PER_QUINTAL_FEE", "Per-quintal fee"
        FIXED_TRANSACTION_FEE = "FIXED_TRANSACTION_FEE", "Fixed transaction fee"
        INSPECTION_FEE = "INSPECTION_FEE", "Inspection fee"
        FREIGHT_MARGIN = "FREIGHT_MARGIN", "Freight coordination margin"
        SUBSCRIPTION_FEE = "SUBSCRIPTION_FEE", "Subscription fee"
        ADVERTISING_FEE = "ADVERTISING_FEE", "Advertising package fee"

    class Payer(models.TextChoices):
        SELLER = "SELLER", "Seller pays"
        BUYER = "BUYER", "Buyer pays"
        BOTH = "BOTH", "Both pay (separately configured)"
        REQUESTING_PARTY = "REQUESTING_PARTY", "Requesting party pays"
        CONTRACTUAL_PARTY = "CONTRACTUAL_PARTY", "Contractually assigned party pays"

    class Calculation(models.TextChoices):
        PERCENTAGE = "PERCENTAGE", "Percentage of transaction value"
        FIXED = "FIXED", "Fixed amount"
        PER_UNIT = "PER_UNIT", "Per unit (quintal)"

    ALLOWED_METHODS = {
        TransactionType.FARMER_WHOLESALER: {
            Method.SELLER_COMMISSION, Method.BUYER_COMMISSION, Method.PER_QUINTAL_FEE,
            Method.FIXED_TRANSACTION_FEE, Method.INSPECTION_FEE,
        },
        TransactionType.WHOLESALER_RETAILER: {
            Method.SELLER_COMMISSION, Method.BUYER_COMMISSION, Method.PER_QUINTAL_FEE,
            Method.FIXED_TRANSACTION_FEE, Method.INSPECTION_FEE,
        },
        TransactionType.FREIGHT: {Method.FREIGHT_MARGIN},
        TransactionType.SUBSCRIPTION: {Method.SUBSCRIPTION_FEE},
        TransactionType.ADVERTISING: {Method.ADVERTISING_FEE},
    }
    COMMISSION_METHODS = {Method.SELLER_COMMISSION, Method.BUYER_COMMISSION}

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction_type = models.CharField(max_length=24, choices=TransactionType.choices)
    method = models.CharField(max_length=32, choices=Method.choices)
    name = models.CharField(max_length=120)
    enabled = models.BooleanField(default=True)
    payer = models.CharField(max_length=24, choices=Payer.choices)
    calculation = models.CharField(max_length=12, choices=Calculation.choices, default=Calculation.PERCENTAGE)
    rate = models.DecimalField(max_digits=9, decimal_places=6, default=Decimal("0"))
    fixed_fee = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    unit_fee = models.DecimalField(max_digits=14, decimal_places=4, default=Decimal("0"))
    # Only used when payer = BOTH: each side pays its own separately configured amount.
    seller_rate = models.DecimalField(max_digits=9, decimal_places=6, default=Decimal("0"))
    seller_fixed_fee = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    buyer_rate = models.DecimalField(max_digits=9, decimal_places=6, default=Decimal("0"))
    buyer_fixed_fee = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    requires_agreement = models.BooleanField(default=True)
    company_share_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("100"))
    notes = models.TextField(blank=True, default="")
    effective_from = models.DateTimeField(default=timezone.now)
    effective_to = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="revenue_methods_created")
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="revenue_methods_approved")
    approved_at = models.DateTimeField(null=True, blank=True)
    disabled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "revenue_methods"
        ordering = ["transaction_type", "method", "-effective_from", "-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(rate__gte=0) & models.Q(rate__lte=1), name="revenue_method_rate_range"),
            models.CheckConstraint(condition=models.Q(fixed_fee__gte=0), name="revenue_method_fixed_nonnegative"),
            models.CheckConstraint(condition=models.Q(unit_fee__gte=0), name="revenue_method_unit_nonnegative"),
            models.CheckConstraint(condition=models.Q(company_share_percentage__gte=0) & models.Q(company_share_percentage__lte=100), name="revenue_method_company_share_range"),
        ]
        indexes = [models.Index(fields=["transaction_type", "method", "effective_from"])]

    def clean(self):
        if self.effective_to and self.effective_to <= self.effective_from:
            raise ValidationError({"effective_to": "Must be later than effective_from."})
        allowed = self.ALLOWED_METHODS.get(self.transaction_type)
        if allowed is None:
            raise ValidationError({"transaction_type": "Unknown transaction type."})
        if self.method not in allowed:
            raise ValidationError({"method": f"{self.get_method_display()} does not apply to {self.get_transaction_type_display()}."})
        if self.payer == self.Payer.BOTH:
            if self.method in self.COMMISSION_METHODS:
                raise ValidationError({
                    "payer": "A two-sided commission is configured on the approved commission rule "
                             "(fee_payer=buyer/split plus buyer_fee_*); use SELLER, BUYER, REQUESTING_PARTY "
                             "or CONTRACTUAL_PARTY here to keep one charge and no double counting.",
                })
            if not (self.seller_rate or self.seller_fixed_fee or self.buyer_rate or self.buyer_fixed_fee):
                raise ValidationError({"payer": "Both parties pay: configure seller and/or buyer amounts."})
        if self.payer in (self.Payer.REQUESTING_PARTY, self.Payer.CONTRACTUAL_PARTY) and not self.requires_agreement:
            raise ValidationError({"requires_agreement": "A requesting or contractually assigned payer always requires an approved agreement."})
        if self.transaction_type in (
            self.TransactionType.FARMER_WHOLESALER,
            self.TransactionType.WHOLESALER_RETAILER,
            self.TransactionType.FREIGHT,
        ) and not self.requires_agreement:
            raise ValidationError({
                "requires_agreement": "Marketplace and freight fees can never be charged without an approved agreement.",
            })
        if self.approved_by_id and not self.approved_at:
            raise ValidationError({"approved_at": "Record the approval time with the approver."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def is_effective(self, at=None):
        at = at or timezone.now()
        if not self.approved_by_id or not self.approved_at or self.approved_at > at:
            return False
        if self.effective_from > at:
            return False
        if self.effective_to is not None and self.effective_to <= at:
            return False
        if self.disabled_at is not None:
            return self.disabled_at > at
        return self.enabled

    def __str__(self):
        return f"{self.get_transaction_type_display()} · {self.get_method_display()} · {self.get_payer_display()}"


class RevenueCharge(models.Model):
    """One fee event with every party and amount explicitly recorded.

    Stores: the revenue method, the transaction/service that generated it, the
    participant who generated the activity, the participant who pays, the amount
    charged and collected, the amount earned by the company, any third-party
    payable, and the settlement status. Rows are append-only; a correction is a
    new reversal, never an edit.
    """

    class SourceType(models.TextChoices):
        ORDER = "ORDER", "Marketplace order"
        FREIGHT = "FREIGHT", "Freight service"
        SUBSCRIPTION = "SUBSCRIPTION", "Subscription"
        ADVERTISING = "ADVERTISING", "Advertising"

    class PayerParty(models.TextChoices):
        SELLER = "SELLER", "Seller"
        BUYER = "BUYER", "Buyer"
        REQUESTING_PARTY = "REQUESTING_PARTY", "Requesting party"
        CONTRACTUAL_PARTY = "CONTRACTUAL_PARTY", "Contractually assigned party"
        SHIPPER = "SHIPPER", "Shipper"
        SUBSCRIBER = "SUBSCRIBER", "Subscribing participant"
        ADVERTISER = "ADVERTISER", "Advertiser"

    class SettlementStatus(models.TextChoices):
        PENDING = "PENDING", "Charged, not yet collected"
        COLLECTED = "COLLECTED", "Collected in full"
        PARTIALLY_COLLECTED = "PARTIALLY_COLLECTED", "Partially collected"
        SETTLED = "SETTLED", "Settled to the platform"
        REVERSED = "REVERSED", "Reversed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reference = models.CharField(max_length=140, unique=True)
    rule = models.ForeignKey(RevenueMethod, on_delete=models.PROTECT, null=True, blank=True, related_name="charges")
    transaction_type = models.CharField(max_length=24)
    method = models.CharField(max_length=32)
    source_type = models.CharField(max_length=16, choices=SourceType.choices)
    source_reference = models.CharField(max_length=100)
    service_amount = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    generating_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="revenue_charges_generated")
    payer_party = models.CharField(max_length=24, choices=PayerParty.choices)
    payer_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="revenue_charges_paid")
    agreement_reference = models.CharField(max_length=100, blank=True, default="")
    amount_charged = models.DecimalField(max_digits=14, decimal_places=2)
    amount_collected = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    amount_company_earned = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    third_party_payable = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    third_party_payee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="revenue_charges_third_party")
    currency = models.CharField(max_length=3, default="ETB")
    settlement_status = models.CharField(max_length=24, choices=SettlementStatus.choices, default=SettlementStatus.PENDING)
    journal_entry = models.OneToOneField(FinancialJournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="revenue_charge")
    collected_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="revenue_charges_created")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "revenue_charges"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount_charged__gt=0), name="revenue_charge_positive_amount"),
            models.CheckConstraint(condition=models.Q(amount_collected__gte=0), name="revenue_charge_collected_nonnegative"),
            models.CheckConstraint(condition=models.Q(amount_company_earned__gte=0), name="revenue_charge_company_nonnegative"),
            models.CheckConstraint(condition=models.Q(third_party_payable__gte=0), name="revenue_charge_third_party_nonnegative"),
        ]
        indexes = [
            models.Index(fields=["method", "payer_party"]),
            models.Index(fields=["source_type", "source_reference"]),
            models.Index(fields=["settlement_status"]),
        ]

    LOCKED_FIELDS = (
        "reference", "rule_id", "transaction_type", "method", "source_type",
        "source_reference", "service_amount", "generating_user_id", "payer_party",
        "payer_user_id", "agreement_reference", "amount_charged", "currency",
    )

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            original = type(self).objects.get(pk=self.pk)
            if any(getattr(original, field) != getattr(self, field) for field in self.LOCKED_FIELDS):
                raise ValidationError("Recorded revenue charges are immutable; post a reversal instead.")
            if self.amount_collected > self.amount_charged:
                raise ValidationError("Collected amount cannot exceed the amount charged.")
        else:
            if self.amount_company_earned + self.third_party_payable > self.amount_charged:
                raise ValidationError("Company earnings plus third-party payable cannot exceed the amount charged.")
        self.full_clean()
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Revenue charges cannot be deleted; post a reversal instead.")

    def __str__(self):
        return f"{self.method} {self.amount_charged} {self.currency} paid by {self.payer_party}"


class AdvertisingPackage(models.Model):
    """An approved promotional package an advertiser can purchase."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    price = models.DecimalField(max_digits=14, decimal_places=2)
    duration_days = models.PositiveIntegerField(default=30)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="advertising_packages_created")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "advertising_packages"
        ordering = ["price", "name"]
        constraints = [models.CheckConstraint(condition=models.Q(price__gt=0), name="advertising_package_positive_price")]

    def __str__(self):
        return f"{self.name} ({self.price} ETB)"


class AdvertisingPurchase(models.Model):
    """A paid promotional package. The advertiser is the only payer."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    package = models.ForeignKey(AdvertisingPackage, on_delete=models.PROTECT, related_name="purchases")
    advertiser = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="advertising_purchases")
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="ETB")
    payment_reference = models.CharField(max_length=120, unique=True)
    starts_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField()
    journal_entry = models.OneToOneField(FinancialJournalEntry, on_delete=models.PROTECT, null=True, blank=True, related_name="advertising_purchase")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="advertising_purchases_created")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "advertising_purchases"
        ordering = ["-created_at"]
        constraints = [models.CheckConstraint(condition=models.Q(amount_paid__gt=0), name="advertising_purchase_positive_amount")]
