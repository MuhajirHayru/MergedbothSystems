from rest_framework.routers import DefaultRouter

from django.urls import path

from .delivery_fee_review_api import (
    MarketplaceDeliveryFeeAgreementListView,
    MarketplaceDeliveryFeeReviewView,
)
from .views import PaymentViewSet
from .shipment_views import BuyerShipmentListView, BuyerShipmentDetailView

router = DefaultRouter()
# PATCH /api/v1/payments/{id}/verify/  (FR-FM-02)
# PATCH /api/v1/payments/{id}/flag/
# PATCH /api/v1/payments/{id}/dispute/
# GET   /api/v1/payments/{id}/receipt/
router.register("", PaymentViewSet, basename="payments")

urlpatterns = [
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
