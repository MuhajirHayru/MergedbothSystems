from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("registrations", "0012_administratorscope_feature_flags"),
    ]

    operations = [
        migrations.AddField(
            model_name="administrativelocation",
            name="flag",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
    ]
