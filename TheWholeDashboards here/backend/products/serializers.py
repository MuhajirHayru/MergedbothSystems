from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from registrations.models import (
    AgriculturalProductType,
    ProductCatalogCategory,
    ProductVariety,
)

from .models import Category, Product, UnitOfMeasure

MAX_PRODUCT_IMAGES = 8


class ProductSerializer(serializers.ModelSerializer):
    catalog_product_name = serializers.CharField(
        source="catalog_product.name", read_only=True, allow_null=True
    )
    catalog_variety_name = serializers.CharField(
        source="catalog_variety.name_en", read_only=True, allow_null=True
    )
    owner_name = serializers.CharField(source="owner.full_name", read_only=True)
    owner_location = serializers.SerializerMethodField()
    owner_role = serializers.CharField(source="owner.get_role_display", read_only=True)
    owner_profile_photo = serializers.ImageField(
        source="owner.profile_photo", read_only=True, allow_null=True
    )
    owner_financially_verified = serializers.SerializerMethodField()
    owner_is_online = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    category_display = serializers.CharField(source="category", read_only=True)
    unit_display = serializers.CharField(source="get_unit_of_measure_display", read_only=True)
    is_owner = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()
    total_value = serializers.SerializerMethodField()
    owner_average_rating = serializers.SerializerMethodField()
    owner_review_count = serializers.SerializerMethodField()

    def get_owner_location(self, obj):
        registration = getattr(obj.owner, "registration", None)
        location = getattr(registration, "location", None)
        while location and location.level not in ("REGION", "CITY"):
            location = location.parent
        return location.name if location else ""

    def get_owner_financially_verified(self, obj):
        if hasattr(obj, "owner_financially_verified"):
            return obj.owner_financially_verified
        return obj.owner.financially_verified

    def get_owner_is_online(self, obj):
        if hasattr(obj, "owner_is_online"):
            return obj.owner_is_online
        return obj.owner.is_online

    class Meta:
        model = Product
        fields = [
            "id", "title", "description", "category", "category_display",
            "catalog_product", "catalog_product_name",
            "catalog_variety", "catalog_variety_name",
            "quantity", "unit_of_measure", "unit_display", "price_per_unit",
            "status", "status_display", "product_type", "owner", "owner_name",
            "owner_location", "owner_role", "owner_profile_photo",
            "owner_financially_verified", "owner_is_online",
            "owner_average_rating", "owner_review_count",
            "images", "is_owner", "distance_km", "total_value",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "owner", "product_type", "images",
            "created_at", "updated_at",
        ]

    @extend_schema_field(serializers.BooleanField)
    def get_is_owner(self, obj):
        request = self.context.get("request")
        return bool(request and request.user and request.user == obj.owner)

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_distance_km(self, obj):
        """Present only when the ORM annotated it (retailer proximity ranking)."""
        value = getattr(obj, "distance_km", None)
        return round(float(value), 2) if value is not None else None

    @extend_schema_field(serializers.CharField)
    def get_total_value(self, obj):
        return str(obj.total_value)

    @extend_schema_field(serializers.FloatField(allow_null=True))
    def get_owner_average_rating(self, obj):
        value = getattr(obj, "owner_average_rating", None)
        return round(float(value), 2) if value is not None else None

    @extend_schema_field(serializers.IntegerField())
    def get_owner_review_count(self, obj):
        return getattr(obj, "owner_review_count", 0)

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value

    def validate_price_per_unit(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than zero.")
        return value

    def validate_images(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("images must be a list of URLs.")
        if len(value) > MAX_PRODUCT_IMAGES:
            raise serializers.ValidationError("A listing may hold at most 8 images.")
        return value


class ProductCreateSerializer(serializers.ModelSerializer):
    """Farmer / Wholesaler listing creation (FR-F-04, FR-W-05)."""

    class Meta:
        model = Product
        fields = [
            "title", "description", "category", "quantity",
            "unit_of_measure", "price_per_unit", "images",
            "catalog_product", "catalog_variety",
        ]

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Quantity must be greater than zero.")
        return value

    def validate_price_per_unit(self, value):
        if value <= 0:
            raise serializers.ValidationError("Price must be greater than zero.")
        return value

    def validate_images(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("images must be a list of URLs.")
        if len(value) > MAX_PRODUCT_IMAGES:
            raise serializers.ValidationError("A listing may hold at most 8 images.")
        return value

    def validate(self, attrs):
        instance = self.instance
        category = attrs.get("category", instance.category if instance else None)
        catalog_product = attrs.get(
            "catalog_product", instance.catalog_product if instance else None
        )
        catalog_variety = attrs.get(
            "catalog_variety", instance.catalog_variety if instance else None
        )
        if catalog_variety and (
            catalog_product is None or catalog_variety.product_id != catalog_product.pk
        ):
            raise serializers.ValidationError(
                {"catalog_variety": "Choose a variety belonging to the selected product."}
            )
        if catalog_product:
            is_retaining_existing = bool(
                instance
                and instance.catalog_product_id == catalog_product.pk
                and instance.catalog_variety_id
                == getattr(catalog_variety, "pk", None)
            )
            if not catalog_product.active and not is_retaining_existing:
                raise serializers.ValidationError(
                    {"catalog_product": "Choose an active catalog product."}
                )
            if category != catalog_product.category:
                raise serializers.ValidationError(
                    {"category": "The listing category must match the selected catalog product."}
                )
        elif category and (
            not instance or category != instance.category
        ) and not ProductCatalogCategory.objects.filter(
            parent__isnull=True, name_en=category, active=True
        ).exists():
            raise serializers.ValidationError(
                {"category": "Choose an active product category."}
            )
        if catalog_variety and (
            not catalog_variety.active
            or catalog_variety.review_status != ProductVariety.ReviewStatus.APPROVED
        ):
            raise serializers.ValidationError(
                {"catalog_variety": "Choose an active, approved product variety."}
            )
        return attrs


class ProductImageUploadSerializer(serializers.Serializer):
    """Multi-part image upload appended to a listing's ``images`` list."""

    image = serializers.ImageField(required=True)

    def validate_image(self, value):
        if value.size > 5 * 1024 * 1024:
            raise serializers.ValidationError("Image must be 5 MB or smaller.")
        return value


class ProductImagesSerializer(serializers.Serializer):
    """Existing image references retained or reordered for a listing."""

    images = serializers.ListField(
        child=serializers.CharField(),
        allow_empty=True,
        max_length=MAX_PRODUCT_IMAGES,
    )


class CategorySerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()


class CatalogSearchResultSerializer(serializers.ModelSerializer):
    category_id = serializers.SerializerMethodField()
    subcategory = serializers.SerializerMethodField()
    aliases = serializers.SerializerMethodField()
    variety_count = serializers.SerializerMethodField()

    class Meta:
        model = AgriculturalProductType
        fields = [
            "id",
            "code",
            "name",
            "name_am",
            "name_am_latin",
            "category",
            "category_id",
            "subcategory",
            "supports_varieties",
            "aliases",
            "variety_count",
        ]

    def get_aliases(self, obj):
        return list(
            obj.aliases.filter(approved=True, variety__isnull=True)
            .order_by("language", "alias")
            .values_list("alias", flat=True)[:5]
        )

    def get_category_id(self, obj):
        category = obj.catalog_category
        return str(category.parent_id or category.pk) if category else None

    def get_subcategory(self, obj):
        category = obj.catalog_category
        return category.name_en if category and category.parent_id else ""

    def get_variety_count(self, obj):
        return obj.varieties.filter(
            active=True, review_status=ProductVariety.ReviewStatus.APPROVED
        ).count()


class CatalogVarietySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariety
        fields = ["id", "product", "name_en", "name_am", "name_am_latin"]


def category_choices():
    return [{"value": value, "label": label} for value, label in Category.choices]


def unit_choices():
    return [{"value": value, "label": label} for value, label in UnitOfMeasure.choices]
