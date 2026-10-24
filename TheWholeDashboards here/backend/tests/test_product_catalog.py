import pytest

from registrations.models import (
    AgriculturalProductType,
    ProductAlias,
    ProductCatalogCategory,
    ProductSuggestion,
)

pytestmark = pytest.mark.django_db


def _vegetable_catalog():
    root = ProductCatalogCategory.objects.get(slug="vegetables")
    subcategory, _ = ProductCatalogCategory.objects.get_or_create(
        slug="test-catalog-vegetables",
        defaults={
            "name_en": "Test vegetables",
            "parent": root,
            "active": True,
        },
    )
    return root, subcategory


def test_catalog_search_matches_approved_amharic_latin_alias(api):
    _, subcategory = _vegetable_catalog()
    product = AgriculturalProductType.objects.create(
        code="catalog-search-test-tomato",
        name="Catalog Search Tomato",
        name_am="የፈተና ቲማቲም",
        name_am_latin="Timatim",
        category="Vegetables",
        catalog_category=subcategory,
    )
    ProductAlias.objects.create(
        product=product,
        alias="Test Timatim",
        normalized_alias="test timatim",
        language=ProductAlias.Language.AMHARIC_LATIN,
        approved=True,
    )

    response = api.get("/api/v1/products/catalog/search/?q=test%20timatim")

    assert response.status_code == 200, response.data
    assert [row["id"] for row in response.data["results"]] == [str(product.pk)]
    assert response.data["results"][0]["name_am"] == "የፈተና ቲማቲም"


def test_marketplace_listing_search_matches_linked_catalog_names(
    api, wholesaler, farmer_product
):
    _, subcategory = _vegetable_catalog()
    catalog_product = AgriculturalProductType.objects.create(
        code="catalog-listing-search-test",
        name="Catalog Search Onion",
        name_am="ሽንኩርት",
        name_am_latin="Shinkurt",
        category="Vegetables",
        catalog_category=subcategory,
    )
    farmer_product.catalog_product = catalog_product
    farmer_product.save(update_fields=["catalog_product"])
    api.force_authenticate(user=wholesaler)

    response = api.get(
        "/api/v1/products/farmer-listings/",
        {"search": "shinkurt"},
    )

    assert response.status_code == 200, response.data
    assert response.data["count"] == 1
    assert str(response.data["results"][0]["catalog_product"]) == str(catalog_product.pk)


def test_approved_english_product_suggestion_keeps_its_resolution(
    api, farmer, super_admin
):
    root, _ = _vegetable_catalog()
    api.force_authenticate(user=farmer)
    created = api.post(
        "/api/v1/products/catalog/suggestions/",
        {
            "suggestion_type": ProductSuggestion.SuggestionType.PRODUCT,
            "name": "Suggested Test Crop",
            "language": ProductAlias.Language.ENGLISH,
            "suggested_category": str(root.pk),
        },
        format="json",
    )
    assert created.status_code == 201, created.data

    api.force_authenticate(user=super_admin)
    reviewed = api.patch(
        f"/api/v1/superadmin/product-suggestions/{created.data['id']}/",
        {"status": ProductSuggestion.ReviewStatus.APPROVED},
        format="json",
    )

    assert reviewed.status_code == 200, reviewed.data
    suggestion = ProductSuggestion.objects.get(pk=created.data["id"])
    assert suggestion.status == ProductSuggestion.ReviewStatus.APPROVED
    assert suggestion.resolved_product is not None
    assert suggestion.resolved_product.name == "Suggested Test Crop"
    assert suggestion.resolved_product.mapping_needs_review


def test_suggestion_review_links_translations_and_created_varieties(
    api, farmer, super_admin
):
    root, subcategory = _vegetable_catalog()
    product = AgriculturalProductType.objects.create(
        code="catalog-suggestion-test-product",
        name="Canonical Suggestion Product",
        category="Vegetables",
        catalog_category=subcategory,
        supports_varieties=True,
    )
    api.force_authenticate(user=farmer)
    translation = api.post(
        "/api/v1/products/catalog/suggestions/",
        {
            "suggestion_type": ProductSuggestion.SuggestionType.PRODUCT,
            "name": "Test Local Crop Name",
            "language": ProductAlias.Language.AMHARIC_LATIN,
            "suggested_category": str(root.pk),
        },
        format="json",
    )
    variety = api.post(
        "/api/v1/products/catalog/suggestions/",
        {
            "suggestion_type": ProductSuggestion.SuggestionType.VARIETY,
            "name": "Test Local Variety",
            "language": ProductAlias.Language.ENGLISH,
            "parent_product": str(product.pk),
        },
        format="json",
    )
    assert translation.status_code == variety.status_code == 201

    api.force_authenticate(user=super_admin)
    approved_translation = api.patch(
        f"/api/v1/superadmin/product-suggestions/{translation.data['id']}/",
        {
            "status": ProductSuggestion.ReviewStatus.APPROVED,
            "resolved_product": str(product.pk),
        },
        format="json",
    )
    approved_variety = api.patch(
        f"/api/v1/superadmin/product-suggestions/{variety.data['id']}/",
        {"status": ProductSuggestion.ReviewStatus.APPROVED},
        format="json",
    )

    assert approved_translation.status_code == 200, approved_translation.data
    assert approved_variety.status_code == 200, approved_variety.data
    assert ProductAlias.objects.filter(
        product=product,
        normalized_alias="test local crop name",
        language=ProductAlias.Language.AMHARIC_LATIN,
        approved=True,
    ).exists()
    variety_suggestion = ProductSuggestion.objects.get(pk=variety.data["id"])
    assert variety_suggestion.resolved_variety is not None
    assert variety_suggestion.resolved_variety.name_en == "Test Local Variety"
