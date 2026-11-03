from django.urls import path

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
]
