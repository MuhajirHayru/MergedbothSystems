from django.conf import settings

from .models import SystemSetting

APPLICATION_FIELD_ALLOWLIST = {
    "legal_full_name",
    "identity_document_type",
    "identity_reference",
    "license_number",
    "license_expiry",
    "vehicle_type",
    "vehicle_registration",
    "cargo_capacity_kg",
    "service_region",
    "service_zone",
    "service_wereda",
}


def document_policy_value(key, fallback):
    setting = SystemSetting.objects.filter(key=key).only("value").first()
    if setting is not None:
        return setting.value
    return fallback


def allowed_driver_document_types():
    value = document_policy_value(
        "driver-document-types", settings.DRIVER_DOCUMENT_TYPES
    )
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    return settings.DRIVER_DOCUMENT_TYPES


def required_driver_document_types():
    value = document_policy_value(
        "driver-required-document-types", settings.DRIVER_REQUIRED_DOCUMENT_TYPES
    )
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    return settings.DRIVER_REQUIRED_DOCUMENT_TYPES


def max_driver_document_bytes():
    value = document_policy_value(
        "driver-document-max-bytes", settings.DRIVER_DOCUMENT_MAX_BYTES
    )
    if isinstance(value, int) and value > 0:
        return value
    return settings.DRIVER_DOCUMENT_MAX_BYTES


def required_driver_application_fields():
    value = document_policy_value(
        "driver-required-application-fields",
        settings.DRIVER_REQUIRED_APPLICATION_FIELDS,
    )
    if isinstance(value, list) and all(
        isinstance(item, str) and item in APPLICATION_FIELD_ALLOWLIST for item in value
    ):
        return value
    return settings.DRIVER_REQUIRED_APPLICATION_FIELDS


def driver_expiry_policy():
    value = document_policy_value("driver-expiry-policy", settings.DRIVER_EXPIRY_POLICY)
    if value in {"expire", "suspend"}:
        return value
    return settings.DRIVER_EXPIRY_POLICY