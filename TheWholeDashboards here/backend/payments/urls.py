from rest_framework.routers import DefaultRouter

from django.urls import path

from .delivery_fee_review_api import (
    MarketplaceDeliveryFeeAgreementListView,
    MarketplaceDeliveryFeeReviewView,
)
from .views import PaymentViewSet
from .shipment_views import BuyerShipmentListView, BuyerShipmentDetailView
from .freight_bid_views import (
    StaffFreightAssignView,
    StaffFreightCancelView,
    StaffFreightJobsView,
)
from .freight_views import FreightBoardView, FreightTrackingView
from .wishlist_views import WishlistView
from .financial_api import (
    DiscountCampaignListView,
    DiscountCampaignUpdateView,
    DiscountCampaignActionView,
    DiscountRedemptionListView,
    FinancialTransactionDetailView,
    ProfitAndLossView,
    EmployeeRegistryView,
    PayrollSummaryView,

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
    path("financial/payroll/summary/", PayrollSummaryView.as_view(), name="financial-payroll-summary"),
    path("financial/employees/", EmployeeRegistryView.as_view(), name="financial-employees"),
    path("financial/payroll/<uuid:pk>/action/", FinancialPayrollActionView.as_view(), name="financial-payroll-action"),
    path("financial/accounts/", FinancialAccountListView.as_view(), name="financial-accounts"),
    path("financial/ledger/", FinancialLedgerListView.as_view(), name="financial-ledger"),
    path("financial/ledger/<uuid:pk>/", FinancialTransactionDetailView.as_view(), name="financial-ledger-detail"),
    path("financial/pnl/", ProfitAndLossView.as_view(), name="financial-pnl"),
    path("financial/freight-board/", FreightBoardView.as_view(), name="freight-board"),
    path("financial/freight-board/<uuid:order_id>/tracking/", FreightTrackingView.as_view(), name="freight-tracking"),
    path("financial/freight-jobs/", StaffFreightJobsView.as_view(), name="staff_freight_jobs"),
    path("financial/freight-jobs/<uuid:pk>/assign/", StaffFreightAssignView.as_view(), name="staff_freight_assign"),
    path("financial/freight-jobs/<uuid:pk>/cancel/", StaffFreightCancelView.as_view(), name="staff_freight_cancel"),
    path("wishlist/", WishlistView.as_view(), name="wishlist"),
    path("financial/summary/", FinancialSummaryView.as_view(), name="financial-summary"),
    path("financial/report/", FinancialReportView.as_view(), name="financial-report"),
    path("financial/reconciliation/", FinancialReconciliationView.as_view(), name="financial-reconciliation"),
    path("financial/regional-report/", RegionalFinancialReportView.as_view(), name="financial-regional-report"),
    path("financial/refunds/", FinancialRefundListView.as_view(), name="financial-refunds"),
    path("financial/refunds/<uuid:pk>/action/", FinancialRefundActionView.as_view(), name="financial-refund-action"),
    path("financial/discount-campaigns/", DiscountCampaignListView.as_view(), name="discount-campaigns"),
    path("financial/discount-campaigns/<uuid:pk>/action/", DiscountCampaignActionView.as_view(), name="discount-campaign-action"),
    path("financial/discount-campaigns/<uuid:pk>/update/", DiscountCampaignUpdateView.as_view(), name="discount-campaign-update"),
    path("financial/discount-redemptions/", DiscountRedemptionListView.as_view(), name="discount-redemptions"),
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
