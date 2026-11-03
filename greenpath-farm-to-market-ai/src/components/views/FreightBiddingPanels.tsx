/**
 * Part 26 — freight bidding UIs.
 * FreightBidsPanel: logistics staff compare bids and assign (controls everything).
 * DriverFreightBoard: drivers browse open jobs and bid (Uber-style), on port 3000.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Gavel, CheckCircle2, Ban, RefreshCw, Truck, MapPin } from 'lucide-react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

function fmt(iso: null | string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}


const DELIVERY_LABELS: Record<string, string> = {
  PICKUP_IN_PROGRESS: 'En route to pickup',
  ARRIVED_AT_PICKUP: 'Arrived at pickup',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit to buyer',
  DELIVERED: 'Delivered',
};

function fmtDate(iso: null | string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  ASSIGNED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  CANCELLED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  SUBMITTED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ACCEPTED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  WITHDRAWN: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

interface Bid { id: string; driver: string; driver_id: string; amount: string; estimated_hours: number; message: string; status: string; created_at: string }
interface Job {
  my_bid?: null | { amount: string; status: string };
  id: string; order_reference: string; product: string; quantity: string; buyer: string;
  pickup: string; destination: string; cargo_weight_kg: null | string; packaging: string;
  status: string; assigned_driver: null | string; assigned_fee: null | string;
  published_at: string; bid_count: number; bids: Bid[];
}

export const FreightBidsPanel: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const res = await api.freight.staffJobs();
      setJobs(res.data.jobs);
      setSummary(res.data.summary);
    } catch (err) {
      setError(formatApiError(err, 'Freight jobs could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const assign = async (job: Job, bid: Bid) => {
    setBusyId(bid.id); setError(''); setNotice('');
    try {
      await api.freight.assignBid(job.id, bid.id);
      setNotice(`Bid accepted: ${bid.driver} at ${bid.amount} ETB for ${job.order_reference}. The driver has been notified.`);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not assign the bid.'));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (job: Job) => {
    setBusyId(job.id); setError(''); setNotice('');
    try {
      await api.freight.cancelJob(job.id, 'Cancelled from the logistics dashboard');
      setNotice(`Job ${job.order_reference} cancelled.`);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not cancel the job.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Gavel className="w-4 h-4 text-emerald-600" /> Freight bidding — compare bids and assign drivers
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[['Open', summary.open], ['Assigned', summary.assigned], ['Completed', summary.completed], ['Cancelled', summary.cancelled]].map(([l, v]) => (
            <div key={String(l)} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">{l}</div>
              <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{String(v)}</div>
            </div>
          ))}
        </div>
      )}
      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading freight jobs…</div>
      ) : jobs.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
          No freight jobs yet. Jobs are created automatically when an order's shipment is confirmed and authorized.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{j.order_reference}</span>
                  <span className="text-xs text-slate-500 ml-2">{j.product} · {j.quantity} · {j.buyer}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[j.status]}`}>{j.status}</span>
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <Truck className="w-3 h-3" /> {j.pickup} → {j.destination} · {j.cargo_weight_kg ?? '—'} kg · bids: {j.bid_count}
              </div>
              {j.bids.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-1.5 pr-3">Driver</th><th className="py-1.5 pr-3 text-right">Bid</th>
                      <th className="py-1.5 pr-3 text-right">ETA (hrs)</th><th className="py-1.5 pr-3">Message</th>
                      <th className="py-1.5 pr-3">Status</th><th className="py-1.5"></th>
                    </tr></thead>
                    <tbody>
                      {j.bids.map((b) => (
                        <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/60">
                          <td className="py-1.5 pr-3 font-semibold">{b.driver}</td>
                          <td className="py-1.5 pr-3 text-right font-mono font-bold">{b.amount} ETB</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{b.estimated_hours}h</td>
                          <td className="py-1.5 pr-3 text-slate-500">{b.message || '—'}</td>
                          <td className="py-1.5 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[b.status]}`}>{b.status}</span></td>
                          <td className="py-1.5">
                            {j.status === 'OPEN' && b.status === 'SUBMITTED' && (
                              <button onClick={() => void assign(j, b)} disabled={busyId === b.id}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#15803D] text-white text-[11px] font-semibold disabled:opacity-60">
                                <CheckCircle2 className="w-3 h-3" /> Accept
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {j.status === 'OPEN' && (
                <button onClick={() => void cancel(j)} disabled={busyId === j.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
                  <Ban className="w-3.5 h-3.5" /> Cancel job
                </button>
              )}
              {j.assigned_driver && (
                <div className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                  Assigned to {j.assigned_driver} for {j.assigned_fee} ETB
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* --------------------------- Driver job board --------------------------- */


export const DriverAvailabilityToggle: React.FC = () => {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.freight.availability();
      setAvailable(res.data.available);
      setEligible(res.data.eligible);
    } catch (err) {
      setError(formatApiError(err, 'Availability could not be loaded.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await api.freight.setAvailability(!available);
      setAvailable(res.data.available);
      setEligible(res.data.eligible);
      setNotice(res.data.available ? 'You are now online and available for jobs.' : 'You are now offline.');
    } catch (err) {
      setError(formatApiError(err, 'Could not change availability.'));
    } finally {
      setBusy(false);
    }
  };

  const statusColor = available
    ? 'bg-emerald-500'
    : eligible ? 'bg-slate-400' : 'bg-amber-500';
  const statusLabel = available
    ? 'Online — Available for jobs'
    : eligible ? 'Offline — Go online to receive jobs' : 'Not eligible — Check documents/approval';

  return (
    <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={`w-3 h-3 rounded-full ${statusColor} ${available ? 'animate-pulse' : ''}`} />
        <div>
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{statusLabel}</div>
          {error && <div className="text-[11px] text-rose-600">{error}</div>}
          {notice && <div className="text-[11px] text-emerald-600">{notice}</div>}
        </div>
      </div>
      <button
        onClick={() => void toggle()}
        disabled={busy || available === null}
        className={`px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60 ${
          available ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#15803D] hover:bg-[#166534]'
        }`}
      >
        {available ? 'Go Offline' : 'Go Online'}
      </button>
    </div>
  );
};

export const DriverFreightBoard: React.FC = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [myBids, setMyBids] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bidForm, setBidForm] = useState<Record<string, { amount: string; hours: string; message: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const [board, bids] = await Promise.all([api.freight.driverJobs(), api.freight.myBids()]);
      setJobs(board.data.jobs);
      setMyBids(bids.data.bids);
    } catch (err) {
      setError(formatApiError(err, 'Freight jobs could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const placeBid = async (jobId: string) => {
    const form = bidForm[jobId] || { amount: '', hours: '24', message: '' };
    if (!form.amount || Number(form.amount) <= 0) { setError('Enter your bid amount first.'); return; }
    setBusyId(jobId); setError(''); setNotice('');
    try {
      await api.freight.placeBid(jobId, {
        amount: form.amount,
        estimated_hours: Number(form.hours || 24),
        message: form.message.trim() || undefined,
      });
      setNotice('Bid submitted. The logistics team will compare all bids and assign.');
      setBidForm((f) => ({ ...f, [jobId]: { amount: '', hours: '24', message: '' } }));
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not submit the bid.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <DriverAvailabilityToggle />
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Truck className="w-4 h-4 text-emerald-600" /> Available delivery jobs — bid to get assigned
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}
      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading job board…</div>
      ) : jobs.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
          No open jobs right now. New delivery jobs appear here the moment an order's shipment is confirmed.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{j.order_reference} · {j.product}</div>
                {j.my_bid && <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLES[j.my_bid.status]}`}>your bid: {j.my_bid.amount} ETB</span>}
              </div>
              <div className="text-[11px] text-slate-500 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {j.pickup} → {j.destination} · {j.cargo_weight_kg ?? '—'} kg · {j.packaging || 'no packaging info'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                <input value={bidForm[j.id]?.amount ?? ''} onChange={(e) => setBidForm((f) => ({ ...f, [j.id]: { ...f[j.id], amount: e.target.value } }))}
                  placeholder="Your bid (ETB)" type="number" min={1}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                <input value={bidForm[j.id]?.hours ?? '24'} onChange={(e) => setBidForm((f) => ({ ...f, [j.id]: { ...f[j.id], hours: e.target.value } }))}
                  placeholder="ETA hours" type="number" min={1}
                  className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                <input value={bidForm[j.id]?.message ?? ''} onChange={(e) => setBidForm((f) => ({ ...f, [j.id]: { ...f[j.id], message: e.target.value } }))}
                  placeholder="Message (optional)"
                  className="sm:col-span-2 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <button onClick={() => void placeBid(j.id)} disabled={busyId === j.id}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
                <Gavel className="w-3.5 h-3.5" /> {busyId === j.id ? 'Submitting…' : j.my_bid ? 'Update bid' : 'Place bid'}
              </button>
            </div>
          ))}
        </div>
      )}
      {myBids.length > 0 && (
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">My bid history</div>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <th className="py-1.5 pr-3">Order</th><th className="py-1.5 pr-3 text-right">Bid</th><th className="py-1.5 pr-3">Status</th>
            </tr></thead>
            <tbody>
              {myBids.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-1.5 pr-3">{b.order_reference}</td>
                  <td className="py-1.5 pr-3 text-right font-mono font-bold">{b.amount} ETB</td>
                  <td className="py-1.5 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[b.status]}`}>{b.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* --------------- Driver assigned-delivery workspace (Part 10/15) --------------- */

interface Assignment {
  job_id: string;
  order_reference: string;
  product: string;
  quantity: string;
  cargo_weight_kg: null | string;
  packaging: string;
  status: string;
  assigned_at: string;
  my_fee: null | string;
  delivery_status: string;
  delivery_status_updated_at: null | string;
  addresses_disclosed: boolean;
  seller: { name: null | string; pickup_address: null | string };
  buyer: { name: null | string; delivery_address: null | string };
}

export const DriverAssignmentsPanel: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyAdvance, setBusyAdvance] = useState<string | null>(null);

  const advanceDelivery = async (jobId: string) => {
    setBusyAdvance(jobId); setError('');
    try {
      await api.freight.advanceDelivery(jobId);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not advance the delivery.'));
    } finally {
      setBusyAdvance(null);
    }
  };

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const res = await api.freight.myAssignments();
      setAssignments(res.data.assignments);
    } catch (err) {
      setError(formatApiError(err, 'Assigned deliveries could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
          My assigned deliveries — exact addresses released by the logistics manager
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading assignments…</div>
      ) : assignments.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
          No assigned deliveries yet. Win a bid on the job board and the exact addresses will appear here.
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => (
            <div key={a.job_id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{a.order_reference} · {a.product}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">{a.status}</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{a.my_fee} ETB</span>
                </div>
              </div>
              <div className="text-[11px] text-slate-500">
                {a.quantity} · {a.cargo_weight_kg ?? '—'} kg · {a.packaging || '—'} · assigned {fmtDate(a.assigned_at)}
              </div>
              {a.addresses_disclosed && a.status === 'ASSIGNED' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">Pickup — seller</div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{a.seller.name ?? '—'}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">{a.seller.pickup_address ?? '—'}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400 mb-1">Delivery — buyer</div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{a.buyer.name ?? '—'}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-300">{a.buyer.delivery_address ?? '—'}</div>
                  </div>
                </div>
              )}
              {a.addresses_disclosed && a.status === 'ASSIGNED' && a.delivery_status && a.delivery_status !== 'DELIVERED' && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-500">Status:</span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 text-[11px] font-bold">
                    {(DELIVERY_LABELS as any)[a.delivery_status] ?? a.delivery_status.replace(/_/g, ' ')}
                  </span>
                  <button
                    onClick={() => void advanceDelivery(a.job_id)}
                    disabled={busyAdvance === a.job_id}
                    className="px-3 py-1 rounded-lg bg-[#15803D] text-white text-[11px] font-semibold disabled:opacity-60"
                  >
                    {busyAdvance === a.job_id ? 'Updating…' : 'Advance to next status'}
                  </button>
                </div>
              )}
              {a.delivery_status === 'DELIVERED' && (
                <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                  ✓ Delivery completed — awaiting buyer confirmation
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
