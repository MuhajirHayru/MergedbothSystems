"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {
  Button,
  Card,
  CardHeader,
  ErrorBanner,
  Field,
  Input,
  PageLoader,
  Select,
  Textarea,
} from "@/components/ui";
import { superAdminApi } from "@/lib/api/client";
import type {
  ManagedAdministrativeLocation,
  ManagedCatalogCategory,
  ManagedProductAlias,
  ManagedProductSuggestion,
  ManagedProductVariety,
  ManagedRegistrationProductType,
  ProductCategory,
} from "@/lib/types";

const LOCATION_LEVELS = [
  ["REGION", "Region"],
  ["ZONE", "Zone"],
  ["WOREDA", "Woreda"],
  ["KEBELE", "Kebele"],
  ["CITY", "City"],
  ["SUBCITY", "Sub-city"],
  ["DISTRICT", "District"],
  ["OTHER", "Other administrative area"],
];

export default function SuperAdminReferenceDataPage() {
  const [locations, setLocations] = useState<ManagedAdministrativeLocation[]>([]);
  const [products, setProducts] = useState<ManagedRegistrationProductType[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<ManagedCatalogCategory[]>([]);
  const [productAliases, setProductAliases] = useState<ManagedProductAlias[]>([]);
  const [productVarieties, setProductVarieties] = useState<ManagedProductVariety[]>([]);
  const [productSuggestions, setProductSuggestions] = useState<ManagedProductSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [locationId, setLocationId] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationLevel, setLocationLevel] = useState("REGION");
  const [locationParent, setLocationParent] = useState("");
  const [locationAliases, setLocationAliases] = useState("");

  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] =
    useState<ProductCategory>("Vegetables");
  const [productSubcategory, setProductSubcategory] = useState("");
  const [productNameAm, setProductNameAm] = useState("");
  const [productNameAmLatin, setProductNameAmLatin] = useState("");
  const [productSupportsVarieties, setProductSupportsVarieties] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [categoryNameEn, setCategoryNameEn] = useState("");
  const [categoryNameAm, setCategoryNameAm] = useState("");
  const [categoryNameAmLatin, setCategoryNameAmLatin] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryParent, setCategoryParent] = useState("");
  const [categoryRegistrationEnabled, setCategoryRegistrationEnabled] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogNotice, setCatalogNotice] = useState("");
  const [aliasProductId, setAliasProductId] = useState("");
  const [aliasName, setAliasName] = useState("");
  const [aliasLanguage, setAliasLanguage] = useState<"en" | "am" | "am-Latn">("am-Latn");
  const [varietyProductId, setVarietyProductId] = useState("");
  const [varietyNameEn, setVarietyNameEn] = useState("");
  const [varietyNameAm, setVarietyNameAm] = useState("");
  const [varietyNameAmLatin, setVarietyNameAmLatin] = useState("");
  const [suggestionResolutions, setSuggestionResolutions] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const [locationRows, productRows, categories, aliases, varieties, suggestions] = await Promise.all([
        superAdminApi.managedLocations(),
        superAdminApi.managedProductTypes(),
        superAdminApi.catalogCategories(),
        superAdminApi.managedProductAliases(),
        superAdminApi.managedProductVarieties(),
        superAdminApi.managedProductSuggestions(),
      ]);
      setLocations(locationRows);
      setProducts(productRows);
      setCatalogCategories(categories);
      setProductAliases(aliases);
      setProductVarieties(varieties);
      setProductSuggestions(suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reference data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function editLocation(location: ManagedAdministrativeLocation) {
    setLocationId(location.id);
    setLocationName(location.name);
    setLocationLevel(location.level);
    setLocationParent(location.parent || "");
    setLocationAliases(location.alternative_names.join(", "));
    setError("");
    setNotice("");
  }

  function resetLocation() {
    setLocationId("");
    setLocationName("");
    setLocationLevel("REGION");
    setLocationParent("");
    setLocationAliases("");
  }

  async function saveLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!locationName.trim()) {
      setError("Enter a location name.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        source_id:
          locations.find((location) => location.id === locationId)?.source_id ||
          `admin-${crypto.randomUUID()}`,
        name: locationName.trim(),
        level: locationLevel,
        parent: locationParent || null,
        alternative_names: locationAliases
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean),
      };
      if (locationId) {
        await superAdminApi.updateLocation(locationId, payload);
        setNotice("Location updated.");
      } else {
        await superAdminApi.createLocation(payload);
        setNotice("Location added.");
      }
      resetLocation();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this location.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateLocation(location: ManagedAdministrativeLocation) {
    if (!window.confirm(`Deactivate ${location.name}? Existing records will be preserved.`)) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await superAdminApi.deactivateLocation(location.id);
      setNotice(`${location.name} deactivated.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate this location.");
    } finally {
      setSaving(false);
    }
  }

  function editProduct(product: ManagedRegistrationProductType) {
    setProductId(product.id);
    setProductName(product.name);
    setProductCategory(product.category);
    setProductSubcategory(product.catalog_category || "");
    setProductNameAm(product.name_am);
    setProductNameAmLatin(product.name_am_latin);
    setProductSupportsVarieties(product.supports_varieties);
    setError("");
    setNotice("");
  }

  function resetProduct() {
    setProductId("");
    setProductName("");
    setProductCategory("Vegetables");
    setProductSubcategory("");
    setProductNameAm("");
    setProductNameAmLatin("");
    setProductSupportsVarieties(false);
  }

  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    const name = productName.trim();
    if (!name) {
      setError("Enter a product name.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (productId) {
        await superAdminApi.updateProductType(productId, {
          name,
          name_am: productNameAm.trim(),
          name_am_latin: productNameAmLatin.trim(),
          category: productCategory,
          catalog_category: productSubcategory || null,
          supports_varieties: productSupportsVarieties,
          active: true,
        });
        setNotice("Registration product option updated.");
      } else {
        const code = `${productCategory}-${name}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");
        await superAdminApi.createProductType({
          code,
          name,
          category: productCategory,
          catalog_category: productSubcategory || null,
          name_am: productNameAm.trim(),
          name_am_latin: productNameAmLatin.trim(),
          supports_varieties: productSupportsVarieties,
        });
        setNotice("Registration product option added.");
      }
      resetProduct();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this product option.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateProduct(product: ManagedRegistrationProductType) {
    if (!window.confirm(`Deactivate ${product.name}? Existing registrations are preserved.`)) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await superAdminApi.deactivateProductType(product.id);
      setNotice(`${product.name} deactivated.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate this product option.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAlias(event: React.FormEvent) {
    event.preventDefault();
    if (!aliasProductId || !aliasName.trim()) {
      setCatalogError("Choose a product and enter its alias.");
      return;
    }
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      await superAdminApi.createProductAlias({
        product: aliasProductId,
        variety: null,
        alias: aliasName.trim(),
        language: aliasLanguage,
        approved: true,
      });
      setAliasName("");
      setCatalogNotice("Approved catalog alias added.");
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not add this alias.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAlias(alias: ManagedProductAlias) {
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      await superAdminApi.deleteProductAlias(alias.id);
      setCatalogNotice(`Alias “${alias.alias}” removed.`);
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not remove this alias.");
    } finally {
      setSaving(false);
    }
  }

  async function reviewSuggestion(
    suggestion: ManagedProductSuggestion,
    status: "APPROVED" | "REJECTED"
  ) {
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      const resolution = suggestionResolutions[suggestion.id];
      await superAdminApi.reviewProductSuggestion(suggestion.id, {
        status,
        ...(suggestion.suggestion_type === "PRODUCT" && resolution
          ? { resolved_product: resolution }
          : {}),
        ...(suggestion.suggestion_type === "VARIETY" && resolution
          ? { resolved_variety: resolution }
          : {}),
      });
      setCatalogNotice(`Suggestion “${suggestion.name}” ${status.toLowerCase()}.`);
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not review this suggestion.");
    } finally {
      setSaving(false);
    }
  }

  function editCatalogCategory(category: ManagedCatalogCategory) {
    setCategoryId(category.id);
    setCategorySlug(category.slug);
    setCategoryNameEn(category.name_en);
    setCategoryNameAm(category.name_am);
    setCategoryNameAmLatin(category.name_am_latin);
    setCategoryDescription(category.description);
    setCategoryParent(category.parent || "");
    setCategoryRegistrationEnabled(category.registration_enabled);
    setCatalogError("");
    setCatalogNotice("");
  }

  function resetCatalogCategory() {
    setCategoryId("");
    setCategorySlug("");
    setCategoryNameEn("");
    setCategoryNameAm("");
    setCategoryNameAmLatin("");
    setCategoryDescription("");
    setCategoryParent("");
    setCategoryRegistrationEnabled(false);
  }

  async function saveCatalogCategory(event: React.FormEvent) {
    event.preventDefault();
    if (!categorySlug.trim() || !categoryNameEn.trim()) {
      setCatalogError("Enter a category slug and English name.");
      return;
    }
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      const payload = {
        slug: categorySlug.trim().toLowerCase(),
        name_en: categoryNameEn.trim(),
        name_am: categoryNameAm.trim(),
        name_am_latin: categoryNameAmLatin.trim(),
        description: categoryDescription.trim(),
        parent: categoryParent || null,
        registration_enabled: categoryParent ? false : categoryRegistrationEnabled,
        active: true,
      };
      if (categoryId) {
        await superAdminApi.updateCatalogCategory(categoryId, payload);
        setCatalogNotice("Catalog category updated.");
      } else {
        await superAdminApi.createCatalogCategory(payload);
        setCatalogNotice("Catalog category added.");
      }
      resetCatalogCategory();
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not save this catalog category.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateCatalogCategory(category: ManagedCatalogCategory) {
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      await superAdminApi.deactivateCatalogCategory(category.id);
      setCatalogNotice(`${category.name_en} deactivated.`);
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not deactivate this category.");
    } finally {
      setSaving(false);
    }
  }

  async function saveVariety(event: React.FormEvent) {
    event.preventDefault();
    if (!varietyProductId || !varietyNameEn.trim()) {
      setCatalogError("Choose a product and enter the variety's English name.");
      return;
    }
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      await superAdminApi.createProductVariety({
        product: varietyProductId,
        name_en: varietyNameEn.trim(),
        name_am: varietyNameAm.trim(),
        name_am_latin: varietyNameAmLatin.trim(),
      });
      setVarietyNameEn("");
      setVarietyNameAm("");
      setVarietyNameAmLatin("");
      setCatalogNotice("Product variety added.");
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not add this variety.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateVariety(variety: ManagedProductVariety) {
    setSaving(true);
    setCatalogError("");
    setCatalogNotice("");
    try {
      await superAdminApi.deactivateProductVariety(variety.id);
      setCatalogNotice(`${variety.name_en} deactivated.`);
      await load();
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : "Could not deactivate this variety.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell title="Registration Reference Data" allow={["SUPER_ADMIN"]}>
        <PageLoader />
      </AppShell>
    );
  }
  const mainCatalogCategories = catalogCategories.filter(
    (item) => item.active && !item.parent
  );

  return (
    <AppShell title="Registration Reference Data" allow={["SUPER_ADMIN"]}>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900">Registration and Profile Reference Data</h2>
        <p className="mt-1 text-sm text-gray-500">
          Manage location records and agricultural product-interest options used by registration.
          Deactivation preserves existing registrations and audit history.
        </p>
      </div>
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={() => void load()} />
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Administrative locations"
            subtitle="Create linked Region, Zone, Woreda, Kebele, City, Sub-city or District records."
          />
          <form onSubmit={(event) => void saveLocation(event)} className="space-y-4 p-5">
            <Field label="Location name" htmlFor="location-name">
              <Input
                id="location-name"
                maxLength={200}
                value={locationName}
                onChange={(event) => setLocationName(event.target.value)}
                placeholder="Enter a location name"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Administrative level" htmlFor="location-level">
                <Select
                  id="location-level"
                  value={locationLevel}
                  onChange={(event) => setLocationLevel(event.target.value)}
                >
                  {LOCATION_LEVELS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Parent location" htmlFor="location-parent">
                <Select
                  id="location-parent"
                  value={locationParent}
                  onChange={(event) => setLocationParent(event.target.value)}
                >
                  <option value="">No parent (top-level record)</option>
                  {locations
                    .filter((location) => location.active && location.id !== locationId)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name} · {location.level}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Alternative names"
              htmlFor="location-aliases"
              hint="Optional aliases separated by commas."
            >
              <Textarea
                id="location-aliases"
                value={locationAliases}
                onChange={(event) => setLocationAliases(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={saving}>
                {locationId ? "Save location" : "Add location"}
              </Button>
              {locationId && (
                <Button type="button" variant="secondary" onClick={resetLocation}>
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
          <ul className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
            {locations.map((location) => (
              <li key={location.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {location.name} <span className="font-normal text-gray-500">· {location.level}</span>
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {location.parent_name || "Top-level"} · {location.active ? "Active" : "Inactive"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="secondary" onClick={() => editLocation(location)}>
                    Edit
                  </Button>
                  {location.active && (
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => void deactivateLocation(location)}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {!locations.length && (
              <li className="px-5 py-6 text-center text-sm text-gray-500">
                No administrative location records are configured.
              </li>
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Registration product interests"
            subtitle="Only Vegetables and Fruits are top-level choices in registration. Root crops are grouped under Vegetables."
          />
          <form onSubmit={(event) => void saveProduct(event)} className="space-y-4 p-5">
            <Field label="Product display name" htmlFor="interest-product-name">
              <Input
                id="interest-product-name"
                maxLength={200}
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
                placeholder="e.g. Tomato"
              />
            </Field>
            <Field label="Registration category" htmlFor="interest-product-category">
              <Select
                id="interest-product-category"
                value={productCategory}
                onChange={(event) =>
                  setProductCategory(event.target.value as ProductCategory)
                }
              >
                {mainCatalogCategories.map((item) => (
                  <option key={item.id} value={item.name_en}>{item.name_en}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Catalog subcategory"
              htmlFor="interest-product-subcategory"
              hint="Products must belong to an active subcategory."
            >
              <Select
                id="interest-product-subcategory"
                value={productSubcategory}
                onChange={(event) => setProductSubcategory(event.target.value)}
              >
                <option value="">Use the category's review-needed default</option>
                {catalogCategories
                  .filter(
                    (item) =>
                      item.active &&
                      item.parent &&
                      item.parent_name === productCategory
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>{item.name_en}</option>
                  ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amharic name" htmlFor="interest-product-name-am">
                <Input
                  id="interest-product-name-am"
                  value={productNameAm}
                  onChange={(event) => setProductNameAm(event.target.value)}
                  maxLength={200}
                />
              </Field>
              <Field label="Amharic Latin name" htmlFor="interest-product-name-latin">
                <Input
                  id="interest-product-name-latin"
                  value={productNameAmLatin}
                  onChange={(event) => setProductNameAmLatin(event.target.value)}
                  maxLength={200}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={productSupportsVarieties}
                onChange={(event) => setProductSupportsVarieties(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              />
              This product has selectable varieties
            </label>
            <div className="flex gap-2">
              <Button type="submit" loading={saving}>
                {productId ? "Save product option" : "Add product option"}
              </Button>
              {productId && (
                <Button type="button" variant="secondary" onClick={resetProduct}>
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
          <ul className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
            {products.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{product.name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {[product.name_am, product.name_am_latin, product.subcategory_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-gray-500">
                    {product.category_display} · {product.active ? "Active" : "Inactive"}
                    {product.mapping_needs_review ? " · Mapping needs review" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="secondary" onClick={() => editProduct(product)}>
                    Edit
                  </Button>
                  {product.active && (
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => void deactivateProduct(product)}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {!products.length && (
              <li className="px-5 py-6 text-center text-sm text-gray-500">
                No registration product options are configured.
              </li>
            )}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Product catalog categories"
            subtitle="Manage the main categories and their subcategories. Names used by products cannot be renamed after they are referenced."
          />
          {catalogError && (
            <div className="p-4 pb-0">
              <ErrorBanner message={catalogError} />
            </div>
          )}
          {catalogNotice && (
            <p role="status" className="mx-5 mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
              {catalogNotice}
            </p>
          )}
          <form onSubmit={(event) => void saveCatalogCategory(event)} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category slug" htmlFor="catalog-category-slug">
                <Input
                  id="catalog-category-slug"
                  value={categorySlug}
                  onChange={(event) => setCategorySlug(event.target.value)}
                  maxLength={100}
                  placeholder="leafy-vegetables"
                />
              </Field>
              <Field label="Parent category" htmlFor="catalog-category-parent">
                <Select
                  id="catalog-category-parent"
                  value={categoryParent}
                  onChange={(event) => setCategoryParent(event.target.value)}
                >
                  <option value="">Main category</option>
                  {catalogCategories
                    .filter((item) => item.active && !item.parent && item.id !== categoryId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>{item.name_en}</option>
                    ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="English name" htmlFor="catalog-category-name-en">
                <Input
                  id="catalog-category-name-en"
                  value={categoryNameEn}
                  onChange={(event) => setCategoryNameEn(event.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field label="Amharic name" htmlFor="catalog-category-name-am">
                <Input
                  id="catalog-category-name-am"
                  value={categoryNameAm}
                  onChange={(event) => setCategoryNameAm(event.target.value)}
                  maxLength={120}
                />
              </Field>
              <Field label="Amharic Latin name" htmlFor="catalog-category-name-latin">
                <Input
                  id="catalog-category-name-latin"
                  value={categoryNameAmLatin}
                  onChange={(event) => setCategoryNameAmLatin(event.target.value)}
                  maxLength={120}
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="catalog-category-description">
              <Input
                id="catalog-category-description"
                value={categoryDescription}
                onChange={(event) => setCategoryDescription(event.target.value)}
                maxLength={300}
              />
            </Field>
            {!categoryParent && (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={categoryRegistrationEnabled}
                  onChange={(event) => setCategoryRegistrationEnabled(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                Show this category in registration product interests
              </label>
            )}
            <div className="flex gap-2">
              <Button type="submit" loading={saving}>
                {categoryId ? "Save category" : "Add category"}
              </Button>
              {categoryId && (
                <Button type="button" variant="secondary" onClick={resetCatalogCategory}>
                  Cancel edit
                </Button>
              )}
            </div>
          </form>
          <ul className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
            {catalogCategories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {category.parent_name ? `${category.parent_name} / ` : ""}{category.name_en}
                  </p>
                  <p className="text-xs text-gray-500">
                    {category.active ? "Active" : "Inactive"} · {category.listing_count} linked listings
                    {category.registration_enabled ? " · registration enabled" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="secondary" onClick={() => editCatalogCategory(category)}>
                    Edit
                  </Button>
                  {category.active && (
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => void deactivateCatalogCategory(category)}
                    >
                      Deactivate
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Product varieties"
              subtitle="Varieties are shown only when attached to an active catalog product that supports varieties."
            />
            <form onSubmit={(event) => void saveVariety(event)} className="space-y-4 p-5">
              <Field label="Catalog product" htmlFor="catalog-variety-product">
                <Select
                  id="catalog-variety-product"
                  value={varietyProductId}
                  onChange={(event) => setVarietyProductId(event.target.value)}
                >
                  <option value="">Choose a product</option>
                  {products.filter((item) => item.active && item.supports_varieties).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="English name" htmlFor="catalog-variety-name-en">
                  <Input id="catalog-variety-name-en" value={varietyNameEn} onChange={(event) => setVarietyNameEn(event.target.value)} maxLength={200} />
                </Field>
                <Field label="Amharic name" htmlFor="catalog-variety-name-am">
                  <Input id="catalog-variety-name-am" value={varietyNameAm} onChange={(event) => setVarietyNameAm(event.target.value)} maxLength={200} />
                </Field>
                <Field label="Amharic Latin name" htmlFor="catalog-variety-name-latin">
                  <Input id="catalog-variety-name-latin" value={varietyNameAmLatin} onChange={(event) => setVarietyNameAmLatin(event.target.value)} maxLength={200} />
                </Field>
              </div>
              <Button type="submit" loading={saving}>Add variety</Button>
            </form>
            <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
              {productVarieties.map((variety) => (
                <li key={variety.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{variety.name_en}</p>
                    <p className="truncate text-xs text-gray-500">
                      {products.find((item) => item.id === variety.product)?.name || "Product"}
                      {variety.name_am ? ` · ${variety.name_am}` : ""}
                      {variety.name_am_latin ? ` · ${variety.name_am_latin}` : ""}
                    </p>
                  </div>
                  {variety.active && (
                    <Button type="button" variant="danger" disabled={saving} onClick={() => void deactivateVariety(variety)}>
                      Deactivate
                    </Button>
                  )}
                </li>
              ))}
              {!productVarieties.length && (
                <li className="px-5 py-4 text-sm text-gray-500">No product varieties are configured.</li>
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Approved search aliases"
              subtitle="Aliases are matched alongside English, Amharic and transliterated catalog names."
            />
            <form onSubmit={(event) => void saveAlias(event)} className="space-y-4 p-5">
              <Field label="Canonical product" htmlFor="catalog-alias-product">
                <Select
                  id="catalog-alias-product"
                  value={aliasProductId}
                  onChange={(event) => setAliasProductId(event.target.value)}
                >
                  <option value="">Choose a product</option>
                  {products.filter((item) => item.active).map((item) => (
                    <option key={item.id} value={item.id}>{item.name} · {item.category}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Alias" htmlFor="catalog-alias-name">
                  <Input
                    id="catalog-alias-name"
                    value={aliasName}
                    onChange={(event) => setAliasName(event.target.value)}
                    maxLength={200}
                  />
                </Field>
                <Field label="Language" htmlFor="catalog-alias-language">
                  <Select
                    id="catalog-alias-language"
                    value={aliasLanguage}
                    onChange={(event) =>
                      setAliasLanguage(event.target.value as "en" | "am" | "am-Latn")
                    }
                  >
                    <option value="en">English</option>
                    <option value="am">Amharic</option>
                    <option value="am-Latn">Amharic Latin</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" loading={saving}>Add approved alias</Button>
            </form>
            <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto border-t border-gray-100">
              {productAliases.map((alias) => (
                <li key={alias.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="truncate text-sm text-gray-800">
                    {alias.alias} · {products.find((item) => item.id === alias.product)?.name || "Product"} · {alias.language}
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={saving}
                    onClick={() => void deleteAlias(alias)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
              {!productAliases.length && (
                <li className="px-5 py-4 text-sm text-gray-500">No approved aliases have been added.</li>
              )}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Pending catalog suggestions"
              subtitle="English suggestions can create a review-needed catalog record. Translation and variety suggestions must be linked to a canonical item before approval."
            />
            <ul className="divide-y divide-gray-100">
              {productSuggestions.map((suggestion) => (
                <li key={suggestion.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{suggestion.name}</p>
                    <p className="text-xs text-gray-500">
                      {suggestion.suggestion_type} · {suggestion.language || "language not specified"} ·
                      {" "}{suggestion.suggested_category_name || suggestion.parent_product_name}
                    </p>
                    <Select
                      aria-label={`Canonical resolution for ${suggestion.name}`}
                      value={suggestionResolutions[suggestion.id] || ""}
                      onChange={(event) =>
                        setSuggestionResolutions((current) => ({
                          ...current,
                          [suggestion.id]: event.target.value,
                        }))
                      }
                      className="mt-2 max-w-xs"
                    >
                      <option value="">
                        {suggestion.language === "en"
                          ? "Create from English suggestion"
                          : "Choose a canonical match"}
                      </option>
                      {suggestion.suggestion_type === "PRODUCT"
                        ? products.filter((item) => item.active).map((item) => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))
                        : productVarieties
                            .filter((item) => item.product === suggestion.parent_product && item.active)
                            .map((item) => (
                              <option key={item.id} value={item.id}>{item.name_en}</option>
                            ))}
                    </Select>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={saving}
                      onClick={() => void reviewSuggestion(suggestion, "APPROVED")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={saving}
                      onClick={() => void reviewSuggestion(suggestion, "REJECTED")}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
              {!productSuggestions.length && (
                <li className="px-5 py-4 text-sm text-gray-500">No pending suggestions.</li>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
