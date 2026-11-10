# REMAINING BACKEND REQUIREMENTS — Green Path Systems

Requirements that **cannot** be completed with existing backend capabilities. Each includes the gap, the recommended minimal change, and the security considerations. No frontend simulation has been built for any of these.

---

## 1. Zone/Wereda-level wallet and verified-wholesaler aggregation

- **Required behavior:** Wallet balances, wallet owners, funding requests, and verified-wholesaler counts broken down by Zone and Wereda (currently region-level only in `/superadmin/statistics/`).
- **Why insufficient:** `superadmin_statistics.py` resolves each user's primary region from the registration hierarchy but does not traverse zone/wereda for wallet grouping.
- **Existing models:** `registrations.AdministrativeLocation` (hierarchy), `payments.Wallet`, `registrations.Registration`.
- **Recommended minimal change:** extend the statistics regional rows with `zones: [{zone, walletOwners, verifiedWholesalers, available, held}]` using one additional `values()` pass over registration hierarchy joins — same no-N+1 pattern.
- **Security:** unchanged — super admin/financial manager only; scoped admins already excluded.
- **Tests:** extend `test_superadmin_intelligence.py` with zone-level assertions.

## 2. Kebele reference-data completeness

- **Required behavior:** Kebele drill-down with real data.
- **Why insufficient:** the drill-down API supports kebele recursion, but the `AdministrativeLocation` reference dataset has few/no kebele children under the tested weredas — a **data** gap, not code.
- **Recommended change:** import the complete EA administrative dataset into `AdministrativeLocation` (existing import tooling in `registrations` accepts versioned source files).
- **Security:** none — reference data.

## 3. Per-account notification preferences

- **Required behavior:** users' channel preferences stored server-side per account.
- **Why insufficient:** preferences currently persist per device (localStorage) — no model.
- **Existing models:** `users.User`.
- **Recommended minimal change:** `UserNotificationPreference(user FK, orders, payments, messages, sms)` + GET/PATCH under `/auth/` + frontend to hydrate from it.
- **Security:** owner-only access (`IsAuthenticated` + `self`).

## 4. Audit-log retention policy

- **Required behavior:** configurable retention for `users.AuditLog` (append-only today, unbounded growth).
- **Recommended minimal change:** a dated management command archiving rows older than N months to an export table/file; do NOT enable deletes on the live table without an export.
- **Security:** deletion must itself be audited; super-admin-only.

## 5. Per-category scarcity thresholds

- **Required behavior:** different scarcity rules per product category.
- **Why insufficient:** current persisted thresholds (`PlatformSettings.scarcity_critical_sellers/low_sellers`) are platform-global.
- **Recommended minimal change:** `ScarcityCategoryThreshold(category FK unique, critical, low)` + inline update in the existing settings serializer flow.
- **Security:** super-admin only.

## 6. MFA (multi-factor authentication)

- **Required behavior:** second factor for privileged roles.
- **Why insufficient:** no MFA model or flow exists; introducing one touches login, lockout, and token issuance.
- **Recommended approach:** TOTP via `django-otp` (established, compatible with JWT issuance), enforced for SUPER_ADMIN/FINANCIAL_MANAGER first. Requires an explicit architectural decision before implementation — deliberately not built in this pass.

## 7. Delivery failure / undelivered message telemetry

- **Required behavior:** messaging insights list failed/undelivered messages.
- **Why insufficient:** the chat `Message` model has no delivery-ack field; WebSocket acks are not persisted.
- **Recommended minimal change:** `Message.delivery_state` (sent/delivered/read/failed) updated by the existing consumers, surfaced in `messaging-insights`.

## 8. Chat participant ↔ region linkage

- **Required behavior:** message activity by region.
- **Why insufficient:** chat participants are not consistently linked to administrative locations (free-text at registration).
- **Recommended change:** derive region from each participant's registration during insight aggregation, with an explicit "unresolved region" bucket — currently the endpoint honestly lists this as unavailable.

## 9. Harvest recommendation engine (AI)

- **Required behavior:** genuine harvest/pricing recommendations.
- **Why insufficient:** the assistant (Groq-backed) answers questions but no recommendation engine exists; hardcoded slices were removed rather than relabeled.
- **Recommended approach:** a real model requires historical price/harvest data collection first — a data-engineering prerequisite, not a code patch. Until then the UI must not present any recommendation as AI-generated.

---

*All other audited requirements are implemented and verified per `GREEN_PATH_REMEDIATION_REPORT.md` and the QA tables. No item above has been simulated in the frontend.*
