# Green Path Marketplace–Driver Integration Contract

**Contract version:** `1`  
**Status:** Owner-approved implementation baseline. Existing v1 remains unchanged; v2 below is the integration contract for this implementation. Financial reservation, transfer, external payout, refund, and reversal remain disabled pending a separately verified ledger design and policy.

## Systems and ownership

- The marketplace remains authoritative for its order, buyer/seller identities, wallet, Chapa, escrow, payment verification, refunds, payouts, and financial ledger.
- The driver app remains authoritative for shipment assignment, fee negotiation/agreement, delivery progress, evidence, and shipment events.
- Shipment and payment-status messages are synchronization only. A shipment event must never modify marketplace payment verification, wallets, escrow, or other financial records.
- The driver app has no wallet or payment-provider integration. Its shipment `payment_status` is an informational mirror.

## Identifiers and participants

- Marketplace order ID: the existing `Order.id` UUID, serialized as a canonical UUID string and sent as `order.id`.
- The marketplace sender must use the UUID format for this key. The driver currently stores `Shipment.external_order_reference` as a string and its v1 event serializer accepts any non-empty bounded string; Phase 2 should validate canonical marketplace UUIDs for this integration path without converting the driver database column or breaking existing standalone/non-marketplace shipment references.
- Driver shipment ID: the driver's local integer shipment primary key, returned as `shipment_id`. It is meaningful only within that driver service/database and must never be used as the cross-system order key. Every integration request and response must map by the original marketplace order UUID (`order.id` inbound, `order_reference` outbound); the driver must enforce one active shipment per buyer/order.
- Marketplace participant ID mapping: the proposed stable external ID is `str(User.id)`. The marketplace has UUID user IDs but no separate integration-ID field. The corresponding active `LogisticsUser.external_user_id` record and matching role must be provisioned on the driver side; the HMAC API does not create users or mappings.
- Roles are sent using the driver's lowercase values: buyers are `wholesaler` or `retailer`; sellers are `farmer`, `wholesaler`, or `retailer`. The marketplace's `Order.buyer` and `Order.seller` properties select the actual parties. The sender must verify the marketplace order parties and approved/active account state before enqueueing an event; the driver verifies the supplied mapping is distinct, active, and role-matched.

## Marketplace to driver: signed order events

### Endpoint and authentication

`POST /api/integrations/v1/orders/events/`

The driver currently accepts `order.authorized`, `order.cancelled`, and `payment.status_changed`. Integration is disabled unless `MARKETPLACE_INTEGRATION_ENABLED=true` and `MARKETPLACE_INTEGRATION_SECRET` is at least 32 characters.

Every request requires:

- `X-GP-Integration-Timestamp`: Unix seconds, within the configured skew window (default 300 seconds).
- `X-GP-Integration-Request-ID`: at most 128 characters; for POST it must equal `event_id`.
- `X-GP-Integration-Signature`: lowercase `sha256=` HMAC-SHA256 digest.

The exact signed bytes are `timestamp + "\n" + request_id + "\n" + UPPERCASE_METHOD + "\n" + request_path_and_query + "\n" + raw_body`. The shared secret is server-side environment configuration only. Use TLS; never place it in browser code, `NEXT_PUBLIC_*`, source control, or logs. The driver's default body limit is 256 KiB and throttle is 60 requests/minute per client IP.

Existing driver authentication environment-variable names are `MARKETPLACE_INTEGRATION_ENABLED` and `MARKETPLACE_INTEGRATION_SECRET`; `MARKETPLACE_INTEGRATION_MAX_BYTES` and `MARKETPLACE_INTEGRATION_MAX_SKEW_SECONDS` are optional limits. No marketplace sender URL/credential environment variables or HMAC sender currently exist. Do not inspect or copy local `.env` values. Agree the server-only sender variable names during implementation; never expose them to either frontend.

### Event envelope

The strict JSON envelope is:

| Field | Contract |
| --- | --- |
| `contract_version` | String `"1"` |
| `event_id` | Unique string, max 128 characters; identical to signed request ID |
| `event_type` | `order.authorized`, `order.cancelled`, or `payment.status_changed` |
| `occurred_at` | ISO-8601 timestamp with explicit UTC offset; cannot be in the future beyond configured skew |
| `revision` | Positive integer; must strictly increase per marketplace order across all event types |
| `order` | Event-specific order object below |

Each `order` contains `id` (marketplace UUID string), `status`, `buyer` and `seller`; each participant has `external_user_id` and the role values above.

For `order.authorized`, `status` is `"authorized"` and the object additionally requires:

- `shipment`: `pickup_region`, `pickup_address`, `destination_region`, `destination_address`, `product_summary`; optional `pickup_zone`, `pickup_wereda`, `destination_zone`, `destination_wereda`, `cargo_weight_kg`, `handling_requirements`, `estimated_pickup_at`, and `estimated_delivery_at`.
- Addresses are limited to 2,000 characters; regions/zones/weredas to 100; product summary and handling requirements to 500. Weight, when supplied, is a positive decimal in kilograms. Estimates, when supplied, require explicit-offset timestamps and delivery cannot precede pickup.
- `delivery_fee`: positive decimal `amount` and `currency`; the driver currently accepts only `ETB`. This is the buyer's initial delivery-fee proposal, not proof of payment or agreement. The driver creates a pending fee proposal; its negotiated fee agreement is tracked separately.
- Optional `payment` in existing v1 is limited to `status` in `pending`, `paid`, `failed`, or `disputed`, and optional `reference` (max 128 characters). The marketplace must not put its order or delivery-fee state in this v1 field; use only the proposed exact-state v2 snapshot after approval and implementation.

For `order.cancelled`, `status` is `"cancelled"` and a non-empty `cancellation_reason` is required. The driver will reject the cancellation with conflict if shipment state/assignment no longer permits it; marketplace cancellation does not override driver commitments.

For the currently implemented v1 `payment.status_changed`, `status` remains `"authorized"` and `payment` is required with the existing `pending|paid|failed|disputed` enum. This v1 event cannot carry the marketplace's complete order-payment lifecycle without lossy conversion. Do not use it for marketplace payment updates until the v2 snapshot contract below is approved and implemented.

Unknown fields are rejected. The event types and field requirements above are the driver's existing serializer contract, not a claim that the marketplace currently sends these payloads.

### Marketplace source inspection: exact current data and gaps

The following mappings are from the existing marketplace Django models, serializers, URL routes, and order workflow. “Unavailable” means there is no shipment-level source confirmed by the order-acceptance workflow; similar profile fields are not substitutes.

| Required value | Actual source and API/workflow | Available when the seller accepts? |
| --- | --- | --- |
| Stable order reference | `payments.Order.id` (UUID, primary key), returned by `OrderSerializer` at `POST /api/v1/orders/` and `GET /api/v1/orders/{id}/`. `Order.reference` is a separate display reference, not the integration key. | Yes. Send `str(order.id)` as `order.id` and retain it as the immutable mapping key. |
| Order idempotency key | `payments.Order.idempotency_key`, populated from the `Idempotency-Key` request header in `OrderViewSet.create`; uniqueness is enforced when nonblank. | Available if supplied at order creation; it is not guaranteed for older orders or callers that omit the header. It is not a substitute for the unique integration `event_id`/outbox key. |
| Buyer/seller marketplace identifiers | `Order.buyer` and `Order.seller` properties resolve the actual `users.User` rows from `retailer`/`wholesaler` and `farmer`/`wholesaler`. Each `User.id` is a UUID; serializer exposes the FK IDs (`wholesaler`, `farmer`, `retailer`) and names. Roles are `User.role`. `GET /api/v1/registration/me/` manages role-specific profile registration, not integration identity. | Yes, subject to account/order validation. The proposed `external_user_id` is the UUID string, but no marketplace-specific external-ID field or cross-service identity mapping currently exists. Provision and verify the corresponding driver `LogisticsUser.external_user_id` mapping out-of-band; never match by email. |
| Pickup region and structured pickup address | **Unavailable.** `Order` has no pickup fields. Buyer/seller `User.location` is general profile text. `UserRegistration.business_address` and its `AdministrativeLocation` FK are business-registration data populated through `PATCH /api/v1/registration/me/`, not a confirmed order pickup. `Order.delivery_information` is free text supplied to `POST /api/v1/orders/`. | No. Do not use profile/registration address or delivery instructions as a confirmed pickup location. Add shipment-specific, participant-confirmed fields to the existing order workflow. |
| Destination region and structured destination address | **Unavailable.** No destination/address/region field exists on `Order`; the `delivery_information` text is not a structured destination. The same profile/registration fields do not designate this shipment's drop-off point. | No. Capture and validate explicit order-specific destination data before authorization. |
| Zone, wereda, kebele | `registrations.AdministrativeLocation` is a parent-linked reference tree with `REGION`, `ZONE`, `WOREDA`, `KEBELE` levels; active options are exposed by `GET /api/v1/registration/locations/`. `UserRegistration.location` selects a single registration location, not an order route. The existing Ethiopia hierarchy importer documents that its source contains no kebele records. | No shipment-specific route is stored. Reuse the administrative-location tree for selecting address areas where valid, but do not infer shipment endpoints from a profile location; kebele coverage is unavailable in the current imported dataset. |
| Buyer-proposed delivery fee and currency | **Unavailable.** Neither `Order`, `Product`, `BusinessAgreement`, nor the order-create serializer/API has a delivery-fee amount/currency/proposer/revision. `Order.total_amount` is product quantity × product unit price, and wallet order operations reserve/release that merchandise amount. | No. Add a distinct ETB delivery-fee proposal to the order/shipment workflow; do not derive it from `total_amount`, product price, or Chapa/wallet records. |
| Product reference/name | `Order.product_id` (UUID FK); `Product.id`, `Product.title`, `Product.description`, and optional catalog product/variety. `OrderSerializer` exposes `product` and `product_title`; `ProductSerializer` is used by product endpoints. | Yes. The order's referenced product is available; snapshot/logistics disclosure rules still need defining. |
| Ordered quantity and unit | `Order.quantity`; `Product.unit_of_measure` (kg, quintal, ton, piece, crate, bunch, litre, etc.). `POST /api/v1/orders/` accepts `product` and `quantity`; the order response serializes quantity but does not expose the product unit in its nested order fields. | Yes in the linked records. A sender can read both server-side, but quantity is not mass unless its unit explicitly means mass. |
| Cargo weight/capacity and packaging | **Unavailable as shipment cargo data.** `Product` has stock quantity and `unit_of_measure`, but no weight-per-unit, packaged cargo, or shipment capacity. Product/order quantity in kg may be reported as ordered quantity, not independently asserted estimated shipment weight. | No confirmed weight or packaging requirement. Add only if business workflow captures it or safely derives it from explicit product-unit metadata. |
| Delivery instructions | `Order.delivery_information`, accepted as optional free text during `POST /api/v1/orders/`; `OrderSerializer` returns it under participant/contact-disclosure rules. | It may exist, but is not validated as an address and may contain personal/contact information. Do not forward it as an address; define and minimize any separately authorized instruction field. |
| Authorization status/time | `Order.status`, `Order.payment_status`, `BusinessAgreement` are updated/created by `PATCH /api/v1/orders/{id}/status/` when the seller accepts. The acceptance path runs in `transaction.atomic()`, sets `Accepted`, creates/gets the agreement, and records `HELD`. | After that transaction commits, this is the candidate marketplace-order authorization boundary. It is not payment release or delivery-fee agreement. Require complete confirmed shipment data and the agreed business authorization predicates before creating the driver request. |

Relevant existing endpoint/workflow: authenticated `POST /api/v1/orders/` creates a pending-seller-approval order and reserves product stock/marketplace order funds; seller acceptance is `PATCH /api/v1/orders/{id}/status/` with `{"status":"Accepted"}`. Acceptance is not sufficient to publish a delivery request while required shipment-specific pickup/destination and a buyer-proposed ETB fee are unavailable. The order's existing `BusinessAgreement` concerns the marketplace goods; it does not record shipment address consent or driver-fee terms.

Minimum data-model/API change for these missing sources: add order-linked shipment details (rather than repurposing profile addresses) with separate pickup/destination address lines and references into the existing `AdministrativeLocation` tree where its hierarchy data is available; capture buyer/seller confirmation and field-level viewer/time policy; add any explicitly required cargo/packaging fields; and persist the buyer's ETB proposal with proposer and monotonically increasing version. Keep product `Product.id`, title, order quantity, and `unit_of_measure` as references/snapshots; do not duplicate location reference data. Require these details before driver authorization. No specific new field names are asserted here.

### Shipment and delivery-fee agreement boundary

- After the marketplace's goods-order agreement/authorization conditions are satisfied and shipment-specific required fields have been confirmed by the relevant buyer/seller, the marketplace may durably enqueue one `order.authorized` request per eligible order. A stable unique constraint on active shipments keyed by buyer + original order UUID is already present in the driver database; marketplace outbox/idempotency must prevent duplicate sends as well.
- The driver creates offers only from a trusted signed authorization event. Its existing `ShipmentFeeProposal` records positive ETB proposal amount, proposer, version, state, timestamps, counterproposals and response reasons. `ShipmentFeeAgreement` is immutable and records shipment, proposal, buyer, driver, exact amount/currency, and both acceptance timestamps. A new amount must create a new proposal/version and new two-party acceptance; it must not reuse an old acceptance. These are driver fee-negotiation records, not marketplace financial authorization or payment.
- After the driver and buyer agree on the same amount in ETB, submit that immutable agreement for marketplace financial-manager review. The marketplace currently has `Role.FINANCIAL_MANAGER` and existing order/payout/funding review workflows, but **no delivery-fee review queue/model or delivery-fee transfer operation**. Approval/rejection must be a separate audited review with reviewer, timestamp, decision reason, and authorization checks; approving is not a payment result. On the driver side, changing an agreed proposal must invalidate prior acceptance and require both parties to accept a new version; current acceptance assigns the driver and there is no post-assignment fee-revision workflow, so implementation must explicitly preserve the required re-acceptance rule.
- **Business direction supplied by the owner:** the buyer on the order (the wholesaler buying from a farmer, or retailer buying from a wholesaler) pays the separately agreed delivery fee from that buyer's marketplace wallet. The assigned driver is the intended payee. After buyer/driver negotiation through the shipment messages/proposal workflow, the agreed positive ETB amount is mandatory and both parties must accept the same proposal/version before submission for financial review. The marketplace Financial Manager reviews and records an approve/reject decision with a reason and audit entry; approval authorizes a subsequent marketplace financial operation, but is not itself payment success. Chapa, buyer/seller wallets, financial processing, reservation, verification, release, refund, and payout remain in the main marketplace.
- **Wallet ownership clarification:** GreenPathDriverApp must not create or independently manage any wallet, ledger, escrow, Chapa, transfer, refund, or payout. Its dashboard may show authorized, non-sensitive delivery-fee/payment workflow status only; it must not collect/show wallet balances or raw account numbers. Owner-approved design: add a separate marketplace-owned driver-payee record explicitly mapped to the DriverApp UUID, and extend the main marketplace's wallet/payout ownership to that payee; do not create a driver role/login or financial subsystem in DriverApp. The payout/account number is mandatory in the marketplace-controlled, protected payout setup before the payee can receive a released fee. The current marketplace `Wallet` and `BankAccount` are tied to `User`; there is no driver payee mapping or implementation yet. Never use email as the mapping key.
- **Approved funds-flow direction, operation still to be implemented:** after buyer and driver accept the exact fee, reserve the amount atomically from the buyer's available marketplace wallet into its held bucket before financial review. Insufficient available funds must block submission without partial debit, fee transfer, or driver credit. A marketplace Financial Manager can approve/reject. Rejection before transfer releases the reservation; approval authorizes exactly one marketplace-owned, idempotent ledger operation to the mapped marketplace driver-payee wallet, with a durable unique transaction reference and immutable audit/review outcome. If an external payout to the driver's registered account is a later step, it must use the marketplace's authorized payout workflow. A driver-facing “paid” status may be emitted only after the relevant authoritative marketplace transaction commits; approval and pending records are not transfer success. This delivery-fee capability does not exist yet.
- **Cancellation policy supplied for unpaid fees:** when no transfer has completed, cancel/void the delivery-fee agreement and notify the driver in the driver-app messages using a respectful system-generated message on behalf of Financial Review (not falsely attributed to a named manager). Preserve the original immutable proposal/agreement and audit the cancellation; do not delete history. Say a Financial Manager approved/rejected/reviewed only if an authenticated, authorized marketplace event proves that action; otherwise use neutral wording. Record source event, action, timestamp, and verified actor identity when available. The current driver service has no signed service-to-service message/cancel-fee endpoint, and its `ShipmentFeeAgreement` is immutable with no cancellation state, so a new audited fee-review outcome event/workflow is required.
- Cancellation after a transfer, refund/chargeback, dispute allocation, and whether a completed delivery is required before transfer remain **unresolved**; the supplied policy explicitly says completed transfers must not be automatically reversed/refunded and unspecified financial outcomes stay blocked. The existing `release_escrow` pays the marketplace goods-order seller from held merchandise-order funds; it is not a delivery-fee transfer and cannot be repurposed without a separately approved operation. No transfer may be implemented until the payee identity, reservation/settlement design, cancellation handling, and atomic ledger operation are approved. No driver endpoint may create or mutate marketplace money.
- A transfer result is successful only when the marketplace financial service commits and confirms its authoritative transaction. A driver event or financial-manager approval cannot assert that the transfer completed.

### Exact marketplace payment states and v1 compatibility

The relevant field is `payments.Order.payment_status`, whose exact choices are `RESERVED`, `HELD`, `RELEASE_PENDING`, `RELEASED`, `REFUNDED`, `DISPUTED`, plus blank for legacy/non-wallet orders. This is the merchandise-order financial lifecycle, **not** the delivery-fee lifecycle. Separate `PaymentRecord.status` (`PENDING`, `VERIFIED`, `FLAGGED`, `DISPUTED`) and wallet funding/payout states refer to other workflows and are not a source for this order's payment event.

| Marketplace `Order.payment_status` | Actual meaning in marketplace source | Existing driver v1 equivalent | Decision |
| --- | --- | --- | --- |
| blank | No order wallet-payment state recorded (legacy/non-wallet order). | unavailable | No evidence of a payment outcome. |
| `RESERVED` | Order-creation marker set before `reserve_order_funds` moves money into held balance; normally transient inside the creation transaction. | unavailable | Not a completed payment and distinct from later-held escrow. |
| `HELD` | Merchandise-order funds are held in the buyer marketplace wallet/escrow; assigned at the end of the reserve operation and after seller acceptance. | unavailable | Must not be described as `paid`; acceptance and held funds are not a released payment. |
| `RELEASE_PENDING` | Buyer confirmed goods quality; marketplace awaits the financial-manager escrow-release action. | unavailable | Pending release is not a completed transfer. |
| `RELEASED` | The existing marketplace escrow service moved held merchandise-order funds to the goods seller's marketplace wallet and marked the order completed. | `paid` is a possible coarse equivalent only for the **merchandise order**; not evidence that a delivery fee was paid. | Do not use this projection for the fee; exact-state v2 snapshot is preferred. |
| `REFUNDED` | Marketplace order reservation was returned to the buyer (for rejection/cancellation workflow). | unavailable | A refund is not a payment failure. |
| `DISPUTED` | Marketplace order payment was marked disputed in the buyer dispute workflow. | `disputed` | Same dispute state; informational only and does not start/resolve a financial dispute. |

Driver v1's serializer only accepts `pending`, `paid`, `failed`, or `disputed`; it has no documented exact semantics for representing marketplace escrow/reservation/refund states, no exact marketplace status field, and its model constrains the local status vocabulary. Therefore, **do not send a lossy v1 conversion** (`failed` is not `REFUNDED`; `pending` does not distinguish `RESERVED`, `HELD`, and `RELEASE_PENDING`; `paid` must not stand for `HELD`). Even the two possible coarse projections above are unsuitable for the required exact mirror.

Approved backward-compatible direction: leave v1 signatures, endpoint, event types, and accepted values unchanged for existing callers. Add a distinct signed v2 payment-status snapshot event/schema (or an explicitly negotiated v2 endpoint) carrying the exact marketplace status string, `source_system`, stable `event_id`, original UUID `order_reference`, per-order monotonic `revision`, and explicit-offset `occurred_at`. Proposed snapshot shape:

```json
{
  "contract_version": "2",
  "source_system": "greenpath_marketplace",
  "event_id": "unique-event-id",
  "event_type": "payment.status_snapshot",
  "occurred_at": "2026-10-19T10:30:00Z",
  "revision": 3,
  "order_reference": "marketplace-order-uuid",
  "payment_status": "RELEASE_PENDING"
}
```

`payment_status` is the exact `Order.payment_status` value; a blank legacy value produces no payment event. Driver stores this separately as an informational snapshot; it never overwrites marketplace state or triggers finance. Maintain latest revision per source system/order; duplicate event ID+identical payload is idempotent, changed payload under same ID conflicts, delayed/out-of-order revisions do not replace the latest snapshot. Terminal/transition validation remains authoritative in the marketplace; driver does not invent payment transitions. No v2 event is implemented by this document.

Marketplace cancellation is a participant transition that can release held merchandise funds and restore stock. Enqueue `order.cancelled` only after its transaction commits. The driver accepts cancellation only if its own shipment state permits it; handle 409 explicitly, reconcile, and do not silently claim logistics cancellation succeeded. Driver offer rejection/expiry is currently offer-level, not a marketplace order cancellation. Driver events `driver.assigned`, `shipment.cancelled`, `shipment.disputed`, and delivery events can synchronize shipment display state, but do not change marketplace order/payment/financial state. `buyer.receipt_confirmed` is not marketplace goods-quality confirmation, escrow release, or proof the original order is complete. Driver feed currently omits driver identity, detailed reassignment history, private addresses, and free-text reasons; define any extra authorized fields separately before exposing them.

### Identity, driver approval, scope, and administration

- Marketplace roles currently include `SUPER_ADMIN`, `USER_ADMIN`, and `FINANCIAL_MANAGER`; `AdministratorScope` supports a `USER_ADMIN` global or single `AdministrativeLocation` scope. Marketplace does not currently define marketplace-side `TOP_USER_ADMIN`, `REGIONAL_ADMIN`, `ZONAL_ADMIN`, or `WEREDA_ADMIN` roles in `users.Role`.
- The driver service separately defines `SUPER_ADMIN`, `TOP_USER_ADMIN`, `REGIONAL_ADMIN`, `ZONAL_ADMIN`, `WEREDA_ADMIN`; its current reviewer check excludes both ordinary `USER_ADMIN` and `FINANCIAL_MANAGER`. Regional/zonal/wereda checks use driver-app scope fields and application strings. No cross-service staff identity/RBAC/scope federation endpoint currently exists.
- Owner-approved administration boundary: each application independently manages and authorizes its own administrator identities/scopes. Marketplace `USER_ADMIN`/`SUPER_ADMIN` are not automatically federated into the driver app; marketplace Super Admin is not automatically driver-app Super Admin. Driver-app admins act only within their own assigned roles/scopes and geography. Financial Managers remain finance-only and get no driver onboarding, shipment, address, or location access solely by that role. Any later cross-service access needs a separately approved, authenticated, narrowly scoped and audited design. No administrator gets unrestricted access by role label alone.
- Do not copy role names or trust frontend claims as authorization. Lower-scope staff cannot grant roles or scope; financial-manager authority does not confer driver-approval privilege. Driver application review remains in the driver service's existing authorized reviewer workflow and its own audit history.
- Existing driver onboarding already records application/document review history, reviewer identity and times; checks license expiry and required verified documents; scopes reviewer decisions; and restricts offers to eligible drivers. This remains authoritative for driver eligibility. Any mapped marketplace staff cannot bypass those service-side checks.

### Dashboard surfaces and lifecycle boundaries

Keep the two applications, repositories, frontends, backends, databases, styles, and navigation separate. Integrate only existing order, shipment, financial-review, driver-review, and dashboard surfaces. Marketplace farmer/wholesaler/retailer views may show order-linked shipment progress and authorized shipment details; the financial manager surface needs a distinct delivery-fee review/result/audit workflow; scoped user administrators and Super Admin need driver review/integration oversight. The driver dashboard retains registration/documents/license state, eligible offers/expiry, fee proposals/counteroffers/agreement history, assigned shipment progression, delivery evidence/messages, and deliberate start/stop location sharing. Every address, identity, location, review, and financial action requires backend authorization; UI visibility is not authorization.

Required administration/dashboard scope is intentionally broader than current code: marketplace dashboards should retain existing visual conventions and add only the farmer, wholesaler, retailer shipment views/notifications, financial-manager delivery-fee review/results/wallet transaction/audit views, scoped driver registration/document/license reviews for user administrators, and system-wide integration/role/scope/audit oversight for Super Admin. The driver dashboard keeps existing onboarding, document/license, offers, fee negotiation, shipment, evidence, messages, and deliberate location-sharing flows. No dashboard work or role grant is part of this contract-only phase.

Marketplace owns goods-order lifecycle and all financial state; driver owns offer, assignment, delivery execution/evidence and shipment transitions. Cancellation, assignment, rejection, delivery, and disputes must be represented as distinct versioned synchronization events, mapped by original order UUID and deduplicated by event ID. A driver shipment event may update only explicitly approved delivery integration fields. It cannot set marketplace order/payment status, mark goods quality confirmed, release escrow, or imply a transfer. Marketplace financial events are snapshots only in the driver. Address visibility needs explicit order-participant authorization and a defined time window; precise driver location is never included in server-to-server shipment events.

## Idempotency, revisions, retries, and audit

- Generate and persist one event ID and exact serialized payload per outbox event. Retries use the same event ID and payload but a fresh timestamp/signature.
- The driver returns the stored status/body for the same event ID and canonical JSON payload (object key order/whitespace do not matter); reuse with changed data returns HTTP 409.
- Revisions strictly increase per marketplace order across authorization, cancellation, and payment events. The marketplace currently has no integration revision counter; the outbox must allocate/persist one transactionally per order.
- Retry connection failures, timeouts, 429, and 5xx with bounded backoff. Do not blindly retry unchanged 4xx; resolve 400/401/403/409 according to the returned reason. A 409 stale revision or changed-payload conflict requires reconciliation, not a new attempt with the same invalid data.
- The driver audits authentication rejection, payload rejection, event processing/rejection, authorization/cancellation/payment changes, and feed polling. Do not log secrets, signatures, raw request bodies, addresses, contact data, payment references, or other private shipment fields. Marketplace `AuditLog` currently documents privileged admin actions; integration-specific audit handling remains to be added and must not expose these values.

Shipment-specific pickup and destination data must have field-level viewer authorization and an explicit access interval. The current applications do not record that policy for order addresses. The owner-approved rules below govern the proposed shipment-specific fields; enforce them with least-privilege backend checks and audit reads/changes. Do not make precise addresses part of broad order serialization or shipment-event feed.

Approved v1 pickup/destination policy: after marketplace delivery authorization, the requesting buyer and seller on that same order may view both authorized addresses until shipment cancellation, completion, or closure. Limited access after closure is only for an authorized dispute/audit case. Unassigned drivers/offers see coarse region/zone and delivery-evaluation details only; no exact addresses, precise GPS, phone numbers, or direct contact details. An approved assigned driver may view exact pickup/destination only after valid assignment and authorization; revoke access on cancellation/reassignment/closure, granting it to a replacement only after valid assignment. Active assigned-driver location sharing remains explicit opt-in under existing rules; no background tracking. Marketplace/driver administrators may access exact addresses only for legitimate scoped operations and with audit; financial managers get no address/GPS access solely through their financial role. Enforce this in Django on every relevant API, notification, message, map, and tracking surface; preserve existing protections.

## Driver to marketplace: shipment-event feed

`GET /api/integrations/v1/shipment-events/?after_id={cursor}&limit={n}`

The signed request authenticates the exact path and query. `after_id` is a non-negative integer (default `0`); `limit` is `1..100` (default `50`). The response contains `results`, `next_cursor`, and `has_more`. Each result contains:

| Field | Meaning |
| --- | --- |
| `event_id` | Driver-generated UUID; deduplicate on receipt |
| `cursor` | Integer cursor |
| `event_type` | Shipment event type |
| `occurred_at` | Driver event timestamp |
| `order_reference` | Marketplace order ID used for mapping |
| `shipment_id` | Driver-local integer shipment ID |
| `details` | Minimal event details; currently transition statuses or exception type |

The driver currently emits `order.authorized`, `driver.assigned`, `driver.preparing_for_pickup`, `driver.arrived_at_pickup`, `shipment.picked_up`, `shipment.in_transit`, `delivery.attempt_failed`, `driver.delivery_reported`, `buyer.receipt_confirmed`, `shipment.cancelled`, `shipment.disputed`, `shipment.completed`, `shipment.exception_reported`, and fallback `shipment.status_changed`.

The marketplace consumer must persist the cursor only after every event on that page has been durably processed, retry the same cursor after failure, and deduplicate by `event_id`. Process events using `order_reference` as the primary cross-system mapping; retain `shipment_id` as the driver-side identifier. Shipment events are informational and may update only delivery/integration fields; they cannot set payment status or invoke wallet, Chapa, escrow, refund, or payout operations. The marketplace currently has no consumer or persisted cursor.

The existing feed does **not** emit the agreed fee amount/version/agreement record, and the existing inbound order-event API has no fee-review decision or fee-cancellation event. Add a separate versioned, authenticated workflow before financial review can work end to end: the driver reports the immutable accepted `ShipmentFeeAgreement` and its original order UUID, proposal/agreement ID, version, ETB amount, buyer/assigned-driver mapped IDs, event ID, revision, and timestamp; the marketplace persists a review record and actor/reason. The marketplace then sends an authenticated, idempotent fee-review outcome to the driver. Rejection/unpaid cancellation marks the fee workflow void without deleting immutable proposal/agreement history and causes a system-generated message on behalf of Financial Review. A paid/settled result is sent only after the marketplace ledger confirms it. Do not place private account numbers, contact details, addresses, GPS, or unsanitized manager notes in these events. The exact v2 schema, accepted statuses, and revision/idempotency namespace must be specified before implementation; v1 remains unchanged.

## Readiness and validation

- This is the documented wire contract as implemented by the driver, plus explicit marketplace mappings and gaps found in source. It is not a live end-to-end integration.
- Marketplace focused order tests: 4 passed using an in-memory SQLite test database; 6 deprecation warnings. The repository's default coverage threshold caused the first test invocation to exit non-zero despite those tests passing; rerunning with coverage disabled passed.
- Driver integration tests could not start in the available Python environment because `django-environ` (`import environ`) is missing. No dependency was installed.
- No API credentials or live infrastructure were tested. The driver remains disabled by default.

## Remaining decisions and blockers — approval required before implementation

1. **Delivery-fee payer, recipient direction, funds sequence, and payee model are owner-approved.** Buyer pays from marketplace wallet; assigned driver is the separate marketplace payee; reserve after both parties accept; financial manager reviews; rejection releases funds; approval permits one confirmed marketplace transfer; do not automatically reverse a completed transfer. The driver payout/account number is required in the marketplace-controlled protected payout setup. Transfers remain blocked until the payee model, protected account setup, and atomic ledger operation exist. Unpaid-fee cancellation and neutral system message on behalf of Financial Review are specified but require a new signed driver API event/workflow.
2. **Shipment address visibility policy is owner-approved.** Buyer and seller of the order see both exact addresses after authorization until closure; assigned approved driver sees them only after valid assignment; offers see coarse areas; administrators need scoped operational authorization; financial managers have no address privilege from their role. Dispute/audit access is limited and audited. The driver API must be updated where existing seller visibility does not yet implement this policy.
3. **Authorization predicate needs confirmation.** The candidate is committed marketplace seller acceptance plus the existing goods-order agreement, active/eligible parties, and complete buyer/seller-confirmed shipment data. Confirm whether any additional marketplace order or account approval state is required before driver matching. Acceptance alone must not bypass missing address/fee details.
4. **Payment synchronization direction is approved; exact event schemas remain to be specified.** Keep v1 unchanged and use an authenticated, backwards-compatible v2 exact-state snapshot for marketplace `Order.payment_status`; no lossy conversion into the current v1 enum. Keep the merchandise-order snapshot distinct from the delivery-fee review/settlement lifecycle, with its own event types and revisions. Specify payload validation and status transition/error handling before implementation.
5. **Independent administration is owner-approved.** Do not federate marketplace admin identities/scopes into DriverApp or inherit permissions. Each service validates its own administrator roles/scopes; driver operational admin remains driver-side; marketplace Financial Managers remain finance-only. Explicit UUID mapping is still required for buyer, seller, assigned driver and the separate marketplace driver-payee; no matching by email.
6. **Operational event treatment needs confirmation.** Driver feed currently omits assigned-driver identity and detailed rejection/reassignment data. Confirm whether marketplace dashboards need a privacy-limited driver identifier or only shipment status. Delivery events must not auto-complete goods quality confirmation or release money.

The owner approved the separate marketplace payee model, marketplace-controlled mandatory payout-account setup, reserve-before-review sequence, unpaid-fee cancellation/system-message policy, independent administrative authorities, address visibility rules, and v2 exact-state payment-snapshot direction. These approvals do not authorize a DriverApp wallet or initiate a transfer. Before Phase 2 implementation, the exact atomic ledger operation and protected payout model must be designed against the separate payee; after-transfer disputes/refunds remain blocked by policy; fee-review/cancellation event schemas must be specified; and exact v2 payload/revision rules must be agreed. Shipment-specific address/cargo/fee data remains unavailable and must be added to the existing marketplace workflow. Phase 2 also needs the outbox and durable revisions; Phase 3 needs a persisted cursor/deduplicating consumer. Repositories, databases, backends, frontends and configuration remain separate.

## Stage A implementation contract — technical details

This addendum finalizes technical rules from the repository evidence and supersedes earlier statements that asked for confirmation of these details. It does not enable financial operations.

### Shipment data and authorization

- Add one marketplace-owned shipment-details record per `Order`; do not modify profile/registration addresses or reinterpret `delivery_information`.
- Capture pickup and destination independently as required address lines plus region and optional zone, wereda, and kebele references to active `AdministrativeLocation` records. Validate each selected location's level and ancestry; require lower-level records only where local reference data covers the address. Address lines are shipment-specific, not inferred from user profiles.
- Require a positive explicit estimated cargo weight in kilograms and a non-empty packaging/handling description before driver authorization. `Order.quantity` and product UOM remain separate and are never treated as cargo weight or packaging.
- Buyer and seller must both confirm the current shipment-details revision. Any edit clears both confirmations and advances the revision. A fee proposal is a positive ETB amount, proposed by the buyer and versioned; it is not a payment.
- Authorize driver matching only after the order status is `Accepted`, an active `BusinessAgreement` exists, both participants are active and approved with roles implied by the order, shipment details are complete, both parties confirmed the same details revision, and the buyer fee proposal is valid. Do not add a financial-verification prerequisite that the existing order flow does not enforce.
- Missing shipment details do not block the existing goods-order workflow; they delay creating a driver authorization event.
- Marketplace buyers and sellers may read exact addresses only after authorization and until shipment closure. An assigned eligible driver may receive exact addresses only after valid assignment. Pending offers expose coarse regions only. Financial Managers receive no address access solely through their role. Enforce authorization server-side; do not return exact address fields in broad order serializers or event-feed details.

### Version 2 signed event contract

Use the existing HMAC canonicalization and replay-window settings at a distinct endpoint, `POST /api/integrations/v2/events/`. V1 endpoints and serializers remain unchanged. The signed request ID must equal `event_id`. JSON is strict (unknown and duplicate keys rejected); `contract_version` is exactly `"2"`; event IDs and `order_reference` are canonical UUID strings; `revision` is a positive signed-64-bit integer allocated transactionally across marketplace-to-driver events for that order; `occurred_at` is ISO-8601 with explicit UTC offset. Revisions increase strictly. An exact duplicate event ID/payload returns the stored response; changed payload under that ID conflicts; stale revisions conflict. Persist the exact serialized payload in the marketplace outbox and retry with that same ID/payload and a fresh timestamp/signature.

`order.authorized`:

```json
{
  "contract_version": "2",
  "source_system": "greenpath_marketplace",
  "event_id": "uuid",
  "event_type": "order.authorized",
  "occurred_at": "timestamp-with-offset",
  "revision": 1,
  "order_reference": "marketplace-order-uuid",
  "buyer": {"external_user_id": "marketplace-user-uuid", "role": "wholesaler"},
  "seller": {"external_user_id": "marketplace-user-uuid", "role": "farmer"},
  "shipment": {
    "pickup": {"region": "name", "zone": "name-or-null", "wereda": "name-or-null", "kebele": "name-or-null", "address_line": "confirmed shipment address"},
    "destination": {"region": "name", "zone": "name-or-null", "wereda": "name-or-null", "kebele": "name-or-null", "address_line": "confirmed shipment address"},
    "product": {"id": "product-uuid", "description": "name/description", "quantity": "decimal", "unit": "source product UOM"},
    "cargo_weight_kg": "positive decimal",
    "packaging_details": "confirmed packaging/handling description",
    "details_revision": 1
  },
  "delivery_fee_proposal": {"amount": "positive decimal", "currency": "ETB", "proposer": "buyer", "version": 1}
}
```

Driver validates active explicit identity mappings and role compatibility; it creates one active shipment/request per buyer and order UUID, then exposes only coarse areas to eligible drivers. Exact addresses remain available only to authorized order participants and a valid assigned driver. The event does not create, reserve, approve, or transfer money.

`payment.status_snapshot`:

```json
{
  "contract_version": "2",
  "source_system": "greenpath_marketplace",
  "event_id": "uuid",
  "event_type": "payment.status_snapshot",
  "occurred_at": "timestamp-with-offset",
  "revision": 2,
  "order_reference": "marketplace-order-uuid",
  "payment": {"status": "HELD"}
}
```

Allowed `payment.status` values are exact marketplace `Order.payment_status` choices: `RESERVED`, `HELD`, `RELEASE_PENDING`, `RELEASED`, `REFUNDED`, and `DISPUTED`. Blank legacy status emits no snapshot. Driver stores the exact value, source, event ID, timestamp, and revision in a separate informational record; it must not set v1 `Shipment.payment_status`, infer delivery-fee payment, or trigger financial effects.

`delivery_fee.review_outcome` is reserved for a later safe stage. It must include order UUID, fee agreement/proposal UUID and version, exact ETB amount, decision (`approved` or `rejected`), reason, timestamp, and opaque marketplace audit-entry reference. Driver may display an outcome as a verified Financial Review action only after authenticating this signed event and deduplicating it. Approval is not a completed transfer. No review or transfer event may be emitted until the authorized marketplace review flow, audit record, and reliable fee-agreement consumer are operational.

### Feed and financial boundary

- Marketplace signs the exact GET path/query using the same HMAC format. Persist one cursor, record each event ID/cursor in an inbox under a database transaction, map only by `order_reference`, and advance the cursor only after successful processing. Duplicate IDs are no-ops; cursor gaps or conflicting IDs stop processing for reconciliation.
- Shipment feed events update only a dedicated marketplace delivery-status projection and audit/event history. They never update goods order/payment state, wallets, ledger, product quality, or order completion.
- Delivery-fee agreement acceptance, marketplace financial review, buyer-balance reservation, payee credit, and external bank payout are distinct states and operations. Existing wallet transactions are user-owned; the separate driver payee has no proven atomic owner/ledger/payout path. Reservation and transfer therefore remain disabled until that path is designed, migration-safe, concurrency-tested, and explicitly enabled. Cancellation after reservation, disputes, post-transfer refund/reversal, and payout failure remain blocked pending approved policy.
- Financial review and any driver-facing review message require an authorized marketplace Financial Manager action and persisted audit record. Driver receives only the signed audited outcome; messages must be neutral system messages and may not fabricate a reviewer identity.

## Controlled implementation status

The following non-financial integration path is implemented locally:

- Marketplace shipment details are order-specific, use structured active administrative locations, and require explicit cargo weight and packaging. Buyer and seller confirmation is bound to a details revision. Authorization is queued only after order acceptance and the existing agreement/participant checks; missing shipment data does not block the goods order.
- Marketplace `order.authorized`, `order.cancelled`, and exact `payment.status_snapshot` payloads are supported by the transactional outbox. The current marketplace workflow still blocks cancellation after driver authorization, so an authorized `order.cancelled` event is not presently reachable. The sender preserves the serialized payload, signs it with the configured server-side secret, applies bounded retry/backoff, and does not deliver later revisions while an earlier revision for that order is pending. A blocked predecessor blocks later revisions for reconciliation.
- DriverApp's existing v1 endpoint and v1 `Shipment.payment_status` are unchanged. The v2 event endpoint stores exact marketplace payment snapshots separately and never performs financial side effects.
- Marketplace can poll the signed DriverApp feed using `python manage.py sync_driver_shipment_events --limit 50`. One page is processed per invocation. The inbox, payload digest, order-to-shipment mapping, dedicated shipment-status projection, audit entries, and cursor update are transactional. A conflicting event or cursor gap rolls back that page. Transient HTTP/network failures receive bounded retries; schedule repeated command runs to drain further pages.
- Once the buyer and driver accept the same current proposal and assignment commits, DriverApp appends `delivery_fee.agreed` to its signed shipment-event feed. Its allowlisted details are `amount` (decimal string), `currency` (`ETB`), `proposal_version` (positive DriverApp proposal version), `buyer_accepted_at`, and `driver_accepted_at` (explicit-offset timestamps). Marketplace persists the signed feed `event_id`, order UUID, driver shipment ID, amount, version, and both acceptance times as an immutable agreement record. This is agreement evidence only, not manager approval, reservation, or payment.
- Driver shipment terminal statuses (`completed`, `cancelled`, `disputed`) close marketplace exact-address visibility. The feed consumer does not change the goods order status, payment state, wallet, ledger, or transaction records.
- Marketplace sender/consumer configuration is server-side only: `GREENPATH_DRIVER_INTEGRATION_BASE_URL` and `GREENPATH_DRIVER_INTEGRATION_SECRET`. Example names only (no secret value): `GREENPATH_DRIVER_INTEGRATION_BASE_URL=https://driver-service.example` and `GREENPATH_DRIVER_INTEGRATION_SECRET=<managed secret of at least 32 characters>`. Use HTTPS except for local loopback development; never expose either setting to frontend builds.

The local changes include marketplace migrations `payments.0009_ordershipmentdetails_and_more`, `payments.0010_drivershipmenteventcursor_and_more`, `payments.0011_drivershipmenteventinbox_payload_sha256`, and `payments.0012_marketplacedeliveryfeeagreement_and_more`, and DriverApp migration `logistics.0014_marketplace_v2_snapshots`. They have not been applied to production. DriverApp `makemigrations --check --dry-run` still reports only the pre-existing `DriverDocument.file` and `ShipmentEvidence.file` upload-path drift; do not fold those changes into this integration migration without separate review.

Marketplace fee review, separate driver-payee ledger operation, reservation/transfer, payout, refund/reversal, cancellation after reservation, disputes workflow, and driver reassignment remain disabled or unimplemented. Proposal and counterproposal versions plus the immutable two-party agreement are synchronized, but financial review and any funds movement are not. Do not claim full integration or financial completion. Local mocked transport tests do not establish live service interoperability; no live credentials, external service, production database, financial operation, or deployment has been used.

Latest local validation: marketplace focused order/wallet/Chapa/contact-privacy/message/privacy/shipment/feed/outbox suite **83 passed**; marketplace Django system check and payment migration check passed. DriverApp Django system check passed. The combined DriverApp integration/shipment run had **47 passed and 2 failures**, both traced to omitted cargo fields in `ShipmentOfferSerializer`; after correcting its field list, all **3 targeted offer/fee-agreement tests passed**. The full 49-test DriverApp run was not repeated after that fix. DriverApp migration check remains blocked only by the two pre-existing file-upload-path alterations noted above.
