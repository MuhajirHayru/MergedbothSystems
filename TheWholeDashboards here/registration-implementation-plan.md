# Green Path Registration and Administration Implementation Plan

## Phase 1 — Existing system inspection

### Current architecture

- Frontend: Next.js App Router, React, TypeScript, and shared `AppShell`.
- Backend: Django 5.x with Django REST Framework and SimpleJWT.
- Database: SQLite by default; PostgreSQL is configurable through environment variables.
- Identity: custom `users.User` model with UUID IDs, email login, role and account status.
- Roles: Farmer, Wholesaler, Retailer, User Admin, Financial Manager, and Super Admin.
- Registration: `/api/v1/auth/register/` creates a disabled `PENDING` account and a linked `DRAFT` role profile. A purpose-limited completion credential supports the second-stage registration flow; pending accounts cannot log in.
- Approval: User Admin and Super Admin endpoints approve/reject accounts. User Admin registration queues and decisions are restricted to assigned geographic scope; Super Admin remains global.
- Product data: `products.Product` represents sellable inventory listings; its category is a fixed choice. There is no separate farmer-production or buyer-preference catalog.
- Geography: a parent-linked location API is populated from the HDX Ethiopia COD-AB v04 workbook. Its 1,270 source records cover ADM1, ADM2, and ADM3; the 22 `ET99` pseudo-region records are inactive, leaving 1,248 selectable units. Kebele-level reference data is not included.
- Documents: profile photos use Django media storage. In DEBUG mode, `MEDIA_ROOT` is served as static media; it is therefore not appropriate for private licenses.
- Notifications: registration and account-status notifications are emitted through Django signals and the existing notification service.
- Tests: backend uses pytest/pytest-django; frontend has TypeScript checking and a Next.js production build.

### Existing surfaces to extend

- Authentication and account creation: `backend/users/views.py`, `backend/users/serializers.py`, and `frontend/app/register/page.tsx`.
- User, status, audit, and permission models: `backend/users/models.py` and `backend/users/permissions.py`.
- Approval queues and decisions: `backend/users/admin_views.py`, `backend/users/admin_urls.py`, and `frontend/components/admin/UserDirectory.tsx`.
- Super Admin account management: `backend/users/superadmin_views.py`, `backend/users/superadmin_urls.py`, and the existing Super Admin account UI.
- Existing listing categories and inventory: `backend/products/models.py` and `backend/products/serializers.py`.
- Registration notifications: `backend/greenpath/signals.py` and `backend/notifications/services.py`.
- Shared role navigation and shell: `frontend/lib/auth/context.tsx` and `frontend/components/layout/AppShell.tsx`.

## Implementation sequence

1. **Add compatible domain models and migrations**
   - Add a parent-linked administrative location model with stable source identifiers, flexible level names, and indexed parent/level fields.
   - Add a one-to-one role-specific registration profile, separate registration/review status, review history, private registration documents with independent license-verification status, and administrator geographic scope.
   - Add a canonical agricultural category/product-type catalog and profile selections, keeping them separate from sellable `Product` listings.
   - Backfill existing accounts as already complete and existing User Admins as global administrators so current behavior is preserved. Do not infer or invent existing users' detailed profiles or locations.

2. **Add backend services, APIs, and security**
   - Keep existing account creation and normal sign-in restrictions.
   - Issue a narrowly scoped registration-completion credential after account creation; it may only save/read that account's incomplete registration, never authenticate for marketplace APIs.
   - Support authenticated resumption for an existing incomplete account without creating another user.
   - Add draft save/read, catalog/location child lookup, final submission, registration listing/detail, review actions, license verification, and private document streaming endpoints.
   - Validate role/profile fields, product identifiers, document extension/MIME/size, and every parent-child and administrator-scope relationship server-side.
   - Apply scope-filtered querysets before searching, filtering, pagination, exports, document access, and approval actions. Keep Super Admin global; preserve legacy global User Admin access through explicit migrated scope.
   - Emit notifications only when a complete registration is submitted and on review decisions, using existing notifications. Record review and administrator changes in the existing audit trail or an additive history model.

3. **Build the shared registration experience**
   - Keep the existing initial account fields, then route the new user to a role-specific completion flow.
   - Save drafts through the scoped registration API; add location cascades that clear descendants when a parent changes.
   - Add searchable multi-category/product selection, private license upload with client-side preview, review/edit/confirm steps, and duplicate-submit protection.
   - Do not turn selected production/preferences into inventory listings.

4. **Extend administration**
   - Add registration queues and detail/review actions to the existing User Admin design.
   - Add Super Admin controls to create/assign global or administrative-location User Admin scopes using existing roles; validate all assignments server-side.
   - Show scoped location context and aggregate-only reports; avoid exposing unnecessary personal data in aggregate reports.

5. **Populate and maintain reference data**
   - Completed: provide an idempotent import/validation command for the versioned HDX v04 location dataset; reject invalid parentage and duplicate source IDs, and retain import provenance and coverage receipts.
   - Maintain the agricultural catalog independently of inventory and provide controlled administration/import for catalog updates.
   - Do not seed fabricated Ethiopian locations. Until a verified source dataset is supplied and imported, location selectors must report that reference data is unavailable rather than offer made-up choices.

6. **Validate and regress**
   - Add backend tests for account creation/resumption, profile save/submit, role validation, document validation/private access, product preference persistence, cascading parentage, scoped list/detail/search/reports/actions, audit history, and notifications.
   - Run the complete existing backend pytest suite, Django checks/migration checks, frontend TypeScript check, and production build.
   - Add browser-level multi-step tests for the registration journey and responsive controls where browser tooling is available; do not bypass auth or mutate real user records for visual verification.
   - Confirm existing login restrictions, role guards, listings, orders, wallet/payments, notifications, and dashboards remain intact.

## Verified data and remaining constraints

- The imported HDX Ethiopia COD-AB v04 workbook provides 15 ADM1, 107 ADM2, and 1,148 ADM3 records. The source covers the administrative levels it supplies, but does not provide kebeles. No location names or parent-child relationships below its coverage are fabricated.
- Source caveats note that boundaries may not reflect current ground realities; source boundary dates are 2023-08-01. Addis is represented as Addis Ababa → Region 14 → 11 sub-city units. The workbook does not name a Kifle Ketema unit. Dire Dawa has urban/rural ADM2 divisions. Do not relabel these structures as a verified kebele hierarchy.
- The workbook does not represent the two contested units Dawe Serer (`ET042199`) and Quarsadula (`ET050905`); they have not been invented or added.
- The existing account status remains the gate for normal login and marketplace access. Detailed registration completion will use a purpose-limited credential rather than enabling pending users to sign in.
- Existing `USER_ADMIN` and `SUPER_ADMIN` roles will be extended with assignment scopes; no duplicate administrator role system will be introduced.
- License files will be stored outside publicly served media and delivered only through authenticated, scope-authorized endpoints. Production deployment must configure a durable private storage location.
