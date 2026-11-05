# Super Admin Production-Readiness Report — Green Path Systems

Date: 2026-11-04 · Scope: complete Super Admin experience (18 sidebar views + 6 dashboard tabs)
Method: static code inventory (import-graph audit) + live browser testing of every page and key action against the running stack (Vite :3000 → Django :8000), with database verification of every persisted action.

**Round 2 (same day) — gap closure.** Follow-up commit closes the outstanding limitations from section K: a dedicated statistics API, WCAG 2.2 AA + responsive verification, bundle optimization, and a full regression pass. See sections M–R below; section K re-scored accordingly.

---

## A. Executive summary

Every Super Admin screen was inventoried (element → handler → API → backend route → database effect) and exercised in a real browser. All 18 sidebar views render real backend data — **no mock data, no fake pages**. Interactive outcome tests verified: registration approval, staff creation, suspend/reinstate with mandatory reason, campaign activation, both CSV exports, message-oversight access control, broadcast, and the full password-change cycle.

The review found and fixed **one critical platform bug** (silent session death: the refresh token was never stored and the refresh call carried a stale Authorization header, so every session expired unrecoverably), **five dead controls** (password save faked success; notification/language/timeframe controls did nothing), **two fabricated-data offenders** (invented +14.8% KPI, invented registration date), one fake session-IP display, four sidebar entries opening the wrong tab, and ~10 views missing loading/empty/error states. The sidebar was reorganized into 8 operational groups with deep-linked tabs, and 32 verified-dead files were removed.

Frontend: `tsc` clean, production build passes. Backend: 546 tests pass (81.5% coverage), 1 new migration applied.

## B. Before-and-after UI improvements

| Before | After |
|---|---|
| Session died silently at token expiry (401 → "0 Active" everywhere) | Cookie-based silent refresh; verified recovery from a sabotaged token mid-session |
| "Save New Password" showed fake success, called nothing | Real `POST /auth/password/change/` with validation, busy/error/success states — verified by re-login |
| Notification toggles, language cards: local state only | Persisted (device-level, honestly labeled); survive reload |
| Fake session line "IP: 196.188.24.12 (Ethio Telecom…)" | Real policy text (lockout + session timeout from settings) |
| Regional Reports: cosmetic Daily–Yearly selector, invented "+14.8% vs previous month" | Selector removed; honest scope line; real export filename date |
| UserAdmin review modal: every applicant dated "2026-10-25" | Real submission date from the application record |
| Region filter: 7 hardcoded options | Regions fetched from `/superadmin/locations/` (15), static fallback |
| Sidebar: 4 flat groups; Categories/CMS/Security all opened the Overview tab | 8 operational groups (Overview / Users & Access / Marketplace / Logistics / Support & Communication / Content / Governance & Security / Workspace); each opens its own tab; new "Products & Listings" (25 records) and "Financial Controls & Pricing" entries |
| Config save UI could show unsaved values as saved ("Saved locally; server rejected…") | Optimistic update rolls back on failure; explicit error |
| Missing loading/empty/error states in 10 views | Skeletons, empty states and error banners added (Users & Staff, Account Controls, Audit Logs, System Admin health, regional reports, overview intel) |
| "1 account(s) suspendd" | Proper past tense for all four bulk actions |

## C. Screen-by-screen report

| View | Component | State after work |
|---|---|---|
| Platform Overview (6 tabs) | SuperAdminDashboard + SuperAdminOverview | Real data everywhere; health tab live; finance forms labeled; categories guarded; refresh button |
| Platform Users & Staff | UserAdminDashboard | Loading/error/empty added; real dates; API-backed regions; approve/reject verified E2E |
| Regional & Financial Reports | RegionalFinancialReportsView | Fabricated KPI + dead timeframe removed; CSV verified; states added |
| Platform Operations | SystemAdminPanel | Health-tab error/loading states; broadcast verified earlier |
| Products & Listings (new entry) | AdminProductsPanel | Now reachable from SA sidebar; renders 25 real records |
| Product Categories | SuperAdminDashboard (tab) | Deep-link fixed; two-step delete verified |
| Discounts & Promotions | DiscountManagementView | Bulk activate/deactivate verified with confirm step |
| Logistics & Tracking | LogisticsDashboard | Verified: shipment cards, fee breakdown, tracking |
| Freight Bidding | FreightBidsPanel | Verified: bid table, accept/cancel (assigned job visible) |
| Customer Support | SupportManagementView | Verified: filters, reply, bulk actions |
| Website Content & CMS | SuperAdminDashboard (tab) | Deep-link fixed; saving states |
| Banners & Announcements | BannerManagementView | Verified: create, reorder, toggle, delete |
| Security & Lockout Rules | SuperAdminDashboard (tab) | Session timeout now persisted end-to-end (new field + migration) |
| Staff Management | StaffManagementView | Create verified E2E (list refresh confirmed working) |
| Account & System Controls | AccountControlPanel | Suspend/reinstate verified with DB + audit checks; reason enforced; verb fix |
| Messaging Oversight | MessagingOversightPanel | Reason-gated open verified |
| Master Audit Logs | AuditLogsView | CSV verified; empty state added; feed enriched (actor email + role) |
| Messages | MessagingWorkspace | Verified: channels, threads |
| System Settings | SettingsView | Password change now real and verified; preferences persist |

## D. Button-by-button results (outcome-verified)

| Action | Result |
|---|---|
| Approve registration (Users & Staff) | PASS — 19→18 pending, audited, account APPROVED in DB |
| Create staff member | PASS — DB row + `admin_account_created` audit (now with email/role); appears in list |
| Suspend / Reinstate (Account Controls) | PASS — status flips in DB + UI; reason mandatory (refuses without); `user_suspended`/`user_reinstated` audit rows |
| Bulk suspend without reason | PASS (negative) — refused with error, no API call |
| Campaign bulk deactivate/activate | PASS — confirm step, status pill flips, audited |
| Audit "Export CSV" | PASS — `greenpath-audit-2026-11-04.csv` download |
| Regional "CSV" | PASS — dated filename download |
| Regional "Print" | PASS — `window.print()` (no crash) |
| Change password | PASS — saved, re-login with new password works |
| Refresh token recovery | PASS — sabotaged token, silent refresh, retry 200 |
| Deep-linked sidebar tabs | PASS — Categories/CMS/Security/Finance land on their tabs; Products & Listings renders |

## E. API integration

Every endpoint called by the 18 SA views exists in the Django URLconf — **zero frontend calls to non-existent routes** (full route-by-route verification in the inventory). New/changed:
- `PATCH /superadmin/settings/` now accepts `session_timeout_minutes` (new model field, migration `users.0014`, serializer bounds 5–10080).
- `POST /auth/login/` unchanged — refresh token already delivered via httponly cookie; the frontend now lets the cookie flow (same-origin proxy).
- Login audit detail enriched (email + role) for the activity feed.

## F. New backend functionality (justified)

1. `PlatformSettings.session_timeout_minutes` — the SA security form exposed the value but it was never persisted; smallest compatible addition (field + serializer + migration + audit inclusion in critical-field set).
2. `admin_account_created` audit detail now records the created account's email/role.

## G. Removed / consolidated / retained

**Removed (32 files, verified zero importers by import-graph scan, `tsc` + build clean):** `components/ui/` (28-file unused design-system library), `admin/PlatformData`, `admin/UserDirectory`, `auth/AuthShell`, `auth/PasswordField`, `branding/BrandMark`, `branding/WebsiteContentProvider`, `common/ChapaModal`, `common/MetricCard`, `common/StatusBadge`, `layout/AppShell`, `layout/ThemeToggle`, `presence/PresenceProvider`, `theme/ThemeProvider`, `orders/OrdersTable`, `payments/{BankAccountManager,FinancialBankAccounts,FinancialWorkflowQueue,PaymentsTable,PayoutInvoiceQueue}`, `products/{MarketplaceBrowser,MyListings,ProductDetail,ProductForm,ProductImageGallery,RelatedProducts}`, `reports/{ReportsView,WalletActivityAnalytics}`, `users/FinanciallyVerifiedBadge`.
**Consolidated:** the four duplicate dashboard view keys (`website_content`, `system_security`, `marketplace_mgmt`) retained for compatibility but superseded by explicit tab views (`sa_categories`, `sa_content`, `sa_security`, `sa_finance`).
**Retained:** Financial Manager and DriverApp functionality untouched; no records deleted; no API removed.

## H. Additional features

- "Products & Listings" SA nav entry (existing capability, previously unreachable from SA).
- "Financial Controls & Pricing" direct entry (previously buried in a tab).
- Honest empty/error/loading handling platform-wide; relative-time activity feed with actor identity.

## I. Security & permission verification

- Geographic scoping confirmed live: the QA User Admin (Addis Ababa scope) sees 3 users in their directory vs 86 for SA.
- Bulk account actions: reason required server-side; last-SA protection in place; every action audited (verified rows).
- Messaging oversight requires a ≥10-char reason and is audited server-side.
- Hiding-is-not-protection: bulk-status and campaign actions were probed directly via authenticated API — server-side enforcement held.
- Refresh cookie is httponly + SameSite=Lax and now only travels same-origin.

## J. Test evidence

- Browser: 19/19 pages loaded with real data (fingerprints captured); interactive tests above with before/after DOM + DB checks.
- Database: `User.objects.get(email='qa.audit.staff@greenpath.et')` status transitions APPROVED→SUSPENDED→APPROVED; `AuditLog` rows `admin_account_created`, `user_suspended`, `user_reinstated` verified; campaign `is_active` flipped and restored.
- Frontend: `npx tsc --noEmit` exit 0; `npm run build` ✓ (47.9s).
- Backend: `pytest tests/` → **546 passed, 3 skipped**, coverage 81.54% (≥70% gate).

## K. Outstanding issues (as of round 1 — resolved in round 2 unless noted)

1. ~~Bundle size 1.48 MB~~ → **RESOLVED (round 2)**: 501 kB eager + 29 lazy route chunks; see section P.
2. ~~Regional financial metrics derive client-side~~ → **RESOLVED (round 2)**: single aggregate endpoint; see section M.
3. ~~Staff stats fire 6 sequential count queries~~ → **VERIFIED ALREADY PARALLEL**: the six count requests run under `Promise.all` (StaffManagementView `loadStats`); no change required.
4. Notification preferences persist per device (localStorage), not per account — a per-user preferences model remains the eventual home.

## M. Round 2 — dedicated statistics API

**`GET /api/v1/superadmin/statistics/`** (`users/superadmin_statistics.py`) — one bulk endpoint, SA + Financial Manager authorized (`get_permissions`), optional `from` / `to` ISO datetime filters (naive input interpreted server-timezone; invalid → 400) and optional `region` filter.

Covers: users by role/status + new-in-period; products and orders by status with GMV and discounts; wallet available + **escrow liability** (held); payments by status (verification-date aware); freight jobs by status/delivery-status with assigned fees; bids total; drivers total/approved/available-now; support tickets by status/priority + unanswered; **31 regional rows** in the exact shape the frontend report consumes (hierarchy region → free-text fallback → "Unspecified").

Integrity rules enforced: **no commission ledger or settlement model exists**, so `platform_revenue` and `seller_payables` are returned as `null` with an explicit `unavailable_note` — zero never means unknown; GMV, escrow and payment sums come only from real records.

Efficiency: fixed small query count (users 1, orders 1, products 1, wallets 2, payments 1, freight 3, bids 1, drivers 1, tickets 3) with Python-side grouping — **no N+1** (enforced by `django_assert_max_num_queries(35)` in tests).

Tests: `tests/test_superadmin_statistics.py` — **13 tests** covering anonymous 401, farmer/wholesaler 403, SA + FM 200, role/status counts, GMV, seller-region mapping, escrow math, revenue null-honesty, from/to filtering, invalid date 400, zero-vs-null, query bound. **All pass** (suite total 559 passed / 3 skipped, coverage 81.71%).

Frontend integration: `api.superadmin.statistics()` → `loadRegionalMetrics(from, to)` consumes `regional` rows directly (legacy client-side derivation kept as fallback); the Regional Reports tab gained a **functional reporting-period selector** (30 days / 90 days / 12 months / All time, `aria-pressed` state) — real data refetch, verified live (31 rows render from the endpoint; 30-day refetch succeeds).

Performance evidence (live, prod data): **68 ms** response for 102 users / 31 regions / all subsystems.

## N. Round 2 — WCAG 2.2 AA verification (not a certification)

In-page audits across SA screens (labeled-control scan, icon-button scan, th-scope scan, img-alt scan, contrast class scan) plus live keyboard testing. Fixes applied:

- **Focus visibility**: global `:focus-visible` ring (2px brand green, `!important` over preflight's `currentcolor` which rendered invisible rings); **verified with real Tab keypress** — `matches(':focus-visible') === true`, computed `outline: 2px solid rgb(21,128,61)`.
- **Contrast**: 101 low-contrast `text-slate-400` helper texts bumped to `text-slate-500 dark:text-slate-400` (4.76:1 on white, AA pass for normal text).
- **Tables**: 16 `<th>` gained `scope="col"` (DataTable + Staff + Products tables).
- **Labels**: placeholder-only controls labeled via `aria-label` (products search/status, support filters) and a real `<label htmlFor>` for the unanswered toggle; audit re-run shows **0 unlabeled controls** on audited pages; **0 icon-only buttons** without names; **0 images without alt**.
- **Charts**: `role="img"` + descriptive `aria-label` on all overview and regional charts (data tables beneath most charts double as text alternatives).
- **Modals**: shared `useModalA11y` hook (Escape-to-close + focus-on-open) wired into CreateStaffModal, StaffDetailModal, UserDetailReviewModal and the campaign form modal.
- **Form validation announcements**: inline errors use `role="alert"` (finance drafts, pricing, health, password change).

Limitations: full screen-reader walkthrough (NVDA/JAWS) and axe-core scan not executed; color-contrast verified by token audit + spot checks rather than a full pixel matrix. Classified READY WITH LIMITATIONS.

## O. Round 2 — responsive verification (DOM-measured)

- **375×812**: no page-level horizontal overflow (`scrollWidth − innerWidth = −6`); sidebar is a true off-canvas drawer (`position:fixed`, x = −256) with a hamburger; tables/tab-strips sit in `overflow-x-auto` containers; main content full-width.
- **768×1024**: same drawer pattern, no overflow, healthy main width.
- **1440×900**: persistent sidebar, verified throughout rounds 1–2.

## P. Round 2 — bundle optimization (before → after)

| Metric | Before (5e5aaf5) | After |
|---|---|---|
| JS shipped on first load | **1,480.29 kB** (single chunk, gzip ≈ 378 kB) | **501.58 kB index (gzip 144.80) + 48.91 kB vendor-react (gzip 17.31)** |
| Chart library | eagerly bundled | **vendor-charts 432.12 kB (gzip 122.93) — lazy**, loaded only when a chart view opens (0 references in the eager index chunk, verified by grep) |
| Route chunks | none | **29 lazy chunks** (SuperAdminDashboard 45.67 kB, FinancialManagerDashboard 79.11 kB, StaffManagementView 30.60 kB, …) |

Changes: React.lazy for 29 dashboard/admin views with a skeleton `<Suspense>` fallback (`role="status"` + `aria-live="polite"`); `manualChunks` for `vendor-react` and `vendor-charts`; landing/auth/marketplace stay eager so first public paint is unaffected. **Direct navigation and deep links preserved** — verified: `/admin` direct load serves the SPA, all four tab deep-links land correctly, silent refresh unaffected.

Bonus fix discovered during verification: the dev-server proxy forwarded `/admin` to Django's admin site, breaking direct SPA deep-links to the User Administrator Console — proxy corrected (`server.ts`), verified live (`/admin` → SPA, 200).

## Q. Round 2 — regression suite results

| Workflow | Result |
|---|---|
| JWT silent refresh (sabotaged token → navigation) | PASS — token replaced with a real JWT; staff list renders |
| Direct `/admin` deep link | PASS — SPA served, Django admin no longer hijacks the path |
| Exact-tab deep links (Categories/Security/Finance/Overview) | PASS — each lands on its tab; Overview resets correctly |
| Statistics-powered Regional Reports + period selector | PASS — 31 real rows; 30-day refetch works |
| User approval | PASS — DB `APPROVED`, fresh `user_approved` audit row |
| Audit CSV export | PASS — `greenpath-audit-2026-11-04.csv` |
| Campaign bulk actions | PASS — appear on selection, confirm step intact |
| Account controls + emergency switches | PASS — all four actions + switches card render |
| Backend suite (full) | **559 passed, 3 skipped**, coverage **81.71%** |
| Frontend | `tsc --noEmit` exit 0; production build ✓ |

## R. Round 2 — classification

| Area | Verdict |
|---|---|
| Statistics API (M) | VERIFIED READY |
| Accessibility (N) | READY WITH LIMITATIONS (screen-reader matrix pending) |
| Responsive (O) | VERIFIED READY |
| Bundle/perf (P) | VERIFIED READY (index 501 kB noted as remaining headroom) |
| Regressions (Q) | VERIFIED READY |
| Per-account notification preferences | READY WITH LIMITATIONS (device-level persistence; needs a user-preferences model) |

## L. Production readiness assessment

| Area | Verdict |
|---|---|
| Platform Overview & all SA pages data accuracy | VERIFIED READY (no mock data remains) |
| User/staff lifecycle + audit trail | VERIFIED READY |
| Authentication & session resilience | VERIFIED READY (silent refresh verified; recovery tested) |
| Financial controls & pricing config | VERIFIED READY (maker-checker preserved) |
| CSV exports & reporting | VERIFIED READY |
| Dedicated statistics API | VERIFIED READY (round 2, section M) |
| Accessibility | READY WITH LIMITATIONS (round 2 fixes verified; screen-reader matrix pending) |
| Responsive layouts | VERIFIED READY (round 2, section O) |
| Frontend performance | VERIFIED READY (round 2, section P) |

## S. Round 3 — product-category repair and every-button re-audit

Trigger: the platform owner reported add/delete category "not working". Root-caused end to end (model → serializer → viewset → URL → apiClient → handler → browser → database).

### S.1 Root-cause analysis

1. **Delete was a silent no-op.** `SuperAdminProductCatalogCategoryViewSet.perform_destroy` never deleted: it flipped `active` to False (and did *nothing at all* for already-inactive rows) while returning **HTTP 204**. The UI removed the row locally and refetched — and the category reappeared, because the list returns inactive rows and the UI displayed no status. Reproduced live: DELETE → 204 → row still in DB with `active=False` and only a `..._deactivated` audit row.
2. **Add failed silently on duplicates.** The old inline form pre-checked duplicates client-side and **silently returned** (button appears dead). When it did submit, rejections came back as the backend envelope `{success:false, error:{field:[...]}}` and the frontend error parser only understood flat maps — so the 400 was displayed **nowhere**. Reproduced live: 400 "slug already exists" invisible to the user.
3. **Capability mismatch.** The model supports hierarchy (parent), descriptions, Amharic/Oromo names, display order, activation and per-category listing counts — the UI exposed only a single name field, so most of the taxonomy was unmanageable.

### S.2 Fixes

- **Backend** (`registrations/views.py`): `perform_destroy` now deletes for real when the category is unused (listings + subcategories checked), and refuses with **400 + plain-language reason** ("'X' cannot be deleted: N listing(s) and M subcategory(ies) depend on it. Deactivate it instead.") when in use — never bypassing the model's PROTECT foreign keys. Writes a `product_catalog_category_deleted` audit row on success.
- **Frontend** (`SuperAdminDashboard.tsx`): the categories tab is now a management table — Category (name + slug), Type (Main / Sub of X), **Listings count**, Order, **Active/Inactive pill**, and row actions (Edit / Activate–Deactivate / Delete); search + status filter; loading/empty states.
- **Create/Edit modal** with every model field (English/Amharic/Oromo names, description, parent select, display order, registration toggle, active toggle on edit), required indicators, and **backend field errors rendered inline** (nested `{error:{field}}` envelope now unwrapped; `detail` mapped to the form banner). Escape/focus via the shared `useModalA11y` hook.
- **Delete confirmation dialog** that names the category, explains the consequence, **hides "Delete permanently" and offers "Deactivate instead" for in-use categories** (listings or children), and surfaces the backend refusal text if it still fails.

### S.3 Category end-to-end test evidence (executed this round)

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 2 | Add "QA Oilseeds Test" via modal | PASS | 201; toast; DB row with description; `..._created` audit |
| 4 | Refresh persistence | PASS | Row present after reload (edit found it) |
| 5–6 | Rename → save | PASS | PATCH 200; DB `name_en` updated; `..._updated` audit with before/after |
| 7–8 | Activate/deactivate toggle | PASS | DB `active` True→False→True; two `..._updated` audit rows with previous/new |
| 9 | Duplicate add | PASS | 400 `slug already exists` **shown inline**; modal stays open; no row created |
| 11–12 | Delete in-use ("Vegetables", 5 listings, 7 children) | PASS | UI dialog refuses + offers Deactivate; direct API DELETE → **400** with the exact reason |
| 13–14 | Delete eligible QA category | PASS | 204 → row **gone from DB**; `product_catalog_category_deleted` audit; removed from UI |
| 15 | Persistence after delete | PASS | DB count excludes the deleted row |
| 16 | Unauthorized API (USER_ADMIN; anonymous) | PASS | 403 on list/create/delete; 401 anonymous |

### S.4 Every-button matrix (all SA screens — statuses across rounds 1–3)

| Screen | Controls | Status |
|---|---|---|
| Categories | New/Edit/Delete/Toggle/Search/Filter | BROKEN — FIXED AND RETESTED (all six flows above) |
| Users & Staff | Approve; Inspect modal | VERIFIED WORKING (DB + audit) |
| Users & Staff | Reject | NOT TESTED this round (refusing a real applicant is destructive; endpoint + audit covered by backend suite) |
| Staff Management | Create / Suspend / Activate / Edit / scope | VERIFIED WORKING (DB + audit) |
| Account Controls | Suspend/Reinstate/Deactivate/Activate + reason enforcement + emergency switches | VERIFIED WORKING (DB + audit; negative test passed) |
| Discounts | Create/Edit modal; bulk Activate/Deactivate + confirm | VERIFIED WORKING (DB + audit) |
| Regional Reports | Period selector (30d/90d/12m/All); CSV; Print | VERIFIED WORKING (statistics API; dated CSV download) |
| Financial Controls | Draft save/approve; delivery pricing create/deactivate | VERIFIED WORKING (round 1; JSON validation gate) |
| CMS | Save & publish | VERIFIED WORKING (endpoint live; landing reflects content) |
| Security | Save (incl. session timeout) | VERIFIED WORKING (60→90→60 round-trip persisted) |
| Audit Logs | Export CSV; filters | VERIFIED WORKING |
| Support | Reply/assign/urgent/close/bulk | VERIFIED WORKING (round 1, real ticket) |
| Logistics | Tracking timelines | VERIFIED WORKING |
| Freight Bidding | Assign/Cancel | NOT TESTED this round (no open freight jobs existed; endpoints covered by backend tests) |
| Messaging Oversight | Reason-gated open | VERIFIED WORKING |
| Banners | Create/reorder/toggle/delete | VERIFIED WORKING (round 1) |
| Platform Operations | Broadcast; order/wallet oversight | VERIFIED WORKING (round 1) |
| Settings | Password change; preference toggles | VERIFIED WORKING (re-login with new password) |
| AI Advisor | Groq-backed chat | NOT TESTED (external API dependency) |
| Payment releases / payouts | — | NOT SAFE TO TEST (real funds; maker-checker + Chapa test-mode boundaries preserved) |

### S.5 Regression and build status (this round)

`tsc --noEmit` exit 0 · production build ✓ (26.5s) · backend suite **559 passed / 3 skipped**, coverage **81.71%** · no commit made (per instruction).

### S.6 Classification

Product-category management: **VERIFIED READY** (all add/edit/delete/toggle flows proven against the database). Every other previously verified screen: **VERIFIED READY** unchanged. Items marked NOT TESTED above are documented with reasons — none block release.

## T. Round 4 — command-centre reorganization, intelligence endpoints, navigation repair

Trigger: the platform owner asked for one organized command centre — a compact grouped sidebar, exact destinations for every control, regional/status intelligence, scarcity monitoring, message insights and approval accountability.

### T.1 Backend (reused + new)

- **Extended `GET /superadmin/statistics/`** (existing endpoint, no duplicates): every regional row now carries `staffCount`, `approvedCount`, `pendingCount`, `suspendedCount`; new `administrative` section with **approvals/rejections by actor** (from real `user_approved`/`user_rejected` audit rows), **pending-by-region**, and an explicit note that pre-audit approvals are not attributable (no fabricated history).
- **New `GET /superadmin/messaging-insights/`** (`users/superadmin_messaging_insights.py`, Super-Admin-only): conversation/message totals, unread, voice, moderation breakdown, active-conversations-7d, today/7d/30d activity, 14-day trend (timezone-correct — TruncDate buckets in Africa/Addis_Ababa, label loop aligned), top senders by role. **Privacy: counts only — verified no message bodies in the payload.** Delivery-failure metrics are honestly listed under `unavailable` (not tracked by the chat model).
- Tests: `tests/test_superadmin_intelligence.py` — 7 tests (401/403/200, accurate counts incl. backdated messages, unread/moderation, privacy, regional status counts, accountability). Full suite: **566 passed / 3 skipped, coverage 81.79%**.

### T.2 Sidebar reorganization (10 collapsible groups)

Executive Overview · Users, Staff & Access · Marketplace · Geography & Intelligence · Orders, Logistics & Delivery · Finance & Wallet Oversight · Messages & Support · Content & Presentation · Governance & Security · Workspace. Group headers are buttons with `aria-expanded` and chevrons; state persists in localStorage; the group owning the active view auto-expands via effect; new entries: **Command Centre, System Health & Operations, Verified Wholesalers (pre-filtered directory), Scarcity Monitoring, Regional Analytics**.

### T.3 Navigation repairs

- Shared-path view guard extended (`scarcity_monitoring`, `regional_analytics`, `all_users_wholesalers`) — verified that these views no longer bounce back to their parent route.
- **KPI cards are now working navigation**: Total Users → All Users, Pending → approval queue, GMV/Revenue/Payroll → Regional Reports, Escrow → Wallet Oversight, Freight → Freight Bidding, Support → Support Inbox — with `role="button"`, keyboard activation and aria-labels. Verified live: Total Users and Support Open cards land on their destinations.
- Regional Reports table gained **% of Platform**, Staff, Approved and Pending columns (real statistics data).

### T.4 New screens

- **Scarcity Monitoring** (`ScarcityMonitor.tsx`): availability classification computed from real product-region records (Critical ≤2, Low ≤5, Moderate ≤10, Sufficient — thresholds editable at runtime by the SA), region filter, two charts (classification pie, low-quantity-by-region bars), full classified table, and the low-quantity watch list. Labels explicitly say **listing/seller availability** — the platform does not track physical inventory.
- **Message insights strip** inside Messaging Oversight: KPI chips, 14-day trend chart, top senders by role, moderation breakdown — sitting above the existing reason-gated conversation list (unchanged privacy model).

### T.5 Verification evidence (this round)

- Navigation: 10 groups render with `aria-expanded`; collapse hides child entries and re-expands correctly; all five new destinations land on their screens (verified live); Total Users/Support KPI cards navigate correctly.
- Scarcity: 18 classified rows + 2 charts + threshold inputs rendered from live data.
- Messaging insights live: `{conversations: 9, messages: 16, unread: 2, active_7d: 3}` with `hasMessageBodies: false`.
- Category regression: management table intact (19 rows, status pills, New category, edit/delete/toggle flows unchanged).
- `tsc --noEmit` exit 0 · production build ✓ (26.2s) · backend 566 passed.

### T.6 Files changed in this round (uncommitted — awaiting approval)

Modified: `SUPER_ADMIN_QA_REPORT.md`, `backend/users/superadmin_statistics.py`, `backend/users/superadmin_urls.py`, `backend/registrations/views.py` (category fix from round 3, preserved), `frontend/src/App.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/views/{RegionalFinancialReportsView,SuperAdminDashboard,SuperAdminOverview,SupportPanels,UserAdminDashboard}.tsx`.
New: `backend/users/superadmin_messaging_insights.py`, `backend/tests/test_superadmin_intelligence.py`, `frontend/src/components/views/ScarcityMonitor.tsx`.
Deleted: none. Migrations: none required. HEAD unchanged: `235a338`.

### T.7 Remaining limitations

- Screen-reader matrix (NVDA/JAWS) still outstanding; per-account notification preferences still device-level; no commission ledger so revenue stays unavailable; message delivery-failure tracking does not exist; chat participants are not consistently region-linked so per-region message activity is honestly marked unavailable.

## U. Round 5 — requirements-completeness audit (pre-approval verification)

Executed against the live stack with database verification for every PASS. Two gaps found during the audit were **closed in this round** (scarcity-threshold persistence; product-visibility enforcement) rather than reported as partial.

### U.1 Verdicts against the ten requested requirements

| # | Requirement | Verdict | Evidence |
|---|---|---|---|
| 1 | Regional drill-down Region → Zone → Wereda → Kebele | **PARTIAL** | Live walk verified: Oromia → **22 zones** → Arsi → **28 weredas** (Sub-administrations cards with per-level user counts). Kebele level: the drill-down mechanism supports it recursively, but the reference dataset contains no kebele children under the weredas tested — **kebele level NOT TESTED against live data** (sparse geographical records, shown separately per spec). |
| 2 | Regional wallet reports + verified wholesalers to lowest level | **PARTIAL** | Region level PASS: wallet available/held per region from the statistics endpoint — now displayed as table columns (added this round) and included in CSV; verified-wholesaler directory opens pre-filtered (role=wholesaler) with a working region filter. **Zone/wereda-level wallet and wholesaler breakdowns: NOT IMPLEMENTED** (statistics endpoint aggregates wallets at region level only). |
| 3 | Product visibility enforced in backend discovery | **PASS** (gap closed this round) | The visibility view was previously **read-only**; a PATCH action was added (SA + scoped oversight roles, reason ≥5 chars required, scope check for non-SA, audit `product_visibility_changed`). E2E verified: hide → **200**, listing **disappears from public farmer-listings discovery** (ID no longer in the response), restore → **200**, audit rows written, short-reason → **400**, UI cycle (Hide → notice "is now inactive — marketplace discovery updated" → Publish → "is now active") verified in the browser. |
| 4 | Content & banners consolidated | **PASS** | Both live under the **Content & Presentation** sidebar group; verified in the sidebar DOM sweep. |
| 5 | Staff filtering, selection, role distribution, geographic filter | **PASS** | Role filter applied → exactly **5/5 FINANCIAL MANAGER rows** (matches the "Financial Managers 5" stat); status/scope filters + geographic LocationPicker present; stats strip (12 Active, role counts) visible. Row multi-select/select-all exists on the Account Controls screen; the staff table itself is single-record oriented. |
| 6 | Approval accountability (who/whom/when) | **PASS** | Aggregate: statistics `administrative.by_actor` → Super Admin 13 approvals, Hana Tesfaye 6; pending-by-region list. Per-user: immutable audit row `user_approved` resolves **actor `superadmin@greenpath.et` → target `mekdes.alemu@mail.com` at 2026-11-04T18:57:35Z**. Approvals predating audit logging are honestly flagged as unattributable. |
| 7 | Messaging insights, privacy, reason-gated inspection | **PASS** | Insights endpoint + strip verified live (9 conversations / 16 messages / 2 unread / 3 active-7d) with **no message bodies in the payload** (tested); conversation content still requires a ≥10-char recorded reason. |
| 8 | Scarcity thresholds persist in DB and affect reports | **PASS** (gap closed this round) | New `PlatformSettings.scarcity_critical_sellers` / `scarcity_low_sellers` fields (migration `users.0015`), exposed in the settings API (PATCH round-trip verified: 2/5 → 3/6 → revert), and the Scarcity Monitor now **loads and saves** the persisted values, classifying every product/area with them. |
| 9 | Every sidebar destination / KPI / chart / filter / modal / table / form | **PASS with documented exceptions** | All 10 groups + every destination clicked and rendered (verified live); KPI cards navigate; chart bar-click drill-down works (real mouse click on the Oromia bar); filters/modals/tables exercised across rounds 3–5. NOT TESTED (documented): freight assign/cancel (no open jobs), AI Advisor (external API), payment releases (real funds), kebele drill-down (no reference data). |
| 10 | Category create/edit/activate/delete fixes preserved | **PASS** | Regression: management table renders (19 rows, Active/Inactive pills), all round-3 flows untouched by later changes; full category E2E evidence in section S.3. |

### U.2 Gaps closed during this audit

1. **Scarcity threshold persistence** — migration `users.0015`, settings API exposure, UI load/save with confirmation; backend round-trip verified (2/5 → 3/6 → revert).
2. **Product visibility enforcement** — new PATCH action on `/admin/products/` with authorization, scope enforcement, reason requirement, audit logging; marketplace-discovery exclusion proven; a `ProductStatus` import bug caught by the live test (500 → fixed → 200).

### U.3 Final state

- Git HEAD: `235a338` (unchanged). Nothing committed or pushed.
- Backend: **566 passed / 3 skipped**, coverage **81.62%**; migrations applied incl. `users.0015`.
- Frontend: `tsc --noEmit` exit 0; production build ✓.

Modified files (cumulative, uncommitted): `SUPER_ADMIN_QA_REPORT.md`, `backend/registrations/views.py`, `backend/users/models.py`, `backend/users/serializers.py`, `backend/users/superadmin_views.py`, `backend/users/oversight_views.py`, `backend/users/superadmin_statistics.py`, `backend/users/superadmin_urls.py`, `backend/users/migrations/0015_scarcity_thresholds.py`, `frontend/src/App.tsx`, `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/views/{RegionalFinancialReportsView,ScarcityMonitor,SuperAdminDashboard,SuperAdminOverview,SupportPanels,UserAdminDashboard}.tsx`, `frontend/src/hooks/useModalA11y.ts` (from round 3).
New files: `backend/users/superadmin_messaging_insights.py`, `backend/tests/test_superadmin_intelligence.py`, `frontend/src/components/views/ScarcityMonitor.tsx`.

### U.4 Risks

1. Zone/wereda-level wallet and wholesaler aggregation remains future work (region-level is complete).
2. Kebele reporting depends on reference-data completeness — the drill-down supports it, the dataset is sparse.
3. `product_visibility_changed` audit rows accumulate per toggle; no retention policy yet.
4. Threshold persistence is global (one rule set platform-wide); per-category thresholds would need a follow-up model.
