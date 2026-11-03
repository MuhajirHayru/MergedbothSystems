from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import AuditEvent, DriverApplication, DriverProfile, LogisticsUser, SystemSetting
from .services import record_audit


class ReadOnlyLogisticsAdmin(admin.ModelAdmin):
    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(LogisticsUser)
class LogisticsUserAdmin(UserAdmin):
    list_display = ("username", "email", "role", "email_verified", "is_active", "is_staff")
    list_filter = ("role", "email_verified", "is_active", "is_staff")
    fieldsets = UserAdmin.fieldsets + (
        (
            "Logistics access",
            {"fields": ("role", "external_user_id", "admin_region", "admin_zone", "admin_wereda")},
        ),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        (
            "Logistics access",
            {"fields": ("role", "email", "admin_region", "admin_zone", "admin_wereda")},
        ),
    )

    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        previous = None
        if change:
            previous = LogisticsUser.objects.get(pk=obj.pk)
        super().save_model(request, obj, form, change)
        access_changed = previous is None or (
            previous.role != obj.role
            or previous.admin_region != obj.admin_region
            or previous.admin_zone != obj.admin_zone
            or previous.admin_wereda != obj.admin_wereda
        )
        if access_changed and obj.role:
            record_audit(
                request.user,
                "account.logistics_access_changed",
                "logistics_user",
                obj.pk,
                {
                    "old_role": previous.role if previous else None,
                    "new_role": obj.role,
                    "admin_region": obj.admin_region,
                    "admin_zone": obj.admin_zone,
                    "admin_wereda": obj.admin_wereda,
                },
            )


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "object_type", "object_id")
    list_filter = ("action", "object_type", "created_at")
    readonly_fields = ("actor", "action", "object_type", "object_id", "details", "created_at")
    ordering = ("-created_at",)

    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SystemSetting)
class SystemSettingAdmin(admin.ModelAdmin):
    list_display = ("key", "description", "updated_at", "updated_by")
    readonly_fields = ("created_at", "updated_at", "updated_by")

    def has_module_permission(self, request):
        return request.user.is_superuser

    def has_view_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
        record_audit(
            request.user,
            "system_setting.updated",
            "system_setting",
            obj.pk,
            {"key": obj.key},
        )


admin.site.register(DriverProfile, ReadOnlyLogisticsAdmin)
admin.site.register(DriverApplication, ReadOnlyLogisticsAdmin)