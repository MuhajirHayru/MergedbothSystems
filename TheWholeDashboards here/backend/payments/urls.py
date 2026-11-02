from rest_framework.routers import DefaultRouter

from django.urls import path

from .delivery_fee_review_api import (
    MarketplaceDeliveryFeeAgreementListView,
    MarketplaceDeliveryFeeReviewView,
)
from .views import PaymentViewSet
from .shipment_views import BuyerShipmentListView, BuyerShipmentDetailView
from .financial_api import (
    FinancialAccountListView,
    FinancialConfigurationApproveView,
    FinancialConfigurationListView,
    FinancialExpenseActionView,
    FinancialExpenseListView,
    FinancialLedgerListView,
    FinancialPayrollActionView,
    FinancialPayrollListView,
    FinancialSummaryView,
    DeliveryPricingListView,
    DeliveryPricingActionView,
    DeliveryPaymentCreateView,
    DeliveryCompensationActionView,
    FinancialRefundListView,
    FinancialRefundActionView,
    FinancialReconciliationView,
    RegionalFinancialReportView,
)
from .financial_reporting import FinancialReportView

router = DefaultRouter()
# PATCH /api/v1/payments/{id}/verify/  (FR-FM-02)
# PATCH /api/v1/payments/{id}/flag/
# PATCH /api/v1/payments/{id}/dispute/
# GET   /api/v1/payments/{id}/receipt/
router.register("", PaymentViewSet, basename="payments")

urlpatterns = [
    path("financial/configurations/", FinancialConfigurationListView.as_view(), name="financial-configurations"),
    path("financial/configurations/<uuid:pk>/approve/", FinancialConfigurationApproveView.as_view(), name="financial-configuration-approve"),
    path("financial/expenses/", FinancialExpenseListView.as_view(), name="financial-expenses"),
    path("financial/expenses/<uuid:pk>/review/", FinancialExpenseActionView.as_view(), name="financial-expense-review"),
    path("financial/payroll/", FinancialPayrollListView.as_view(), name="financial-payroll"),
    path("financial/payroll/<uuid:pk>/action/", FinancialPayrollActionView.as_view(), name="financial-payroll-action"),
    path("financial/accounts/", FinancialAccountListView.as_view(), name="financial-accounts"),
    path("financial/ledger/", FinancialLedgerListView.as_view(), name="financial-ledger"),
    path("financial/summary/", FinancialSummaryView.as_view(), name="financial-summary"),
    path("financial/report/", FinancialReportView.as_view(), name="financial-report"),
    path("financial/reconciliation/", FinancialReconciliationView.as_view(), name="financial-reconciliation"),
    path("financial/regional-report/", RegionalFinancialReportView.as_view(), name="financial-regional-report"),
    path("financial/refunds/", FinancialRefundListView.as_view(), name="financial-refunds"),
    path("financial/refunds/<uuid:pk>/action/", FinancialRefundActionView.as_view(), name="financial-refund-action"),
    path("financial/delivery-pricing/", DeliveryPricingListView.as_view(), name="delivery-pricing"),
    path("financial/delivery-pricing/<uuid:pk>/action/", DeliveryPricingActionView.as_view(), name="delivery-pricing-action"),
    path("financial/delivery-agreements/<int:agreement_id>/payments/", DeliveryPaymentCreateView.as_view(), name="delivery-payment-create"),
    path("financial/delivery-payments/<uuid:pk>/compensation/", DeliveryCompensationActionView.as_view(), name="delivery-compensation-action"),
    path(
        "delivery-fee-agreements/",
        MarketplaceDeliveryFeeAgreementListView.as_view(),
        name="delivery-fee-agreement-list",
    ),
    path(
        "delivery-fee-agreements/<int:agreement_id>/review/",
        MarketplaceDeliveryFeeReviewView.as_view(),
        name="delivery-fee-agreement-review",
    ),
    path(
        "shipments/",
        BuyerShipmentListView.as_view(),
        name="buyer-shipment-list",
    ),
    path(
        "shipments/<int:pk>/",
        BuyerShipmentDetailView.as_view(),
        name="buyer-shipment-detail",
    ),
] + router.urls
