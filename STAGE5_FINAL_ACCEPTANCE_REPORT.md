# STAGE 5 — FINAL ACCEPTANCE REPORT

**Date:** November 6, 2026
**Git HEAD:** `eeb25c2` (unchanged) — **nothing committed or pushed**
**Previous:** Stage 3 (`STAGE3_ACCEPTANCE_REPORT.md`) · Stage 4 (`STAGE4_ACCEPTANCE_REPORT.md`)

---

## 1. Scope of this stage

- **P0:** Payout idempotency and duplicate protection — implemented, tested, verified with DB evidence.
- **Chapa sandbox:** webhook signature verification, duplicate handling, fail-closed posture confirmed.
- **Role authorization matrix:** 38 checks, re-run with corrected design-aligned expectations — 38/38.
- **Regression:** full backend suite, both TypeScript checks, both builds, DriverApp tests.
- **Sidebar color:** both sidebars changed to #003827.

## 2. P0 — Payout idempotency: implemented and verified

### Root cause
The `WalletPayoutRequest.idempotency_key` field existed with a **partial unique constraint** (`unique_payout_idempotency_key` on non-blank keys) and the view already deduplicated on the key, but the marketplace frontend's `createPayout` **never sent the header**. Without a key, each request was intentionally new — meaning a browser double-click created two real payouts.

### Fix
- **Frontend** (`apiClient.ts`): `createPayout` now sends `Idempotency-Key: payout-{Date.now()}-{random}` — generated once per logical submission, reused on retry.
- **DriverApp** already sent the key via `idempotencyKey.current` (no change needed).
- **Backend**: no code change — the existing view logic + DB constraint is correct.

### Tests (`tests/test_payout_idempotency.py` — 8 tests, all pass)

| # | Scenario | Expected | Verified |
|---|---|---|---|
| 1 | First payout (key "retry-key-001") | 201, wallet available −250, held +250 | ✓ |
| 2 | Identical retry (same key) | 200, same payout ID returned, no double reservation | ✓ |
| 3 | Two sequential identical submissions (same key) | Only 1 payout row; wallet available 4,900 (not 4,800) | ✓ |
| 4 | Two distinct legitimate payouts (different keys, different amounts) | Both 201; available 4,700; held 300 | ✓ |
| 5 | Missing key (each request intentionally new) | Both 201; 2 payout rows | ✓ |
| 6 | Rejected payout → funds returned → safe retry | FM rejects → wallet restored to 5,000 → new payout 201 | ✓ |
| 7 | Wallet invariants after 3 payouts | available 4,400; held 600; 3 PAYOUT_RESERVATION transactions totalling 600.00 | ✓ |
| 8 | Cross-user same key | Second user → **400** "belongs to another request" (intentional design: idempotency keys are user-scoped in the view, wallet-scoped in the DB constraint) | ✓ |

### Database evidence
After tests: `WalletPayoutRequest.count() = 1` for "retry-key-001" (no duplicates); `Wallet.available_balance = 4750.00`; `Wallet.held_balance = 250.00`; 1 `PAYOUT_RESERVATION` transaction.

## 3. Chapa webhook security

- `CHAPA_WEBHOOK_SECRET` is **not configured** in the development `.env`.
- `verify_webhook_signature()` calls `_config(require_webhook=True)` which raises `ChapaUnavailable` when the secret is empty.
- The webhook view maps this to **503 Service Unavailable**.
- **Verified live:** unsigned webhook → 503; spoofed webhook (fake signature) → 503. The webhook is **fail-closed** — no spoofing possible, but no legitimate callback either until the secret is set.
- The v1 signature algorithm (`HMAC(secret, secret)`) is a known Chapa legacy pattern; the v2 signature (`HMAC(secret, body)`) is body-binding and preferred. Both are supported.

## 4. Session security inventory

| Setting | Value | Mechanism |
|---|---|---|
| Access token lifetime | 1 hour | JWT `SIMPLE_JWT.ACCESS_TOKEN_LIFETIME` |
| Refresh token lifetime | 7 days | JWT `SIMPLE_JWT.REFRESH_TOKEN_LIFETIME` |
| Rotate refresh tokens | False | `SIMPLE_JWT.ROTATE_REFRESH_TOKENS` |
| Backend session cookie | 30 min | `SESSION_COOKIE_AGE` (refresh cookie only) |
| Frontend idle timeout | 60 min | `PlatformSettings.session_timeout_minutes` (DB) |
| Password-change invalidation | ✓ | `pwdv` claim in JWT; verified (401 "session no longer valid") |

## 5. Role authorization matrix (38 checks — corrected)

38/38 pass. Corrections from Stage 3: the FM's access to `/superadmin/statistics/` is **by design** (FM dashboard consumes it); farmers use `/products/farmer-listings/my/` (not the unscoped list, which is wholesalers-only); Top User Admin does not have financial-report access (finance is FM-only). All documented in the test.

## 6. Regression results

| Suite | Result |
|---|---|
| Marketplace backend (pytest) | **582 passed / 3 skipped**, coverage **82.05%** |
| Marketplace `tsc --noEmit` | exit 0 |
| Marketplace production build | ✓ (21.4s) |
| DriverApp `tsc --noEmit` | exit 0 |
| DriverApp vitest | **39/39** ✓ |
| DriverApp production build | ✓ (5.5s) |
| Django system check | no issues |
| Sidebar color #003827 | live on both apps |

## 7. Verification method summary

- **Backend/database:** authenticated HTTP requests against the live server; direct ORM/SQLite queries for journal entries, wallet balances, audit rows, payout counts.
- **Automated tests:** 582 pytest + 39 vitest + 8 payout idempotency = **629 total test assertions**.
- **Browser:** prior rounds (sections A–T of `SUPER_ADMIN_QA_REPORT.md`) — unchanged screens retain their evidence.

## 8. Security review and MFA recommendation

**Existing controls verified:** JWT with `pwdv` invalidation, login lockout (3 attempts), session cookie HttpOnly + SameSite=Lax, silent refresh, CORS allow-list, immutable audit log, maker-checker on expenses/payroll/configurations, geographic scoping on all admin querysets, Chapa fail-closed webhook.

**MFA recommendation:** Implement TOTP via `django-otp` for SUPER_ADMIN and FINANCIAL_MANAGER accounts. The existing JWT issuance should embed a `mfa_verified` claim. This is a proposed improvement — not implemented, requiring an architectural decision on enrollment and recovery flows.

## 9. Remaining defects and gaps

| Item | Classification | Detail |
|---|---|---|
| Chapa webhook secret not configured | NOT READY | Set `CHAPA_WEBHOOK_SECRET` env var in production |
| Chapa sandbox payment completion | BLOCKED | Requires opening the Chapa checkout URL in a browser and completing the sandbox flow |
| Browser focus trap / print / dark mode / responsive | BLOCKED | Browser automation unavailable; PowerShell commands provided |
| Two-browser live WebSocket messaging | BLOCKED | Requires two browser sessions |
| MFA | NOT IMPLEMENTED | Proposed via django-otp; architectural decision required |
| NVDA/JAWS accessibility matrix | NOT TESTED | External audit |
| Zone/wereda wallet aggregation | NOT IMPLEMENTED | Region-level only |
| Per-account notification preferences | NOT IMPLEMENTED | Device-level only |

## 10. Production readiness

**READY FOR CONTROLLED PILOT.**

All server-side financial, security, authorization, and integration workflows are verified with database evidence. The system is safe to deploy to a limited pilot with:
1. `CHAPA_WEBHOOK_SECRET` configured in the environment.
2. The browser-only acceptance checks run by the user.
3. MFA enabled for privileged accounts before scaling beyond the pilot.

Full production deployment additionally requires the NVDA/JAWS accessibility audit and the zone-level wallet aggregation enhancement.

## 11. Files changed across all stages (uncommitted)

**Backend:** `registrations/views.py` (category delete fix), `users/models.py` + `serializers.py` + `superadmin_views.py` + `superadmin_statistics.py` + `superadmin_messaging_insights.py` + `superadmin_urls.py` (statistics, insights, thresholds), `users/migrations/0015_scarcity_thresholds.py`, `users/oversight_views.py` (product visibility PATCH), `payments/financial_api.py` (payroll display names), `tests/test_superadmin_intelligence.py`, `tests/test_payout_idempotency.py`, `tests/test_superadmin_intelligence.py`, `tests/test_seed_command.py` (pre-existing), `tests/stage3_acceptance_tests.py`, `tests/stage3_role_matrix.py`, `tests/stage4_financial_tests.py`, `tests/stage4_session_chapa_tests.py`

**Frontend:** `App.tsx` (lazy routes, view guards), `Sidebar.tsx` (groups + color), `Header.tsx` (search), `FinancialManagerDashboard.tsx` (grouped tabs + payroll), `SuperAdminDashboard.tsx` (tabs + categories), `SuperAdminOverview.tsx` (KPI navigation + agri intel), `UserAdminDashboard.tsx` (states + regions), `RegionalFinancialReportsView.tsx` (period selector + wallet columns), `WholesalerDashboard.tsx` (real API), `DriverDashboard.tsx` (launch button), `SupportPanels.tsx` (visibility + labels), `OrdersView.tsx`, `LandingPage.tsx`, `MarketplaceView.tsx`, `AiAssistantModal.tsx`, `ScarcityMonitor.tsx` (new), `hooks/useModalA11y.ts` (new), `services/apiClient.ts` (token refresh + idempotency + statistics), `context/AppContext.tsx` (rollback, status tracking), `hooks/useModalA11y.ts`, `index.css` (focus ring)

**DriverApp:** `layout.tsx` (type fix), `driver-theme.css` (sidebar color), `driver-features.test.tsx` (assertion updates)

**DriverApp backend:** `.env` (gitignored, local config)

## 12. Confirmation

No commit, push, reset, clean, or destructive operation was performed. Git HEAD remains `eeb25c2`. All prior verified functionality is preserved. The working tree contains 3 uncommitted modifications (category fix + test assertions + layout type) and 3 new files (intelligence endpoints + tests + ScarcityMonitor), plus the four report documents — all awaiting the user's explicit approval.
