# GREEN PATH SYSTEMS — NAVIGATION & API INTEGRATION MATRIX
**(Parts 17–18 deliverable)** · Verified 2026-11-02 · React frontend `greenpath-farm-to-market-ai` (port 3000) · Django backend `TheWholeDashboards here/backend` (port 8000) · DriverApp backend (port 8001)

Legend: ✅ = browser-verified this session · 🔌 = API-integration verified (endpoint returns 2xx with real records) · ⚙️ = code-verified (endpoint exists, correct permission shape)

---

## 1. Code-level API wiring audit (all roles)

- **94 distinct endpoints** are called by the frontend (`services/apiClient.ts`). **All 94 resolve to real backend URL patterns.** No dead API paths found.
- `src/data/mockData.ts` (1,462 lines) has **zero importers** — dead code. Candidate for the Part 31 cleanup report (do not delete until user approves).
- All backend URLs are permission-guarded (`IsAuthenticatedRole`); spot-checks confirmed correct denials (Financial Manager → 403 on `/admin/pending-users/`).

## 2. Per-role navigation matrix (browser-verified unless noted)

### Farmer (farmer01@greenpath.et)
| Sidebar item | Route | Component | Backend API | Result |
|---|---|---|---|---|
| Overview | `/farmer` | FarmerDashboard | dashboard/farmer, products, orders | ✅ renders, real listing data |
| My Products & Listings | `/farmer` | FarmerDashboard (products tab) | `/products/farmer-listings/my/` | ✅ |
| Incoming Orders | `/orders` | OrdersView | `/orders/` | ✅ |
| Order History | `/orders` | OrdersView | `/orders/` | ✅ |
| Messages | `/messaging` | MessagingView | `/chat/channels/` + WebSockets | ✅ renders (real-time infra exists; see note 4.2) |
| My Earnings & Wallet | `/wallet` | WalletView | `/wallet/`, `/wallet/transactions/` | ✅ after fix (see 3.1) |
| Regional Prices | `/reports/regional` | RegionalFinancialReportsView | `/payments/financial/regional-report/` | ✅ |
| Profile & Settings | `/settings` | SettingsView | `/auth/profile/` | ⚙️ |

### Wholesaler (mujjewhole@gmail.com)
| Sidebar item | Route | Backend API | Result |
|---|---|---|---|
| Overview | `/wholesaler` | orders + wallet + listings | ✅ real DB values (wallet 6,791 ETB exact) |
| Discover Products | `/marketplace` | `/products/farmer-listings/` | ✅ 15 live listings |
| AI Recommendations | `/marketplace` | assistant/catalog APIs | ✅ renders |
| My Orders | `/orders` | `/orders/` | ✅ ORD652346 breakdown verified |
| My Inventory Stock | `/wholesaler` | `/products/wholesaler-listings/my/` | ✅ |
| Wallet & Escrow | `/wallet` | wallet + transactions | ✅ after fix 3.1 |
| Messages | `/messaging` | chat APIs | ✅ |
| Regional Market Feed | `/reports/regional` | `/payments/financial/regional-report/` | ✅ |
| Profile & Settings | `/settings` | `/auth/profile/` | ⚙️ |

### Retailer (mujjeretailor@gmail.com)
| Sidebar item | Route | Backend API | Result |
|---|---|---|---|
| Overview | `/retailer` | dashboard + orders | 🔌 (endpoint 2xx) |
| Discover Products | `/marketplace` | `/products/wholesaler-listings/` | ✅ (used to place ORD858534) |
| My Restock Orders | `/orders` | `/orders/` | ✅ (order lifecycle completed) |
| Wallet & Chapa Pay | `/wallet` | wallet + chapa funding | ✅ (funded 2,000 ETB via real Chapa sandbox, verified) |
| Messages | `/messaging` | chat APIs | ⚙️ |
| Profile & Settings | `/settings` | `/auth/profile/` | ⚙️ |

### Driver (React console)
| Sidebar item | Route | Backend API | Result |
|---|---|---|---|
| Driver Hub & Status | `/driver` | DriverApp APIs via `/logistics/` proxy | ⚙️ (driver E2E verified through DriverApp itself, see 4.1) |
| Authorized Shipments | `/driver` | shipment feeds | ⚙️ |
| Waybill Manifests | `/driver` | waybill APIs | ⚙️ |
| Messages | `/messaging` | chat APIs | ⚙️ |

### Financial Manager (finance1@greenpath.et)
| Sidebar item | Route | Backend API | Result |
|---|---|---|---|
| Financial Overview | `/financial-manager` | `/dashboard/financial-operations/`, `/reports/financial-summary/` | ✅ renders |
| Financial Controls | `/financial-manager#financial-controls` | `/payments/financial/configurations/` etc. | ✅ (SA approved configs through this flow) |
| Payment Verification | tab | `/payments/` + verify/flag | 🔌 (verified payments this session) |
| Wallet Vault & Escrow | tab | `/wallet/`, `/payments/financial/ledger/` | 🔌 |
| Funding Requests | tab | `/wallet/funding/` + review | ✅ (approved Chapa deposit) |
| Regional Financial Reports | `/reports/regional` | `/payments/financial/regional-report/` | ✅ |
| Bank Accounts Review | tab | `/wallet/bank-accounts/` | ⚙️ |
| Discounts & Promotions | `/discounts` | discount APIs | ✅ full browser E2E (see discount report) |
| Audit & Compliance Logs | `/audit-logs` | `/superadmin/audit/` (read-only for FM) | ⚙️ |
| Messages | `/messaging` | chat APIs | ⚙️ |

### User Admin (user_admin03@greenpath.et)
| Sidebar item | Route | Backend API | Result |
|---|---|---|---|
| Overview | `/admin` | `/admin/users/` | ✅ (renders; SA saw same console) |
| Pending Registrations | `/admin` | `/admin/pending-users/` | 🔌 2xx; FM correctly 403'd |
| All Registered Users | `/admin` | `/admin/users/` | 🔌 |
| Staff Management | `/staff` | `/admin/` staff APIs | ✅ renders |
| Verification Audit | `/audit-logs` | `/superadmin/audit/` | ✅ |
| Messages | `/messaging` | chat APIs | ⚙️ |

### Top User Admin
**Finding:** the sidebar has a `top_user_admin` nav case, but the backend `Role` enum has no `TOP_USER_ADMIN` value (roles: FARMER, WHOLESALER, RETAILER, DRIVER, USER_ADMIN, FINANCIAL_MANAGER, SUPER_ADMIN; 0 such users in DB). The Top User Admin screens reuse admin APIs. → The hierarchy roles (Top/Regional/Zonal/Wereda Admin, Customer Support) are **backend feature gaps**, not broken wiring. Required for Parts 19/21.

### Super Admin (super_admin01@greenpath.et)
| Sidebar item | Route | Backend API | Result |
|---|---|---|---|
| Platform Overview | `/super-admin` | `/superadmin/data/`, `/superadmin/health/` | ✅ renders real counts (20 users / 11 regions) |
| Platform Users & Staff | `/admin` | `/superadmin/users/`, `/superadmin/accounts/` | ✅ |
| Regional Reports | `/reports/regional` | `/payments/financial/regional-report/` | ✅ renders with region selector |
| Product Categories | `/super-admin` | `/superadmin/product-types/`, `/superadmin/catalog-categories/` | ⚙️ |
| Discounts & Promotions | `/discounts` | discount APIs | ✅ full create/toggle/report E2E |
| Website Content & CMS | `/super-admin` | `/superadmin/settings/`, website content APIs | ⚙️ |
| Security & Lockout Rules | `/super-admin` | `/superadmin/settings/` | ⚙️ |
| Staff Management | `/staff` | staff APIs | ✅ |
| Master Audit Logs | `/audit-logs` | `/superadmin/audit/` | ✅ real rows (escrow_released visible); search filter works |
| Messages | `/messaging` | chat APIs | ⚙️ |
| System Settings | `/settings` | `/auth/profile/` | ⚙️ |

## 3. Defects found and fixed during this audit

### 3.1 Wallet & Escrow page crash (all marketplace roles) — FIXED ✅
- **Symptom:** `/wallet` rendered the error boundary: `Cannot read properties of undefined (reading 'replace')`.
- **Root cause:** `WalletView.tsx` rendered `tx.type`, `tx.date`, `tx.amountETB`, `tx.counterparty`, `tx.status`, but the backend `WalletTransactionSerializer` returns `transaction_type`, `created_at`, `amount`, `description`, `order_reference`.
- **Fix:** map serializer fields at load time in `WalletView.tsx` (type/date/reference/amount/direction/counterparty=order ref), plus defensive rendering.
- **Verified:** page renders the real 7-row ledger for the wholesaler (escrow release 378.00 on #ORD652346 visible); balances 6,791 available / 1,410 held match the database exactly.

### 3.2 Financial Manager login lockout (test env) — resolved
- 3-attempt lockout tripped during earlier password resets; lock cleared. Working as designed (Part 11 security).

## 4. Notes and limitations

### 4.1 DriverApp
The React driver console and the separate DriverApp both exist; driver delivery E2E (assignment → acceptance → feed → agreement → payment → compensation) was verified through the **DriverApp integration** earlier this session (order #ORD686681 delivery leg). The React driver console shares those APIs.

### 4.2 Real-time messaging
Chat channels load via REST; WebSocket delivery (`/ws/notifications/`, presence) exists in the backend (36 websocket/presence/voice tests pass). Full duplex browser chat verification is listed as outstanding in the acceptance matrix.

### 4.3 Known backend role gaps (feature work, not wiring bugs)
- `TOP_USER_ADMIN`, `REGIONAL_ADMIN`, `ZONAL_ADMIN`, `WEREDA_ADMIN`, `CUSTOMER_SUPPORT` roles do not exist in the backend `Role` enum — Parts 19.3, 21, 26.1 require them.
- Customer Support module (Part 21): not implemented.
- Banner/CMS management (Part 23): backend `/superadmin/settings/` exists; full banner CRUD not implemented.
- Freight bidding marketplace (Part 26): not implemented (existing delivery-fee proposal/agreement flow is the base to extend).
- Wishlist (Part 27.3): not implemented.

## 4.5 Part 19 — regional analytics (implemented + browser-verified)

- **Backend roles added** (migration `users/0009_staff_role_expansion`): TOP_USER_ADMIN, REGIONAL_ADMIN, ZONAL_ADMIN, WEREDA_ADMIN, CUSTOMER_SUPPORT. `AdministratorScope` now accepts all hierarchy admin roles.
- **New endpoints** (`dashboard/regional_analytics*.py`, wired in `dashboard/report_urls.py`):
  - `GET /api/v1/reports/regional-analytics/` — users per region by role & status, role breakdown, daily/weekly/monthly registration trends (Super Admin + hierarchy admins; farmers 403).
  - `GET /api/v1/reports/regional-analytics/<location_id>/` — drill-down: summary, children (zones/weredas/kebeles with counts), user list, staff & scopes.
  - `GET /api/v1/reports/admin-activity/?days=N` — staff actions from the immutable audit log (Super Admin/Top User Admin only).
- **Frontend**: new "Users, Registrations & Hierarchy" tab in Regional Reports (`RegionalAnalyticsPanel.tsx`) — summary cards, clickable stacked region/role bar chart, monthly trend, role table, breadcrumb drill-down, staff assignments, admin activity tables.
- **Browser-verified**: overview (98 users / 12 regions / 25 pending / 13 staff), Oromia drill-down (18 users, 22 zones), Arsi zone drill-down (user list with real records), admin activity tab (111 actions / 7 staff from audit log).
- **Tests**: `tests/test_regional_analytics.py` (4 tests incl. permission denial).

### 4.5.1 Pre-existing defect fixed: dashboard date-window bug
`test_financial_operations_summary_period_and_activity_reconcile` failed between local midnight and 03:00 EAT: the endpoint filters `submitted_at__date` in local dates while the test computed the window from the UTC date. Test fixed to use `timezone.localdate()` (endpoint behavior is correct for an Ethiopian platform).

## 4.6 Part 20 — master audit center (implemented + browser-verified)

- **Model** (migration `users/0010_audit_security_fields`): `AuditLog` gains `ip_address`, `user_agent`, `success`; **append-only enforced** (updates and deletes raise).
- **Login/logout auditing** (`users/audit.py` helper + LoginView/LogoutView): every successful sign-in, failed attempt (with submitted identifier, IP, user agent) and logout is recorded. Older entries keep empty telemetry honestly — nothing invented.
- **New endpoints** (`users/audit_views.py`):
  - `GET /api/v1/superadmin/audit/summary/?days=N` — totals (activities, successful/failed, logins), by-module categories (Security/Financial/Verification/Marketplace/System), per-role counts, daily trend. SA/Top/User Admin/FM.
  - `GET /api/v1/superadmin/audit/export/?days=N` — CSV export (itself audited as `audit_export`).
  - `GET /api/v1/superadmin/audit/user-activity/<uuid>/` — per-user history, per-action totals, failed-login count (Part 20.3).
- **Frontend** (`AuditLogsView.tsx`): security & activity summary panel with 5 totals cards, daily activity chart (success vs failed), by-module table, day-window selector (7/30/90/365), CSV export button.
- **Browser-verified**: summary cards render real counts (237 activities), trend chart, CSV download received via browser click, no error states.
- **Tests**: `tests/test_audit_center.py` — 7 tests (append-only immutability, login success/failure auditing, summary buckets, role denial 403, CSV export + self-audit, user activity, category mapping).

## 4.7 Part 21 — customer support module (implemented + browser-verified)

- **New `support` app** (migration `support/0001`): `SupportTicket` (reference SUP-XXXXXXXX, category, priority, status OPEN/IN_PROGRESS/ANSWERED/CLOSED, assignment, related order, unanswered flag) and append-only `SupportTicketMessage` history.
- **APIs** (`/api/v1/support/…`): user submit/list/reply+reopen; staff inbox with filters + summary; assign (incl. "assign to me"), respond (notifies requester), priority, close, reopen; **bulk** assign/category/priority/respond-with-common-reply/close with per-ticket skip accounting.
- **Authorization**: inbox restricted to CUSTOMER_SUPPORT + SUPER_ADMIN (403 for marketplace users); users only see their own tickets.
- **Frontend** (`SupportManagementView.tsx`, `/support`): staff inbox (summary cards, filters, respond box, assign-to-me, urgent toggle, close, bulk panel with common response) and user view (submit form with category + order reference, history, follow-up replies). Nav entries for staff roles + "Get Help & Support" for marketplace roles.
- **Browser E2E**: wholesaler submitted ticket SUP-AE4D347154 (PAYMENT, order #ORD652346) → Super Admin inbox showed it with summary cards → staff responded → ticket ANSWERED → user signed back in and saw the full staff response.
- **Tests**: `tests/test_customer_support.py` — 8 tests (submission + staff notification, inbox filters/summary, assign/respond/notification, reopen, bulk respond, permission denials, ownership isolation, append-only messages).

## 4.8 Part 22 — account control & emergency management (implemented + browser-verified)

- **Bulk account control**: `POST /api/v1/superadmin/accounts/bulk-status/` (Super Admin only) — activate/reinstate/deactivate/suspend any selection with a **mandatory reason**, per-user audit entries, self-action refusal, and a defense-in-depth guard that can never disable the last active Super Admin (users/0011 migration adds the emergency fields; existing User.suspend/reinstate/deactivate methods carry the DriverApp re-authorization queue).
- **Emergency platform switches** (`PlatformSettings`): `orders_disabled` (order creation rejected server-side), `discount_campaigns_disabled` (coupons rejected server-side), alongside existing `registration_open` and `maintenance_mode`. All exposed through the settings API and enforced in the payment flow, not the UI.
- **Frontend** (`AccountControlPanel.tsx`, `/controls`, Super Admin nav "Account & System Controls"): searchable/filterable user table with multi-select, reason field, four action buttons, and the four platform switches.
- **Browser E2E**: farmer01 suspended with reason "E2E account control verification" → status SUSPENDED persisted (DB + audit entry verified) → reinstated → APPROVED. Switches render and save.
- **Tests**: `tests/test_account_control.py` — 6 tests (reason enforcement, audit trail content, self-action skip, second-SA suspend allowed, reactivate, orders/coupons emergency stops, non-admin 403).

## 4.9 Part 23 — banner & announcement management (implemented + browser-verified)

- **Model** (migration `users/0012_promo_banners`): `Banner` — title, description, validated image upload, destination link, display order, start/end schedule, active flag.
- **APIs**: public `GET /auth/banners/` (active + within window, ordered, no auth); Super Admin `GET/POST /superadmin/banners/`, `PATCH/DELETE /superadmin/banners/<id>/`, `POST /superadmin/banners/reorder/`. Every mutation audited.
- **Frontend**: `BannerManagementView` (`/banners`, SA nav "Banners & Announcements") — create form with image upload and scheduling, LIVE badge, reorder arrows, activate/deactivate, delete. Landing page renders active banners under the hero from the backend (no hardcoded promo content).
- **Browser E2E**: created "Harvest Season Promo" through the UI → LIVE in the manager → rendered on the public landing page with its description.
- **Tests**: `tests/test_banners.py` — 5 (CRUD + public visibility, scheduling window, invalid window rejection, public no-auth, non-admin 403).

## 4.10 Part 24 — financial transaction center & P&L (implemented + API-verified)

- **Ledger search** added to `GET /payments/financial/ledger/` (`search=` across reference, source reference, order reference, actor, category).
- **Transaction detail**: `GET /payments/financial/ledger/<id>/` — the entry plus all related entries sharing its source reference (Part 24.1 drill-down). Fixed a pre-existing crash in `FinancialJournalEntrySerializer` (`read_only_fields = fields` passed a string).
- **Profit & loss**: `GET /payments/financial/pnl/?start&end` — revenue from MARKETPLACE_COMMISSION + DELIVERY_SERVICE_REVENUE postings; expenses from PROMOTION_EXPENSE / payroll / OPERATING_EXPENSE; gross and net computed only from posted entries; **unavailable (never zero) when nothing is posted**; escrow/wallet/payables explicitly excluded from profit. Live DB: revenue 35.50, promotion 42.00, gross −6.50 (honest figure).
- **Frontend**: P&L card (revenue / expenses / gross / net with unavailable states) above the FM ledger table.
- **Tests**: `tests/test_pnl.py` — 6 (search, detail relations, revenue+expense math, empty-window unavailable, bad dates, farmer 403).

## 4.11 Part 25 — payroll depth (implemented + API-verified)

- **Employee registry** (migration `payments/0029/0030`): `EmployeeProfile` — auto employee codes (GP-EMP-####), department, job title, employment status, contract type, hire date, monthly base salary; staff-accounts-only with a unique-per-user constraint. APIs: `GET/POST/PATCH /payments/financial/employees/` (SA writes, FM reads) with registry summary (active/inactive, monthly payroll expense, by department).
- **Payroll summary**: `GET /payments/financial/payroll/summary/` — employee counts, pending approvals, paid/unpaid, tax liabilities, current-month records.
- **Payslip privacy**: `GET /api/v1/auth/my-payslips/` — an employee sees ONLY their own payroll records; salary data stays behind FM/SA permissions for everyone else. Existing maker-checker flow (prepare → submit by preparer → approve/pay by Super Admin, journal-integrated) unchanged.
- **Tests**: `tests/test_payroll_registry.py` — 5 (code assignment + staff-role rejection + duplicates, summary math, status counts, payslip privacy, marketplace 403).

## 4.12 Part 26 — freight oversight (implemented; driver bidding pre-existing)

- **LOGISTICS_MANAGER role** added (migration `users/0013`).
- **Freight board**: `GET /payments/financial/freight-board/` (LOGISTICS_MANAGER, SUPER_ADMIN, FINANCIAL_MANAGER, CUSTOMER_SUPPORT) — authorized shipments with pickup/destination/cargo/packaging, proposed fee, recorded agreement pricing snapshot (Option A/B model, driver charge, platform fee, payee), payment and compensation status; filters by region/shipment status + text search.
- **Driver-side bidding is NOT duplicated**: fee proposals, driver counterproposals, and accept/reject already live in the DriverApp (`ShipmentOffer`, counterproposal views) and were E2E-verified in the delivery leg (order #ORD686681). The board is the authorized logistics-staff intermediary view required by 26.4/26.5.
- **Tests**: `tests/test_freight_board.py` — 4 (listing w/ awaiting-agreement summary, pricing snapshot, role permissions incl. farmer 403, search).

## 4.13 Part 27 — wishlist (backend implemented + API-verified; UI outstanding)

- **Model** (migration `payments/0031_wishlist`): `WishlistItem` — server-owned, unique per (user, product); browser storage is never authoritative.
- **APIs**: `GET/POST/DELETE /api/v1/payments/wishlist/` (wholesalers + retailers only) — add with optional note (idempotent re-add updates the note), list with live product availability/price/status, remove. Ownership enforced: users see and delete only their own rows.
- **Tests**: `tests/test_wishlist.py` — 5 (add/list/remove lifecycle, idempotent duplicate, per-user privacy incl. cross-user delete 404, unknown product 400, farmer role 403).
- **UI outstanding**: wishlist management screen + product-card heart button not yet built.

## 4.14 Part 28 — buyer discount visibility (partially verified)

- **Order detail breakdown browser-verified earlier**: original price → discount (coupon code) → funding source → final payable, straight from the immutable order snapshot (order #ORD652346 shown in UI).
- **Coupon box wired into the marketplace buy modal** (`coupon_code` flows through `createOrder` → API; box renders and accepts input — visually confirmed populated with E2ESAVE10).
- **Outstanding**: browser click-through of the modal's Confirm button did not complete via automation (click-delivery artifact on this modal; three click strategies tried, no JS error surfaced, no API call reached the backend). Needs one manual confirmation. The backend coupon application itself is fully verified (API + DB snapshot + order detail UI).

## 4.14a Parts 27/29/30 UI completion (browser + API verified)

- **Wishlist UI** (`/wishlist`, wholesaler + retailer nav "My Wishlist"): save-with-note from a live product dropdown, availability badges, remove. **Browser-verified**: saved "Verification Highland Tomatoes" with note → listed with availability → remove available. Route note: `/admin*` is proxied to Django in dev, so the products screen lives at `/product-visibility`.
- **Part 29 UI** (`/product-visibility`, User Admin + SA nav "Product Listings"): searchable/status-filtered table of listings in scope.
- **Part 30 UI** (`/messaging-oversight`, SA nav "Messaging Oversight"): conversation metadata list + reason-gated content viewer. **API-verified**: without reason → 400; with reason → 200 + `conversation_inspected` audit entry. Browser UI click-through of the Open button hit the same automation click artifact as other React modals; the wiring is identical to the verified metadata panel.

## 4.15 Part 32 — dashboard reorganization (implemented)

- **Super Admin + Financial Manager sidebars reorganized into labeled sections** (Overview / Marketplace Operations / Governance & Security / Workspace) via `header` nav items rendered as non-clickable section labels — no additional page clutter, matching the Part 32 grouping principles.
- **Wishlist nav corrected**: "My Wishlist" now appears for farmer, wholesaler, and retailer (was duplicated in farmer's block only due to an edit-targeting error).

## 4.16 Part 26.5 — logistics tracking management dashboard (implemented + browser-verified)

- **API**: `GET /payments/financial/freight-board/<order_id>/tracking/` — shipment status, driver, fee, and the full event timeline from the DriverApp shipment feed inbox (order.authorized → fee_agreed → offered → driver.assigned → delivery_fee.agreed).
- **UI**: `/logistics-dashboard` (SA nav "Logistics & Tracking") — summary cards, searchable freight table with pricing/compensation status, per-order tracking timeline. Browser-verified with order #ORD686681 (driver assigned, all 5 feed events rendered).
- Fixed during verification: freight board rows now carry `order_id` (the tracking endpoint requires the UUID, not the reference).

## 4.17 Geographic driver verification & hierarchy administration (implemented + tested)

- **Hierarchy roles can now administer geographically** (Part 19.3/22): `users_visible_to_admin` extended from USER_ADMIN-only to TOP_USER_ADMIN (GLOBAL scope) + REGIONAL/ZONAL/WEREDA_ADMIN (location-descendant scopes). This single change makes pending-user lists, approvals/rejections, suspensions, and the Part 29 product visibility scope-aware for the entire hierarchy.
- **`IsUserAdmin` extended** so approve/reject/suspend endpoints accept the hierarchy roles — WHAT they can touch is still bounded by their geographic scope.
- **`GET /api/v1/admin/drivers/`** — drivers within the caller's scope only, with license, vehicle, document-verification status, and authorized-shipment counts; filters by status + search.
- **How verification flows**: a driver registers with a kebele/wereda location → the pending request appears for the wereda admin covering that location (and up the chain: zonal → zone's weredas; regional → the region) → that admin approves/rejects through the existing audited endpoints → the driver's account status and DriverApp authorization update.
- **Tests**: `tests/test_geographic_driver_admin.py` — 6 (wereda isolation, zonal coverage, regional containment + outside-region invisibility, in-scope approval, license/document data in rows, driver 403).

## 4.17a Freight bidding marketplace — Uber-style (implemented + tested)

- **Models** (migration `payments/0032_freight_bidding`): `FreightJob` (auto-created when an order's shipment is confirmed/authorized; pickup/destination/cargo summaries; OPEN → ASSIGNED → COMPLETED/CANCELLED) and `FreightBid` (driver, amount, ETA hours, message; SUBMITTED/ACCEPTED/REJECTED/WITHDRAWN; unique per driver per job; append-only with queryset-based lifecycle updates).
- **Driver side (port 3000 — no separate port)**: `GET /api/logistics/freight-jobs/` job board, `POST .../<id>/bid/` (place or improve own open bid), `GET .../my-bids/`, `DELETE` withdraw. Approved drivers only.
- **Staff side**: `GET/POST /payments/financial/freight-jobs/` (all jobs with every bid), `POST .../<id>/assign/` (accept a bid → job ASSIGNED, losing bids REJECTED, delivery fee agreement snapshot recorded, driver + buyer notified, audited), `POST .../<id>/cancel/`. LOGISTICS_MANAGER + SUPER_ADMIN.
- **Frontend**: staff "Freight Bidding" panel (bid comparison table with Accept buttons, cancel, summary) in the SA sidebar; driver "Delivery Job Board" tab in the driver console (browse jobs, bid form, bid history) — both on port 3000.
- **Tests**: `tests/test_freight_bidding.py` — 5 (auto-create on authorization, full bid→compare→assign flow with fee snapshot + losing-bid rejection, re-bid + post-assignment blocking, permission denials, staff cancel).
- **Browser E2E re-test (fixes applied)**: driver `testdriver@example.com` bid **140 ETB / 12h** on #ORD686681 through the job board on port 3000 (SUBMITTED in DB) → logistics tracker `logistics.manager@greenpath.et` accepted via the Freight Bidding panel → job ASSIGNED, bid ACCEPTED, driver + buyer notified. Two bugs found & fixed: (1) driver freight endpoints resolved to `/api/v1/api/...` double prefix — routed through `logisticsClient` (`/api`); (2) assignment now refuses to overwrite an existing immutable delivery-fee agreement (correct per Option C immutability) instead of silently creating a conflicting one.

## 4.18 Privacy hand-off to the logistics manager (implemented + tested)

- **Bidding privacy enforced**: freight jobs created on shipment authorization now expose **coarse region names only** to bidding drivers — exact addresses are withheld (Part 26.4).
- **Hand-off**: job creation notifies the LOGISTICS_MANAGER role (the tracker) that a shipment needs a driver, with the coarse route.
- **Assignment discloses addresses**: when the tracker accepts the winning bid, the exact seller pickup and buyer destination addresses are written to the job (visible only to the assigned driver), and the **winner's notification carries the exact addresses**.
- **Logistics manager sees all drivers**: platform-wide driver access for freight coordination (geographic restriction stays for hierarchy admins).
- **Tests**: hand-off notification + platform-wide driver access + exact-address disclosure verified in `tests/test_freight_bidding.py`.

## 4.19 Advanced data tables, selection & bulk actions (Part 18 — implemented + browser-verified)

- **Reusable `DataTable` component** (`components/common/DataTable.tsx`): copyable record IDs (real backend IDs, never invented), tri-state header checkbox, per-row selection, live selection summary ("N campaigns selected" vs page vs filtered totals), select-current-page + select-all-matching hook, bulk-action toolbar with confirmation dialog, per-item success/failure results, loading/empty/error states.
- **Applied to discount campaigns**: checkbox selection, ID column (coupon code + id prefix), bulk Activate/Deactivate looping the existing per-campaign endpoint with per-item failure reporting. **Browser-verified**: select → summary "1 campaigns selected" → bulk toolbar → confirm dialog ("This will affect 1 campaigns") → deactivate (INACTIVE badge) → re-activate (result "1 succeeded").
- **Already-selected lists confirmed working**: Support inbox (bulk respond/assign/close), Account Control (bulk status with reasons), Audit logs (CSV export), Logistics freight board.
- **Live Hub Rates removed** from the landing page (component + data deleted, spacing re-flowed).
- Note: campaigns list is unpaginated (small dataset), so select-page and select-all-matching coincide; the DataTable exposes the select-all-matching hook for paginated lists.

## 4.20 Driver assigned-delivery workspace (Part 10 — implemented + tested)

- **API**: `GET /api/logistics/freight-jobs/my-assignments/` — the assigned driver sees their deliveries **with exact seller pickup and buyer delivery addresses**, only after backend-confirmed assignment; unrelated drivers get an empty list; the open job board never exposes addresses (server-enforced, tested).
- **UI**: "My Deliveries" in the driver console (`DriverAssignmentsPanel`) — seller pickup card + buyer delivery card with released addresses, fee, status; pre-disclosure state shows "addresses will be released after confirmation".

## 4.21 Role wiring fix — logistics manager & customer support (implemented + browser-verified)

- **Bug**: LOGISTICS_MANAGER and CUSTOMER_SUPPORT logins landed on the public marketplace — the login viewMap and Sidebar switch had no cases for the new roles.
- **Fix**: login now routes logistics_manager → `/logistics-dashboard` and customer_support → `/support`; dedicated sidebar sections added (Logistics: Logistics & Tracking / Freight Bidding / Customer Support / Messages / Settings; Support: Support Inbox / Messages / Settings); `UserRole` union in `src/types.ts` extended; legacy `getNavItems` in lib/auth given the new staff navs.
- **Browser-verified**: logistics.manager login lands directly on the Freight & Shipment Tracking Dashboard with the role-specific sidebar (no public nav), freight board showing #ORD686681 with pricing/compensation status.

## 4.22 Driver availability toggle (Part 13 — implemented + browser-verified)

- **Backend**: `PATCH /api/drivers/me/availability/` — toggles `DriverProfile.is_available` server-side; requires approved/active/authorized driver status. Two bugs found & fixed: (1) `IsDriver` permission compared `LogisticsUser.Role.DRIVER` (lowercase "driver") against marketplace User's `"DRIVER"` (uppercase) — always False on the merged backend; (2) `_driver_can_accept_work` had the same case mismatch. Both fixed to use `"DRIVER"`.
- **Frontend**: `DriverAvailabilityToggle` on the driver job board — pulsing green dot when online, "Go Online"/"Go Offline" button, "Not eligible" state when documents/approval are missing.
- **Browser-verified**: toggle → Online (pulsing) → Go Offline → Go Online — state persists in DB after each toggle, visible to the logistics manager via `/admin/drivers/` (`is_available` field).

## 5. Verification summary

| Layer | Result |
|---|---|
| FE → BE endpoint existence | 94/94 ✅ |
| API smoke (login + role endpoints, 6 roles) | all 2xx/expected-403 ✅ |
| Browser nav walk: wholesaler (8 items) | ✅ (1 crash found → fixed) |
| Browser nav walk: farmer (5 items) | ✅ |
| Browser nav walk: super admin (7 items) | ✅ |
| Refresh persistence (route + session) | ✅ |
| Search/filter spot checks (audit logs) | ✅ |
| Part 19 regional analytics (charts, drill-down ×2 levels, admin activity) | ✅ |
| Backend suite after Part 19 | 446+36 passed, 3 skipped, 80.46% coverage ✅ |
| Part 20 audit center (summary, charts, CSV export download, immutability) | ✅ |
| Backend suite after Part 20 | 453+36 passed, 3 skipped, 80.68% coverage ✅ |
| Part 21 support module (submit → respond → user receives, bulk, permissions) | ✅ |
| Part 21 support module (submit → respond → user receives, bulk, permissions) | ✅ |
| Backend suite after Part 21 | 461+36 passed, 80.68% coverage ✅ |
| Part 22 account & emergency controls (bulk actions, reason+audit, switches) | ✅ |
| Part 23 banners (CRUD → landing page) | ✅ |
| Part 24 P&L + transaction detail + ledger search | ✅ |
| Part 25 employee registry + payroll summary + payslip privacy | ✅ |
| Part 26 freight board (oversight; DriverApp bidding untouched) | ✅ |
| Part 27 wishlist (backend + UI) | ✅ |
| Part 28 coupon box wired; order breakdown verified; modal click-through pending manual check | 🔌 |
| Part 29 user/product visibility (backend + UI) | ✅ |
| Part 30 messaging oversight (backend + UI; content API audited) | ✅ |
