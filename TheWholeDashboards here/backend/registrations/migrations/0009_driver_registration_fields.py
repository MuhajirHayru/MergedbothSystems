from django.db import migrations


DRIVER_PROFILE_FIELDS = (
    ("driving_license_number", "Driving-license number", 8),
    ("license_expiry", "Driving-license expiry", 9),
    ("vehicle_type", "Vehicle type", 10),
    ("vehicle_registration", "Vehicle registration", 11),
    ("cargo_capacity_kg", "Cargo capacity (kg)", 12),
)


def configure_driver_registration(apps, schema_editor):
    Configuration = apps.get_model("registrations", "RegistrationFieldConfiguration")
    manager = Configuration.objects.using(schema_editor.connection.alias)

    for key in ("full_name", "email", "phone"):
        manager.filter(field_key=key, stage="INITIAL").update(
            roles=["FARMER", "WHOLESALER", "RETAILER", "DRIVER"]
        )

    for key in ("full_name", "phone", "location"):
        row = manager.filter(field_key=key, stage="PROFILE").first()
        if row:
            row.roles = sorted(set(row.roles or []) | {"DRIVER"})
            row.save(update_fields=["roles"])

    for key, label, display_order in DRIVER_PROFILE_FIELDS:
        manager.update_or_create(
            field_key=key,
            stage="PROFILE",
            defaults={
                "label": label,
                "description": "Required to verify and authorize a driver.",
                "required": True,
                "visible": True,
                "display_order": display_order,
                "roles": ["DRIVER"],
                "options": [],
                "editable_after_approval": False,
            },
        )


def reverse_driver_registration(apps, schema_editor):
    Configuration = apps.get_model("registrations", "RegistrationFieldConfiguration")
    manager = Configuration.objects.using(schema_editor.connection.alias)
    for key, _, _ in DRIVER_PROFILE_FIELDS:
        manager.filter(field_key=key, stage="PROFILE").delete()
    for key in ("full_name", "email", "phone"):
        row = manager.filter(field_key=key, stage="INITIAL").first()
        if row:
            row.roles = [role for role in row.roles if role != "DRIVER"]
            row.save(update_fields=["roles"])
    for key in ("full_name", "phone", "location"):
        row = manager.filter(field_key=key, stage="PROFILE").first()
        if row:
            row.roles = [role for role in row.roles if role != "DRIVER"]
            row.save(update_fields=["roles"])


class Migration(migrations.Migration):
    dependencies = [("registrations", "0008_userregistration_cargo_capacity_kg_and_more")]

    operations = [migrations.RunPython(configure_driver_registration, reverse_driver_registration)]
