from rest_framework.routers import DefaultRouter

from django.urls import path

from .delivery_fee_review_api import (
    MarketplaceDeliveryFeeAgreementListView,
    MarketplaceDeliveryFeeReviewView,
)
from .bank_account_api import BankAccountDetailView, BankAccountListCreateView, PayoutBankListView
from .transport_agreement_api import TransportAgreementDetailView, TransportAgreementListCreateView, TransportQuoteView
from .views import LotMovementCreateView, MyLotsView, PaymentViewSet
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
    StaffCompensationView,
    RevenueSourceListView,
    RevenueSourceUpdateView,
    SubscriptionPlanListView,
    SubscriptionPlanDeactivateView,
    OtherRevenueView,
    SubscribeView,
    FinancialPayrollDetailView,
    StaffAttendanceView,
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
    DeliveryPaymentVerifyView,
    DeliveryCompensationActionView,
    FinancialRefundListView,
    FinancialRefundActionView,
    FinancialReconciliationView,
    RegionalFinancialReportView,
)
from .financial_reporting import FinancialReportView
from .financial_statement import FinancialStatementView
from .revenue_api import (
    AdvertisingPackageListCreateView,
    AdvertisingPurchaseView,
    FreightSettlementListView,
    RevenueChargeDetailView,
    RevenueChargeListView,
    RevenueMethodActionView,
    RevenueMethodListCreateView,
)

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
    path("my-lots/", MyLotsView.as_view(), name="my-lots"),
    path("subscribe/", SubscribeView.as_view(), name="subscribe"),

    path("my-lots/<uuid:pk>/movements/", LotMovementCreateView.as_view(), name="my-lot-movement-create"),
    path("financial/employees/", EmployeeRegistryView.as_view(), name="financial-employees"),
    path("financial/compensation/<uuid:user_id>/", StaffCompensationView.as_view(), name="financial-compensation"),
    path("financial/revenue-methods/", RevenueMethodListCreateView.as_view(), name="financial-revenue-methods"),
    path("financial/revenue-methods/<uuid:pk>/action/", RevenueMethodActionView.as_view(), name="financial-revenue-method-action"),
    path("financial/revenue-charges/", RevenueChargeListView.as_view(), name="financial-revenue-charges"),
    path("financial/revenue-charges/<uuid:pk>/", RevenueChargeDetailView.as_view(), name="financial-revenue-charge-detail"),
    path("financial/freight-settlements/", FreightSettlementListView.as_view(), name="financial-freight-settlements"),
    path("financial/advertising-packages/", AdvertisingPackageListCreateView.as_view(), name="financial-advertising-packages"),
    path("financial/advertising-packages/<uuid:pk>/purchase/", AdvertisingPurchaseView.as_view(), name="financial-advertising-purchase"),
    path("financial/revenue-sources/", RevenueSourceListView.as_view(), name="financial-revenue-sources"),
    path("financial/revenue-sources/<str:source>/", RevenueSourceUpdateView.as_view(), name="financial-revenue-source-update"),
    path("financial/subscription-plans/", SubscriptionPlanListView.as_view(), name="financial-subscription-plans"),
    path("financial/subscription-plans/<uuid:pk>/deactivate/", SubscriptionPlanDeactivateView.as_view(), name="financial-subscription-plan-deactivate"),
    path("financial/other-revenue/", OtherRevenueView.as_view(), name="financial-other-revenue"),
    path("financial/payroll/<uuid:pk>/", FinancialPayrollDetailView.as_view(), name="financial-payroll-detail"),
    path("financial/attendance/<uuid:user_id>/", StaffAttendanceView.as_view(), name="financial-attendance"),
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
    path("banks/", PayoutBankListView.as_view(), name="payout-banks"),
    path("bank-accounts/", BankAccountListCreateView.as_view(), name="bank-accounts"),
    path("bank-accounts/<uuid:pk>/", BankAccountDetailView.as_view(), name="bank-account-detail"),
    path("transport-agreements/", TransportAgreementListCreateView.as_view(), name="transport-agreements"),
    path("transport-agreements/<uuid:pk>/", TransportAgreementDetailView.as_view(), name="transport-agreement-detail"),
    path("transport-quotes/", TransportQuoteView.as_view(), name="transport-quotes"),
    path("financial/summary/", FinancialSummaryView.as_view(), name="financial-summary"),
    path("financial/report/", FinancialReportView.as_view(), name="financial-report"),
    path("financial/statement/", FinancialStatementView.as_view(), name="financial-statement"),
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
    path("delivery-payments/<uuid:pk>/verify/", DeliveryPaymentVerifyView.as_view(), name="delivery-payment-verify"),
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
