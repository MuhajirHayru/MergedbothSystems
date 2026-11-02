import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0022_deliverypricingconfiguration_deliveryfeepayment_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='financialjournalentry',
            name='reverses',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='reversals', to='payments.financialjournalentry'),
        ),
    ]
