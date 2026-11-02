import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0023_alter_financialjournalentry_reverses'),
    ]

    operations = [
        migrations.AddField(
            model_name='deliveryfeepayment',
            name='tax_configuration',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='delivery_payments', to='payments.financialconfiguration'),
        ),
    ]
