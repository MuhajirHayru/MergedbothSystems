from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0016_platformsettings_national_flag"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="bio",
            field=models.TextField(blank=True, default=""),
        ),
    ]
