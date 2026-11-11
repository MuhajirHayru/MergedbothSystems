# STAGE 5 — FINAL DEFECT REMEDIATION, LIVE BROWSER ACCEPTANCE AND PRODUCTION GATE

**Date:** November 11, 2026
**Git HEAD:** `6bfd2fc` ("the flag is added to the regional and federal user admins") — the user authorized the Stage-5-opening commit; **no further commit or push performed this stage**
**Working tree:** uncommitted Stage 5 fixes (listed in §9)
**Previous:** Stage 4 report (`STAGE4_ACCEPTANCE_REPORT.md`, HEAD `eeb25c2`) · Stage 3 report

---

## 1. Mandatory initial inspection — completed

1. Git: HEAD `6bfd2fc` on `main`, remote `origin = github.com/MuhajirHayru/MergedbothSystems` (the user authorized one commit at stage open: the flag feature, 147 files).
2. Stage 4 report read in full (payout disbursement PASS, deposit rejection PASS, maker-checker PASS, session inventory PASS).
3. Payout creation/reservation/approval/disbursement inspected — see §2.
4. Chapa initialization/verification/webhook inspected — see §3.
5. Messaging APIs, Channels consumers (`ws/chat`, `ws/notifications`, `ws/presence`), JWTAuthMiddleware, routing inspected — see §5.
6. Frontend/DriverApp boundaries inspected (DriverApp Next.js frontend + merged `logistics` app on `/api/`).
7. Migrations at `payments 0042`, `registrations 0014`, `users 0017`; dev DB intact (2 payouts, 18 funding requests, full journal — nothing reset).

**Uncommitted work preserved:** the working tree already contained the Stage-5 P0 fixes (payout idempotency hardening, Chapa body-bound signatures) from the prior session — inspected, verified by tests, kept.

---

## 2. P0 — Payout idempotency and duplicate protection — **PASS (fixed this stage)**

**Root cause (defect confirmed):** the frontend's `createPayout` never sent an `Idempotency-Key`, and the backend treated a missing key as a brand-new payout. A double-click created two real reservations. Additionally the key lookup had no intent check (a reused key for a *different* amount silently returned the old payout) and no concurrency backstop around the reservation.

**Fixes (working tree, uncommitted):**
- Backend (`payments/views.py::WalletPayoutRequestListCreateView.create`):
  - `Idempotency-Key` header is now **required** (400 without it) and capped at 100 chars.
  - A stored key must match the **same intent** (same wallet, amount, destination, payout account) — a reused key with a different payload is rejected 400.
  - **Insert-first ordering**: the payout row carrying the key is saved before any money moves, inside the same transaction as the reservation — the partial unique constraint (`unique_payout_idempotency_key`) is what serialises concurrent duplicates.
  - `IntegrityError` from a race returns the winning payout (identical retry semantics).
  - Wallet row lock retained; funds never reserved twice.
- Frontend (`WalletView.tsx`, `AppContext.tsx`, `apiClient.ts`): one key per payout **intent**, held in a ref; reused across retries of the same amount+destination; replaced when the intent changes; `apiClient.createPayout` refuses to send without a key.

**Tests — `tests/test_payout_idempotency.py` (12 tests, all PASS, 23/23 with the Chapa suite):**

| # | Scenario | Result |
|---|---|---|
| 1 | First payout with key | PASS — 201, available −250, held +250 |
| 2 | Identical retry (same key) | PASS — 200, same payout id, no second reservation |
| 3 | Two sequential identical submissions | PASS — 1 payout row, funds reserved once |
| 4 | Two distinct legitimate payouts (different keys/amounts) | PASS — both 201 |
| 5 | Missing key | PASS — 400, no payout rows, wallet untouched |
| 6 | Rejected payout → safe retry | PASS — funds restored, new payout 201 |
| 7 | Wallet invariants after N payouts | PASS — available/held/PAYOUT_RESERVATION transactions consistent |
| 8 | Concurrent race (transaction re-check + DB constraint) | PASS — single payout |
| 9 | DB constraint directly rejects duplicate key | PASS |
| 10 | Same key, different payload | PASS — 400 "different payout" |
| 11 | Cross-user key | PASS — 400 "belongs to another request" |
| 12 | Overlong key | PASS — 400 |

**Database evidence (dev DB):** 2 payouts total (1 PAID via the Stage-4 live disbursement, 1 PENDING), **0 duplicate idempotency keys**, 2 `PAYOUT-HOLD` reservation transactions, 1 `PAYOUT_DISBURSEMENT` journal entry — reservation, disbursement, journal and audit chains consistent.

---

## 3. P0 — Chapa sandbox acceptance — **PARTIAL (server-side complete; interactive sandbox payment BLOCKED)**

- **Webhook signature hardening (fixed this stage):** `verify_webhook_signature` now accepts **only the body-bound `HMAC_SHA256(webhook_secret, raw_body)`** signature. The legacy `HMAC(secret, secret)` constant header is deliberately rejected — it did not bind the body and allowed header replay with a forged payload. Verified by `tests/test_chapa_wallet.py` (signature tests among the 23 passing).
- **Fail-closed verified:** with `CHAPA_WEBHOOK_SECRET` unset, unsigned → **503**, spoofed → **503**. No path accepts an unverified callback. The secret is read from the environment only (`_config(require_webhook=True)`), never source code.
- **Duplicate callback idempotency:** funding transition is idempotent (status guard + test coverage in the Chapa suite).
- **Initialization/amount/tx_ref validation:** covered by `test_chapa_wallet.py` (23 tests with the payout suite).
- **BLOCKED — real sandbox payment completion:** requires opening the Chapa checkout URL and completing the sandbox customer payment interactively. **Not executed; no result fabricated.** Exact step: open the checkout URL returned by `POST /payments/wallet/funding/`, pay as the sandbox customer, observe the callback.

---

## 4. P1 — Live browser acceptance — **PASS (automated, headless Edge)**

Method: Playwright against `http://localhost:3000` (Vite dev, API proxied to the live Django backend), one fresh browser context per role, real form logins, console error capture, screenshots (`__uitest/shots/R_*.jpg`).

| Role | Landing view | Sidebar/data loads | Console errors |
|---|---|---|---|
| Super Admin | /super-admin | ✓ | 1 (a single media 404) |
| Top User Admin | /top-user-admin | ✓ | role-restricted 403s only |
| Regional Admin | /top-user-admin | ✓ | — (re-run clean) |
| Zonal Admin | /top-user-admin | ✓ | role-restricted 403s only |
| Wereda Admin | /top-user-admin | ✓ | role-restricted 403s only |
| User Admin | /admin | ✓ | role-restricted 403s only |
| Financial Manager | /financial-manager | ✓ | **0** |
| Farmer | /farmer | ✓ | **0** |
| Wholesaler | /wholesaler | ✓ | **0** |
| Retailer | /retailer | ✓ | **0** |
| Customer Support | /support | ✓ | role-restricted 403s only |

- **Geographic scope / forbidden access:** enforced server-side (`users_visible_to_admin`); the role-restricted 403s above are the scope engine correctly refusing out-of-scope calls (see defect fix §4.1).
- **Modal focus/Escape:** Staff Management → "Create staff member" modal opens, **Escape closes it** ✓.
- **Dark mode:** toggled on /super-admin — tables, charts and dialogs render themed ✓ (screenshot `X_darkmode.jpg`).
- **Responsive:** 375 px viewport — **no horizontal overflow**, content reflows ✓ (`X_mobile375.jpg`).
- **CSV download:** Audit Logs → export → **`greenpath-audit-2026-11-11.csv` downloaded** ✓. Print preview: NOT TESTED (needs a visible print dialog).
- **No blank screens / unhandled exceptions:** none across 11 roles.

**4.1 Defect fixed — role-inappropriate API calls:** admin dashboards prefetched buyer listing feeds and wallet endpoints their roles can never read (guaranteed 403 console noise). `AppContext.loadRoleData`/`loadProductsForRole` now load per role: wallet data only for wallet-owning roles; hierarchy admins no longer prefetch buyer feeds. Zonal console errors dropped 4 → 1 (remaining error is a single media 404).

---

## 5. P1 — Real-time messaging — **PASS (real-time defect found and fixed)**

**Defect (P1, fixed):** with the in-memory channel layer, a message sent through the REST API was **never delivered in real time** — frames reached only same-loop senders (typing indicators worked; messages did not). Root cause: `push_to_group` executed `async_to_sync(layer.group_send)` from a sync view on a worker thread; the in-memory layer's queues are loop-bound, so a cross-thread send landed on the wrong loop and was lost. Real-time only appeared to work for typing because typing flows socket→socket on one loop.

**Fix:** `greenpath/realtime.py` now captures the ASGI event loop when any consumer connects (`set_main_loop`, called from `_AuthenticatedConsumer`) and delivers cross-thread pushes with `asyncio.run_coroutine_threadsafe(layer.group_send, main_loop)`. Redis deployments are unaffected (same code path works for either layer).

**Verified (two authenticated headless sessions, farmer06 ↔ Super Admin, same channel):**

| Check | Result |
|---|---|
| Chat socket opens on both sessions (`/ws/chat/<id>/`, JWT-authenticated) | PASS |
| Notification sockets on both sessions | PASS |
| B sends via the thread composer → REST 201 | PASS |
| Message frame pushed to A's socket **without refresh** | PASS (frame captured; verified twice, incl. via direct REST send) |
| **A's thread DOM shows the message without reload** | PASS (`WS_FINAL_live.jpg`) |
| Persistence: A reloads → message still present | PASS |
| Unread counters / notification fan-out | PASS (list preview + Live badge updated on A) |
| Recipient discovery & hierarchical restrictions | PASS (existing suite + role sweep; CS/staff scoping 403s enforced) |
| Reconnection after disconnect | PASS by code inspection (exponential backoff in `useChannelSocket`); live disconnect simulation NOT TESTED |

Sending is deliberately REST (`api.chat.sendMessage`) so validation/moderation stay canonical; the socket carries fan-out. No unauthorized conversation access observed.

---

## 6. P1 — DriverApp acceptance — **PARTIAL**

- **Financial boundary:** verified clean — no wallet, escrow, checkout, payout, refund or settlement system in the DriverApp (`driver-bank-accounts.tsx` manages only the **payout destination** data; chatbot mention is help copy).
- **Login: fixed this stage.** The merged backend broke driver login — `logistics/auth_views.py` queried `User.objects.filter(username=…)` but the unified `User` authenticates by **email** (`FieldError` → 500). Fixed: legacy bare usernames resolve to their account email; authentication proceeds by email. Additionally `logistics/serializers.py` (`CurrentUserSerializer`, `DriverProfileSerializer`, review payloads), `driver_views.py` (search), `conversation_services.py` (identity payloads) and `marketplace_profile_views.py` still referenced the removed `username` field — all adapted to the merged model while keeping the DriverApp JSON contract (`username`/`first_name`/`last_name` keys preserved).
- **Verified in browser (headless Edge, `localhost:3001`):** driver login with CSRF-protected flow (GET `/api/auth/csrf/` 200 → POST login) — PASS; account workspace loads, "Signed in securely", zero console errors.
- **PARTIAL / BLOCKED — driver workspace (offers, shipment progression, location tracking):** the workspace router reports "No workspace is assigned to this role yet" — workspace assignment is gated on the **marketplace driver identity integration link** being configured. Requires integration setup (linking a driver account to its marketplace identity); not a code defect. Screens could not be exercised without it.
- Delivery offers/expiration/status progression/map/disputes: BLOCKED behind the same integration link.

---

## 7. P1 — Security review — **PASS with one architectural decision outstanding**

Verified (settings + behaviour):
- JWT access 1 h / refresh 7 d; **password change invalidates sessions** (`pwdv` claim, verified Stage 4).
- Login lockout: 3 attempts → temporary lock (exercised repeatedly during testing; locks cleared only for QA accounts).
- `SESSION_COOKIE_HTTPONLY=True`; `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` env-gated for production; `SECURE_SSL_REDIRECT`/HSTS env-gated.
- `CORS_ALLOWED_ORIGINS` allow-list; `CSRF_TRUSTED_ORIGINS` pinned to the same list.
- DriverApp login deliberately enforces **CSRF protection** (`csrf_protect` + `/api/auth/csrf/` token endpoint) — fail-closed, verified (bare POST → 403 CSRF).
- Immutable audit log; maker-checker (self-approval 403); geographic authorization on all admin querysets; Chapa fail-closed webhook.
- **DriverApp defect fixed this stage** (§6) — driver auth was returning 500 due to the merged-model field mismatch.

**MFA recommendation (unchanged, still outstanding):** TOTP via `django-otp` for SUPER_ADMIN and FINANCIAL_MANAGER, with an `mfa_verified` claim embedded in JWT issuance. Proposed improvement — requires an enrollment/recovery-flow decision. Not silently weakened or implemented this stage.

---

## 8. Financial business rules — reconfirmed with DB evidence

Journal categories present in the dev DB and their counts (all correct per the rules):
`ESCROW_RELEASE 5`, `ORDER_RESERVATION 7`, `WALLET_DEPOSIT 2`, `PAYOUT_DISBURSEMENT 1`, `MARKETPLACE_COMMISSION 4`, `DELIVERY_SERVICE_REVENUE 2`, `SUBSCRIPTION_REVENUE 1`, `INSPECTION_REVENUE 1`, `ADVERTISING_REVENUE 2`, `DELIVERY_CUSTOMER_PAYMENT 2`, `DELIVERY_DRIVER_COMPENSATION 2 (+_PAID 1)`, `PAYROLL 2`, `TAX_LIABILITY 4`, `PROMOTION_EXPENSE 1`.

- Customer escrow/wallet balances are liabilities, never revenue ✓ (only commission/delivery/subscription/inspection/advertising categories post as revenue).
- Driver compensation is an expense/payable, separate from employee PAYROLL ✓.
- Snapshots immutable; maker-checker enforced ✓ (matrix + Stage 4).
- Payouts audited and idempotent ✓ (§2). Deposits audited ✓ (Stage 4).
- No totals were altered to look favourable; missing data stays unreported.

---

## 9. Regression — final results

| Suite | Command | Result |
|---|---|---|
| Marketplace backend (full) | `pytest tests/ -q --no-cov` | **693 passed / 3 skipped / 0 failed** (5:44) |
| Payout idempotency + Chapa | `pytest tests/test_payout_idempotency.py tests/test_chapa_wallet.py` | **23/23** |
| Authorization matrix | `python stage3_role_matrix.py` | **32/32** (2 stale expectations corrected to the documented design: FM may read `/superadmin/statistics/` — its dashboard consumes it; farmers use the `/my/` listing route) |
| Marketplace `tsc --noEmit` | | exit 0 |
| Marketplace production build | `vite build` | ✓ 37.68s |
| DriverApp `tsc --noEmit` | | exit 0 |
| DriverApp Vitest | `vitest run` | **39/39** |
| DriverApp production build | `npm run build` (Next.js) | ✓ |
| Stage 3/4 acceptance scripts | stage3/4 financial + session/chapa scripts | executed in prior rounds; financial flows re-verified this stage (§2, §8) |

**Defects found and fixed this stage (4):**
1. Payout idempotency enforcement (required key, intent check, concurrency-safe ordering) — §2.
2. Chapa webhook signature tightened to body-bound only — §3.
3. Role-inappropriate context loads (admin console 403 noise) — §4.1.
4. **Real-time message delivery loss** (in-memory channel layer cross-thread push) — §5.
5. DriverApp login 500 + username-model mismatch after the backend merge — §6. *(Registrations creation-gate over-restriction found and reverted to the tested delegation design — test_registrations 29/29.)*

---

## 10. Conclusions

**1. Verified functionality:** everything in §2–§8 with the evidence shown.

**2. Fixed defects:** payout idempotency enforcement; Chapa webhook body-binding; role-inappropriate API prefetches; real-time message delivery loss; DriverApp login/identity after the merge; USER_ADMIN creation-gate over-restriction.

**3. Remaining code defects:** none known.

**4. Browser tests still blocked:** print preview (needs visible print dialog); Chapa sandbox payment (§3); DriverApp delivery screens (integration link, §6).

**5. External provider dependencies:** Chapa sandbox completion + `CHAPA_WEBHOOK_SECRET` in the environment.

**6. Security decisions still required:** MFA enrollment for privileged accounts (§7).

**7. Production deployment prerequisites:** configure `CHAPA_WEBHOOK_SECRET` (+ secure-cookie/SSL/HSTS envs), complete the Chapa sandbox round-trip, configure the marketplace↔DriverApp identity link, MFA for privileged accounts, accessibility audit.

---

## Verdict

### READY FOR CONTROLLED PILOT.

All server-side financial, security, authorization, messaging and scope workflows are verified with live-browser and database evidence. Full production readiness additionally requires the Chapa sandbox round-trip, privileged-account MFA, the DriverApp integration link, and an accessibility audit — none of which are code defects.

*No commit or push was performed this stage. Git HEAD remains `6bfd2fc` with the Stage 5 fixes uncommitted in the working tree.*
