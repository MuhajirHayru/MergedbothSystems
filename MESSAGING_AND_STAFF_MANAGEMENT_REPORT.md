# GreenPath — Real-Time Messaging & Hierarchical Staff Management

Frontend implementation report. The Django backend remains the single source of
truth: no backend model, serializer, view, URL or business rule was added,
removed or modified for this work.

The live application is the Vite/React client (`src/main.tsx` → `src/App.tsx`,
`src/context/AppContext.tsx`, `src/services/apiClient.ts`). Everything below is
integrated into that client and its existing role dashboards.

---

## 1. Files created / modified

### Created

| File | Purpose |
|---|---|
| `src/lib/realtime.ts` | WebSocket base-URL resolution (`VITE_WS_URL` normalisation) and authenticated socket URL builder |
| `src/lib/chat.ts` | Types mirroring `ChatChannelSerializer` / `MessageSerializer`, plus preview, time, avatar and unread helpers |
| `src/lib/apiErrors.ts` | Shared DRF error formatter (surfaces backend validation text verbatim) |
| `src/context/MessagingContext.tsx` | Platform-wide conversation/unread state fed by `/chat/channels/` and the existing `/ws/notifications/` socket |
| `src/components/messaging/useChannelSocket.ts` | Per-channel socket (`/ws/chat/<id>/`) with reconnect, typing and read helpers |
| `src/components/messaging/MessagingWorkspace.tsx` | The messaging interface: conversation list, thread, composer, voice recording, partner picker, info panel |
| `src/components/staff/LocationPicker.tsx` | Region → Zone → Wereda → … cascade driven by `/registration/locations/?parent_id=` |
| `src/components/views/StaffManagementView.tsx` | Reusable, role-adaptive staff management page (stats, filters, table, create modal, detail/edit modal) |
| `scripts/verify-chat.mjs` | REST + WebSocket end-to-end verification of the messaging contract |
| `scripts/verify-ui.mjs` | Headless-Chrome DOM verification of the messaging and staff pages |
| `scripts/verify-nav.mjs` | Sidebar/nav and unread-badge verification for every role |
| `scripts/verify-staff-api.py` | Endpoint-level verification of the staff hierarchy, scopes and forbidden operations |
| `scripts/verify-staff-create-ui.mjs` | Browser-driven staff creation → persistence → list refresh verification |

### Modified

| File | Change |
|---|---|
| `src/components/views/MessagingView.tsx` | Replaced the minimal channel list with the real-time workspace wrapper (supports `?with=<id>`) |
| `src/components/layout/Sidebar.tsx` | Messaging navigation on every role, live unread badge from the backend, Staff Management entries for authorised admins |
| `src/App.tsx` | `MessagingProvider` mounted, `/staff` route + `staff_management` view, deep-link sync fix |
| `src/services/apiClient.ts` | Added `chat.staffRecipients`, `chat.voiceMessageAudio`, `superadmin.creationOptions`, `superadmin.account`, `superadmin.updateAccount`, `superadmin.deleteAccount` |

No existing dashboard, page, order, wallet, registration or marketplace
component was removed or restructured.

---

## 2. Messaging

### Sidebar coverage

| Role | Sidebar item | Unread badge |
|---|---|---|
| Farmer | Messages | live |
| Wholesaler | Messages | live |
| Retailer | Messages | live |
| Driver | Messages | live (see gap G1) |
| User Admin | Messages | live |
| Top User Admin (top-level `USER_ADMIN`) | Messages | live |
| Super Admin | Messages | live |
| Financial Manager | Messages | live |

The badge is the sum of `unread_count` across the caller's channels, refreshed
when the server pushes a `MESSAGE` notification — not by polling. An incoming
message also re-marks the open thread as read and refreshes the list.

### Real-time transport (reused, not rebuilt)

| Concern | Existing backend | Frontend |
|---|---|---|
| Message fan-out | Django Channels `ChatConsumer` at `/ws/chat/<channelID>/?token=<JWT>` | `useChannelSocket` connects per open conversation |
| New-message alerts / badge | `NotificationConsumer` at `/ws/notifications/?token=<JWT>` (`notify()` fans out the `MESSAGE` type) | `MessagingProvider` refreshes channel metadata on `notify.event` |
| Socket auth | `users.middleware.JWTAuthMiddleware` read the `?token=` query parameter | token read from `greenpath_auth_token`, URL-encoded |
| Reconnect | consumer rejects with 4401/4403/4404 for auth/permission failures | exponential backoff (1 s → 15 s), stops on those codes, re-syncs on reconnect and on tab focus |
| Typing | `{"action":"typing"}` → `chat.typing` | debounced send, 4 s display timeout |
| Read state | `mark-read/` endpoint and `{"action":"read"}` | called on open and on incoming message |
| History | `GET /chat/channels/<id>/messages/` (paginated, oldest-first) | loads the last page when the thread exceeds one page |

`VITE_WS_URL` is normalised (`http(s)` → `ws(s)`, `/api/v1` stripped). Django's
`AllowedHostsOriginValidator` requires a browser `Origin` header, which browsers
send automatically.

### Interface

Conversation search, previews, per-thread unread counts, grouped-by-day history,
sent/received bubbles, timestamps, Sent/Read ticks, typing indicator, text
composer (Enter to send, Shift+Enter newline), voice recording (MediaRecorder,
2-minute cap, moderation-aware playback through the private audio endpoint),
conversation information panel, loading skeletons, empty and error states, and a
mobile list ↔ thread toggle. Disabled/failed operations show the backend's own
message; nothing reports success before the API confirms it.

Privacy is enforced by the backend (`greenpath.privacy`, `chat.access`); the UI
displays the rejection verbatim and never renders contact details that the API
withholds.

### Composer partner search

* Staff roles use the existing `GET /chat/staff-recipients/?search=` endpoint,
  which already applies `can_communicate` and administrator scoping.
* Marketplace roles have no permitted-recipient endpoint (gap G2). Their picker
  therefore lists the counterparties of their existing orders
  (`GET /orders/`), which is exactly the relationship set `can_communicate`
  permits, with client-side name filtering.

---

## 3. Staff management

### Where it appears

| Sidebar | Entry | Backend gate |
|---|---|---|
| User Admin | Staff Management | `GET/POST /superadmin/accounts/` (`IsUserAdmin`) |
| Super Admin | Staff Management | same |
| Top User Admin (top-level User Admin) | Administrative Users | same, GLOBAL scope |
| Financial Manager | — (not shown) | API returns 403; direct `/staff` visit shows the permission message |
| Farmer / Wholesaler / Retailer / Driver | — | no access |

### Hierarchy as the backend actually models it

The backend has one administrative role (`USER_ADMIN`) plus
`AdministratorScope` (GLOBAL or a location). The user-facing titles are derived
from the scope, exactly as `AdminAccountSerializer.get_scope_label` does:

| UI title | Backend representation | May create (from `allowed_staff_scope_types`) |
|---|---|---|
| Top User Admin | `USER_ADMIN` + GLOBAL scope | any location scope below the selected level; Super Admin only may create GLOBAL |
| Regional Admin | `USER_ADMIN` + REGION scope | CITY/ZONAL/WOREDA/SUBCITY/DISTRICT/ADMIN_DIVISION within the region |
| Zonal Admin | `USER_ADMIN` + ZONE scope | WOREDA/… inside the zone |
| Wereda Admin | `USER_ADMIN` + WOREDA scope | child locations inside the wereda |
| Financial Manager | `FINANCIAL_MANAGER` | Super Admin only |

No permission is inferred in the frontend: creation options come from
`/superadmin/accounts/creation-options/`, the manageable list from
`manageable_admins_for`, and assignment legality from `can_assign_admin_scope`.
A denied operation is shown with the backend's message.

### Page capabilities

Backend-derived counters (staff in scope, active, suspended, pending, User Admin
count, Financial Manager count — each from a filtered request's `count`), search
by name/email/phone, filters by role, administrator level, account status and
geographic scope, paginated table, detail modal, edit modal (name, phone,
location label, temporary password reset, scope relocation), and
activate/suspend actions. Geography uses
`GET /registration/locations/?parent_id=` — no hardcoded Ethiopian lists.

`DELETE /superadmin/accounts/{id}/` deactivates rather than deletes, so the UI
exposes suspend/activate instead of a destructive delete.

---

## 4. Verification (real backend, real data)

| Suite | Command | Result |
|---|---|---|
| Chat REST + WebSocket | `node scripts/verify-chat.mjs` | **11/11** |
| Staff hierarchy & scopes | `python scripts/verify-staff-api.py` | **21/21** |
| Messaging + staff DOM | `node scripts/verify-ui.mjs <farmerToken> <adminToken>` | **17/17** |
| Sidebars & badges, all roles | `node scripts/verify-nav.mjs <tokens.json>` | **26/26** |
| Create staff through the UI | `node scripts/verify-staff-create-ui.mjs <adminToken>` | **9/9** |
| TypeScript | `npx tsc --noEmit` | pass |
| Production bundle | `npx vite build` | pass |

Highlights proven against the running Django server and database:

* live delivery to the recipient and echo to the sender over `/ws/chat/`, typing
  fan-out, persisted history, read receipts, unread counts, 404 for a
  non-participant;
* the sidebar badge moves from 0 to 1 when a message arrives while another page
  is open, and equals the backend total for every role;
* a User Admin created a real `USER_ADMIN` at `Addis Ababa → Region 14 → Addis
  Ketema Sub City` through the modal; the backend returned `Sub-city Admin`, the
  row appeared in the refreshed list, and the record was removed afterwards;
* a Zonal Admin (South Wello) created a Woreda admin inside the zone and was
  rejected (400) for a woreda outside it; the same admin was refused top-level
  and Financial Manager creation by the backend;
* a Financial Manager receives 403 from the staff API and sees the permission
  message on `/staff`;
* a voice upload reached `202 Pending review` (the backend queues audio when
  transcription is unavailable) and the UI renders “Awaiting moderation”.

Test accounts created during verification were purged; no product data was
altered.

---

## 5. Missing or partial backend capabilities (approval required)

Nothing below was implemented or stubbed in the frontend.

**G1 — Driver messaging is not authorised by the backend.** `chat.access.ALLOWED_COUNTERPARTIES`
has no `DRIVER` entry, so `can_communicate()` is always false for a driver:
channels cannot be created and `can_access_channel()` fails even if a Super Admin
adds a driver to one. The sidebar shows Messages for drivers, and the page states
that driver messaging is not yet authorised instead of faking a conversation.
Proposed: add a `Role.DRIVER` counterparty set (e.g. order counterparties plus
dispatch administrators) in `chat/access.py`.

**G2 — No permitted-recipient search for marketplace roles.**
`GET /chat/staff-recipients/` is staff-only. Suggested endpoint:
`GET /api/v1/chat/recipients/?search=<q>` → `{"results":[{"id","full_name","role","role_display","location","scope"}]}`,
filtered through `can_communicate`. Until then the picker uses order
counterparties, so a farmer cannot start a brand-new conversation with a
wholesaler they have never traded with.

**G3 — File attachments are not supported.** `MessageKind` is `TEXT | VOICE`;
`MessageSerializer` accepts `audio` only. The composer therefore offers text and
voice, with no attachment button. Proposed: `kind=FILE` with size/type limits and
private storage, mirroring the existing voice pipeline.

**G4 — Conversations are strictly one-to-one.** `ChatChannelViewSet.create`
rejects more than one participant. Group/administrative broadcast conversations
are not supported; broadcast exists only as
`POST /admin/messages/` (notification fan-out, not a thread).

**G5 — Read state is a single per-message boolean.** There is no per-recipient
delivery/read record, so ticks are “Sent” / “Read”, which is accurate for 1:1
threads. Multi-recipient conversation receipts would need a join model.

**G6 — No staff invitation flow.** `AdminAccountSerializer` requires a
`password` on create; the UI asks the administrator for a temporary password.
An email/one-time-link invitation endpoint does not exist.

**G7 — No aggregate staff statistics endpoint.** Counters are computed from the
paginated list's `count` for each filter (six lightweight requests). A dedicated
`GET /superadmin/accounts/stats/` would reduce that to one.

**Pre-existing, not changed:** `src/components/common/NotificationsDropdown.tsx`
renders static sample notifications and does not consume
`/api/v1/notifications/`. It is outside this task's scope but is the next obvious
place to reuse the same notification socket.

---

## 6. Stability fixes made after the first delivery

Reported symptoms: the app sometimes hung on a blank page, and signing out then
signing in with another account kept showing the previous account.

| Cause | Fix |
|---|---|
| `apiClient` awaited its own refresh promise when `/auth/token/refresh/` itself returned 401, so `/auth/me/` never settled and `authLoading` stayed true forever (endless blank screen, most visible with an expired token) | The refresh/login endpoints are excluded from the refresh retry, the promise is cleared in `finally`, and tokens are dropped when refresh fails |
| `Sidebar` and `Header` read `currentUser.role.replace(...)` before a profile existed, throwing and unmounting the whole React tree | Defensive fallbacks in both, plus the shell only renders for an authenticated session and protected views fall back to the login page while the session is unconfirmed |
| The three “Sign Out” buttons only switched the local role back to `public` — the JWT stayed in `localStorage`, so reloading restored the old user | Sidebar footer, header menu and Settings now call the real `logout()` (API logout, token + registration token removal, all cached role data cleared) |
| Switching accounts in one browser reused the previous account's cached products/orders/wallet/conversations because role data was only reloaded when the *role* changed | `syncAuthUser` detects a different user id and clears the cached state before loading the new account; the login form also clears stale tokens and no longer ships prefilled demo credentials |

Measured after the fixes: a direct link with an expired token reaches the login
page in ~0.7 s (previously never), public landing renders in ~1.2 s and the
authenticated dashboard in ~0.7 s on the local dev server.

## 7. Running the checks

```bash
# backend
cd "TheWholeDashboards here/backend" && python manage.py runserver 0.0.0.0:8000

# frontend
cd greenpath-farm-to-market-ai && npm run dev          # http://localhost:3000

# verification
node scripts/verify-chat.mjs
cd "../TheWholeDashboards here/backend" && python ../../greenpath-farm-to-market-ai/scripts/verify-staff-api.py
cd ../../greenpath-farm-to-market-ai && npx tsc --noEmit && npx vite build
```

The DOM suites need Chrome started with `--remote-debugging-port=9333` and a JWT
for the relevant role; see each script's header for arguments.
