from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AdministratorScopeDetailView,
    AdministratorScopeListCreateView,
    SuperAdminLocationViewSet,
    SuperAdminProductAliasViewSet,
    SuperAdminProductCatalogCategoryViewSet,
    SuperAdminProductSuggestionViewSet,
    SuperAdminProductTypeViewSet,
    SuperAdminProductVarietyViewSet,
    SuperAdminRegistrationFieldViewSet,
)

router = DefaultRouter()
router.register("locations", SuperAdminLocationViewSet, basename="superadmin-locations")
router.register(
    "product-types",
    SuperAdminProductTypeViewSet,
    basename="superadmin-product-types",
)
router.register(
    "catalog-categories",
    SuperAdminProductCatalogCategoryViewSet,
    basename="superadmin-catalog-categories",
)
router.register(
    "product-varieties",
    SuperAdminProductVarietyViewSet,
    basename="superadmin-product-varieties",
)
router.register(
    "product-aliases",
    SuperAdminProductAliasViewSet,
    basename="superadmin-product-aliases",
)
router.register(
    "product-suggestions",
    SuperAdminProductSuggestionViewSet,
    basename="superadmin-product-suggestions",
)
router.register(
    "registration-fields",
    SuperAdminRegistrationFieldViewSet,
    basename="superadmin-registration-fields",
)

urlpatterns = router.urls + [
    path("admin-scopes/", AdministratorScopeListCreateView.as_view(), name="admin_scopes"),
    path(
        "admin-scopes/<uuid:user_id>/",
        AdministratorScopeDetailView.as_view(),
        name="admin_scope_detail",
    ),
]
