# Phase 2 API and Permissions

All paths below are prefixed with `/api`. Session-authenticated unsafe requests require a valid CSRF token. `GET /auth/csrf/` returns a token and sets the CSRF cookie. Sessions are HTTP-only, expire after 30 minutes, and are revoked on logout. No browser local storage is used for credentials.

## Permission matrix

| Role | Identity | Driver application | Driver documents | Review queue and decisions | Financial records |
| --- | --- | --- | --- | --- | --- |
| Driver | Own profile only | Read/edit own draft or requested changes; submit own application | Upload, replace, and download own documents | Denied | Denied |
| Farmer | Own profile only | Denied | Denied | Denied | Denied |
| Wholesaler | Own profile only | Denied | Denied | Denied | Denied |
| Retailer | Own profile only | Denied | Denied | Denied | Denied |
| Financial Manager | Own profile only | Denied | Denied | Denied | Not implemented in Phase 2 |
| Super Admin | Own profile only | No driver self-review | In-scope documents only | All applications; cannot review own application | Not implemented in Phase 2 |
| Top User Admin | Own profile only | No driver self-review | In-scope documents only | All applications; cannot review own application | Not implemented in Phase 2 |
| Regional Admin | Own profile only | No driver self-review | Matching region only | Matching region only | Not implemented in Phase 2 |
| Zonal Admin | Own profile only | No driver self-review | Matching region and zone only | Matching region and zone only | Not implemented in Phase 2 |
| Wereda Admin | Own profile only | No driver self-review | Matching region, zone, and wereda only | Matching region, zone, and wereda only | Not implemented in Phase 2 |
| Legacy Administrator | Own profile only | Denied | Denied | Denied | Denied |

Regional scope is an exact match against application service-area strings. Zone and wereda reviewers must have every parent scope configured; missing scope returns an empty queue and denies object access. A verified geographic hierarchy and its codes are not assumed to exist yet. Reviewer roles are not Django superusers. Initial or changed privileged logistics roles and scope values can be assigned only by an existing Django superuser through Django admin; those assignments create audit records. Ordinary API registration always creates a pending driver account and ignores client-supplied role fields.

## Authentication endpoints

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /auth/csrf/` | Public | Initialize CSRF cookie and return request token |
| `POST /auth/register/` | Public, throttled | Create inactive driver account, profile, and draft application |
| `POST /auth/activate/` | Public, throttled | Consume one-time activation token; activate account and establish session |
| `POST /auth/login/` | Public, throttled | Accept username or email and password; inactive accounts are denied |
| `POST /auth/logout/` | Authenticated | Revoke current session |
| `GET /auth/me/` | Authenticated | Return current user's safe profile fields |
| `POST /auth/password-reset/` | Public, throttled | Generic response to avoid account enumeration; send a one-time reset link |
| `POST /auth/password-reset/confirm/` | Public, throttled | Validate one-time token and set a password using Django's password hashers |

Development mode returns activation/reset tokens to the local client for testing; production never does. Production activation and recovery email require SMTP configuration. Password reset and activation tokens use Django's one-time token generator and the configured one-hour timeout.

## Driver endpoints

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /drivers/me/application/` | Driver | Read only the caller's application, documents' metadata, and review history |
| `PATCH /drivers/me/application/` | Driver | Edit allowed details only while draft or additional information is required |
| `POST /drivers/me/application/submit/` | Driver | Validate configured required fields, unexpired license, positive capacity, and required documents; record submission and audit event |
| `POST /drivers/me/application/documents/` | Driver, throttled | Upload or replace one configured document type |
| `GET /driver-documents/{id}/download/` | Owner or in-scope reviewer | Download as attachment with `application/octet-stream`, `nosniff`, and `no-store`; unauthorized object lookups return 404 |

## Reviewer endpoints

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /admin/driver-applications/` | Active reviewer | Scoped, paginated list; optional `status`, `search`, `page`, and `page_size` |
| `GET /admin/driver-applications/{id}/` | Active in-scope reviewer | Read application and decision history |
| `POST /admin/driver-applications/{id}/review/` | Active in-scope reviewer | Apply a valid transition with a required reason; self-review is denied |
| `POST /admin/driver-documents/{id}/verify/` | Active in-scope reviewer | Verify/reject a pending document with a required reason; decision is one-way |

## State and audit rules

- Driver states are `draft`, `submitted`, `under_review`, `additional_info_required`, `approved`, `rejected`, `suspended`, and `expired`.
- Driver submission is permitted only from draft or additional-information-required. Reviewers cannot skip from submitted directly to approved; approval requires under-review, verified required documents, and an unexpired license.
- A reviewer cannot decide on their own application. Suspension deactivates login. Reinstatement moves the application to under-review and reactivates the account; it does not auto-approve.
- Application review history is append-only through the application API. Audit events are read-only in Django admin and have no ordinary API endpoint.
- Audit payloads exclude passwords, session/CSRF/reset tokens, document bytes, and identity-document contents.
- Uploads enforce configured size, extension, and PDF/PNG/JPEG magic-byte checks; names are server-generated. The private storage root is outside frontend assets and has no public media route.
- Required application fields, document types, required document types, and maximum file size can be configured through audited `SystemSetting` records (with environment defaults). Geographic fields remain free-form until verified hierarchy data is provided.
- `python manage.py expire_driver_applications` expires approved accounts with expired licenses/current documents and records history/audit events. Schedule it operationally when a scheduler is selected.

## Phase 3 shipment permissions

| Role | Shipment access |
| --- | --- |
| Wholesaler or retailer | Create delivery requests and read, negotiate, cancel, dispute, message, and confirm delivery only for their own requests |
| Driver | Read offers returned by server-side eligibility checks; accept, decline, or counter-propose for that offer; read and progress only assigned shipments |
| Farmer | No browser shipment API access; can be bound as seller only through a trusted marketplace integration event |
| Financial manager | Denied; this app defines no financial action permission or payment-provider integration |
| Regional/zonal/wereda admins and legacy administrator | Denied; driver-review scope is not shipment scope |
| Super Admin / Top User Admin | No ordinary shipment endpoint access; any later administrative exception needs a separately scoped and audited permission |

Every browser-facing shipment endpoint requires the existing authenticated session; unsafe browser requests continue to require CSRF. The separately documented `/integrations/v1/` endpoints use HMAC service authentication and do not use browser sessions. Shipment and evidence lookups for unrelated users return 404. Exact pickup/destination addresses and evidence metadata are returned only to the requesting buyer or the assigned driver; the offer response contains only coarse regions, cargo summary, weight, handling requirements, fee, and expiration. Driver contact details are not serialized. Free-form messages are enabled only after assignment; before assignment, offer threads contain only generated fee-proposal events.

## Phase 3 endpoints

All paths are prefixed with `/api`.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /shipments/` | Active buyer or driver | List only the caller's requests or assigned shipments |
| `POST /shipments/` | Active wholesaler or retailer | Record an external-order delivery request and buyer fee proposal |
| `GET /shipments/{id}/` | Requesting buyer or assigned driver | Read permitted shipment fields, fee history, progress, exceptions, and evidence metadata |
| `GET /drivers/me/shipment-offers/` | Active driver | List unexpired offers for eligible, verified orders |
| `POST /shipments/{id}/offers/refresh/` | Owning buyer | Add newly eligible drivers to a verified, unassigned shipment |
| `POST /shipments/{id}/offers/{offer_id}/accept/` | Offered driver | Explicitly accept the buyer's fee and atomically agree/assign |
| `POST /shipments/{id}/offers/{offer_id}/decline/` | Offered driver | Decline with a required reason |
| `POST /shipments/{id}/offers/{offer_id}/fee-counterproposal/` | Offered driver | Persist a counterproposal and a scoped fee-history message |
| `POST /shipments/{id}/fee-proposals/` | Owning buyer | Submit a new fee proposal version before assignment |
| `POST /shipments/{id}/fee-proposals/{proposal_id}/accept/` | Owning buyer | Accept a driver's counterproposal and atomically assign that driver |
| `POST /shipments/{id}/fee-proposals/{proposal_id}/reject/` | Owning buyer | Reject that driver's pending counterproposal with a required reason |
| `POST /shipments/{id}/status/` | Assigned driver | Prepare for pickup, report pickup arrival, confirm pickup, enter transit, report failed attempt, or request buyer delivery confirmation |
| `POST /shipments/{id}/evidence/` | Assigned driver | Upload private PDF/PNG/JPEG pickup, failed-attempt, or delivery-confirmation evidence |
| `GET /shipments/{id}/evidence/{evidence_id}/` | Buyer or assigned driver | Download evidence as a private attachment |
| `POST /shipments/{id}/confirm-delivery/` | Owning buyer | Confirm receipt only after the driver requests confirmation of successful delivery |
| `POST /shipments/{id}/delivery-problem/` | Owning buyer | Report a problem with a pending delivery confirmation and enter dispute |
| `POST /shipments/{id}/reschedule/` | Owning buyer or assigned driver | Record a failed-delivery reschedule and return that shipment to transit |
| `POST /shipments/{id}/cancel/` | Owning buyer | Cancel an unassigned request with a required reason |
| `POST /shipments/{id}/dispute/` | Buyer or assigned driver | Record a reasoned dispute; does not alter payment status |
| `POST /shipments/{id}/exceptions/` | Buyer or assigned driver | Record a reasoned delay, incident, or failed-delivery exception |
| `GET /shipments/{id}/messages/` | Buyer, assigned driver, or offered driver | Read only the caller's authorized thread; paginated (50 by default, 100 maximum) |
| `POST /shipments/{id}/messages/` | Buyer or assigned driver | Send shipment-specific free-form messages after assignment |
| `GET /shipments/notifications/` | Authenticated active user | List only notifications addressed to the caller |
| `POST /shipments/notifications/{notification_id}/read/` | Notification recipient | Mark only the caller's notification as read |

The response schemas use explicit serializer field lists. There is no endpoint that allows a browser to set order verification, assignment, fee agreement, shipment status, or payment status directly.

Fee responses include a proposal `id` and `version`. Driver acceptance posts both `proposal_id` and `version` to the offer's `/accept/` route. Buyer acceptance posts `version` to the specific counterproposal `/accept/` route; rejection posts `version` and a non-empty `reason`. Creating a replacement buyer proposal posts `amount` and `currency` to `/shipments/{id}/fee-proposals/`. Stale proposal versions return HTTP 409. Fee creation, acceptance, rejection, assignment, and offer withdrawal decisions are recorded in the existing audit trail.

## Marketplace-order authorization boundary

An unverified browser-created request with an unknown external order reference remains `requested`, with `order_verified=false`; it is visible only to its buyer and creates no driver offers. Driver offers and fee agreement/assignment require a positive authorization bound to active, role-matched buyer and seller accounts. The legacy internal `logistics.shipment_services.authorize_marketplace_order(...)` helper remains for trusted in-process use; it is not exposed as a browser API.

The v1 server-to-server contract below is implemented but disabled by default. Its field names and identity mapping are proposed integration assumptions, not a claim about the actual marketplace API. The marketplace must confirm its order status model, stable external IDs, participant role values, delivery requirement fields, fee semantics, payment status and reference, monotonically increasing revision source, and event lifecycle before connecting. Integration events must be generated server-side by the marketplace; values submitted directly by a browser are not trusted.

## Phase 3D marketplace integration contract

### Architecture and ownership

- The marketplace remains the source of truth for marketplace order identity, buyer/seller association, order authorization/cancellation, Chapa, payment verification, wallets, escrow, refunds, payouts, and financial ledgers. This application has no Chapa client, checkout, wallet, or financial mutation endpoint.
- `MarketplaceOrderAuthorization` binds `external_order_reference` to locally mapped, active `LogisticsUser.external_user_id` accounts and roles. Those mappings must be provisioned by an approved server-side/admin process; the integration payload cannot create users or change their roles/mappings.
- A trusted `order.authorized` event can create a shipment, or reconcile a matching unverified buyer request still in `requested`. It imports shipment requirements and creates a buyer fee proposal; it does **not** agree the fee. If negotiation or assignment has progressed, changed order details are rejected rather than silently rewriting driver commitments.
- Marketplace cancellation is accepted only when the existing state machine permits pre-assignment cancellation. Assigned or later shipments must use the participant workflow; the integration cannot reverse a shipment transition.
- Signed payment events update only the shipment's `payment_status`, `payment_status_updated_at`, and private `marketplace_payment_reference`. The reference is not serialized to browser users. Payment status is not derived from fee agreement, driver action, delivery, or browser input. Missing/unverified status remains `unavailable`.
- The integration event inbox stores unique event IDs, canonical payload hashes, revisions, and the final response. New verified shipment transitions and exceptions are stored in a local outbox-style event table for authenticated cursor polling. Outbound events omit addresses, phone numbers, email addresses, free-form reasons, message text, and payment references.
- No automatic outbound HTTP call, paid broker, GPS provider, payment call, escrow release, refund, or transfer is performed by this contract.

### Endpoints

All paths are prefixed by `/api`.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /integrations/v1/orders/events/` | HMAC-authenticated marketplace service | Accept an authorized-order, order-cancellation, or payment-status event |
| `GET /integrations/v1/shipment-events/?after_id={cursor}&limit={n}` | HMAC-authenticated marketplace service | Poll privacy-limited shipment events after a persisted cursor (`limit` 1-100, default 50) |

These endpoints do not use browser session authentication or CSRF. They are unavailable with HTTP 503 unless `MARKETPLACE_INTEGRATION_ENABLED=true` and a shared secret of at least 32 characters is configured. They are rate limited to 60 requests/minute per client IP by Django REST Framework. Production must also apply an appropriate shared-cache or gateway rate limit because Django's local-memory cache is not shared between workers. The event endpoint's default request body limit is 256 KiB (`MARKETPLACE_INTEGRATION_MAX_BYTES`); place a matching or smaller limit at the reverse proxy.

### HMAC request authentication

Every request includes:

- `X-GP-Integration-Timestamp`: Unix timestamp in seconds, within `MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS` (default 300 seconds).
- `X-GP-Integration-Request-ID`: unique caller request ID, at most 128 characters. For POST, this **must equal** the body `event_id`.
- `X-GP-Integration-Signature`: `sha256=` followed by a lowercase hex HMAC-SHA256 digest.

The signed bytes are exactly:

```text
timestamp + "\n" + request_id + "\n" + UPPERCASE_METHOD + "\n" + request_path_and_query + "\n" + raw_request_body
```

The final newline before the raw body is included. The shared key is read only from `MARKETPLACE_INTEGRATION_SECRET`; it is never returned or logged. Use TLS in deployment. Rotate the key through a coordinated deployment cutover, stop/restart the integration sender as necessary, allow old signed requests to expire, and confirm both sides use the new key before re-enabling traffic. Do not place the key in frontend variables, browser requests, source control, or logs.

### Inbound event schema

The JSON envelope is strict (unknown fields are rejected):

```json
{
  "contract_version": "1",
  "event_id": "unique-marketplace-event-id",
  "event_type": "order.authorized",
  "occurred_at": "2026-10-17T10:30:00Z",
  "revision": 1,
  "order": {
    "id": "unique-marketplace-order-id",
    "status": "authorized",
    "buyer": {"external_user_id": "marketplace-buyer-id", "role": "wholesaler"},
    "seller": {"external_user_id": "marketplace-seller-id", "role": "farmer"},
    "shipment": {
      "pickup_region": "North",
      "pickup_zone": "Highland",
      "pickup_wereda": "Market Wereda",
      "pickup_address": "Private pickup address",
      "destination_region": "North",
      "destination_zone": "Highland",
      "destination_wereda": "Market Wereda",
      "destination_address": "Private destination address",
      "product_summary": "Order summary",
      "cargo_weight_kg": "100.00",
      "handling_requirements": "Keep upright",
      "estimated_pickup_at": "2026-10-18T08:00:00+03:00",
      "estimated_delivery_at": "2026-10-18T12:00:00+03:00"
    },
    "delivery_fee": {"amount": "250.00", "currency": "ETB"},
    "payment": {"status": "pending", "reference": "marketplace-payment-reference"}
  }
}
```

`shipment` and `delivery_fee` are required only for `order.authorized`; `payment` is optional there. `order.cancelled` requires `status: "cancelled"` and a non-empty `cancellation_reason`. `payment.status_changed` requires `status: "authorized"` plus `payment`. Payment status is one of `pending`, `paid`, `failed`, or `disputed`; the app does not accept `unavailable` or browser-supplied payment status. Shipment currency is currently limited to `ETB`. Event and estimate timestamps must be ISO-8601 with an explicit offset; an event timestamp cannot be in the future.

Buyer roles are `wholesaler` or `retailer`; seller roles are `farmer`, `wholesaler`, or `retailer`. Both references must match distinct active local accounts and the exact role in `external_user_id` mapping. The signed event is the evidence of marketplace-side validation; this app cannot independently verify the marketplace order. Do not send contact/location fields beyond the shipment information required for logistics.

### Idempotency, ordering, and errors

- `event_id` is unique. Repeating the same event with the same canonical JSON payload returns the stored HTTP status/body without creating another shipment, proposal, assignment, or outbox record. JSON whitespace and key order do not affect the canonical payload hash. Reusing an ID with different data returns HTTP 409.
- `revision` must strictly increase per external order across **all** event types. Replayed or out-of-order revisions return HTTP 409 and do not modify authorization, shipment, or payment state. A later correction uses a new event ID and a higher revision.
- Signature timestamp limits replay window; event ID/revision checks provide durable replay protection after that window. Invalid auth attempts are audited by category only (never body, signature, key, or address).
- Successful POST response includes event ID, order reference, local shipment ID/status, authorization/fee/payment status, and offer count as applicable; it does not include private addresses or contacts.
- HTTP 400: malformed JSON/schema, unsupported currency/payment state, invalid transition data, or oversized body. HTTP 401: missing/invalid signature or stale signature timestamp. HTTP 403: participant identity/role mismatch. HTTP 409: reused event ID with different data, stale revision, participant/order conflict, or cancellation blocked by shipment progression. HTTP 413 may be returned by a configured upstream proxy for oversized requests. HTTP 429: rate limit. HTTP 503: integration disabled or secret not configured.
- For timeout, connection reset, or 5xx, retry the exact event ID and payload with a fresh timestamp/signature; the database transaction either commits the stored result or rolls back so retry can safely process. Do not retry a 4xx unchanged except to retrieve a stored idempotent result; correct invalid data under a new event ID/revision.

### Outbound shipment-event feed

Each new state transition or shipment exception on an authorized shipment creates an immutable event. Poll with a signed GET and persist `next_cursor`; retry the same cursor after timeout for at-least-once delivery. Deduplicate by `event_id` at the receiver. Continue while `has_more` is true. The feed is retained in the application database and has no acknowledgement/delete endpoint; the marketplace owns its poll cursor and retry schedule.

Event fields are `event_id`, integer `cursor`, `event_type`, `occurred_at`, `order_reference`, local `shipment_id`, and a minimal `details` object. Current event types include:

| Driver-app action/state | Outbound type |
| --- | --- |
| Trusted order becomes eligible and shipment enters fee proposal | `order.authorized` |
| Offer accepted and driver assigned | `driver.assigned` |
| Driver prepares for pickup / arrives / confirms pickup | `driver.preparing_for_pickup`, `driver.arrived_at_pickup`, `shipment.picked_up` |
| Shipment enters transit | `shipment.in_transit` |
| Failed delivery / delivery confirmation request | `delivery.attempt_failed`, `driver.delivery_reported` |
| Buyer confirms receipt | `buyer.receipt_confirmed` |
| Cancellation, dispute, completion | `shipment.cancelled`, `shipment.disputed`, `shipment.completed` |
| Participant reports a delay/incident | `shipment.exception_reported` |

These are informational synchronization events, not commands. The inbound endpoint currently accepts only order authorization/cancellation and payment status; it has no external command to set shipment progress. Thus external systems cannot bypass driver evidence, buyer receipt confirmation, shipment permissions, or transition/audit services. Failed integration polling is retried by retaining the cursor; do not infer a completed event from a missing page or skip the cursor on a processing error.

## Phase 3E live driver location

### Sharing and authorization

Location sharing is opt-in per assigned shipment. It is available only while the shipment is marketplace-authorized and in `assigned`, `pickup_pending`, `pickup_arrived`, `picked_up`, `in_transit`, `delivery_attempted`, or `delivery_confirmation_requested`. The assigned active driver must still have an approved, unexpired, eligible application and required current verified documents. Starting requires a deliberate driver action and browser Geolocation permission; login, page load, and assignment do not start GPS collection.

Only the assigned driver and the shipment's active buyer may read a location. No general administrator, seller, unrelated driver, or marketplace feed gets precise coordinates. The APIs derive the driver from the session and shipment assignment; they accept no driver ID. Existing session authentication and CSRF rules apply to all unsafe methods. Unauthenticated requests return 401; nonparticipants and unrelated shipment IDs return 404. The location response is not added to general shipment serializers.

### Tracking endpoints

| Method and path | Access | Behavior |
| --- | --- | --- |
| `POST /shipments/{id}/tracking/start/` | Assigned eligible driver | Start/restart an expiring location-sharing session. Returns the tracking status. |
| `POST /shipments/{id}/tracking/location/` | Assigned eligible driver with active sharing | Validate and replace the latest location. Browser driver identity is never accepted. |
| `POST /shipments/{id}/tracking/stop/` | Current assigned driver | Stop sharing; the latest point remains marked stopped for authorized participants until the shipment ends or a new update replaces it. |
| `GET /shipments/{id}/tracking/` | Assigned driver or active buyer | Return shipment status, `sharing_status`, freshness limit, and latest point when one is available. |

Location update request:

```json
{
  "latitude": 9.03,
  "longitude": 38.74,
  "accuracy_meters": 12.5,
  "observed_at": "2026-10-17T10:30:00Z"
}
```

Coordinates must be in range, accuracy must not exceed `DRIVER_LOCATION_MAX_ACCURACY_METERS`, and `observed_at` must use an ISO-8601 timestamp with an explicit UTC offset. Updates older than `DRIVER_LOCATION_MAX_AGE_SECONDS`, beyond `DRIVER_LOCATION_FUTURE_SKEW_SECONDS` into the future, or not newer than the last accepted observation are rejected. The request body is limited by `DRIVER_LOCATION_MAX_PAYLOAD_BYTES`; location updates are throttled at 30/minute, start/stop actions at 12/minute, and location reads at 120/minute per client IP. A network failure, permission error, poor accuracy, or expired session is shown as an error and never presented as a successful location update. Configure a shared cache or gateway limit for multi-worker production deployments; per-process local throttling is not a shared global quota.

Responses contain `shipment_id`, `shipment_status`, `sharing_status` (`starting`, `sharing`, `stale`, or `stopped`), `is_sharing`, nullable `location` (`latitude`, `longitude`, `accuracy_meters`, and `observed_at`), `last_updated_at`, and `stale_after_seconds`. A stale/stopped point is labelled historical, not live. `DRIVER_LOCATION_SESSION_TIMEOUT_SECONDS` expires server acceptance if updates stop. `DRIVER_LOCATION_STALE_AFTER_SECONDS` controls when a last position is considered stale. The frontend asks for a location fix using high accuracy, avoids updates more often than every ten seconds, and sends a stationary heartbeat no more than once a minute.

### Storage, audit, and transport

`DriverShipmentLocation` stores at most one current/last point per shipment, not a route or permanent GPS history. It is overwritten on each accepted update and retains no history of previous coordinates. Explicit stop keeps the last point only as a stopped historical position for the active shipment. Delivery, completion, cancellation, or dispute ends sharing and clears precise coordinates. Start/stop audit events contain only the shipment reference and action; coordinates are excluded from logs, audit descriptions, analytics, and the marketplace event feed.

The viewer polls the authenticated endpoint every fifteen seconds; no WebSocket service, Redis, broker, or paid provider is required. Polling stops on authorization/network failure and the UI offers a manual retry. The server expires a sharing session when valid updates cease even if the browser cannot issue a stop request. Browser geolocation is not reliable after a page is hidden, suspended, or closed, and this application does not implement background tracking.

The map uses `https://tile.openstreetmap.org/{z}/{x}/{y}.png` and visibly attributes OpenStreetMap contributors. Respect the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/); public tiles are not an unlimited production service. For substantial traffic, choose a compliant provider or host tiles in accordance with OSM policy. There is no API key requirement for this standard development endpoint.

No precise coordinates are included in marketplace integration payloads or outbound shipment events. The integration's status feed remains separate from location tracking and does not authorize marketplace location access.

### Standalone behavior and readiness before production

When disabled or when the marketplace is unavailable, session-authenticated standalone workflows continue. Browser-created requests stay private and unverified; no driver sees them until a trusted server path authorizes the matching order and parties. Configure `MARKETPLACE_INTEGRATION_ENABLED`, `MARKETPLACE_INTEGRATION_SECRET`, `MARKETPLACE_INTEGRATION_MAX_BYTES`, and `MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS` only in backend environment/secret storage. The `.env.example` value is a placeholder and must not be used as a production key.

Before connecting the real marketplace, its owners must confirm the contract fields, identity/role mapping lifecycle, source-of-truth revision behavior, cancellation policy after assignment, payment status/reference meanings, signing implementation, TLS/network allowlists, timeout/retry/backoff policy, shared-cache/gateway rate limit, and retention/monitoring requirements. Provision `external_user_id` mappings through a trusted controlled process, generate a high-entropy shared secret, validate both systems in a non-production environment, and run PostgreSQL concurrency plus end-to-end integration tests. This repository has not been connected to the actual marketplace and has no credentials for it.

Matching uses exact pickup-region strings, active driver accounts, an approved application (suspended/expired applications fail), an unexpired license, all configured current verified required documents, and verified cargo capacity when shipment weight is supplied. Offer listing rechecks driver and marketplace eligibility and withdraws stale offers; acceptance rechecks both before assignment. No GPS, availability, or distance claim is made. Offers expire after 24 hours. Assignment locks the shipment row within a transaction and uses a conditional update requiring an unassigned shipment at the same current fee version, consumes the selected offer, withdraws competing offers, creates a unique immutable fee agreement, and records the fee-agreed/offered/assigned history. Database constraints enforce one agreement per shipment, one fee proposal per shipment version, one offer per driver per shipment, and one active shipment per buyer/order. PostgreSQL row-lock behavior has not been exercised in this environment; SQLite tests are not evidence of deployed concurrency safety. A PostgreSQL concurrency test is still required before production concurrency guarantees can be claimed.

## Delivery state machine and confirmation

Every change is validated by backend services and stored in an append-only `ShipmentTransition` with actor, timestamp, previous state, next state, and reason. The transition table is:

| Current state | Permitted next state | Actor and condition |
| --- | --- | --- |
| `requested` | `fee_proposed`, `cancelled` | Trusted marketplace verification; owning buyer may cancel before assignment |
| `fee_proposed` | `negotiating`, `fee_agreed`, `cancelled` | Fee action; owning buyer may cancel before assignment |
| `negotiating` | `fee_agreed`, `cancelled` | Exact current fee version accepted; owning buyer may cancel before assignment |
| `fee_agreed` | `offered` | Server-side assignment workflow |
| `offered` | `assigned` | Server-side atomic assignment |
| `assigned` | `pickup_pending`, `disputed` | Assigned driver prepares for pickup; either shipment participant may dispute |
| `pickup_pending` | `pickup_arrived`, `disputed` | Assigned driver records arrival; either participant may dispute |
| `pickup_arrived` | `picked_up`, `disputed` | Assigned driver confirms pickup; configured pickup evidence must exist |
| `picked_up` | `in_transit`, `disputed` | Assigned driver starts transit; either participant may dispute |
| `in_transit` | `delivery_attempted`, `delivery_confirmation_requested`, `disputed` | Assigned driver reports a failed attempt or submits successful-delivery evidence for buyer confirmation; either participant may dispute |
| `delivery_attempted` | `in_transit`, `disputed` | Only the explicit reschedule endpoint may return a failed delivery to transit; it records a failed-delivery exception and new ETA |
| `delivery_confirmation_requested` | `delivered`, `disputed` | Owning buyer confirms receipt or reports a problem |
| `delivered` | `completed`, `disputed` | `completed` has no public endpoint; a participant may still dispute a delivered shipment |
| `cancelled`, `disputed`, `completed` | — | Terminal through the current public API |

An unverified request remains `requested`. A failed delivery attempt is not successful delivery and cannot be confirmed as receipt. The driver's `delivery_confirmation_requested` state is only a request; only the owning buyer can transition it to `delivered`, or use `delivery-problem/` to dispute it. There is no automatic confirmation timeout or staff override. `delivered` records buyer-confirmed receipt; it does not change the separate payment status or release, refund, or transfer funds. No public API lets a driver mark a shipment delivered or any actor mark it completed.

`SHIPMENT_REQUIRE_PICKUP_EVIDENCE` and `SHIPMENT_REQUIRE_DELIVERY_EVIDENCE` default to `true`. When enabled, pickup evidence is required before confirming pickup, and delivery-attempt or successful-delivery evidence is required before the corresponding driver status update. Set either to `false` only when policy permits evidence-free progress. `SHIPMENT_EVIDENCE_MAX_BYTES` defaults to 10 MiB and is independent of the driver-document upload limit. Evidence accepts PDF, PNG, or JPEG only; extension, MIME type (when supplied), file signature, and configured size are validated. Evidence is stored with the private document storage backend and is never emitted as a public media URL. The API returns the effective evidence policy to the participant UI; photo and GPS evidence are not specifically required.

Failed delivery is reported as a reasoned `delivery_attempted` transition and evidence when configured. A buyer or assigned driver can then POST `estimated_delivery_at` (timezone-aware future ISO-8601) and `reason` to `/shipments/{id}/reschedule/`; the failed-delivery exception, new estimate, audit entry, notification, and explicit transition back to `in_transit` are committed together. Cancellation remains buyer-only and pre-assignment; after assignment, participants use exception or dispute workflows instead of silently cancelling the delivery.

The frontend polls shipment data, messages, and in-app notifications every 15 seconds while open. Notifications are database-backed and contain only shipment ID and generic event type, are visible only to their recipient, and can be marked read by that recipient. Status changes, exceptions, and messages notify the other authorized shipment participant. No email, SMS, push, paid messaging, or payment/escrow integration is configured.

The shipment stores its currency, current proposal version, and explicit fee-agreement state (`pending` or `agreed`); individual proposals store a monotonically increasing shipment-wide version, amount, currency, proposer, status, and timestamps. The immutable agreement records the accepted amount and currency. `ETB` is the currently supported shipment currency. Counterproposals and buyer resubmissions must use the shipment currency. The buyer proposes the initial fee when creating the request and can issue a new proposal version before assignment. Each new proposal supersedes any still-proposed version. An accept or reject action must identify the exact current version; stale proposals return HTTP 409 and cannot be accepted. Acceptance is a formal endpoint action, never inferred from a chat message. Accepting the buyer proposal or the buyer accepting a driver's counterproposal records both parties' acceptance times in an immutable agreement and assigns that driver in one transaction. Rejected, superseded, withdrawn, or already accepted proposals cannot be accepted. An agreed fee cannot be amended after assignment through the current API; no post-assignment amendment endpoint exists. Payment status is a separate field and is never changed by fee acceptance, delivery confirmation, or dispute actions.

## Payment, messaging, and limitations

- No payment provider is configured in this app. Shipment payment status defaults to `unavailable`; it can be mirrored only from an authenticated marketplace event after integration is enabled. No fake checkout, client-side payment confirmation, financial-manager approval, or payout/refund action exists. `paid` is an informational marketplace-owned status; it is not proof generated by this app and does not cause settlement. `completed` still has no public transition endpoint. Do not treat an agreed fee as a payment.
- Messages and generated offer-fee events are shipment-scoped. Candidate drivers can see only their own offer thread. Free-form messaging begins after assignment, is non-empty and capped at 2,000 characters, and is paginated newest-first (50 default, 100 maximum). Message bodies are not copied into audit records or notification payloads.
- Evidence download is authorized for the owning buyer or currently assigned driver and audited. Its test coverage exercises local filesystem private storage only; production storage access controls still need deployment verification.
- No GPS update endpoint, continuous tracking, map, or route geometry is enabled. Estimated delivery times are user-supplied and are not computed from location or routes.
- Real seller/farmer participation and order eligibility cannot be inferred until the marketplace confirms and connects the proposed authenticated order/participant contract. Scoped administrative shipment views and financial-manager permissions are not configured.
- Admin scope continues to use exact strings; canonical geographic records and audit-safe scope reassignment remain future work.
- Account recovery/activation needs production SMTP and a trusted frontend origin. Configure production values only in deployment secrets.
- Next: obtain marketplace confirmation of the contract, provision trusted identity mappings and secrets, perform joint non-production tests, and security-review the deployment configuration. Keep all Chapa/payment execution and financial records in the main marketplace.