from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .account_control_views import BulkAccountStatusView
from .banner_views import BannerAdminView, BannerDetailView, BannerReorderView
from .oversight_views import ConversationMessagesView, ConversationOversightView
from .enterprise_views import SystemHealthDetailedView
from .audit_views import (
    AuditExportView,
    AuditSummaryView,
    UserActivityView,
)
from .superadmin_views import (
    AdminAccountViewSet,
    AnnouncementBroadcastView,
    AuditLogListView,
    LoginUnlockView,
    OverrideDecisionView,
    PlatformSettingsView,
    SuperAdminDataView,
    SuperAdminUsersListView,
    SystemHealthView,
    WebsiteContentAdminView,
)

router = DefaultRouter()
router.register("accounts", AdminAccountViewSet, basename="superadmin-accounts")
router.register("audit", AuditLogListView, basename="superadmin-audit")

urlpatterns = [
    # Part 22 — must precede the accounts router so 'bulk-status' is not read as a pk.
    path(
        "accounts/bulk-status/",
        BulkAccountStatusView.as_view(),
        name="superadmin_bulk_status",
    ),
] + router.urls + [
    # FR-SA-01
    path("data/", SuperAdminDataView.as_view(), name="superadmin_data"),
    path("users/", SuperAdminUsersListView.as_view(), name="superadmin_users"),
    # FR-SA-03
    path("users/<uuid:pk>/override/", OverrideDecisionView.as_view(), name="superadmin_override"),
    path(
        "users/<uuid:pk>/unlock-login/",
        LoginUnlockView.as_view(),
        name="superadmin_unlock_login",
    ),
    # FR-SA-04
    path("settings/", PlatformSettingsView.as_view(), name="superadmin_settings"),
    path(
        "website-content/",
        WebsiteContentAdminView.as_view(),
        name="superadmin_website_content",
    ),
    path("banners/", BannerAdminView.as_view(), name="superadmin_banners"),
    path("banners/reorder/", BannerReorderView.as_view(), name="superadmin_banner_reorder"),
    path("banners/<int:pk>/", BannerDetailView.as_view(), name="superadmin_banner_detail"),
    path("announcement/", AnnouncementBroadcastView.as_view(), name="superadmin_announcement"),
    # FR-SA-05
    path("health/", SystemHealthView.as_view(), name="superadmin_health"),
    path("health-detailed/", SystemHealthDetailedView.as_view(), name="superadmin_health_detailed"),
    # Part 20 — master audit center
    path("conversations/", ConversationOversightView.as_view(), name="superadmin_conversations"),
    path(
        "conversations/<uuid:pk>/messages/",
        ConversationMessagesView.as_view(),
        name="superadmin_conversation_messages",
    ),
    path("audit/summary/", AuditSummaryView.as_view(), name="superadmin_audit_summary"),
    path("audit/export/", AuditExportView.as_view(), name="superadmin_audit_export"),
    path(
        "audit/user-activity/<uuid:user_id>/",
        UserActivityView.as_view(),
        name="superadmin_audit_user_activity",
    ),
]
