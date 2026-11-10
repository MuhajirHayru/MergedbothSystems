import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from notifications.services import notify
from users.models import AccountStatus, AuditLog, Role, User

from .models import (
    AdministratorScope,
    AdministrativeLocation,
    RegistrationDocument,
    RegistrationReview,
    RegistrationStatus,
    DriverAuthorizationOutbox,
    DriverIntegrationLink,
    UserRegistration,
)

ADMIN_SCOPE_TYPES = {
    "REGIONAL": {"REGION"},
    "CITY": {"CITY"},
    "ZONAL": {"ZONE"},
    "WOREDA": {"WOREDA"},
    "SUBCITY": {"SUBCITY"},
    "DISTRICT": {"DISTRICT"},
    "ADMIN_DIVISION": {"OTHER"},
}

DASHBOARD_FEATURES = {
    "regional_reports": "Regional reports",
    "user_management": "User directory and account actions",
    "admin_management": "Create and manage administrators in your scope",
    "registration_review": "Registration and document review",
    "product_oversight": "Product listing oversight",
    "administrative_audit": "Administrative audit history",
}


def location_descendant_ids(location):
    """Return the active location and all active descendants, without depth assumptions."""
    if not location or not location.active:
        return []
    found = [location.pk]
    frontier = [location.pk]
    while frontier:
        children = list(
            AdministrativeLocation.objects.filter(
                parent_id__in=frontier,
                active=True,
            ).values_list("pk", flat=True)
        )
        found.extend(children)
        frontier = children
    return found


def admin_scope_type_for_location(location):
    if location is None:
        return "TOP_LEVEL"
    for scope_type, levels in ADMIN_SCOPE_TYPES.items():
        if location.level in levels:
            return scope_type
    return "ADMIN_DIVISION"


def administrator_scope_for(user):
    return (
        AdministratorScope.objects.select_related("location")
        .filter(user_id=user.pk)
        .first()
    )


def allowed_staff_scope_types(actor):
    if actor.role == Role.SUPER_ADMIN:
        location_levels = AdministrativeLocation.objects.filter(active=True).values_list(
            "level", flat=True
        ).distinct()
        return ["TOP_LEVEL", *sorted({admin_scope_type_for_level(level) for level in location_levels})]
    if actor.role not in (Role.USER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN):
        return []
    scope = administrator_scope_for(actor)
    if scope is None and actor.role == Role.TOP_USER_ADMIN:
        location_levels = AdministrativeLocation.objects.filter(active=True).values_list(
            "level", flat=True
        ).distinct()
        return sorted({admin_scope_type_for_level(level) for level in location_levels})
    if scope is None:
        return []
    if scope.level == AdministratorScope.Level.GLOBAL:
        location_levels = AdministrativeLocation.objects.filter(active=True).values_list(
            "level", flat=True
        ).distinct()
    else:
        location_levels = AdministrativeLocation.objects.filter(
            active=True,
            pk__in=location_descendant_ids(scope.location),
        ).exclude(pk=scope.location_id).values_list("level", flat=True).distinct()
    types = sorted({admin_scope_type_for_level(level) for level in location_levels})
    return types


def admin_scope_type_for_level(level):
    for scope_type, levels in ADMIN_SCOPE_TYPES.items():
        if level in levels:
            return scope_type
    return "ADMIN_DIVISION"


def can_assign_admin_scope(actor, level, location, requested_scope_type=None):
    if actor.role == Role.SUPER_ADMIN:
        if level == AdministratorScope.Level.GLOBAL:
            return location is None
        return bool(
            level == AdministratorScope.Level.LOCATION
            and location
            and location.active
            and (
                requested_scope_type is None
                or requested_scope_type == admin_scope_type_for_location(location)
            )
        )
    if actor.role not in (Role.USER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN) or level != AdministratorScope.Level.LOCATION:
        return False
    if location is None or not location.active:
        return False
    scope = administrator_scope_for(actor)
    if scope is None and actor.role == Role.TOP_USER_ADMIN:
        scope = None
    elif scope is None:
        return False
    if actor.role != Role.TOP_USER_ADMIN and not admin_dashboard_feature_enabled(actor, "admin_management"):
        return False
    scope_type = admin_scope_type_for_location(location)
    if requested_scope_type and requested_scope_type != scope_type:
        return False
    if scope_type not in allowed_staff_scope_types(actor):
        return False
    if actor.role == Role.REGIONAL_ADMIN and scope.location.level != "REGION":
        return False
    if actor.role == Role.ZONAL_ADMIN and scope.location.level != "ZONE":
        return False
    if scope is None or scope.level == AdministratorScope.Level.GLOBAL:
        return True
    return location.pk in set(location_descendant_ids(scope.location)) - {
        scope.location_id
    }


def manageable_admins_for(actor, queryset=None):
    queryset = queryset if queryset is not None else User.objects.all()
    if actor.role == Role.SUPER_ADMIN:
        return queryset.filter(role__in=(
            Role.USER_ADMIN,
            Role.REGIONAL_ADMIN,
            Role.ZONAL_ADMIN,
            Role.WEREDA_ADMIN,
            Role.FINANCIAL_MANAGER,
            Role.LOGISTICS_MANAGER,
            Role.CUSTOMER_SUPPORT,
        ))
    if actor.role not in (Role.USER_ADMIN, Role.TOP_USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN, Role.WEREDA_ADMIN):
        return queryset.none()
    if actor.role != Role.TOP_USER_ADMIN and not admin_dashboard_feature_enabled(actor, "admin_management"):
        return queryset.none()
    scope = administrator_scope_for(actor)
    if scope is None and actor.role == Role.TOP_USER_ADMIN:
        return queryset.filter(
            role__in=(Role.USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN, Role.WEREDA_ADMIN),
            administrative_scope__level=AdministratorScope.Level.LOCATION,
        )
    if scope is None:
        return queryset.none()
    managed_roles = (Role.USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN, Role.WEREDA_ADMIN)
    scoped = queryset.filter(role__in=managed_roles)
    if scope.level == AdministratorScope.Level.GLOBAL:
        return scoped.filter(
            administrative_scope__level=AdministratorScope.Level.LOCATION
        )
    descendant_ids = set(location_descendant_ids(scope.location)) - {scope.location_id}
    if not descendant_ids:
        return scoped.none()
    return scoped.filter(administrative_scope__location_id__in=descendant_ids)


SCOPED_ADMIN_ROLES = (
    Role.USER_ADMIN,
    Role.TOP_USER_ADMIN,
    Role.REGIONAL_ADMIN,
    Role.ZONAL_ADMIN,
    Role.WEREDA_ADMIN,
)


def users_visible_to_admin(user, queryset=None):
    """Geographic scope enforcement for every administrative role (Parts 19/22/29).

    Super Admin sees everything. TOP_USER_ADMIN sees the whole country through a
    GLOBAL scope. REGIONAL/ZONAL/WEREDA/USER Admins see only accounts whose
    registration location falls inside their scope's descendant tree.
    """
    queryset = queryset if queryset is not None else User.objects.all()
    if user.role == Role.SUPER_ADMIN:
        return queryset
    if user.role not in SCOPED_ADMIN_ROLES:
        return queryset.none()
    scope = administrator_scope_for(user)
    if scope is None and user.role == Role.TOP_USER_ADMIN:
        return queryset
    if scope is None:
        return queryset.none()
    if scope.level == AdministratorScope.Level.GLOBAL:
        return queryset
    location_ids = location_descendant_ids(scope.location)
    if not location_ids:
        return queryset.none()
    return queryset.filter(registration__location_id__in=location_ids)


def admin_dashboard_feature_enabled(user, feature):
    """Enforce Top User Admin grants on scoped administration APIs."""
    if user.role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
        return True
    if feature not in DASHBOARD_FEATURES:
        return False
    scope = administrator_scope_for(user)
    if scope is None or user.role not in SCOPED_ADMIN_ROLES:
        return False
    # Existing scoped admins keep their current access until a Top User Admin
    # explicitly configures their feature allow-list.
    if scope.feature_flags is None:
        return True
    return feature in scope.feature_flags


def features_available_to_admin(user):
    """Return the dashboard feature keys the administrator may pass to a child."""
    if user.role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
        return list(DASHBOARD_FEATURES)
    scope = administrator_scope_for(user)
    if scope is None:
        return []
    enabled = list(DASHBOARD_FEATURES) if scope.feature_flags is None else scope.feature_flags
    return [feature for feature in DASHBOARD_FEATURES if feature in enabled]


def creatable_hierarchy_roles(actor):
    """Return the child admin roles this actor can create under their location."""
    if actor.role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
        return (Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN, Role.WEREDA_ADMIN)
    if actor.role not in (Role.USER_ADMIN, Role.REGIONAL_ADMIN, Role.ZONAL_ADMIN):
        return ()
    if not admin_dashboard_feature_enabled(actor, "admin_management"):
        return ()
    scope = administrator_scope_for(actor)
    if not scope or scope.level != AdministratorScope.Level.LOCATION:
        return ()
    location_level = scope.location.level
    if location_level == "REGION" and actor.role != Role.ZONAL_ADMIN:
        return (Role.ZONAL_ADMIN, Role.WEREDA_ADMIN)
    if location_level == "ZONE" and actor.role != Role.REGIONAL_ADMIN:
        return (Role.WEREDA_ADMIN,)
    return ()


def region_flag_for(location):
    """Return the location's flag, or the nearest ancestor region's flag.

    Zones and weredas inherit their region's insignia for dashboard display;
    the nearest location carrying an explicit flag wins.
    """
    node = location
    while node is not None:
        if node.flag:
            return node.flag
        node = node.parent
    return ""


NATIONAL_FLAG = "🇪🇹"

ALLOWED_FLAG_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/svg+xml")
MAX_FLAG_IMAGE_BYTES = 2 * 1024 * 1024


def region_flag_image_for(location):
    """Return the media URL of the nearest ancestor location with an uploaded
    flag picture, or '' when none carries one."""
    node = location
    while node is not None:
        if node.flag_image:
            try:
                return node.flag_image.url
            except ValueError:
                return ""
        node = node.parent
    return ""


def national_flag_image_url():
    """Media URL of the uploaded national flag picture ('' when unset)."""
    from users.models import PlatformSettings

    flag = PlatformSettings.load().national_flag
    if not flag:
        return ""
    try:
        return flag.url
    except ValueError:
        return ""


def dashboard_flag_image_for(scope, role):
    """The flag *picture* an administrator's dashboard should display.

    Nationwide roles display the uploaded national flag; Addis Ababa admins
    inherit it as the federal flag; everyone else inherits the nearest
    ancestor region's uploaded picture.
    """
    from users.models import Role

    national = national_flag_image_url()
    if scope is None or scope.location_id is None:
        if role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
            return national
        return ""
    if is_federal_city(scope.location):
        return region_flag_image_for(scope.location) or national
    if role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
        return region_flag_image_for(scope.location) or national
    return region_flag_image_for(scope.location)


def is_federal_city(location):
    """Addis Ababa is the federal capital — its administrators carry the federal flag."""
    return (
        location is not None
        and location.level in ("CITY", "REGION")
        and location.name.strip().lower() == "addis ababa"
    )


def dashboard_flag_for(scope, role):
    """The insignia an administrator's dashboard should display.

    Nationwide roles (Super Admin / Top User Admin) display the national flag.
    Addis Ababa user admins display the federal flag. Everyone else inherits
    the nearest ancestor region's flag.
    """
    if scope is None or scope.location_id is None:
        if role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
            return NATIONAL_FLAG
        return ""
    if is_federal_city(scope.location):
        return scope.location.flag or NATIONAL_FLAG
    if role in (Role.SUPER_ADMIN, Role.TOP_USER_ADMIN):
        return scope.location.flag or NATIONAL_FLAG
    return region_flag_for(scope.location)


def admin_can_access_location(user, location):
    """Return whether an admin may inspect this location and its reports."""
    if user.role == Role.SUPER_ADMIN:
        return True
    if user.role not in SCOPED_ADMIN_ROLES:
        return False
    scope = administrator_scope_for(user)
    if scope is None:
        return user.role == Role.TOP_USER_ADMIN
    if scope.level == AdministratorScope.Level.GLOBAL:
        return True
    return location.pk in location_descendant_ids(scope.location)


class RegistrationReviewConflict(APIException):
    status_code = 409
    default_detail = "This registration is no longer awaiting review."
    default_code = "registration_review_conflict"


def required_license_types_for_role(role):
    return {
        Role.FARMER: ("FARMER_LICENSE",),
        Role.WHOLESALER: ("WHOLESALER_LICENSE",),
        Role.RETAILER: ("RETAILER_LICENSE",),
        Role.DRIVER: (
            "IDENTITY_DOCUMENT",
            "DRIVING_LICENSE",
            "VEHICLE_REGISTRATION",
        ),
    }.get(role, ())


def has_verified_required_license(registration):
    required_types = required_license_types_for_role(registration.user.role)
    if not required_types:
        return True
    verified_types = set(registration.documents.filter(
        document_type__in=required_types,
        verification_status=RegistrationDocument.VerificationStatus.VERIFIED,
    ).values_list("document_type", flat=True))
    return set(required_types).issubset(verified_types)


@transaction.atomic
def enqueue_driver_authorization_update(user):
    """Queue a minimal, revisioned snapshot of Marketplace-owned driver status."""
    if user.role != Role.DRIVER:
        return None
    link, _ = DriverIntegrationLink.objects.get_or_create(user=user)
    link = DriverIntegrationLink.objects.select_for_update().get(pk=link.pk)
    registration = UserRegistration.objects.select_related("location").filter(
        user=user
    ).first()
    if registration is None:
        return None

    location_names = {}
    location = registration.location
    while location is not None:
        location_names.setdefault(location.level, location.name)
        location = location.parent
    documents_verified = has_verified_required_license(registration)
    license_valid = bool(registration.license_expiry and registration.license_expiry > timezone.localdate())
    approved = bool(
        user.status == AccountStatus.APPROVED
        and registration.status == RegistrationStatus.APPROVED
        and documents_verified
        and license_valid
    )
    link.revision += 1
    event_id = uuid.uuid4()
    application_status = {
        RegistrationStatus.CHANGES_REQUESTED: "additional_info_required",
    }.get(registration.status, registration.status.lower())
    payload = {
        "contract_version": "2",
        "source_system": "greenpath_marketplace",
        "event_id": str(event_id),
        "event_type": "driver.authorization_snapshot",
        "occurred_at": timezone.now().isoformat(),
        "revision": link.revision,
        "canonical_user_id": str(user.pk),
        "driver_authorization": {
            "account_status": user.status,
            "account_active": bool(user.is_active),
            "application_status": application_status,
            "driver_authorized": approved,
            "documents_verified": documents_verified,
            "license_expiry": registration.license_expiry.isoformat() if registration.license_expiry else None,
            "legal_full_name": user.full_name,
            "phone": user.phone,
            "service_region": location_names.get("REGION", ""),
            "service_zone": location_names.get("ZONE", ""),
            "service_wereda": location_names.get("WOREDA", ""),
            "service_kebele": location_names.get("KEBELE", ""),
            "license_number": registration.driving_license_number,
            "vehicle_type": registration.vehicle_type,
            "vehicle_registration": registration.vehicle_registration,
            "cargo_capacity_kg": (
                str(registration.cargo_capacity_kg)
                if registration.cargo_capacity_kg is not None
                else None
            ),
        },
    }
    DriverAuthorizationOutbox.objects.create(
        event_id=event_id,
        link=link,
        revision=link.revision,
        payload=payload,
    )
    link.sync_status = DriverIntegrationLink.SyncStatus.PENDING
    link.last_error_code = ""
    link.last_correlation_id = event_id
    link.save(
        update_fields=["revision", "sync_status", "last_error_code", "last_correlation_id", "updated_at"]
    )
    return event_id


def record_registration_decision(registration_id, reviewer, action, reason=""):
    with transaction.atomic():
        registration = (
            UserRegistration.objects.select_for_update()
            .select_related("user", "location")
            .filter(pk=registration_id)
            .first()
        )
        if registration is None:
            raise NotFound()
        if registration.user_id == reviewer.pk:
            raise PermissionDenied("You cannot review your own registration.")
        if not users_visible_to_admin(reviewer).filter(pk=registration.user_id).exists():
            raise NotFound()
        if registration.status not in (
            RegistrationStatus.SUBMITTED,
            RegistrationStatus.CHANGES_REQUESTED,
        ):
            raise RegistrationReviewConflict()
        if action == "APPROVE" and not registration.legacy_registration:
            if not has_verified_required_license(registration):
                raise ValidationError(
                    {
                        "license": (
                            "A required business license must be uploaded and verified "
                            "before this registration can be approved."
                        )
                    }
                )

        if action == "APPROVE":
            registration.status = RegistrationStatus.APPROVED
            registration.save(update_fields=["status", "updated_at"])
            registration.user.approve(actor=reviewer)
            review_action = RegistrationReview.Action.APPROVED
        elif action == "REJECT":
            registration.status = RegistrationStatus.REJECTED
            registration.save(update_fields=["status", "updated_at"])
            registration.user.reject(reason, actor=reviewer)
            review_action = RegistrationReview.Action.REJECTED
        elif action == "REQUEST_CHANGES":
            registration.status = RegistrationStatus.CHANGES_REQUESTED
            registration.save(update_fields=["status", "updated_at"])
            review_action = RegistrationReview.Action.CHANGES_REQUESTED
            if registration.user.status == AccountStatus.REJECTED:
                registration.user.status = AccountStatus.PENDING
                registration.user.rejection_reason = ""
                registration.user.is_active = False
                registration.user.save(
                    update_fields=[
                        "status",
                        "rejection_reason",
                        "is_active",
                        "updated_at",
                    ]
                )
        else:
            raise ValidationError({"action": "Unknown registration decision."})

        RegistrationReview.objects.create(
            registration=registration,
            reviewer=reviewer,
            action=review_action,
            reason=reason,
        )
        AuditLog.objects.create(
            actor=reviewer,
            action=f"registration_{action.lower()}",
            target=registration.user.email,
            detail=reason,
        )
        if action == "REQUEST_CHANGES":
            notify(
                user_ids=[registration.user_id],
                type="REGISTRATION",
                message=f"Please update your registration. Reason: {reason}",
                actor=reviewer,
            )
            if registration.user.role == Role.DRIVER:
                enqueue_driver_authorization_update(registration.user)
    return registration
