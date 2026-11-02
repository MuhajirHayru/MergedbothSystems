"""Let business owners keep their own business name/address up to date.

``business_name`` and ``business_address`` are profile fields on the
registration dossier. They defaulted to "locked after approval", which made the
self-service profile screen unable to persist them at all. Administrators can
still re-lock either field from the registration settings screen.
"""

from django.db import migrations

BUSINESS_FIELD_KEYS = ("business_name", "business_address")


def allow_business_edits(apps, schema_editor):
    RegistrationFieldConfiguration = apps.get_model(
        "registrations", "RegistrationFieldConfiguration"
    )
    RegistrationFieldConfiguration.objects.filter(
        stage="PROFILE", field_key__in=BUSINESS_FIELD_KEYS
    ).update(editable_after_approval=True)


def restore_business_locks(apps, schema_editor):
    RegistrationFieldConfiguration = apps.get_model(
        "registrations", "RegistrationFieldConfiguration"
    )
    RegistrationFieldConfiguration.objects.filter(
        stage="PROFILE", field_key__in=BUSINESS_FIELD_KEYS
    ).update(editable_after_approval=False)


class Migration(migrations.Migration):
    dependencies = [
        ("registrations", "0009_driver_registration_fields"),
    ]

    operations = [
        migrations.RunPython(allow_business_edits, restore_business_locks),
    ]
