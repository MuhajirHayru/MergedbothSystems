"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  PageLoader,
  Select,
  Textarea,
} from "@/components/ui";
import { paymentsApi } from "@/lib/api/client";
import { formatDateTime, formatEtb } from "@/lib/format";
import type { DeliveryFeeAgreement } from "@/lib/types";

export default function DeliveryFeeReviewsPage() {
  const [agreements, setAgreements] = useState<DeliveryFeeAgreement[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await paymentsApi.deliveryFeeAgreements(filter);
      setAgreements(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load delivery-fee agreements.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (agreement: DeliveryFeeAgreement, decision: "approved" | "rejected") => {
    const reason = (reasons[agreement.id] || "").trim();
    if (decision === "rejected" && !reason) {
      setError("Add a reason before rejecting this agreement.");
      return;
    }
    setError("");
    setNotice("");
    setBusyId(agreement.id);
    try {
      await paymentsApi.reviewDeliveryFeeAgreement(agreement.id, {
        decision,
        proposal_version: agreement.driver_proposal_version,
        ...(decision === "rejected" ? { rejection_reason: reason } : {}),
      });
      setNotice("Review decision recorded. No funds were reserved or transferred.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The review decision could not be recorded.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell title="Delivery Fee Reviews" allow={["FINANCIAL_MANAGER"]}>
      <div className="mb-6 max-w-3xl">
        <p className="text-sm text-gray-600">
          Review the immutable delivery-fee agreement and proposal revision. An approval records a review decision only; it does not reserve or transfer money.
        </p>
      </div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Select
          aria-label="Agreement status"
          className="w-full sm:w-52"
          value={filter}
          onChange={(event) => setFilter(event.target.value as "pending" | "all")}
        >
          <option value="pending">Awaiting review</option>
          <option value="all">All agreements</option>
        </Select>
        <Button variant="secondary" onClick={() => void load()} loading={loading}>
          Refresh
        </Button>
      </div>
      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={() => void load()} /></div>}
      {notice && <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading ? (
        <PageLoader />
      ) : agreements.length === 0 ? (
        <EmptyState title="No agreements to review" description="New delivery-fee agreements will appear here after the shipment parties agree." />
      ) : (
        <div className="space-y-4">
          {agreements.map((agreement) => (
            <Card key={agreement.id}>
              <CardHeader
                title={`Order ${agreement.order_reference}`}
                subtitle={`Recorded ${formatDateTime(agreement.recorded_at)} · Agreement ${agreement.agreement_event_id}`}
                action={
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${agreement.review_status === "pending" ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-700"}`}>
                    {agreement.review_status === "pending" ? "Pending review" : agreement.review_status}
                  </span>
                }
              />
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-gray-500">Agreed fee</dt><dd className="font-semibold text-gray-900">{formatEtb(agreement.amount)}</dd></div>
                <div><dt className="text-gray-500">Proposal revision</dt><dd className="font-semibold text-gray-900">{agreement.driver_proposal_version}</dd></div>
                <div><dt className="text-gray-500">Buyer</dt><dd className="font-semibold text-gray-900">{agreement.buyer_name}</dd></div>
                <div><dt className="text-gray-500">Seller</dt><dd className="font-semibold text-gray-900">{agreement.seller_name}</dd></div>
                <div><dt className="text-gray-500">Driver shipment</dt><dd className="font-semibold text-gray-900">{agreement.driver_shipment_id}</dd></div>
                <div><dt className="text-gray-500">Buyer accepted</dt><dd className="font-semibold text-gray-900">{formatDateTime(agreement.buyer_accepted_at)}</dd></div>
                <div><dt className="text-gray-500">Driver accepted</dt><dd className="font-semibold text-gray-900">{formatDateTime(agreement.driver_accepted_at)}</dd></div>
              </dl>
              {agreement.review ? (
                <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                  <p>{agreement.review.decision === "approved" ? "Approved" : "Rejected"} by {agreement.review.actor_name} · {formatDateTime(agreement.review.decided_at)}</p>
                  {agreement.review.rejection_reason && <p className="mt-1">Reason: {agreement.review.rejection_reason}</p>}
                </div>
              ) : (
                <div className="mt-5 grid gap-3 border-t border-gray-100 pt-4 md:grid-cols-[1fr_auto_auto] md:items-end">
                  <label className="text-sm font-medium text-gray-700">
                    Rejection reason
                    <Textarea
                      className="mt-1"
                      value={reasons[agreement.id] || ""}
                      onChange={(event) => setReasons((current) => ({ ...current, [agreement.id]: event.target.value }))}
                      placeholder="Required only when rejecting"
                      maxLength={2000}
                    />
                  </label>
                  <Button variant="danger" disabled={busyId !== null} loading={busyId === agreement.id} onClick={() => void decide(agreement, "rejected")}>
                    Reject
                  </Button>
                  <Button disabled={busyId !== null} loading={busyId === agreement.id} onClick={() => void decide(agreement, "approved")}>
                    Approve
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
