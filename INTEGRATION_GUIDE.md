# GreenPath Frontend ⇄ Django Backend Integration Guide

This document is the manual-integration work order: **what to copy, where it belongs, what each React page calls, and how to configure the connection.**
Nothing here moves, renames, deletes or restructures your projects — every item is a file you copy yourself.

Two applications are involved:

| Application | Role | Location in this repo |
|---|---|---|
| React marketplace (Vite + Express + React 19) | The UI that talks to Django | `greenpath-farm-to-market-ai/` |
| Django REST backend (`TheWholeDashboards here/backend`) | Single source of truth: auth, registrations, catalog, orders, wallet, chat, dashboards | `TheWholeDashboards here/backend/` |

Both Next.js frontends are untouched and remain in place.

---

## 1. Backend files — copy these into your Django project

Copy **preserving the folder structure**. All paths are relative to `TheWholeDashboards here/backend/`.

### 1.1 Modified files

| File | Change | Why it matters to the frontend |
|---|---|---|
| `payments/wallet_services.py` | `review_funding_request` / `review_payout_request` now convert `DoesNotExist/ValueError/TypeError` into DRF `NotFound` (HTTP **404** instead of **500**). Added `flag_funding_request()` — flags a deposit **without** touching balances or the ledger. | Fixes the 500s on funding/payout approval for unknown IDs; adds the real flag workflow. |
| `payments/models.py` | `FundingStatus.FLAGGED` added. | The Flag button now has a real persisted state; it is never mapped to `REJECTED`. |
| `payments/serializers.py` | New `FundingFlagSerializer` (`reason`, required, max 500). | Request body for the new flag endpoint. |
| `payments/views.py` | New `WalletFundingFlagView` (`POST`, `IsFinancialManager`), imports `flag_funding_request`. | `POST /api/v1/wallet/funding/{id}/flag/`. |
| `payments/wallet_urls.py` | Route `funding/<uuid:pk>/flag/` → `wallet_funding_flag`. | Endpoint name for the wallet client. |
| `products/models.py` | `Product.name_am` (Amharic title) and `Product.name_om` (Afaan Oromo title), both blank-able. | Product titles in three languages are now stored in the database. |
| `products/serializers.py` | `name_am` / `name_om` added to `ProductSerializer` (read) and `ProductCreateSerializer` (write, optional). | Listing create/update accepts and returns the localized titles. |
| `users/serializers.py` | `ProfileUpdateSerializer` accepts `email`, `business_name`, `business_address` (writing business fields through to `UserRegistration`); `UserSerializer` exposes `business_name` / `business_address`. | Settings screen can persist email, business name and registered address. |
| `users/views.py` | Login/profile payload (`_user_payload`) includes `business_name` / `business_address`. | The React session object has the values it renders. |
| `registrations/serializers.py` | Document upload validation also catches PIL's bare `SyntaxError` (corrupt PNG checksum). | A malformed document upload now returns **400** with a field error instead of **500**. |

### 1.2 New files

| File | Purpose |
|---|---|
| `payments/migrations/0015_alter_walletfundingrequest_status.py` | Records the new `FLAGGED` status choice (no data change). |
| `products/migrations/0005_product_name_am_product_name_om.py` | Adds the two localized-title columns. |
| `registrations/migrations/0010_allow_business_profile_edits.py` | Makes `business_name` / `business_address` editable after approval by default (admins can re-lock them per role in registration settings). |
| `tests/test_integration_completion.py` | Regression tests: flag ≠ rejection, flag → later approve credits once, bilingual listing titles, business profile persistence. |

### 1.3 Previously completed in this workstream (already in your tree)

`payments/serializers.py` (`BuyerShipmentSerializer`), `payments/shipment_views.py`, `dashboard/views.py`, `greenpath/settings.py` (CORS/JWT extras), `greenpath/urls.py` (logistics mount), `products/views.py`, `tests/test_wallet_workflow.py`.
Copy them if your project copy predates these changes.

### 1.4 Apply the migrations

```bash
cd "TheWholeDashboards here/backend"
python manage.py migrate
```

Expected: `payments.0015`, `products.0005`, `registrations.0010` applied. No destructive operations.

---

## 2. Frontend files — copy these into your React project

Paths relative to `greenpath-farm-to-market-ai/`.

### 2.1 Modified files

| File | Change |
|---|---|
| `src/services/apiClient.ts` | `wallet.flagFunding(id, { reason })` → `POST /wallet/funding/{id}/flag/`. Request interceptor now sends the **registration completion token** (`greenpath_registration_token` in localStorage) for `/registration/*` calls, and the JWT everywhere else. |
| `src/context/AppContext.tsx` | `submitRegistration(dossier, password, documents)` now: registers the account with the applicant's own password → resolves region/zone/wereda to an `AdministrativeLocation` id → `PATCH /registration/me/` → uploads each real document → `POST /registration/me/submit/`. `flagDeposit()` calls the dedicated flag endpoint instead of rejecting. |
| `src/components/views/AuthPages.tsx` | Registration step 2 has real **Create/Confirm Password** fields (client-side validation). Document step uses a real `<input type="file">` per required slot (PDF/JPG/PNG) instead of fabricated filenames. Driver wizard gains a National ID/Fayda slot. No more placeholder names/emails/licenses. |
| `src/components/views/SettingsView.tsx` | Profile save sends `email`, `business_name`, `business_address` when (and only when) the user changed them, and surfaces per-field backend errors. |
| `src/components/views/FarmerDashboard.tsx` | Listing form has Amharic **and** Oromo title inputs, sends `name_am` / `name_om`, and loads categories from `GET /products/categories/` instead of a hardcoded list. |
| `src/components/views/OrdersView.tsx` | Lifecycle buttons are generated from the backend's `allowed_transitions`, so every action calls the real endpoint (`PATCH /orders/{id}/status/`, `POST /confirm-quality/`, `POST /release/`, `POST /dispute/`). |
| `src/services/adapters.ts` | `mapProduct` reads `name_am` / `name_om` and the API's `category`. |
| `src/types.ts` | `Product.category` is a string (categories are DB-driven); `OrderStatus` includes the real backend values; `Order.allowedTransitions`. |
| `.env` | Added `VITE_MEDIA_URL=http://localhost:8000` for `/media/...` image resolution. |

### 2.2 Files that need no change but must ship with the app

`src/services/adapters.ts`, `src/data/ethiopianLocations.ts` (wizard cascading selectors only — the authoritative hierarchy is resolved server-side from `AdministrativeLocation`), `src/components/**`, `src/App.tsx`, `index.html`, `vite.config.ts`, `server.ts`, `tsconfig.json`, `package.json`.

> `src/components/products/ProductForm.tsx`, `ProductDetail.tsx` and `src/lib/**` are **Next.js-era** components (`next/navigation`, `@/lib/api/client`). They are not mounted by the React SPA. Leave them with the Next.js app; do not copy them into the React app.

---

## 3. Environment, CORS, CSRF and authentication

### 3.1 Backend `.env` (`TheWholeDashboards here/backend/.env`, git-ignored)

```ini
# Database (defaults to SQLite db.sqlite3 when unset)
DB_NAME=db.sqlite3

# Origins allowed to call the API with credentials (comma separated)
DJANGO_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001

# Set to 1 behind HTTPS so the refresh cookie and CSRF cookie are Secure
DJANGO_SECURE_COOKIES=0

# AI assistant (Groq) — already configured in this repo
GROQ_API_KEY=<your Groq key>
# Must be a model your Groq account can access; check https://api.groq.com/openai/v1/models
GROQ_CHAT_MODEL=openai/gpt-oss-120b
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
GROQ_TIMEOUT_SECONDS=30
```

`CSRF_TRUSTED_ORIGINS` is derived from `CORS_ALLOWED_ORIGINS`, so you only maintain one list.

### 3.2 Frontend `.env` (`greenpath-farm-to-market-ai/.env`)

```ini
VITE_API_URL=http://localhost:8000/api/v1
VITE_MEDIA_URL=http://localhost:8000
VITE_WS_URL=http://localhost:8000
```

Alternative (no CORS at all): `VITE_API_URL=/api/v1` and run the app through `server.ts`, which proxies `/api`, `/media`, `/admin` and `/static` to `http://127.0.0.1:8000` (override with `BACKEND_ORIGIN`). Use **one** of the two, not both.

### 3.3 How authentication actually works

* `POST /api/v1/auth/login/` returns `{ success, access, user, permissions }` **and** sets the refresh token in an httpOnly cookie (`greenpath_refresh`, `SameSite=Lax`, 7 days). Access token lifetime: 1 hour.
* The SPA stores the access token in `localStorage.greenpath_auth_token`; the axios interceptor adds `Authorization: Bearer <access>` to every request.
* On `401`, the interceptor calls `POST /api/v1/auth/refresh/` (cookie-authenticated) once and retries; on failure it clears the token.
* **Registration before approval:** the account is `PENDING` and cannot log in. `/auth/register/` returns `completion_token`; the SPA stores it as `greenpath_registration_token` and sends it as the Bearer token for `/registration/*` calls only. `POST /auth/registration/resume/` re-issues it from email + password if the applicant returns later.
* **CSRF:** API views are JWT-authenticated and CSRF-exempt; the refresh cookie is `SameSite=Lax` + CORS-restricted. `localhost:3000 → localhost:8000` is same-site (ports are ignored), so the refresh cookie travels normally in local dev. If you deploy the frontend on a different site than the API, set `DJANGO_SECURE_COOKIES=1`, serve both over HTTPS, and add the frontend origin to `DJANGO_CORS_ORIGINS`.
* **Media:** uploaded documents are returned through `GET /api/v1/admin/registration-documents/{id}/file/` (admin-only), never as public URLs. Product images are served from `/media/products/...` in DEBUG.

---

## 4. Page → API map (what each React screen calls)

All paths are prefixed with `/api/v1`. "Bearer" = `Authorization: Bearer <access>`.

### Login (`components/views/AuthPages.tsx` → `LoginPage`)
| Call | Method | Body | Response |
|---|---|---|---|
| `/auth/login/` | POST | `{ email, password }` | `{ success, access, user, permissions }` + refresh cookie |

### Registration wizard (`RegisterPage`)
| Call | Method | Body | Auth |
|---|---|---|---|
| `/auth/register/` | POST | `{ email, password, full_name, phone, role: FARMER\|WHOLESALER\|RETAILER\|DRIVER, location, privacy_policy_accepted: true }` | public |
| `/registration/locations/?parent_id=<id>` | GET | — | public (walks region → zone → wereda) |
| `/registration/me/` | PATCH | `{ phone, location?, date_of_birth?, sex?, product_selections?, business_name?, business_address?, driving_license_number?, license_expiry?, vehicle_type?, vehicle_registration?, cargo_capacity_kg? }` | completion token |
| `/registration/me/documents/` | POST (multipart) | `file`, `document_type` (`FARMER_LICENSE`, `WHOLESALER_LICENSE`, `RETAILER_LICENSE`, `IDENTITY_DOCUMENT`, `DRIVING_LICENSE`, `VEHICLE_REGISTRATION`) | completion token |
| `/registration/me/submit/` | POST | `{ confirm: true }` | completion token |
| `/auth/registration/resume/` | POST | `{ email, password }` | public → `{ completion_token }` |

`product_selections` is a list of `{ product_type: <AgriculturalProductType id>, intent: "PRODUCES" | "BUYS" | "SELLS" | "HANDLES" }` (farmer → `PRODUCES`, wholesaler/retailer → `BUYS`). Load the ids from `GET /registration/product-types/`.

Submission requires, per role: `date_of_birth`, `sex` (`MALE`/`FEMALE`/`OTHER`/`PREFER_NOT_TO_SAY`, taken from `GET /registration/form-fields/?stage=PROFILE&role=<ROLE>`), at least one `product_selections` row (farmer/wholesaler/retailer), `location` **at a leaf node**, and the documents below.

Required documents by role: farmer `FARMER_LICENSE`; wholesaler `WHOLESALER_LICENSE`; retailer `RETAILER_LICENSE`; driver `IDENTITY_DOCUMENT` + `DRIVING_LICENSE` + `VEHICLE_REGISTRATION`. Submission returns **400** listing anything missing.

> The wizard's static `src/data/ethiopianLocations.ts` tree does **not** match the `AdministrativeLocation` table exactly (e.g. “Meki” is not a node; its East Shewa children are `Ada'a`, `Adama`, `Batu town`, …). `resolveRegistrationLocation()` therefore matches by name and falls back to the first child, then descends until it reaches a leaf, because the backend rejects any node that still has children.

### Settings (`components/views/SettingsView.tsx`)
| Call | Method | Body |
|---|---|---|
| `/auth/me/` | GET | — |
| `/auth/profile/` | PATCH | `{ full_name?, phone?, email?, business_name?, business_address? }` |
| `/auth/profile/photo/` | POST/DELETE (multipart `photo`) | — |
| `/wallet/bank-accounts/` | GET / POST / PATCH / DELETE | `{ bank, account_holder_name, account_number, confirm_account_number, account_type, is_default }` |
| `/wallet/banks/` | GET | — |

`email` must be unique (case-insensitive). `business_name` / `business_address` are gated by the PROFILE field configuration: a field an administrator hides or locks after approval returns **400** `{ "<field>": "This field is not editable in your profile." }`.

### Marketplace, categories, products
| Call | Method | Body / notes |
|---|---|---|
| `/products/categories/` | GET | `{ success, categories: [{value,label}], units: [{value,label}] }` — **DB-backed**, use it for every category dropdown |
| `/products/catalog/categories/` | GET | `{ results: [{id, slug, name_en, name_am, name_am_latin, parent, parent_name, sort_order, registration_enabled}] }` |
| `/products/catalog/search/?q=` | GET | catalog product search (localized names + aliases) |
| `/products/catalog/products/{id}/varieties/` | GET | approved varieties of a catalog product |
| `/products/catalog/suggestions/` | POST | `{ suggested_name, suggested_category, ... }` — asks admins to add a missing crop |
| `/products/farmer-listings/` | GET / POST | POST body: `{ title, name_am, name_om, description, category, quantity, unit_of_measure, price_per_unit, images, catalog_product?, catalog_variety? }` |
| `/products/farmer-listings/my/` | GET | the farmer's own listings |
| `/products/farmer-listings/{id}/` | GET / PATCH / DELETE | same body as create |
| `/products/farmer-listings/{id}/images/` | POST (multipart `image`) / PUT `{ images: [...] }` | max 8 images, 5 MB each |
| `/products/farmer-listings/{id}/activate\|deactivate\|mark-sold/` | POST | lifecycle |
| `/products/wholesaler-listings/…` | same shape | wholesaler re-listing |

`category` must be an active root `ProductCatalogCategory.name_en`; when `catalog_product` is sent, the category must match it. Localized titles persist as `name_am` / `name_om`.

### Orders (`components/views/OrdersView.tsx`)
| Call | Method | Body |
|---|---|---|
| `/orders/` | GET | serialized orders include `allowed_transitions` **computed for the current user** — render buttons from it |
| `/orders/` | POST | `{ product, quantity, ... }` + `Idempotency-Key` header |
| `/orders/{id}/status/` | PATCH | `{ status }` for `Accepted`, `Rejected`, `Processing`, `Confirmed`, `Shipped`, `Delivered`, `Cancelled` |
| `/orders/{id}/confirm-quality/` | POST | buyer sign-off → `Awaiting payment release` |
| `/orders/{id}/release/` | POST | escrow release → `Completed` |
| `/orders/{id}/dispute/` | POST | `{ reason }` |
| `/orders/{id}/shipment-details/` | GET / POST | logistics hand-off |

`status/` rejects `Awaiting payment release`, `Completed` and `Disputed` on purpose — use the dedicated actions above.

### Wallet (`components/views/WalletView.tsx`, `FinancialManagerDashboard.tsx`)
| Call | Method | Body | Role |
|---|---|---|---|
| `/wallet/` | GET | — | authenticated |
| `/wallet/transactions/` | GET | `?page_size=` | authenticated |
| `/wallet/funding/` | GET / POST | `{ amount, payment_method, external_reference }` | authenticated |
| `/wallet/funding/{id}/review/` | POST | `{ approve, notes }` | Financial Manager |
| **`/wallet/funding/{id}/flag/`** | POST | `{ reason }` — **new** | Financial Manager |
| `/wallet/funding/chapa/` | POST | `{ amount }` → checkout URL | authenticated |
| `/wallet/payouts/` | GET / POST | `{ amount, destination, payout_account }` | authenticated |
| `/wallet/payouts/{id}/review/` | POST | `{ approve, external_reference, notes }` (reference required to approve) | Financial Manager |
| `/wallet/agreements/`, `/wallet/reviews/` | GET / POST | — | authenticated |

`FLAGGED` deposits keep their balance untouched, stay listed in the verification queue, and can still be approved or rejected afterwards.
Unknown funding/payout ids return **404** (previously **500**).

### Admin, Financial Manager, Super Admin dashboards
| Page | Calls |
|---|---|
| User Admin | `/admin/pending-users/`, `/admin/users/`, `/admin/users/{id}/approve\|reject\|suspend/`, `/admin/registrations/`, `/admin/registrations/{id}/decision/` (`{ action: APPROVE\|REJECT\|REQUEST_CHANGES, reason }`), `/admin/registration-documents/{id}/verification/`, `/admin/registration-reports/`, `/admin/messages/` |
| Financial Manager | `/dashboard/payments/`, `/dashboard/financial-operations/`, `/dashboard/wallet-activity/`, `/dashboard/wallet-activity/export/`, `/payments/`, `/payments/{id}/verify\|flag\|dispute\|receipt/`, `/payments/delivery-fee-agreements/{id}/review/` |
| Super Admin | `/superadmin/settings/`, `/superadmin/data/`, `/superadmin/users/`, `/superadmin/users/{id}/override/`, `/superadmin/accounts/`, `/superadmin/audit/`, `/superadmin/locations/`, `/superadmin/product-types/`, `/superadmin/product-varieties/`, `/superadmin/product-suggestions/`, `/superadmin/health/`, `/superadmin/announcement/` |
| Farmer / Wholesaler / Retailer / Driver dashboards | `/dashboard/farmer/`, `/dashboard/wholesaler/`, `/dashboard/retailer/` |
| Messaging | `/chat/channels/`, `/chat/channels/{id}/messages/`, `/chat/channels/{id}/mark-read/`, `/chat/staff-recipients/`, `/chat/voice-moderation/` |
| Notifications | `/notifications/`, `/notifications/unread-count/`, `/notifications/{id}/mark-read/`, `/notifications/mark-all-read/` |
| AI assistant | `/assistant/conversations/`, `/assistant/conversations/{id}/messages/`, `/assistant/transcribe/` |

Live OpenAPI schema with every field and enum: **`http://localhost:8000/api/docs/`**.

---

## 5. Manual integration checklist

1. Copy the backend files from §1 (same relative paths), then run `python manage.py migrate`.
2. Confirm `DJANGO_CORS_ORIGINS` contains the exact origin you browse the React app from.
3. Start the backend: `python manage.py runserver 0.0.0.0:8000`.
4. Copy the frontend files from §2, set `.env`, run `npm install`, then `npm run dev` (port 3000).
5. Log in as a seeded account (all seeded users use password `Green@2024`): `superadmin01@greenpath.et`, `financial_manager01@greenpath.et`, `user_admin01@greenpath.et`, `farmer01@greenpath.et`, `wholesaler01@greenpath.et`, `retailer01@greenpath.et`, `driver01@greenpath.et`.
6. Walk these flows end-to-end:
   - Register a farmer **with your own password** → upload the license PDF → submit → approve in User Admin → log in with that password.
   - Settings → change business name/address → reload → values persist.
   - Farmer dashboard → create a listing with Amharic + Oromo titles → appears in marketplace with the localized title.
   - Upload a product image (≤5 MB) and reload.
   - Orders: accept → process → ship → delivered → quality → release; confirm balance movements in the wallet.
   - Wallet: submit a deposit → Financial Manager **Flag** it (balance unchanged, status Flagged) → approve it (balance credited once) → submit and reject a payout.
   - Bank accounts: add, set primary, delete.
   - Chat: send a message and receive it in the other account's channel.
   - Ask the AI assistant a question (Groq).
7. Keep both Next.js frontends in place until you have signed off on the React app.

---

## 6. Remaining manual actions / known gaps

| Item | Status |
|---|---|
| Copying files between projects | **Your step** — nothing was moved or deleted by the agent. |
| Seed/admin account passwords | Seeded accounts use `Green@2024`; change them for anything non-local. |
| Groq key | Written to the backend `.env` (`GROQ_API_KEY`, `GROQ_CHAT_MODEL=openai/gpt-oss-120b`) and verified with a live assistant reply. `llama-3.3-70b-versatile` is **not** available on this key, which is why the model was switched. Rotate the key if it was shared outside your machine. |
| Wizard extras not stored (Fayda id, land size, irrigation type, cooperative, warehouse capacity, cold storage, retail venue type, driver license grade, insurance policy) | No columns exist on `UserRegistration`. They are collected but not persisted; adding them needs new model fields + migration + serializer updates. Deliberately **not** invented here. |
| Product images in the farmer listing form | Still entered as URLs. `POST /products/{kind}-listings/{id}/images/` exists for real uploads; wiring a file picker into that form is the remaining step. |
| Category admin UI (`SuperAdminDashboard` → Categories tab) | Edits local state only. Real category management lives at `/superadmin/` catalog endpoints (`product-types`, `product-varieties`, `product-suggestions`); repoint the tab to those APIs. |
| Location selectors in the wizard | Still populated from the static `ethiopianLocations.ts`; the submitted dossier resolves to a real DB leaf, but the dropdown text can differ from the stored node. Driving the three selects from `GET /registration/locations/?parent_id=` would make them identical. |
| Website content / security settings (`updatePlatformConfig`) | Persisted only if the screen calls `PATCH /superadmin/settings/`; the current content form does not. |
| Order "Completed" | Reachable only through `POST /orders/{id}/release/` after quality confirmation — by design. |
