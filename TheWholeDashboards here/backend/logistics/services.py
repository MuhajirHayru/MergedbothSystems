from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .configuration import (
    driver_expiry_policy,
    required_driver_application_fields,
    required_driver_document_types,
)
from .models import (
    AuditEvent,
    DriverApplication,
    DriverApplicationReview,
    DriverDocument,
    DriverShipmentLocation,
    LogisticsUser,
)
from .permissions import application_in_scope


REVIEW_TRANSITIONS = {
    DriverApplication.Status.SUBMITTED: {
        DriverApplication.Status.UNDER_REVIEW,
        DriverApplication.Status.ADDITIONAL_INFO_REQUIRED,
        DriverApplication.Status.REJECTED,
    },
    DriverApplication.Status.UNDER_REVIEW: {
        DriverApplication.Status.ADDITIONAL_INFO_REQUIRED,
        DriverApplication.Status.APPROVED,
        DriverApplication.Status.REJECTED,
    },
    DriverApplication.Status.ADDITIONAL_INFO_REQUIRED: {
        DriverApplication.Status.UNDER_REVIEW,
        DriverApplication.Status.REJECTED,
    },
    DriverApplication.Status.APPROVED: {DriverApplication.Status.SUSPENDED},
    DriverApplication.Status.SUSPENDED: {DriverApplication.Status.UNDER_REVIEW},
}


def record_audit(actor, action, object_type, object_id="", details=None):
    return AuditEvent.objects.create(
        actor=actor,
        action=action,
        object_type=object_type,
        object_id=str(object_id),
        details=details or {},
    )


def stop_driver_location_sharing(driver, actor=None):
    affected_shipments = list(
        DriverShipmentLocation.objects.filter(driver=driver)
        .filter(Q(sharing_stopped_at__isnull=True) | Q(latitude__isnull=False))
        .values_list("shipment_id", flat=True)
    )
    if not affected_shipments:
        return
    stopped_at = timezone.now()
    DriverShipmentLocation.objects.filter(
        driver=driver, shipment_id__in=affected_shipments
    ).update(
        sharing_stopped_at=stopped_at,
        sharing_expires_at=stopped_at,
        latitude=None,
        longitude=None,
        accuracy_meters=None,
        observed_at=None,
        received_at=None,
    )
    for shipment_id in affected_shipments:
        record_audit(
            actor,
            "shipment.location_sharing_invalidated",
            "shipment",
            shipment_id,
            {"shipment_id": shipment_id},
        )


@transaction.atomic
def submit_driver_application(application, actor):
    if settings.MARKETPLACE_INTEGRATION_ENABLED:
        raise PermissionDenied(
            "Driver registration and application changes are managed by GreenPath Marketplace."
        )
    application = (
        DriverApplication.objects.select_for_update()
        .select_related("profile__user")
        .get(pk=application.pk)
    )
    if application.status not in {
        DriverApplication.Status.DRAFT,
        DriverApplication.Status.ADDITIONAL_INFO_REQUIRED,
    }:
        raise ValidationError({"status": "This application cannot be submitted in its current state."})

    errors = {}
    for field in required_driver_application_fields():
        if not getattr(application, field):
            errors[field] = "This field is required before submission."
    if application.license_expiry and application.license_expiry <= timezone.localdate():
        errors["license_expiry"] = "The driving license must be unexpired."
    if application.cargo_capacity_kg is not None and application.cargo_capacity_kg <= 0:
        errors["cargo_capacity_kg"] = "Cargo capacity must be greater than zero."

    uploaded_types = set(
        application.documents.filter(
            is_current=True,
            verification_status__in=[
                DriverDocument.VerificationStatus.PENDING,
                DriverDocument.VerificationStatus.VERIFIED,
            ],
        ).values_list("document_type", flat=True)
    )
    missing_documents = sorted(set(required_driver_document_types()) - uploaded_types)
    if missing_documents:
        errors["documents"] = f"Required documents are missing: {', '.join(missing_documents)}."
    if errors:
        raise ValidationError(errors)

    previous_status = application.status
    application.status = DriverApplication.Status.SUBMITTED
    application.submitted_at = timezone.now()
    application.review_reason = ""
    application.save(update_fields=["status", "submitted_at", "review_reason", "updated_at"])
    DriverApplicationReview.objects.create(
        application=application,
        reviewer=None,
        from_status=previous_status,
        to_status=application.status,
        reason="Application submitted by driver.",
    )
    record_audit(
        actor,
        "driver_application.submitted",
        "driver_application",
        application.pk,
        {"from_status": previous_status, "to_status": application.status},
    )
    return application


@transaction.atomic
def review_driver_application(application_id, reviewer, target_status, reason):
    if settings.MARKETPLACE_INTEGRATION_ENABLED:
        raise PermissionDenied(
            "Driver application reviews are managed by GreenPath Marketplace."
        )
    application = (
        DriverApplication.objects.select_for_update()
        .select_related("profile__user")
        .get(pk=application_id)
    )
    if application.profile.user_id == reviewer.pk:
        raise PermissionDenied("Reviewers cannot review their own driver application.")
    if not application_in_scope(reviewer, application):
        raise PermissionDenied("This application is outside your administrative scope.")
    if not reason.strip():
        raise ValidationError({"reason": "A decision reason is required."})
    if target_status not in REVIEW_TRANSITIONS.get(application.status, set()):
        raise ValidationError(
            {"status": f"Cannot change application from {application.status} to {target_status}."}
        )

    if target_status == DriverApplication.Status.APPROVED:
        uploaded_verified = set(
            application.documents.filter(
                is_current=True,
                verification_status=DriverDocument.VerificationStatus.VERIFIED,
            ).values_list("document_type", flat=True)
        )
        missing = sorted(set(required_driver_document_types()) - uploaded_verified)
        if missing:
            raise ValidationError(
                {"documents": f"Required documents must be verified: {', '.join(missing)}."}
            )
        if not application.license_expiry or application.license_expiry <= timezone.localdate():
            raise ValidationError({"license_expiry": "An unexpired driving license is required."})

    previous_status = application.status
    application.status = target_status
    application.reviewer = reviewer
    application.reviewed_at = timezone.now()
    application.review_reason = reason.strip()
    application.save(
        update_fields=["status", "reviewer", "reviewed_at", "review_reason", "updated_at"]
    )

    user = application.profile.user
    if target_status == DriverApplication.Status.SUSPENDED:
        user.is_active = False
        user.save(update_fields=["is_active"])
        stop_driver_location_sharing(user, reviewer)
    elif previous_status == DriverApplication.Status.SUSPENDED:
        user.is_active = True
        user.save(update_fields=["is_active"])

    DriverApplicationReview.objects.create(
        application=application,
        reviewer=reviewer,
        from_status=previous_status,
        to_status=target_status,
        reason=reason.strip(),
    )
    record_audit(
        reviewer,
        "driver_application.reviewed",
        "driver_application",
        application.pk,
        {
            "from_status": previous_status,
            "to_status": target_status,
            "reason": reason.strip(),
        },
    )
    if previous_status != target_status:
        record_audit(
            reviewer,
            "driver_account.activation_changed",
            "logistics_user",
            user.pk,
            {"is_active": user.is_active, "application_status": target_status},
        )
    return application


@transaction.atomic
def verify_driver_document(document, reviewer, verification_status, reason):
    if settings.MARKETPLACE_INTEGRATION_ENABLED:
        raise PermissionDenied(
            "Driver document verification is managed by GreenPath Marketplace."
        )
    document = (
        DriverDocument.objects.select_for_update()
        .select_related("application__profile__user")
        .get(pk=document.pk)
    )
    if not application_in_scope(reviewer, document.application):
        raise PermissionDenied("This document is outside your administrative scope.")
    if document.application.profile.user_id == reviewer.pk:
        raise PermissionDenied("Reviewers cannot verify their own documents.")
    if document.verification_status != DriverDocument.VerificationStatus.PENDING:
        raise ValidationError({"verification_status": "Only pending documents can be reviewed."})
    document.verification_status = verification_status
    document.verified_by = reviewer
    document.verified_at = timezone.now()
    document.verification_reason = reason.strip()
    document.save(
        update_fields=[
            "verification_status",
            "verified_by",
            "verified_at",
            "verification_reason",
        ]
    )
    record_audit(
        reviewer,
        "driver_document.verified",
        "driver_document",
        document.pk,
        {
            "verification_status": verification_status,
            "reason": reason.strip(),
        },
    )
    return document


@transaction.atomic
def expire_driver_applications(today=None):
    today = today or timezone.localdate()
    target_status = (
        DriverApplication.Status.EXPIRED
        if driver_expiry_policy() == "expire"
        else DriverApplication.Status.SUSPENDED
    )
    expired = list(
        DriverApplication.objects.select_for_update()
        .filter(status=DriverApplication.Status.APPROVED)
        .filter(
            Q(license_expiry__lte=today)
            | Q(documents__is_current=True, documents__expires_at__lte=today)
        )
        .select_related("profile__user")
        .distinct()
    )
    for application in expired:
        previous_status = application.status
        reason = f"Automatically {target_status} because a required credential has expired."
        application.status = target_status
        application.reviewed_at = timezone.now()
        application.review_reason = reason
        application.save(
            update_fields=["status", "reviewed_at", "review_reason", "updated_at"]
        )
        driver = application.profile.user
        if driver.is_active:
            driver.is_active = False
            driver.save(update_fields=["is_active"])
        stop_driver_location_sharing(driver)
        DriverApplicationReview.objects.create(
            application=application,
            reviewer=None,
            from_status=previous_status,
            to_status=application.status,
            reason=reason,
        )
        record_audit(
            None,
            "driver_application.expired",
            "driver_application",
            application.pk,
            {"from_status": previous_status, "to_status": application.status},
        )
    return len(expired)
