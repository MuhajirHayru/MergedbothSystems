from django.conf import settings
from rest_framework.permissions import BasePermission

from .models import DriverApplication, LogisticsUser


REVIEWER_ROLES = {
    LogisticsUser.Role.SUPER_ADMIN,
    LogisticsUser.Role.TOP_USER_ADMIN,
    LogisticsUser.Role.REGIONAL_ADMIN,
    LogisticsUser.Role.ZONAL_ADMIN,
    LogisticsUser.Role.WEREDA_ADMIN,
}


def is_reviewer(user):
    return bool(
        not settings.MARKETPLACE_INTEGRATION_ENABLED
        and user
        and user.is_authenticated
        and user.is_active
        and user.role in REVIEWER_ROLES
    )


def application_in_scope(user, application):
    if not is_reviewer(user):
        return False
    if user.role in {LogisticsUser.Role.SUPER_ADMIN, LogisticsUser.Role.TOP_USER_ADMIN}:
        return True
    if user.role == LogisticsUser.Role.REGIONAL_ADMIN:
        return bool(user.admin_region) and application.service_region == user.admin_region
    if user.role == LogisticsUser.Role.ZONAL_ADMIN:
        return (
            bool(user.admin_region and user.admin_zone)
            and application.service_region == user.admin_region
            and application.service_zone == user.admin_zone
        )
    if user.role == LogisticsUser.Role.WEREDA_ADMIN:
        return (
            bool(user.admin_region and user.admin_zone and user.admin_wereda)
            and application.service_region == user.admin_region
            and application.service_zone == user.admin_zone
            and application.service_wereda == user.admin_wereda
        )
    return False


def applications_in_reviewer_scope(user):
    applications = DriverApplication.objects.select_related("profile__user")
    if user.role in {LogisticsUser.Role.SUPER_ADMIN, LogisticsUser.Role.TOP_USER_ADMIN}:
        return applications
    if user.role == LogisticsUser.Role.REGIONAL_ADMIN and user.admin_region:
        return applications.filter(service_region=user.admin_region)
    if user.role == LogisticsUser.Role.ZONAL_ADMIN and user.admin_region and user.admin_zone:
        return applications.filter(
            service_region=user.admin_region, service_zone=user.admin_zone
        )
    if (
        user.role == LogisticsUser.Role.WEREDA_ADMIN
        and user.admin_region
        and user.admin_zone
        and user.admin_wereda
    ):
        return applications.filter(
            service_region=user.admin_region,
            service_zone=user.admin_zone,
            service_wereda=user.admin_wereda,
        )
    return applications.none()


class IsDriver(BasePermission):
    message = "A driver account is required."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_active
            and request.user.role == LogisticsUser.Role.DRIVER
        )


class IsDriverReviewer(BasePermission):
    message = "An authorized driver application reviewer is required."

    def has_permission(self, request, view):
        return is_reviewer(request.user)

    def has_object_permission(self, request, view, obj):
        application = obj.application if hasattr(obj, "application") else obj
        return application_in_scope(request.user, application)
