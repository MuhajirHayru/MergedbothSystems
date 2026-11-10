/**
 * Part 26 — Logistics tracking management dashboard.
 * Freight board (authorized shipments) + per-order tracking timeline from the
 * DriverApp shipment feed. For LOGISTICS_MANAGER / SUPER_ADMIN / FM / Support.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Truck, RefreshCw, MapPin } from 'lucide-react';
import { api } from '../../services/apiClient';
import { DataTable } from '../common/DataTable';
import { formatApiError } from '../../lib/apiErrors';

interface ShipmentRow {
  order_id: string;
  order_reference: string;
  product: string;
  quantity: string;
  buyer: string;
  seller: string;
  pickup: string;
  destination: string;
  cargo_weight_kg: string;
  packaging: string;
  driver_shipment_id: null | number;
  driver_shipment_status: string;
  proposed_fee: null | string;
  agreement: null | { amount: string; pricing_model: string; driver_charge: null | string; platform_fee: null | string; driver_payee: string };
  payment_status: null | string;
  compensation_paid: boolean;
  order_status: string;
}

export const LogisticsDashboard: React.FC = () => {
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [timeline, setTimeline] = useState<null | { order: string; driver: null | string; fee: null | string; driver_shipment_status: string; timeline: any[] }>(null);

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (search) params.search = search;
      if (statusFilter) params.shipment_status = statusFilter;
      const res = await api.freight.board(params);
      setRows(res.data.shipments);
      setSummary(res.data.summary);
    } catch (err) {
      setError(formatApiError(err, 'Freight board could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [load]);

  const openTracking = useCallback(async (orderId: string) => {
    setError('');
    try {
      const res = await api.freight.tracking(orderId);
      setTimeline({ order: res.data.order_reference, driver: res.data.driver, fee: res.data.fee, driver_shipment_status: res.data.driver_shipment_status, timeline: res.data.timeline });
    } catch (err) {
      setError(formatApiError(err, 'Tracking could not be loaded.'));
    }
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div>
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
          <Truck className="w-4 h-4" />
          <span>Logistics operations</span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
          Freight &amp; Shipment Tracking Dashboard
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Authorized shipments, driver assignment status, and tracking timelines from the DriverApp feed.
        </p>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            ['Authorized shipments', summary.authorized_shipments],
            ['With fee agreement', summary.with_agreement],
            ['Awaiting agreement', summary.awaiting_agreement],
          ].map(([label, value]) => (
            <div key={String(label)} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
              <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{String(value)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center text-xs">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order, product, address…"
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
          <option value="">All shipment states</option>
          <option value="awaiting_agreement">Awaiting agreement</option>
          <option value="agreed">Agreement recorded</option>
        </select>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading shipments…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">No authorized shipments match.</div>
      ) : (
        <div className="space-y-2">
          {/* Available drivers summary */}
          <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-xs">
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Drivers overview:</span>{" "}
            All approved drivers are visible in <strong>Staff Management → Platform Users &amp; Staff</strong> with availability badges (online/offline toggle from DriverApp).
            {" "}Bid submissions appear in <strong>Freight Bidding</strong> for assignment.
          </div>
          {rows.map((r) => (
            <div key={r.order_reference} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{r.order_reference} · {r.product}</div>
                  <div className="text-[11px] text-slate-500">
                    {r.buyer} → {r.seller} · {r.cargo_weight_kg} kg · {r.packaging}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" /> {r.pickup} → {r.destination}
                  </div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-mono font-bold">{r.proposed_fee ? `${r.proposed_fee} ETB` : 'fee pending'}</div>
                  <div className="text-[11px] text-slate-500">
                    {r.driver_shipment_status ? `driver: ${r.driver_shipment_status.replace(/_/g, ' ')}` : 'not yet in DriverApp'}
                  </div>
                  {r.agreement && (
                    <div className="text-[11px] text-slate-500">
                      {r.agreement.pricing_model === 'A' ? 'Model A' : 'Model B'} · driver {r.agreement.driver_charge} · platform {r.agreement.platform_fee}
                      {r.payment_status ? ` · ${r.payment_status}` : ''}
                      {r.compensation_paid ? ' · compensation paid' : ''}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void openTracking(r.order_id)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600"
                >
                  Tracking
                </button>
              </div>
              {timeline && timeline.order === r.order_reference && (
                <div className="mt-3 border-t border-slate-100 dark:border-slate-800 pt-3 space-y-1.5">
                  {timeline.timeline.map((e: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full ${i === timeline.timeline.length - 1 ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                      <span className="font-mono text-[11px] text-slate-500">{new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{String(e.event_type).replace(/_/g, ' ')}</span>
                      {e.status && <span className="text-slate-500 dark:text-slate-400">→ {String(e.status).replace(/_/g, ' ')}</span>}
                    </div>
                  ))}
                  {timeline.timeline.length === 0 && <div className="text-xs text-slate-500 dark:text-slate-400">No feed events recorded yet.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
