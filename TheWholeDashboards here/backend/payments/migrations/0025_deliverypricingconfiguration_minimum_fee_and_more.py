from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0024_deliveryfeepayment_tax_configuration'),
        ('registrations', '0010_allow_business_profile_edits'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='deliverypricingconfiguration',
            name='minimum_fee',
            field=models.DecimalField(decimal_places=2, default=Decimal('0'), max_digits=12),
        ),
        migrations.AddField(
            model_name='marketplacedeliveryfeeagreement',
            name='driver_charge_snapshot',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True),
        ),
        migrations.AddField(
            model_name='marketplacedeliveryfeeagreement',
            name='platform_fee_snapshot',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True),
        ),
        migrations.AddField(
            model_name='marketplacedeliveryfeeagreement',
            name='pricing_configuration_snapshot',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='marketplacedeliveryfeeagreement',
            name='pricing_model_snapshot',
            field=models.CharField(blank=True, default='', max_length=1),
        ),
        migrations.AddField(
            model_name='marketplacedeliveryfeeagreement',
            name='tax_amount_snapshot',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=14, null=True),
        ),
        migrations.AddConstraint(
            model_name='deliverypricingconfiguration',
            constraint=models.CheckConstraint(condition=models.Q(('minimum_fee__gte', 0)), name='delivery_pricing_min_nonnegative'),
        ),
    ]
