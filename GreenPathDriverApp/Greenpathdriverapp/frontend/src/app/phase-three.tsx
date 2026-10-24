"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Activity, Bell, CircleAlert, PackageCheck, Truck } from "lucide-react";

import { apiBaseUrl, apiRequest } from "@/lib/logistics-api";
import DriverLocationSharing from "./driver-location-sharing";
import { ConfirmationDialog, StatusBadge } from "./ui";

const ShipmentLocationMap = dynamic(
  () => import("./shipment-location-map"),
  { ssr: false, loading: () => <p role="status">Loading tracking map…</p> },
);

const TRACKING_STATUSES = new Set<ShipmentStatus>([
  "assigned",
  "pickup_pending",
  "pickup_arrived",
  "picked_up",
  "in_transit",
  "delivery_attempted",
  "delivery_confirmation_requested",
]);

type ShipmentStatus =
  | "requested"
  | "fee_proposed"
  | "negotiating"
  | "fee_agreed"
  | "offered"
  | "assigned"
  | "pickup_pending"
  | "pickup_arrived"
  | "picked_up"
  | "in_transit"
  | "delivery_attempted"
  | "delivery_confirmation_requested"
  | "delivered"
  | "completed"
  | "cancelled"
  | "disputed";

type FeeProposal = {
  id: number;
  version: number;
  amount: string;
  currency: string;
  status: string;
  proposed_by_role: string;
  response_reason: string;
  created_at: string;
};

type Shipment = {
  id: number;
  external_order_reference: string | null;
  order_verified: boolean;
  pickup_region: string;
  pickup_zone: string;
  pickup_wereda: string;
  pickup_address: string | null;
  destination_region: string;
  destination_zone: string;
  destination_wereda: string;
  destination_address: string | null;
  product_summary: string;
  cargo_weight_kg: string | null;
  handling_requirements: string;
  status: ShipmentStatus;
  currency: string;
  payment_status: string;
  assigned_driver_username: string | null;
  fee_proposals: FeeProposal[];
  current_fee: { amount: string; currency: string } | null;
  estimated_delivery_at: string | null;
  evidence: {
    id: number;
    evidence_type: string;
    description: string;
    download: string;
    uploaded_at: string;
  }[];
  evidence_requirements: { pickup: boolean; delivery: boolean; max_bytes: number };
  transitions: {
    from_status: ShipmentStatus;
    to_status: ShipmentStatus;
    actor_username: string | null;
    reason: string;
    created_at: string;
  }[];
  exceptions: {
    exception_type: string;
    reason: string;
    created_at: string;
  }[];
};

type ShipmentOffer = {
  id: number;
  shipment_id: number;
  pickup_region: string;
  destination_region: string;
  product_summary: string;
  cargo_weight_kg: string | null;
  handling_requirements: string;
  expires_at: string;
  fee_proposal: Pick<FeeProposal, "id" | "version" | "amount" | "currency" | "proposed_by_role"> | null;
};

type ShipmentMessage = {
  id: number;
  sender_username: string;
  body: string;
  created_at: string;
};

type ShipmentNotification = {
  id: number;
  shipment_id: number;
  event_type: string;
  created_at: string;
  read_at: string | null;
};

type Page<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type PendingConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  success: string;
  action: () => Promise<unknown>;
};

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function PhaseThree({ role }: { role: string }) {
  const isDriver = role === "driver";
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [offers, setOffers] = useState<ShipmentOffer[]>([]);
  const [messages, setMessages] = useState<Record<number, ShipmentMessage[]>>({});
  const [hasOlderMessages, setHasOlderMessages] = useState<Record<number, boolean>>({});
  const [notifications, setNotifications] = useState<ShipmentNotification[]>([]);
  const [counterAmounts, setCounterAmounts] = useState<Record<number, string>>({});
  const [rejectionReasons, setRejectionReasons] = useState<Record<number, string>>({});
  const [feeProposalAmounts, setFeeProposalAmounts] = useState<Record<number, string>>({});
  const [cancellationReasons, setCancellationReasons] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);

  const reload = useCallback(async () => {
    const ownShipments = await apiRequest<Shipment[]>("/shipments/");
    setShipments(ownShipments);
    const notificationPage = await apiRequest<Page<ShipmentNotification>>(
      "/shipments/notifications/?limit=20",
    );
    setNotifications(notificationPage.results);
    if (isDriver) {
      const availableOffers = await apiRequest<ShipmentOffer[]>(
        "/drivers/me/shipment-offers/",
      );
      setOffers(availableOffers);
    }
    const activeShipments = ownShipments.filter(
      (shipment) => shipment.assigned_driver_username,
    );
    const threadResults = await Promise.all(
      activeShipments.map(async (shipment) => [
        shipment.id,
        await apiRequest<Page<ShipmentMessage>>(
          `/shipments/${shipment.id}/messages/?limit=50`,
        ),
      ] as const),
    );
    setMessages(Object.fromEntries(
      threadResults.map(([shipmentId, page]) => [shipmentId, page.results]),
    ));
    setHasOlderMessages(Object.fromEntries(
      threadResults.map(([shipmentId, page]) => [shipmentId, Boolean(page.next)]),
    ));
  }, [isDriver]);

  useEffect(() => {
    let current = true;
    async function loadInitial() {
      try {
        const ownShipments = await apiRequest<Shipment[]>("/shipments/");
        if (!current) return;
        setShipments(ownShipments);
        const notificationPage = await apiRequest<Page<ShipmentNotification>>(
          "/shipments/notifications/?limit=20",
        );
        if (!current) return;
        setNotifications(notificationPage.results);
        if (isDriver) {
          const availableOffers = await apiRequest<ShipmentOffer[]>(
            "/drivers/me/shipment-offers/",
          );
          if (!current) return;
          setOffers(availableOffers);
        }
        const activeShipments = ownShipments.filter(
          (shipment) => shipment.assigned_driver_username,
        );
        const threadResults = await Promise.all(
          activeShipments.map(async (shipment) => [
            shipment.id,
            await apiRequest<Page<ShipmentMessage>>(
              `/shipments/${shipment.id}/messages/?limit=50`,
            ),
          ] as const),
        );
        if (current) setLoading(false);
        if (current) {
          setMessages(Object.fromEntries(
            threadResults.map(([shipmentId, page]) => [shipmentId, page.results]),
          ));
          setHasOlderMessages(Object.fromEntries(
            threadResults.map(([shipmentId, page]) => [shipmentId, Boolean(page.next)]),
          ));
        }
      } catch (reason) {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Could not load shipments.");
          setLoading(false);
        }
      }
    }
    void loadInitial();
    return () => {
      current = false;
    };
  }, [isDriver]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setInterval(() => {
      void reload().catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Could not refresh shipments.");
      });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loading, reload]);

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await action();
      await reload();
      setNotice(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The shipment action failed.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function confirmPendingAction() {
    if (!confirmation) return;
    const completed = await run(confirmation.action, confirmation.success);
    if (completed) setConfirmation(null);
  }

  async function requestShipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload = Object.fromEntries(form.entries());
    const succeeded = await run(
      () => apiRequest("/shipments/", { method: "POST", body: JSON.stringify(payload) }),
      "Delivery request recorded. Driver matching waits for marketplace order verification.",
    );
    if (succeeded) formElement.reset();
  }

  async function uploadEvidence(
    event: FormEvent<HTMLFormElement>,
    shipment: Shipment,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const nextStatus = String(form.get("next_status"));
    const reason = String(form.get("reason") ?? "");
    form.delete("next_status");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      const evidenceRequired =
        nextStatus === "picked_up"
          ? shipment.evidence_requirements.pickup
          : shipment.evidence_requirements.delivery;
      if (evidenceRequired) {
        setError("Select a PDF, PNG, or JPEG evidence file.");
        return;
      }
      const succeeded = await run(
        () => apiRequest(`/shipments/${shipment.id}/status/`, {
          method: "POST",
          body: JSON.stringify({ status: nextStatus, reason }),
        }),
        "Shipment progress updated.",
      );
      if (succeeded) formElement.reset();
      return;
    }
    const succeeded = await run(async () => {
      await apiRequest(`/shipments/${shipment.id}/evidence/`, {
        method: "POST",
        body: form,
      });
      await apiRequest(`/shipments/${shipment.id}/status/`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus, reason }),
      });
    }, "Shipment progress updated.");
    if (succeeded) formElement.reset();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const succeeded = await run(
      () =>
        apiRequest(`/shipments/${shipment.id}/messages/`, {
          method: "POST",
          body: JSON.stringify({ body: form.get("body") }),
        }),
      "Message sent.",
    );
    if (succeeded) formElement.reset();
  }

  async function proposeFee(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const amount = feeProposalAmounts[shipment.id];
    if (!amount) return;
    await run(
      () => apiRequest(`/shipments/${shipment.id}/fee-proposals/`, {
        method: "POST",
        body: JSON.stringify({ amount, currency: shipment.currency }),
      }),
      "New fee proposal sent to eligible drivers.",
    );
  }

  async function reportException(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(
      () => apiRequest(`/shipments/${shipment.id}/exceptions/`, {
        method: "POST",
        body: JSON.stringify({
          exception_type: form.get("exception_type"),
          reason: form.get("reason"),
        }),
      }),
      "Shipment exception recorded.",
    );
  }

  async function reportDispute(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return;
    setConfirmation({
      title: "Dispute this shipment?",
      description: "This records a dispute for the authorized shipment participants. It does not change payment status.",
      confirmLabel: "Submit dispute",
      destructive: true,
      success: "Shipment disputed. Payment remains unchanged.",
      action: () => apiRequest(`/shipments/${shipment.id}/dispute/`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    });
  }

  async function rescheduleDelivery(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localEstimate = String(form.get("estimated_delivery_at") ?? "");
    const estimate = new Date(localEstimate);
    if (!localEstimate || Number.isNaN(estimate.getTime())) {
      setError("Choose a valid future delivery time.");
      return;
    }
    await run(
      () => apiRequest(`/shipments/${shipment.id}/reschedule/`, {
        method: "POST",
        body: JSON.stringify({
          estimated_delivery_at: estimate.toISOString(),
          reason: form.get("reason"),
        }),
      }),
      "Failed delivery rescheduled.",
    );
  }

  async function reportDeliveryProblem(event: FormEvent<HTMLFormElement>, shipment: Shipment) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return;
    setConfirmation({
      title: "Report a delivery problem?",
      description: "The shipment will be disputed and the delivery issue will be recorded for the buyer and driver.",
      confirmLabel: "Report problem",
      destructive: true,
      success: "Delivery problem recorded and shipment disputed.",
      action: () => apiRequest(`/shipments/${shipment.id}/delivery-problem/`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    });
  }

  async function loadOlderMessages(shipment: Shipment) {
    try {
      const offset = messages[shipment.id]?.length ?? 0;
      const page = await apiRequest<Page<ShipmentMessage>>(
        `/shipments/${shipment.id}/messages/?limit=50&offset=${offset}`,
      );
      setMessages((current) => ({
        ...current,
        [shipment.id]: [...(current[shipment.id] ?? []), ...page.results],
      }));
      setHasOlderMessages((current) => ({
        ...current,
        [shipment.id]: Boolean(page.next),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load older messages.");
    }
  }

  const activeCount = shipments.filter((shipment) => TRACKING_STATUSES.has(shipment.status)).length;
  const attentionCount = shipments.filter((shipment) =>
    ["delivery_attempted", "delivery_confirmation_requested"].includes(shipment.status),
  ).length;

  if (loading) {
    return <section className="shipment-workspace" aria-busy="true">Loading shipment workspace…</section>;
  }

  return (
    <section className="shipment-workspace" aria-labelledby="shipment-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DELIVERY OPERATIONS</p>
          <h2 id="shipment-heading">{isDriver ? "Shipment offers and deliveries" : "Delivery requests"}</h2>
        </div>
        <span className="empty-count">{shipments.length} shipments</span>
      </div>
      <p className="panel-description">
        The marketplace integration must verify the order, buyer, and seller before drivers receive an offer.
        Payment collection is not configured; payment status is shown separately from the agreed fee.
      </p>
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

      <section className="shipment-metrics" aria-label="Shipment summary">
        <article className="shipment-metric"><span><PackageCheck size={15} aria-hidden="true" /> {isDriver ? "Eligible offers" : "Your shipments"}</span><strong>{isDriver ? offers.length : shipments.length}</strong></article>
        <article className="shipment-metric"><span><Truck size={15} aria-hidden="true" /> Active deliveries</span><strong>{activeCount}</strong></article>
        <article className="shipment-metric"><span><CircleAlert size={15} aria-hidden="true" /> Needs attention</span><strong>{attentionCount}</strong></article>
      </section>

      <section className="shipment-notifications" id="shipment-notifications" aria-labelledby="shipment-notifications-heading">
        <h3 id="shipment-notifications-heading"><Bell size={16} aria-hidden="true" /> Shipment activity</h3>
        {notifications.length === 0 && <p className="document-empty">No shipment notifications.</p>}
        {notifications.map((notification) => (
          <p className="shipment-notification" key={notification.id}>
            Shipment #{notification.shipment_id}: {readable(notification.event_type)}
            {" · "}{new Date(notification.created_at).toLocaleString()}
            {!notification.read_at && (
              <button
                className="button button-secondary"
                type="button"
                disabled={working}
                onClick={() => run(
                  () => apiRequest(`/shipments/notifications/${notification.id}/read/`, { method: "POST" }),
                  "Notification marked as read.",
                )}
              >Mark read</button>
            )}
          </p>
        ))}
      </section>

      {!isDriver && (
        <form className="shipment-request-form work-panel" onSubmit={requestShipment}>
          <h3>Request delivery for an order</h3>
          <div className="form-grid">
            <label className="form-field">Marketplace order reference<input name="external_order_reference" required maxLength={128} /></label>
            <label className="form-field">Pickup region<input name="pickup_region" required maxLength={100} /></label>
            <label className="form-field">Pickup zone<input name="pickup_zone" maxLength={100} /></label>
            <label className="form-field">Pickup wereda<input name="pickup_wereda" maxLength={100} /></label>
            <label className="form-field">Private pickup address<input name="pickup_address" required /></label>
            <label className="form-field">Destination region<input name="destination_region" required maxLength={100} /></label>
            <label className="form-field">Destination zone<input name="destination_zone" maxLength={100} /></label>
            <label className="form-field">Destination wereda<input name="destination_wereda" maxLength={100} /></label>
            <label className="form-field">Private destination address<input name="destination_address" required /></label>
            <label className="form-field">Product/package summary<input name="product_summary" required maxLength={500} /></label>
            <label className="form-field">Cargo weight (kg)<input name="cargo_weight_kg" type="number" min="0.01" step="0.01" /></label>
            <label className="form-field">Handling requirements<input name="handling_requirements" maxLength={500} /></label>
            <label className="form-field">Proposed fee<input name="initial_fee" type="number" min="0.01" step="0.01" required /></label>
            <label className="form-field">Currency<select name="currency" defaultValue="ETB" required><option value="ETB">Ethiopian birr (ETB)</option></select></label>
            <label className="form-field">Estimated pickup<input name="estimated_pickup_at" type="datetime-local" /></label>
            <label className="form-field">Estimated delivery<input name="estimated_delivery_at" type="datetime-local" /></label>
          </div>
          <button className="button button-primary" type="submit" disabled={working}>Record delivery request</button>
        </form>
      )}

      {isDriver && (
        <div className="shipment-offers" id="available-offers">
          <h3>Available offers</h3>
          {offers.length === 0 && <p className="document-empty">No verified, eligible shipment offers are available.</p>}
          {offers.map((offer) => (
            <article className="shipment-card" key={offer.id}>
              <div className="section-heading">
                <strong>{offer.product_summary}</strong>
                <span className="status-pill">Offer expires {new Date(offer.expires_at).toLocaleString()}</span>
              </div>
              <p>{offer.pickup_region} → {offer.destination_region} · {offer.cargo_weight_kg ?? "Unspecified"} kg</p>
              {offer.handling_requirements && <p>{offer.handling_requirements}</p>}
              {offer.fee_proposal && <p>
                {offer.fee_proposal.proposed_by_role === "driver" ? "Your counterproposal" : "Buyer proposal"}
                {" "}v{offer.fee_proposal.version}: <strong>{offer.fee_proposal.amount} {offer.fee_proposal.currency}</strong>
              </p>}
              <div className="shipment-actions">
                <button
                  className="button button-primary"
                  type="button"
                  disabled={working || !["wholesaler", "retailer"].includes(offer.fee_proposal?.proposed_by_role ?? "")}
                  onClick={() => {
                    const proposal = offer.fee_proposal;
                    if (!proposal || !["wholesaler", "retailer"].includes(proposal.proposed_by_role)) {
                      return;
                    }
                    setConfirmation({
                      title: "Accept this delivery offer?",
                      description: `Accept the current proposal of ${proposal.amount} ${proposal.currency}? This creates the fee agreement and assigns the shipment to you.`,
                      confirmLabel: "Accept and assign",
                      success: "Fee agreed and shipment assigned.",
                      action: () => apiRequest(`/shipments/${offer.shipment_id}/offers/${offer.id}/accept/`, {
                        method: "POST",
                        body: JSON.stringify({ proposal_id: proposal.id, version: proposal.version }),
                      }),
                    });
                  }}
                >{offer.fee_proposal?.proposed_by_role === "driver"
                  ? "Counterproposal awaiting buyer"
                  : "Accept fee and offer"}</button>
                {offer.fee_proposal && ["wholesaler", "retailer"].includes(offer.fee_proposal.proposed_by_role) && <form className="shipment-counter-form" onSubmit={(event) => {
                  event.preventDefault();
                  const proposal = offer.fee_proposal;
                  const amount = counterAmounts[offer.id];
                  if (!proposal || !amount) return;
                  run(
                    () => apiRequest(`/shipments/${offer.shipment_id}/offers/${offer.id}/fee-counterproposal/`, {
                      method: "POST",
                      body: JSON.stringify({ amount, currency: proposal.currency }),
                    }),
                    "Counterproposal sent to the buyer.",
                  );
                }}>
                  <label className="form-field">Counter fee<input aria-label={`Counter fee for shipment ${offer.shipment_id}`} type="number" min="0.01" step="0.01" value={counterAmounts[offer.id] ?? ""} onChange={(event) => setCounterAmounts((values) => ({ ...values, [offer.id]: event.target.value }))} /></label>
                  <button className="button button-secondary" type="submit" disabled={working || !counterAmounts[offer.id]}>Send counterproposal</button>
                </form>}
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={working}
                  onClick={() => run(
                    () => apiRequest(`/shipments/${offer.shipment_id}/offers/${offer.id}/decline/`, {
                      method: "POST",
                      body: JSON.stringify({ reason: "Driver declined this offer." }),
                    }),
                    "Offer declined.",
                  )}
                >Decline</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="shipment-list" id={isDriver ? "assigned-deliveries" : "shipments"}>
          <h3><Activity size={16} aria-hidden="true" /> {isDriver ? "Assigned deliveries and messages" : "Your shipments"}</h3>
        {isDriver && !shipments.some(
          (shipment) =>
            shipment.assigned_driver_username && TRACKING_STATUSES.has(shipment.status),
        ) && (
          <p className="document-empty">
            Location sharing is available only for an authorized active delivery assigned to an eligible approved driver.
          </p>
        )}
        {shipments.length === 0 && <p className="document-empty">No shipments yet.</p>}
        {shipments.map((shipment) => (
          <article className="shipment-card" key={shipment.id}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">SHIPMENT #{shipment.id}</p>
                <strong>{shipment.product_summary}</strong>
              </div>
              <StatusBadge status={shipment.status} />
            </div>
            <p>{shipment.pickup_region} → {shipment.destination_region}{shipment.cargo_weight_kg ? ` · ${shipment.cargo_weight_kg} kg` : ""}</p>
            {!shipment.order_verified && (
              <p className="feedback feedback-warning">Waiting for the marketplace to verify the order, buyer, and seller. No driver offer is shared yet.</p>
            )}
            {shipment.pickup_address && <p>Pickup: {shipment.pickup_address}</p>}
            {shipment.destination_address && <p>Destination: {shipment.destination_address}</p>}
            {shipment.current_fee && <p>Agreed delivery fee: <strong>{shipment.current_fee.amount} {shipment.current_fee.currency}</strong></p>}
            <p>Delivery payment: <strong>{readable(shipment.payment_status)}</strong></p>
            {shipment.assigned_driver_username && TRACKING_STATUSES.has(shipment.status) && (
              isDriver
                ? <DriverLocationSharing shipmentId={shipment.id} />
                : <ShipmentLocationMap shipmentId={shipment.id} />
            )}
            {shipment.estimated_delivery_at && (
              <p>Estimated delivery: {new Date(shipment.estimated_delivery_at).toLocaleString()}</p>
            )}
            {shipment.evidence.length > 0 && (
              <section className="shipment-evidence-list" aria-label={`Shipment ${shipment.id} evidence`}>
                <h4>Private shipment evidence</h4>
                {shipment.evidence.map((item) => (
                  <p key={item.id}>
                    {readable(item.evidence_type)}{item.description ? ` · ${item.description}` : ""}
                    {" · "}{new Date(item.uploaded_at).toLocaleString()}
                    {" · "}<a href={`${apiBaseUrl()}${item.download.replace(/^\/api/, "")}`}>Download evidence</a>
                  </p>
                ))}
              </section>
            )}
            {shipment.transitions.length > 0 && (
              <section className="shipment-progress" aria-label={`Shipment ${shipment.id} progress history`}>
                <h4>Delivery progress</h4>
                <ol>
                  {shipment.transitions.map((transition, index) => (
                    <li key={`${transition.to_status}-${transition.created_at}-${index}`}>
                      {readable(transition.to_status)} · {new Date(transition.created_at).toLocaleString()}
                      {transition.actor_username ? ` · ${transition.actor_username}` : ""}
                      {transition.reason ? ` · ${transition.reason}` : ""}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {!isDriver && shipment.order_verified && ["fee_proposed", "negotiating"].includes(shipment.status) && (
              <button
                className="button button-secondary"
                type="button"
                disabled={working}
                onClick={() => run(
                  () => apiRequest(`/shipments/${shipment.id}/offers/refresh/`, { method: "POST", body: JSON.stringify({}) }),
                  "Eligible driver offers refreshed.",
                )}
              >Refresh eligible drivers</button>
            )}
            {!isDriver && shipment.fee_proposals.filter((proposal) => proposal.proposed_by_role === "driver" && proposal.status === "proposed").map((proposal) => (
              <div className="shipment-actions" key={proposal.id}>
                <span>Driver counterproposal v{proposal.version}: {proposal.amount} {proposal.currency}</span>
                <button className="button button-primary" type="button" disabled={working} onClick={() => setConfirmation({
                  title: "Accept the driver's counterproposal?",
                  description: `Accept ${proposal.amount} ${proposal.currency} and assign this shipment to the counterproposing driver?`,
                  confirmLabel: "Accept and assign",
                  success: "Fee accepted and driver assigned.",
                  action: () => apiRequest(`/shipments/${shipment.id}/fee-proposals/${proposal.id}/accept/`, {
                    method: "POST",
                    body: JSON.stringify({ version: proposal.version }),
                  }),
                })}>Accept and assign</button>
                <label className="form-field">
                  Rejection reason
                  <input
                    aria-label={`Rejection reason for counterproposal ${proposal.id}`}
                    value={rejectionReasons[proposal.id] ?? ""}
                    onChange={(event) => setRejectionReasons((values) => ({ ...values, [proposal.id]: event.target.value }))}
                    required
                  />
                </label>
                <button className="button button-secondary" type="button" disabled={working || !rejectionReasons[proposal.id]?.trim()} onClick={() => run(
                  () => apiRequest(`/shipments/${shipment.id}/fee-proposals/${proposal.id}/reject/`, {
                    method: "POST",
                    body: JSON.stringify({
                      version: proposal.version,
                      reason: rejectionReasons[proposal.id]?.trim(),
                    }),
                  }),
                  "Counterproposal rejected.",
                )}>Reject</button>
              </div>
            ))}
            {!isDriver && shipment.order_verified && ["fee_proposed", "negotiating"].includes(shipment.status) && (
              <form className="shipment-counter-form" onSubmit={(event) => proposeFee(event, shipment)}>
                <label className="form-field">
                  New buyer delivery fee proposal ({shipment.currency})
                  <input
                    aria-label={`New fee proposal for shipment ${shipment.id}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={feeProposalAmounts[shipment.id] ?? ""}
                    onChange={(event) => setFeeProposalAmounts((values) => ({
                      ...values,
                      [shipment.id]: event.target.value,
                    }))}
                    required
                  />
                </label>
                <button className="button button-secondary" type="submit" disabled={working || !feeProposalAmounts[shipment.id]}>
                  Send new fee proposal
                </button>
              </form>
            )}
            {isDriver && shipment.status === "assigned" && (
              <button className="button button-secondary" type="button" disabled={working} onClick={() => run(
                () => apiRequest(`/shipments/${shipment.id}/status/`, { method: "POST", body: JSON.stringify({ status: "pickup_pending" }) }),
                "Pickup arrangements started.",
              )}>Begin pickup arrangements</button>
            )}
            {isDriver && shipment.status === "pickup_pending" && (
              <button className="button button-secondary" type="button" disabled={working} onClick={() => run(
                () => apiRequest(`/shipments/${shipment.id}/status/`, { method: "POST", body: JSON.stringify({ status: "pickup_arrived" }) }),
                "Pickup arrival recorded.",
              )}>Record arrival at pickup</button>
            )}
            {isDriver && shipment.status === "pickup_arrived" && (
              <form className="shipment-evidence-form" onSubmit={(event) => uploadEvidence(event, shipment)}>
                <label className="form-field">Pickup evidence {shipment.evidence_requirements.pickup ? "(required)" : "(optional)"}
                  <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required={shipment.evidence_requirements.pickup} />
                </label>
                <input type="hidden" name="evidence_type" value="pickup" />
                <input type="hidden" name="next_status" value="picked_up" />
                <button className="button button-secondary" type="submit" disabled={working}>Upload evidence and confirm pickup</button>
              </form>
            )}
            {isDriver && shipment.status === "picked_up" && (
              <button className="button button-secondary" type="button" disabled={working} onClick={() => run(
                () => apiRequest(`/shipments/${shipment.id}/status/`, { method: "POST", body: JSON.stringify({ status: "in_transit" }) }),
                "Shipment marked in transit.",
              )}>Start transit</button>
            )}
            {isDriver && shipment.status === "in_transit" && (
              <>
                <form className="shipment-evidence-form" onSubmit={(event) => uploadEvidence(event, shipment)}>
                  <h4>Report an unsuccessful delivery attempt</h4>
                  <label className="form-field">Attempt evidence {shipment.evidence_requirements.delivery ? "(required)" : "(optional)"}
                    <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required={shipment.evidence_requirements.delivery} />
                  </label>
                  <input type="hidden" name="evidence_type" value="delivery_attempt" />
                  <input type="hidden" name="next_status" value="delivery_attempted" />
                  <label className="form-field">Reason<input name="reason" required maxLength={2000} /></label>
                  <button className="button button-secondary" type="submit" disabled={working}>Report failed delivery attempt</button>
                </form>
                <form className="shipment-evidence-form" onSubmit={(event) => uploadEvidence(event, shipment)}>
                  <h4>Request buyer confirmation of successful delivery</h4>
                  <label className="form-field">Delivery evidence {shipment.evidence_requirements.delivery ? "(required)" : "(optional)"}
                    <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" required={shipment.evidence_requirements.delivery} />
                  </label>
                  <input type="hidden" name="evidence_type" value="delivery_confirmation" />
                  <input type="hidden" name="next_status" value="delivery_confirmation_requested" />
                  <button className="button button-primary" type="submit" disabled={working}>Submit delivery for buyer confirmation</button>
                </form>
              </>
            )}
            {!isDriver && shipment.status === "delivery_confirmation_requested" && (
              <>
              <button className="button button-primary" type="button" disabled={working} onClick={() => setConfirmation({
                title: "Confirm delivery received?",
                description: "This records your receipt of the shipment. It does not settle or transfer payment.",
                confirmLabel: "Confirm receipt",
                success: "Delivery confirmed.",
                action: () => apiRequest(`/shipments/${shipment.id}/confirm-delivery/`, { method: "POST", body: JSON.stringify({}) }),
              })}>Confirm receipt</button>
                <form className="shipment-actions" onSubmit={(event) => reportDeliveryProblem(event, shipment)}>
                  <label className="form-field">Problem with delivery<input name="reason" required maxLength={2000} /></label>
                  <button className="button button-warning" type="submit" disabled={working}>Report a problem</button>
                </form>
              </>
            )}
            {(shipment.status === "delivery_attempted") && (
              <form className="shipment-actions" onSubmit={(event) => rescheduleDelivery(event, shipment)}>
                <label className="form-field">New estimated delivery<input name="estimated_delivery_at" type="datetime-local" required /></label>
                <label className="form-field">Rescheduling reason<input name="reason" maxLength={2000} required /></label>
                <button className="button button-secondary" type="submit" disabled={working}>Reschedule failed delivery</button>
              </form>
            )}
            {["requested", "fee_proposed", "negotiating"].includes(shipment.status) && (
              <form className="shipment-actions" onSubmit={(event) => {
              event.preventDefault();
              const reason = cancellationReasons[shipment.id];
              if (reason?.trim()) {
                setConfirmation({
                  title: "Cancel this delivery request?",
                  description: "The request and pending offers will be withdrawn. This action is only available before driver assignment.",
                  confirmLabel: "Cancel request",
                  destructive: true,
                  success: "Shipment request cancelled.",
                  action: () => apiRequest(`/shipments/${shipment.id}/cancel/`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) }),
                });
              }
              }}>
              <label className="form-field">Cancellation reason<input value={cancellationReasons[shipment.id] ?? ""} onChange={(event) => setCancellationReasons((values) => ({ ...values, [shipment.id]: event.target.value }))} maxLength={2000} required /></label>
              <button className="button button-secondary" type="submit" disabled={working}>Cancel request</button>
              </form>
            )}
            {shipment.assigned_driver_username && ["assigned", "pickup_pending", "pickup_arrived", "picked_up", "in_transit", "delivery_attempted", "delivery_confirmation_requested"].includes(shipment.status) && (
              <form className="shipment-evidence-form" onSubmit={(event) => reportException(event, shipment)}>
              <label className="form-field">Report delivery issue
                <select name="exception_type" defaultValue="delay">
                  <option value="delay">Delay</option>
                  <option value="incident">Incident</option>
                  <option value="failed_delivery">Failed delivery</option>
                </select>
              </label>
              <label className="form-field">Reason<input name="reason" required maxLength={2000} /></label>
              <button className="button button-secondary" type="submit" disabled={working}>Report issue</button>
              </form>
            )}
            {shipment.assigned_driver_username && ["assigned", "pickup_pending", "pickup_arrived", "picked_up", "in_transit", "delivery_attempted", "delivery_confirmation_requested", "delivered"].includes(shipment.status) && (
              <form className="shipment-actions" onSubmit={(event) => reportDispute(event, shipment)}>
              <label className="form-field">Dispute reason<input name="reason" required maxLength={2000} /></label>
              <button className="button button-warning" type="submit" disabled={working}>Report dispute</button>
              </form>
            )}
            {shipment.assigned_driver_username && (
              <div className="shipment-messages">
                <p className="eyebrow">SHIPMENT MESSAGES</p>
                {messages[shipment.id]?.length === 0 && <p className="document-empty">No messages yet.</p>}
                {hasOlderMessages[shipment.id] && (
                  <button className="button button-secondary" type="button" disabled={working} onClick={() => void loadOlderMessages(shipment)}>
                    Load older messages
                  </button>
                )}
                {messages[shipment.id]?.map((message) => (
                  <p className="shipment-message" key={message.id}>
                    <strong>{message.sender_username}</strong> · {new Date(message.created_at).toLocaleString()}<br />
                    {message.body}
                  </p>
                ))}
                <form className="shipment-message-form" onSubmit={(event) => sendMessage(event, shipment)}>
                  <label className="form-field">Message<textarea name="body" maxLength={2000} required /></label>
                  <button className="button button-secondary" type="submit" disabled={working}>Send message</button>
                </form>
              </div>
            )}
          </article>
        ))}
      </div>
      <ConfirmationDialog
        open={confirmation !== null}
        title={confirmation?.title ?? "Confirm action"}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "Confirm"}
        destructive={confirmation?.destructive}
        busy={working}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmPendingAction()}
      />
    </section>
  );
}
