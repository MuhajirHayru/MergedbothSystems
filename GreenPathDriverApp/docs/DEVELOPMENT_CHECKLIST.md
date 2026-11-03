# Development Checklist

## Phase 1 — Workspace and foundation

- [x] Inspect workspace; isolate the application under `Greenpathdriverapp/`.
- [x] Scaffold Next.js, TypeScript, Tailwind CSS, and Django REST Framework.
- [x] Add environment-based development and production settings.
- [x] Add SQLite local default and PostgreSQL URL support.
- [x] Add initial identity, settings, and audit-event models.
- [x] Add database-backed health endpoint and API documentation routes.
- [x] Add a role-neutral operations shell that reports actual API health.
- [x] Generate and apply migrations; run backend checks and tests.
- [x] Run frontend lint, typecheck, and production build.
- [x] Verify frontend and backend startup in the local environment.

## Phase 2 — Authentication, access, and driver onboarding

- [x] Preserve the migrated custom `LogisticsUser`; add explicit role/admin-scope and email-verification fields.
- [x] Add CSRF-protected session login/logout, current user, driver-only registration, activation, password reset, timeout, and throttles.
- [x] Add role- and geographic-scope-enforced application APIs; deny self-review and keep financial access separate.
- [x] Add driver profile/application draft, submission validation, reviewer decisions/history, suspension, and credential expiration.
- [x] Add private document storage, size/type/signature validation, replacement history, private authorized downloads, and one-way verification.
- [x] Add role-aware driver/reviewer interfaces, login, activation, recovery, loading/error/empty states, and pagination.
- [x] Document API contract, role matrix, environment settings, and future marketplace integration boundary.
- [x] Run the backend suite (23 tests), Django checks, migration-drift checks, four frontend component tests, lint/typecheck/build, and live API/UI checks.

Known limits: no verified geographic hierarchy, SMTP was not exercised against a provider, cloud private storage is configurable but untested, and shipment/financial workflows remain Phase 3+.

Exact next step after Phase 2 validation: implement Phase 3 shipment eligibility, fee quotes/agreements, matching/offers, and concurrency-safe assignment.