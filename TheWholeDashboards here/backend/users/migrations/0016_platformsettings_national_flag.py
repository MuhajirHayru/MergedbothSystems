from django.db import migrations
import django.db.models.fields.files


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0015_scarcity_thresholds"),
    ]

    operations = [
        migrations.AddField(
            model_name="platformsettings",
            name="national_flag",
            field=django.db.models.fields.files.ImageField(
                upload_to="location_flags/", blank=True, null=True
            ),
        ),
    ]
