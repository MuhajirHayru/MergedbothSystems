import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("logistics", "0013_drivershipmentlocation"),
    ]

    operations = [
        migrations.AddField(
            model_name="shipment",
            name="pickup_kebele",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="shipment",
            name="destination_kebele",
            field=models.CharField(blank=True, default="", max_length=100),
        ),
        migrations.AddField(
            model_name="shipment",
            name="external_product_reference",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddField(
            model_name="shipment",
            name="cargo_quantity",
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=12, null=True
            ),
        ),
        migrations.AddField(
            model_name="shipment",
            name="cargo_quantity_unit",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="shipment",
            name="packaging_details",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.CreateModel(
            name="MarketplacePaymentSnapshot",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("source_system", models.CharField(max_length=64)),
                ("status", models.CharField(max_length=24)),
                ("revision", models.PositiveBigIntegerField()),
                ("occurred_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "event",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="payment_snapshot",
                        to="logistics.marketplaceintegrationevent",
                    ),
                ),
                (
                    "shipment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="payment_snapshots",
                        to="logistics.shipment",
                    ),
                ),
            ],
            options={"ordering": ["revision", "pk"]},
        ),
        migrations.AddConstraint(
            model_name="marketplacepaymentsnapshot",
            constraint=models.UniqueConstraint(
                fields=("shipment", "revision"),
                name="unique_marketplace_payment_snapshot_revision",
            ),
        ),
    ]
