from django.urls import path

from .views import (
    AdminDashboardView,
    FarmerDashboardView,
    FinancialOperationsSummaryView,
    PaymentSummaryView,
    RetailerDashboardView,
    WholesalerDashboardView,
)
from .financial_analytics import FinancialAnalyticsView
from .wallet_report_views import WalletActivityExportView, WalletActivityReportView
from .regional_price_reports import RegionalPriceReportsView

urlpatterns = [
    path("farmer/", FarmerDashboardView.as_view(), name="dashboard_farmer"),
    path("wholesaler/", WholesalerDashboardView.as_view(), name="dashboard_wholesaler"),
    path("retailer/", RetailerDashboardView.as_view(), name="dashboard_retailer"),
    path("admin/", AdminDashboardView.as_view(), name="dashboard_admin"),
    path("payments/", PaymentSummaryView.as_view(), name="dashboard_payments"),
    path(
        "financial-operations/",
        FinancialOperationsSummaryView.as_view(),
        name="dashboard_financial_operations",
    ),
    path(
        "financial-analytics/",
        FinancialAnalyticsView.as_view(),
        name="dashboard_financial_analytics",
    ),
    path(
        "wallet-activity/",
        WalletActivityReportView.as_view(),
        name="dashboard_wallet_activity",
    ),
    path(
        "wallet-activity/export/",
        WalletActivityExportView.as_view(),
        name="dashboard_wallet_activity_export",
    ),
    path(
        "regional-price-reports/",
        RegionalPriceReportsView.as_view(),
        name="dashboard_regional_price_reports",
    ),
]
