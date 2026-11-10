"""Audit-log immutability (FR-SA-02/03): the guards must fail closed, not crash."""

import pytest
from django.contrib.admin.sites import AdminSite
from django.core.exceptions import ValidationError

from users.admin import AuditLogAdmin
from users.models import AuditLog

pytestmark = pytest.mark.django_db


def test_instance_delete_raises_validation_error_not_a_name_error(farmer):
    """The original defect: ``ValidationError`` was never imported, so deleting
    an entry raised ``NameError`` and produced a 500 instead of a refusal."""
    entry = AuditLog.objects.create(actor=farmer, action="probe", target="audit-test")

    with pytest.raises(ValidationError) as error:
        entry.delete()

    assert "cannot be deleted" in str(error.value)
    assert AuditLog.objects.filter(pk=entry.pk).exists()


def test_saving_an_existing_entry_is_refused(farmer):
    entry = AuditLog.objects.create(actor=farmer, action="probe")
    entry.action = "tampered"

    with pytest.raises(ValidationError) as error:
        entry.save()

    assert "append-only" in str(error.value)
    assert AuditLog.objects.get(pk=entry.pk).action == "probe"


def test_bulk_delete_and_bulk_update_are_refused(farmer):
    AuditLog.objects.create(actor=farmer, action="probe")

    with pytest.raises(ValidationError):
        AuditLog.objects.all().delete()
    with pytest.raises(ValidationError):
        AuditLog.objects.all().update(action="tampered")

    assert AuditLog.objects.count() == 1
    assert AuditLog.objects.get().action == "probe"


def test_admin_does_not_offer_a_delete_action():
    admin = AuditLogAdmin(AuditLog, AdminSite())

    assert admin.has_delete_permission(None) is False
    # The other privileged paths stay closed too.
    assert admin.has_add_permission(None) is False
    assert admin.has_change_permission(None) is False
