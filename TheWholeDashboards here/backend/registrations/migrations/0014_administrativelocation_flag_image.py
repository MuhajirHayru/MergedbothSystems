from django.db import migrations
import django.db.models.fields.files


class Migration(migrations.Migration):

    dependencies = [
        ("registrations", "0013_administrativelocation_flag"),
    ]

    operations = [
        migrations.AddField(
            model_name="administrativelocation",
            name="flag_image",
            field=django.db.models.fields.files.ImageField(
                upload_to="location_flags/", blank=True, null=True
            ),
        ),
    ]
