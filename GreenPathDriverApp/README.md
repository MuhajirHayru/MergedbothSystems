# GreenPath Driver App

Independent agricultural logistics workspace for eventual integration with the Green Path Farm-to-Market AI marketplace. The marketplace repository and its actual contracts have not been assumed or modified.

## Implemented

- Next.js 16, React, TypeScript, Tailwind CSS, and an API-connected operations shell.
- Django REST Framework foundation with development and production settings.
- SQLite for local startup; PostgreSQL is supported through `DATABASE_URL`.
- Session authentication with CSRF protection, activation, password recovery, 30-minute sessions, and throttling for login, registration, recovery, and document uploads.
- Server-enforced roles and scoped driver application review.
- Driver registration, editable drafts, submission, private documents, review decisions/history, suspension, and credential-expiry command.
- Database-backed required-field/document policy with environment fallbacks; audit events for account, application, document, and review actions.
- Buyer shipment requests, trusted-marketplace-authorized driver matching, versioned delivery-fee proposals and agreements, conditional single-driver assignment, evidence-backed progress, buyer delivery confirmation, shipment messages, and exception/dispute reporting.
- Backend-enforced pickup arrival, failed-delivery rescheduling, separate driver delivery-confirmation requests and buyer receipt/problem decisions, paginated shipment messages, private evidence downloads, and recipient-scoped in-app notifications.
- Consent-based live driver location sharing with shipment-scoped authorization, latest-position-only storage, authenticated polling, and an OpenStreetMap/Leaflet map.
- OpenAPI schema at `/api/schema/` and Swagger UI at `/api/docs/`.
- Versioned marketplace integration readiness: an opt-in signed server-to-server order/payment event endpoint, idempotent revision handling, and a cursor-polled shipment-event feed. It is disabled until separately configured with shared credentials.

---

## Detailed System Process & Administrative Approval Workflow

### 1. Account Creation, Email Activation, and Initial Visibility
* **Registration (`POST /api/auth/register/`):**
  - Anyone can submit username, email, password, phone number, and preferred language (`en`, `am`, `om`).
  - Upon submission, a `LogisticsUser` is created with role `driver`, `is_active=False`, and `email_verified=False`.
  - An associated `DriverProfile` and an initial draft `DriverApplication` (status `draft`) are created atomically.
  - An activation email is triggered containing a secure token link (`/activate-account?uid=...&token=...`). In development, activation details are returned in the response for convenience.
* **Account Activation (`POST /api/auth/activate/`):**
  - The driver clicks the link or submits the activation token.
  - Upon token validation, `email_verified` becomes `True`, `is_active` becomes `True`, and the driver is automatically logged into an active HTTP-only session.
* **Username & Profile Visibility:**
  - **Self:** The driver can view their own profile and application status via `GET /api/drivers/me/application/`.
  - **Unauthenticated / Other Drivers / Non-Admin Users:** Cannot search, list, or view driver profiles, usernames, or contact numbers.
  - **Administrative Reviewers:** Administrative users (`super_admin`, `top_user_admin`, `regional_admin`, `zonal_admin`, `wereda_admin`) can see the driver's full name, username, phone number, application data, and uploaded documents **if and only if** the application falls within their assigned geographical jurisdiction (or if they are global admins).

---

### 2. Driver Application, Document Upload, and Submission
* **Drafting:** Active drivers fill out vehicle specifications (`vehicle_type`, `cargo_capacity_kg`, `license_number`, `license_expiry`) and service area geography (`service_region`, `service_zone`, `service_wereda`).
* **Document Management (`POST /api/drivers/me/documents/`):**
  - Mandatory private document types (e.g. driving license, vehicle registration/ownership certificate, identity document) are uploaded to secure private storage.
  - Uploaded documents are marked as `pending` verification.
* **Submission (`POST /api/drivers/me/application/submit/`):**
  - Validates that all required fields are complete, cargo capacity is > 0, driving license is unexpired, and all required current documents have been uploaded.
  - Changes application status from `draft` (or `additional_info_required`) to `submitted`.
  - Locks application details and documents against further driver modification while under review.

---

### 3. Administrative Review, Approval, and Scope Hierarchy

#### Reviewer Roles & Geographic Scope (`Greenpathdriverapp/backend/logistics/permissions.py`)
Who can view and approve a driver application is strictly regulated by the reviewer's administrative role and jurisdiction:
- **`super_admin` & `top_user_admin`:** Global scope. Can view, inspect, and approve/reject any driver application across the entire platform.
- **`regional_admin`:** Can view and review applications where `service_region` matches `admin_region`.
- **`zonal_admin`:** Can view and review applications where `service_region` matches `admin_region` AND `service_zone` matches `admin_zone`.
- **`wereda_admin`:** Can view and review applications where `service_region` matches `admin_region`, `service_zone` matches `admin_zone`, AND `service_wereda` matches `admin_wereda`.

*Note:* Self-review is strictly blocked server-side; admins cannot approve or modify their own driver applications.

#### Administrative Workflow
1. **Queue Inspection (`GET /api/driver-applications/`):**
   - Reviewers access their geographically scoped review queue, filterable by status (`submitted`, `under_review`, `additional_info_required`, etc.) or search keywords.
2. **Document Verification (`POST /api/driver-documents/{id}/verify/`):**
   - Reviewer opens individual private documents (accessed via secure non-public streams) and marks each as `verified` or `rejected` with a reason.
3. **Review Decision (`POST /api/driver-applications/{id}/review/`):**
   - Reviewer submits a formal decision along with a mandatory review reason:
     - **`under_review`:** Transitions application into active review.
     - **`additional_info_required`:** Unlocks the application for the driver to update details or replace rejected documents. Driver re-submits when updated.
     - **`approved`:** Driver status becomes `approved`. Driver is now eligible for shipment assignment and live order matching.
     - **`rejected`:** Application is formally denied.
     - **`suspended`:** An approved driver is temporarily suspended from taking new shipments.
4. **Audit Logging & History:** Every status change, document verification, and administrative decision is recorded in immutable `AuditEvent` and `DriverApplicationReview` tables with timestamps and actor IDs.
5. **Automated Expiry (`expire_driver_applications`):** Background commands automatically move approved applications to `expired` status if their license or any current required document expires.

---

### 4. Shipment Matching, Fee Proposals, and Assignment
* **Order Authorization:** Standalone requests stay pending until authorized by the trusted marketplace. Server-to-server HMAC integration matches verified buyers and sellers in ETB currency.
* **Driver Eligibility:** Only active, `approved` drivers with unexpired credentials and no active suspensions receive shipment offers (`GET /api/drivers/me/shipment-offers/`).
* **Versioned Fee Negotiations:**
  - Buyers post initial delivery fee proposals.
  - Offered drivers can accept the proposal or submit counterproposals (`POST .../fee-counterproposal/`).
  - Buyers can accept or reject counterproposals.
* **Atomic Assignment:**
  - When a proposal or offer is accepted, the system executes an atomic transaction with row-level locking.
  - Validates single-driver assignment constraints, updates shipment status to `assigned`, and closes all competing offers.

---

### 5. Delivery Execution, Evidence, and Receipt Confirmation
1. **Pickup & Transit:**
   - Driver marks pickup arrival (`POST .../status/`), confirms pickup with required private evidence photos (e.g. goods loaded), and enters transit.
2. **Messaging & Rescheduling:**
   - Assigned driver and buyer communicate via paginated in-app shipment messages.
   - Exceptions or failed delivery attempts trigger formal delay/reschedule records.
3. **Delivery Completion:**
   - Driver uploads delivery evidence photos and requests delivery confirmation.
   - **Buyer Decision:** Final receipt confirmation (`POST .../confirm-delivery/`) is exclusively controlled by the buyer (or buyer can report a delivery problem/dispute). Drivers cannot self-confirm completed receipt.

---

### 6. Live Location Sharing & Tracking
* **Opt-In Driver Consent:** Assigned drivers must explicitly click **Start sharing location** in an active browser context.
* **Privacy Controls:**
  - Coordinates are accepted only for active, assigned shipments.
  - System records latest position only; location history is not accumulated or exposed in feed events.
  - Tracking is automatically cleared when the shipment is completed, delivered, cancelled, or disputed.
* **Map Rendering:** Interactive OpenStreetMap/Leaflet integration provides real-time geographic status to authorized buyers and drivers.
---

### 7. Driver Availability, Maps, and Live Tracking System

This section details how drivers express their availability and how location tracking and maps function within the GreenPath system.

#### Driver Availability for Shipments
*   **Approved Status:** A driver becomes eligible to receive shipment offers only after their `DriverApplication` status is `approved` by an administrator (Greenpathdriverapp/backend/logistics/models.py:89).
*   **Active & Unexpired Credentials:** In addition to approval, the driver must be `is_active=True` (Greenpathdriverapp/backend/logistics/models.py:58) and their driving license and all required documents must be unexpired (Greenpathdriverapp/backend/logistics/services.py:100, Greenpathdriverapp/backend/logistics/configuration.py:8-10).
*   **No Explicit "Online/Offline" Toggle:** The system does not feature a separate "online" or "offline" toggle for drivers to declare general availability for new orders. Availability is determined by their approved application status and valid credentials.

#### Consent-Based Live GPS Tracking
*   **Opt-In Driver Consent (`POST /api/shipments/{id}/tracking/start/`):**
    *   Live location sharing is *explicitly initiated by the assigned driver* for a specific shipment (Greenpathdriverapp/backend/logistics/location_tracking.py:114). The driver must click "Start sharing location" in a secure browser context (Greenpathdriverapp/README.md:134, Greenpathdriverapp/frontend/src/app/driver-location-sharing.tsx:233-248).
    *   Browser geolocation permission must be granted. The frontend (`Greenpathdriverapp/frontend/src/app/driver-location-sharing.tsx`) handles permission denied or timeout errors (Greenpathdriverapp/frontend/src/app/driver-location-sharing.tsx:51-59).
*   **Shipment-Scoped Authorization:**
    *   The backend (`Greenpathdriverapp/backend/logistics/location_tracking.py:83-99`) strictly enforces that tracking updates are only accepted for an *active, assigned shipment* where the driver is the officially assigned driver (Greenpathdriverapp/backend/logistics/location_tracking.py:107-110).
    *   Buyers can only view location for shipments they are associated with (Greenpathdriverapp/backend/logistics/location_tracking.py:94-96).
*   **Privacy Controls & Data Retention:**
    *   **Latest Position Only:** The system stores only the latest known position for a shipment (`DriverShipmentLocation` model in `Greenpathdriverapp/backend/logistics/models.py`). Location history is *not accumulated* or exposed in feed events (Greenpathdriverapp/README.md:134, Greenpathdriverapp/backend/logistics/location_tracking.py:214-218).
    *   **Automatic Invalidation:** Tracking data is automatically cleared and location sharing stops when the shipment is completed, delivered, cancelled, or disputed (Greenpathdriverapp/backend/logistics/services.py:53-72, Greenpathdriverapp/backend/logistics/location_tracking.py:236-262).
    *   **Session Timeout:** Location sharing has a configurable session timeout, after which it becomes `stale` (Greenpathdriverapp/backend/logistics/location_tracking.py:53-56, Greenpathdriverapp/backend/logistics/location_tracking.py:133-134).
*   **Tracking Statuses:** The system reports various `sharing_status` values: `starting`, `sharing`, `stale`, and `stopped` (Greenpathdriverapp/backend/logistics/location_tracking.py:48-60, Greenpathdriverapp/frontend/src/app/shipment-location-map.tsx:113-119).
*   **Update Frequency:** The frontend sends location updates at a minimum interval of 10 seconds, and a heartbeat every 60 seconds (Greenpathdriverapp/frontend/src/app/driver-location-sharing.tsx:30-31). Updates must be newer than the last accepted update (Greenpathdriverapp/backend/logistics/location_tracking.py:198-203).

#### Map Rendering & User Interface
*   **OpenStreetMap & Leaflet:** The frontend (`Greenpathdriverapp/frontend/src/app/shipment-location-map.tsx`) integrates OpenStreetMap tiles via the Leaflet library to display driver locations (Greenpathdriverapp/README.md:136).
*   **Real-time Polling:** The map component polls the backend for location updates at a `POLL_INTERVAL_MS` of 15 seconds to display near real-time positions (Greenpathdriverapp/frontend/src/app/shipment-location-map.tsx:24, 55-61).
*   **Visual Indicators:** The map displays a marker for the driver's location and provides text to indicate the `sharing_status` (e.g., "Location is fresh," "Last known position is stale," "Driver location sharing is stopped") (Greenpathdriverapp/frontend/src/app/shipment-location-map.tsx:107-119).
*   **Map Recenter:** The map automatically recenters to the driver's latest coordinates when new data is received (Greenpathdriverapp/frontend/src/app/shipment-location-map.tsx:30-34).
*   **OpenStreetMap Policy:** The `README.md` explicitly reminds users to follow the OpenStreetMap tile usage policy and to consider a compliant tile provider or self-hosted tiles for production (see [Local setup](#local-setup)).
## Requirements

- Node.js 20.9 or newer and npm.
- Python 3.12 or newer.
- PostgreSQL only when using a PostgreSQL `DATABASE_URL`; local development defaults to SQLite.

## Local setup

1. Copy `.env.example` to `.env`; use a private `DJANGO_SECRET_KEY` in production (at least 50 random characters).
2. In `backend`, create and activate a virtual environment, then install `requirements.txt`.
3. Run `python manage.py migrate` from `backend` (Phase 2 and shipment foundation migrations are included).
4. Start the API with `python manage.py runserver` from `backend`.
5. Copy `frontend/.env.example` to `frontend/.env.local`, install frontend packages with `npm install`, then run `npm run dev` from `frontend`.
6. Open `http://localhost:3000`. The API health indicator checks `http://localhost:8000/api/health/`.
7. Register as a driver. The development API returns an activation token in the response; activate the account in the UI, sign in, and complete the application.
For PostgreSQL, set `DATABASE_URL` to `postgres://USER:PASSWORD@HOST:5432/DATABASE`. Never commit real credentials.

In production, configure SMTP variables in `.env`/deployment secret settings and set `FRONTEND_BASE_URL` to the trusted frontend origin. Never enable `PASSWORD_RESET_DEBUG_DELIVERY` outside isolated development. Configure a private storage backend using `PRIVATE_DOCUMENT_STORAGE_BACKEND` and its JSON `PRIVATE_DOCUMENT_STORAGE_OPTIONS`; driver documents are never exposed as public media URLs.

For live tracking, use a browser that supports Geolocation and grant location permission only after pressing **Start sharing location**. Localhost is treated as a secure context by modern browsers; deployed sites must use HTTPS. The API accepts tracking only for an authorized marketplace shipment with an active, eligible driver assignment. The page must remain open and active; browser geolocation does not guarantee background tracking after a page is hidden, suspended, or closed. The latest location is kept only for that shipment and is never included in the marketplace shipment-event feed or general shipment serializers. See the tracking API, privacy/retention rules, and the exact `DRIVER_LOCATION_*` settings in [the API and permissions contract](docs/API_AND_PERMISSIONS.md).

The map uses the standard OpenStreetMap tile endpoint and visibly attributes OpenStreetMap contributors. Follow the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/): the public tile servers are not an unlimited or guaranteed production service. For substantial production traffic, select a compliant tile provider or self-hosted tiles before launch; no API key is required for the standard development endpoint.

## Checks

Backend: `python manage.py check`, `python manage.py makemigrations --check --dry-run`, and `python manage.py test logistics.tests` from `backend`.

Frontend: `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` from `frontend`.

## Settings modes

`config.settings.development` is the local default and uses an in-memory email backend for safe activation/recovery testing. Production uses `DJANGO_SETTINGS_MODULE=config.settings.production`, requires a private `DJANGO_SECRET_KEY` and `DJANGO_ALLOWED_HOSTS`, and enables secure cookies and HTTPS redirect by default. Configure trusted origins and deployment-specific database settings using environment variables.

To expire approved drivers whose license or a current document has expired, run `python manage.py expire_driver_applications` from `backend`; schedule this command through the deployment's approved scheduler when one is introduced.