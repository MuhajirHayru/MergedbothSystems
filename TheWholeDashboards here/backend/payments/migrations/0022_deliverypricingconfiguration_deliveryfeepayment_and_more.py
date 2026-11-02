import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0021_financialrefundrequest'),
        ('registrations', '0010_allow_business_profile_edits'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DeliveryPricingConfiguration',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=120)),
                ('pricing_model', models.CharField(choices=[('A', 'Platform-retained service fee'), ('B', 'Separate platform fee')], max_length=1)),
                ('fee_type', models.CharField(choices=[('FIXED', 'Fixed amount'), ('PERCENTAGE', 'Percentage')], max_length=12)),
                ('fee_value', models.DecimalField(decimal_places=4, max_digits=12)),
                ('maximum_fee', models.DecimalField(decimal_places=2, max_digits=12)),
                ('category', models.CharField(blank=True, default='*', max_length=48)),
                ('vehicle_category', models.CharField(blank=True, default='*', max_length=48)),
                ('business_agreement_reference', models.CharField(blank=True, default='', max_length=100)),
                ('effective_from', models.DateTimeField()),
                ('effective_to', models.DateTimeField(blank=True, null=True)),
                ('active', models.BooleanField(default=True)),
                ('approved_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('approved_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_pricing_approved', to=settings.AUTH_USER_MODEL)),
                ('created_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='delivery_pricing_created', to=settings.AUTH_USER_MODEL)),
                ('region', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_pricing_regions', to='registrations.administrativelocation')),
                ('wereda', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_pricing_weredas', to='registrations.administrativelocation')),
                ('zone', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_pricing_zones', to='registrations.administrativelocation')),
            ],
            options={
                'db_table': 'delivery_pricing_configurations',
                'ordering': ['-effective_from', '-created_at'],
            },
        ),
        migrations.CreateModel(
            name='DeliveryFeePayment',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('pricing_model', models.CharField(choices=[('A', 'Platform-retained service fee'), ('B', 'Separate platform fee')], max_length=1)),
                ('fee_type', models.CharField(choices=[('FIXED', 'Fixed amount'), ('PERCENTAGE', 'Percentage')], max_length=12)),
                ('fee_value', models.DecimalField(decimal_places=4, max_digits=12)),
                ('customer_amount', models.DecimalField(decimal_places=2, max_digits=14)),
                ('driver_charge', models.DecimalField(decimal_places=2, max_digits=14)),
                ('platform_fee', models.DecimalField(decimal_places=2, max_digits=14)),
                ('tax_amount', models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True)),
                ('payment_reference', models.CharField(max_length=100, unique=True)),
                ('verification_evidence', models.CharField(blank=True, default='', max_length=255)),
                ('status', models.CharField(choices=[('PENDING', 'Pending verification'), ('VERIFIED', 'Verified'), ('PARTIAL', 'Partially verified'), ('FAILED', 'Failed'), ('REFUNDED', 'Refunded')], default='PENDING', max_length=12)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('agreement', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='customer_payments', to='payments.marketplacedeliveryfeeagreement')),
                ('journal_entry', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_collection', to='payments.financialjournalentry')),
                ('verified_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_payments_verified', to=settings.AUTH_USER_MODEL)),
                ('pricing_configuration', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='payments', to='payments.deliverypricingconfiguration')),
            ],
            options={
                'db_table': 'delivery_fee_payments',
            },
        ),
        migrations.AddConstraint(
            model_name='deliverypricingconfiguration',
            constraint=models.CheckConstraint(condition=models.Q(('fee_value__gte', 0)), name='delivery_pricing_fee_nonnegative'),
        ),
        migrations.AddConstraint(
            model_name='deliverypricingconfiguration',
            constraint=models.CheckConstraint(condition=models.Q(('maximum_fee__gt', 0)), name='delivery_pricing_max_positive'),
        ),
        migrations.AddConstraint(
            model_name='deliveryfeepayment',
            constraint=models.CheckConstraint(condition=models.Q(('customer_amount__gt', 0)), name='delivery_payment_positive_amount'),
        ),
    ]
