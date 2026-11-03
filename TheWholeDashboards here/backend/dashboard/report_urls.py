from django.urls import path

from users.enterprise_views import ReportsCenterView, ReportExportView, DriverPerformanceView
from .regional_analytics_views import (
    AdminActivityView,
    RegionalAnalyticsView,
    RegionalDrilldownView,
)
from .report_views import (
    FinancialExportView,
    FinancialSummaryView,
    TransactionVolumeView,
)

urlpatterns = [
    path("financial-summary/", FinancialSummaryView.as_view(), name="financial_summary"),
    path(
        "financial-summary/export/",
        FinancialExportView.as_view(),
        name="financial_export",
    ),
    path("transaction-volume/", TransactionVolumeView.as_view(), name="transaction_volume"),
    path("regional-analytics/", RegionalAnalyticsView.as_view(), name="regional_analytics"),
    path(
        "regional-analytics/<uuid:location_id>/",
        RegionalDrilldownView.as_view(),
        name="regional_analytics_drilldown",
    ),
    path("admin-activity/", AdminActivityView.as_view(), name="admin_activity"),
    path("center/", ReportsCenterView.as_view(), name="reports_center"),
    path("center/export/", ReportExportView.as_view(), name="reports_center_export"),
    path("driver-performance/", DriverPerformanceView.as_view(), name="driver_performance"),
]
