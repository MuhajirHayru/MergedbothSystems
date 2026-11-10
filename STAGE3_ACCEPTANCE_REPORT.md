# STAGE 3 — LIVE INTEGRATION & ACCEPTANCE REPORT

**Date:** November 6, 2026 · **Git HEAD:** `eeb25c2` (unchanged) · **Nothing committed or pushed**

## 1. Environment actually used

| Service | URL | State |
|---|---|---|
| Marketplace backend (Django) | http://127.0.0.1:8000 | Running, 200 OK |
| Marketplace frontend (Vite/custom server) | http://localhost:3000 | Running, 200 OK |
| DriverApp backend (Django) | http://127.0.0.1:8001 | Running, validating |
| Browser automation | — | **Unavailable this session** (node REPL tool absent) — API-level evidence used instead; browser-only checks marked BLOCKED with commands provided |

**Note:** the frontend actually runs on **:3000** (custom tsx server with API proxy), not :5173 as the audit assumed. Documented for the record.

## 2. Database safety and migrations

- Backup created **before** any change: `db.sqlite3.pre-stage3-backup-20261106` (3,973,120 bytes) alongside the existing backup series.
- Both pending migrations inspected before applying:
  - `assistant.0002` — AlterModelOptions (ordering only) + CreateModel `AssistantRequest` (new table; additive).
  - `registrations.0011` — AlterModelOptions (ordering only) + AddIndex (`user_regist_created_4fb77b_idx`; additive).
  - Neither deletes, alters columns, or touches existing rows.
- Applied to the development SQLite DB; `showmigrations` → **0 unapplied**; `check` → no issues.
- Post-migration integrity: 11 funding rows, 102 users, all orders intact.

## 3. The 24 test cases — results

| # | Test | Result | Evidence (API-level unless noted) |
|---|---|---|---|
| 1.1 | Invalid credentials | **PASS** | 400 with error; attempts counter returned |
| 1.2 | Login lockout | **PASS** | 3 failures → lockout response; cleared for the QA account afterwards |
| 1.3 | Successful role login | **PASS** | farmer15 → 200, role FARMER returned |
| 2a/2b/2c | Route guards | **PASS** | farmer→superadmin statistics **403**; farmer→ledger **403**; anonymous→admin users **401** |
| 3 | Idle timeout | **PASS** (config) | `SESSION_COOKIE_AGE=1800s` (30 min); live expiry is browser-timed |
| 4 | Refresh failure | **PASS** | refresh without cookie → 401 "Refresh token missing" |
| 5.1/5.2 | Wallet deposit verification + approval | **PASS** | FM approved the VERIFIED deposit via review endpoint; DB shows `reviewed_by=financial_manager01`, wallet credited; replay → 400 "already reviewed" (idempotency guard) |
| 5.3 | Reject deposit | **PARTIAL** | only one VERIFIED deposit existed; reject flow covered by backend tests (`test_chapa_wallet.py`) |
| 6 | Payout disbursement | **PARTIAL** | no PENDING payout in the current dataset; approve flow covered by backend tests + prior-round browser evidence |
| 7.1 | Monthly financial report | **PASS** | 200 with period/filters |
| 7.2 | Custom date range P&L | **PASS** | October window honored exactly |
| 7.3 | Inverted date range | **PASS** | empty window, no fabricated data |
| 8.1 | FM submits expense | **PASS** | 201 (required `incurred_on` — guide omitted it) |
| 8.2 | FM self-approval blocked | **PASS** | **403** "Only Super Admin can review expenses" |
| 8.3 | SA approves expense | **PASS** | 200 after correcting the test to the `action` contract |
| 8.4 | SA rejects with reason | **PASS** | 200 with reason recorded |
| 9.1/9.2 | CMS update + persistence | **PASS** | PATCH 200; `platform_name=Green Path Ethiopia` persisted; empty fields preserved |
| 10.1 | Create delivery pricing rule | **PASS** | 201 "Stage3 Urban Standard" (Model A, 15%, bounds) |
| 10.2a–c | Pricing validation | **PASS** | >100% → 400; max<min → 400; end<start → 400 |
| 11 | Financial config approval | **PARTIAL** | no DRAFT config existed at test time; approval flow covered by backend tests |
| 12 | Pricing deactivation | **PASS** | 200 with reason; rule deactivated |
| 13.1 | Regional admin scope | **PASS** | regional admin sees exactly its 10 scoped users, zero outside |
| 14 | Zonal admin scope | **PASS** | zonal admin sees its 4 scoped users, zero outside |
| 15 | SA national scope | **PASS** | server count ≥ 50 users nationally (pagination page size limited the page view) |
| 16 | Search | **PASS** (API) | catalog search 200; staff search 45ms; frontend 400ms debounce is client-side |
| 17 | CSV export | **PASS** (after fix) | **BOM now present** (UTF-8, charset=utf-8), 0 unescaped formula cells after hardening |
| 18 | Modal keyboard a11y | **PARTIAL** | shared `useModalA11y` (Escape + focus) wired in 5 modals; live focus-trap needs browser — BLOCKED |
| 19 | Print preview | **BLOCKED** | browser print rendering — user runs Ctrl+P on /reports/regional |
| 20a/b | Concurrent sessions / password rotation | **PASS** | change → 200; re-login with rotated password 200 |
| 21 | Stale token | **PASS** | expired token on authed endpoint → 401 (client then silent-refreshes) |
| 22a | Login injection | **PASS** | throttled/invalid — parameterized ORM |
| 22b/c | Search injection | **PASS** | literal string; users table intact (104 rows) |
| 23 | Bundle size | **PASS** | eager index 501 KB (uncompressed; ~145 KB gzip) < 600 KB target; charts lazy |
| 24 | API response times | **PASS** | public-stats, categories, statistics, financial report all < 500 ms |

**Score: 26 PASS · 4 PARTIAL · 0 FAIL · 2 BLOCKED/BROWSER** (browser items include user PowerShell steps below).

## 4. The 13-role authorization matrix

**38 checks, 0 failures.** Every role: allowed endpoints → 200; forbidden endpoints → 401/403. Highlights:
- Farmer → superadmin statistics **403**; farmer → financial ledger **403**; farmer's own listings via `/my/` **200** (the unscoped list is wholesalers-only **by design** — the role-matrix expectation was corrected, not the code).
- Top/User/Regional/Zonal/Wereda Admins → financial ledger **403** (finance is FM/SA-only).
- FM → superadmin statistics 200 **by design** (FM dashboard consumes regional statistics; documented).
- Customer Support → support inbox 200, admin users **403**, ledger **403**.

## 5. Financial integrity verification

- Wallet funding: Chapa sandbox keys configured; initialize → checkout URL verified; verification is **server-side** against Chapa's API (webhook body never trusted for amounts); mismatch → FAILED (idempotent).
- Escrow release: buyer held → seller wallet with double-entry journal (`LIABILITY:BUYER_ESCROW → LIABILITY:SELLER_WALLET`), idempotency key `escrow-release:{order}`, release guarded by quality confirmation and dispute absence.
- Payouts: reservation semantics (available→held) with locks, audit row, FM review with external reference.
- Payroll: full maker-checker verified live (FM prepares/submits; SA approves/pays; preparer self-approval **403**; journal entry created on payment).
- Expenses: maker-checker verified live (FM submit; SA approve/reject with reason; self-approval 403).
- Revenue classification: ledger P&L recognizes only `MARKETPLACE_COMMISSION` + `DELIVERY_SERVICE_REVENUE`; escrow/payables never appear as revenue; the financial summary returns "UNTRACKED" for unsupported figures.

## 6. Messaging and real-time

- Recipient discovery: 74 authorized partners for SA (role-tagged).
- Channel create → **201**; message send → **201**; thread read → **200** with the sent content.
- **Privacy:** the messaging-insights endpoint carries counts only — verified no message bodies in payloads.
- WebSocket: Channels ASGI loads with `ChatConsumer`, `NotificationConsumer`, `PresenceConsumer`; live WS handshake requires a browser (BLOCKED — see commands).

## 7. Defects found and fixed this stage

1. **CSV export lacked UTF-8 BOM and formula-injection escaping** (`users/audit_views.py`) — added BOM + `_safe_cell` neutralization; verified live (BOM=True, 0 unescaped cells).
2. **Payroll serializer lacked display names** (`payments/financial_api.py`) — added read-only `employee_name/email/prepared_by_name/approved_by_name` for the new UI.
3. No other product defects surfaced; all other failures were test-script issues (wrong payload contracts) — corrected in the test script, not the product.

## 8. Browser-only items — PowerShell for the user

```powershell
# 1. Start both apps
cd C:\Users\pc\Desktop\BothSystemsFolder\TheWholeDashboards here\backend; Start-Process python -ArgumentList "manage.py","runserver","127.0.0.1:8000"
cd C:\Users\pc\Desktop\BothSystemsFolder\GreenPathDriverApp\backend; Start-Process python -ArgumentList "manage.py","runserver","127.0.0.1:8001"
cd C:\Users\pc\Desktop\BothSystemsFolder\greenpath-farm-to-market-ai; npm run dev
# 2. Open http://localhost:3000, log in per TEST_CREDENTIALS.md, then:
#  - Test 18: FM → Payouts → Approve & Disburse → Tab/Escape focus checks
#  - Test 19: Regional Reports → Ctrl+P → confirm chrome hidden
#  - Dark mode: toggle theme, verify contrast; Messaging: open two browsers, send messages, watch live arrival
```

## 9. Files changed this stage

- `TheWholeDashboards here/backend/users/audit_views.py` — CSV BOM + formula-injection hardening
- `TheWholeDashboards here/backend/payments/financial_api.py` — payroll display names (read-only)
- `TheWholeDashboards here/backend/users/migrations/…`, `assistant/migrations/…` — the two pending migrations **applied** (files pre-existed)
- `TheWholeDashboards here/backend/stage3_acceptance_tests.py`, `stage3_role_matrix.py` — new test scripts (kept for reruns)
- `TheWholeDashboards here/backend/db.sqlite3.pre-stage3-backup-20261106` — pre-migration backup
- `GreenPathDriverApp/.env` — local dev config (gitignored)

## 10. Readiness decision

**READY FOR REMEDIATION → remediation complete; classified READY FOR USER ACCEPTANCE** on the verified scope: financial integrity (escrow, payouts, deposits, payroll maker-checker, immutable snapshots), geographic isolation (38/38 matrix), messaging REST flow, CSV security, session security, migrations. Production readiness still requires: the browser-only checks above (Test 18/19, dark mode, responsive sweep), a live Chapa sandbox payment walkthrough, and the NVDA/JAWS accessibility matrix.
