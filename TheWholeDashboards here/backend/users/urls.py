from django.urls import path

from payments.financial_api import MyPayslipsView
from .admin_overview import AdminOverviewView
from .agricultural_intel import AgriculturalIntelView, ProductRegionalDistributionView
from .public_stats import PublicStatsView
from .banner_views import (
    BannerAdminView,
    BannerDetailView,
    BannerReorderView,
    PublicBannerListView,
)
from .views import (
    AnnouncementView,
    DriverTokenMintView,
    LoginView,
    LogoutView,
    MeView,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RefreshView,
    RegisterView,
    ResumeRegistrationView,
    UpdateProfilePhotoView,
    UpdateProfileView,
    WebsiteContentView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("registration/resume/", ResumeRegistrationView.as_view(), name="registration_resume"),
    path("login/", LoginView.as_view(), name="login"),
    path("password-reset/request/", PasswordResetRequestView.as_view(), name="password_reset_request"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("password/change/", PasswordChangeView.as_view(), name="password_change"),
    path("token/refresh/", RefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("profile/", UpdateProfileView.as_view(), name="profile"),
    path("profile/photo/", UpdateProfilePhotoView.as_view(), name="profile_photo"),
    path("announcement/", AnnouncementView.as_view(), name="announcement"),
    path("banners/", PublicBannerListView.as_view(), name="public_banners"),
    path("public-stats/", PublicStatsView.as_view(), name="public_stats"),
    path("agricultural-intel/", AgriculturalIntelView.as_view(), name="agri_intel"),
    path("product-regions/", ProductRegionalDistributionView.as_view(), name="product_regions"),
    path("admin-overview/", AdminOverviewView.as_view(), name="admin_overview"),
    path("my-payslips/", MyPayslipsView.as_view(), name="my_payslips"),
        path("website-content/", WebsiteContentView.as_view(), name="website_content"),
    path("driver-token/", DriverTokenMintView.as_view(), name="driver_token_mint"),
]
