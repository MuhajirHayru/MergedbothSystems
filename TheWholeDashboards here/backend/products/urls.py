from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CategoryListView,
    FarmerListingViewSet,
    ProductCatalogCategoryListView,
    ProductCatalogSearchView,
    ProductCatalogVarietiesView,
    ProductSuggestionCreateView,
    WholesalerListingViewSet,
)

router = DefaultRouter()
router.register("farmer-listings", FarmerListingViewSet, basename="farmer-listings")
router.register(
    "wholesaler-listings", WholesalerListingViewSet, basename="wholesaler-listings"
)
router.register("categories", CategoryListView, basename="product-categories")

urlpatterns = [
    path("catalog/categories/", ProductCatalogCategoryListView.as_view()),
    path("catalog/search/", ProductCatalogSearchView.as_view()),
    path(
        "catalog/products/<uuid:product_id>/varieties/",
        ProductCatalogVarietiesView.as_view(),
    ),
    path("catalog/suggestions/", ProductSuggestionCreateView.as_view()),
    path("", include(router.urls)),
]
