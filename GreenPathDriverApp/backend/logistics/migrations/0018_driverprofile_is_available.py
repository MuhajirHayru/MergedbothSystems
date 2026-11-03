from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("logistics", "0017_marketplacedriveridentity"),
    ]

    operations = [
        migrations.AddField(
            model_name="driverprofile",
            name="is_available",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
