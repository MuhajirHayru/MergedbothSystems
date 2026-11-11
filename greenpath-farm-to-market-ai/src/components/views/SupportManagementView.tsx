/**
 * Part 21 — Customer Support.
 *
 * Staff (CUSTOMER_SUPPORT / SUPER_ADMIN): unified inbox with filters, summary,
 * assignment, respond, priority, close, and bulk actions (Part 21.2/21.3).
 * Marketplace users: submit tickets, view history, reply/reopen (Part 21.1).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Send, UserCheck, RefreshCw } from 'lucide-react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { Pager } from '../common/Pager';

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  IN_PROGRESS: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  ANSWERED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  CLOSED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const CATEGORIES = ['REGISTRATION', 'ORDER', 'PAYMENT', 'DELIVERY', 'PRODUCT', 'ACCOUNT', 'COMPLAINT', 'TECHNICAL', 'OTHER'];
const PRIORITIES = ['LOW', 'NORMAL', 'URGENT'];

function fmt(iso: null | string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface TicketMessage { id: string; author_kind: string; author_name: string; body: string; created_at: string }
interface Ticket {
  id: string; reference: string; subject: string; category: string; priority: string;
  status: string; unanswered: boolean; requester: string; requester_role: string;
  requester_region: string;
  assigned_to: null | string; assigned_to_id: null | string; related_order_reference: string;
  created_at: string; answered_at: null | string; messages: TicketMessage[];
}
interface RegionSummary { region: string; total: number; answered: number; unanswered: number; }
interface InboxData {
  summary: {
    total_incoming: number; unanswered: number; assigned: number; urgent: number;
    answered: number; closed: number; by_category: { category: string; total: number }[];
    by_region: RegionSummary[];
  };
  pagination: { page: number; page_size: number; total_items: number; total_pages?: number; has_next: boolean };
  assignees?: { id: string; full_name: string; role: string }[];
  tickets: Ticket[];
}

export const SupportManagementView: React.FC<{ staffView?: boolean }> = ({ staffView = false }) => {
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState<{ status: string; category: string; priority: string; assigned: string; requester: string; unanswered: boolean }>({
    status: '', category: '', priority: '', assigned: '', requester: '', unanswered: false,
  });
  const [regionFilter, setRegionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [bulkBody, setBulkBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 10 };
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.priority) params.priority = filters.priority;
      if (filters.assigned) params.assigned = filters.assigned;
      if (filters.requester.trim()) params.requester = filters.requester.trim();
      if (filters.unanswered) params.unanswered = 'true';
      if (regionFilter) params.region = regionFilter;
      if (dateFrom) params.created_from = dateFrom;
      if (dateTo) params.created_to = dateTo;
      const res = staffView
        ? await api.support.inbox(params)
        : await api.support.myTickets();
      setData(res.data);
    } catch (err) {
      setError(formatApiError(err, 'Support inbox could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [staffView, filters, regionFilter, dateFrom, dateTo, page]);

  useEffect(() => { void load(); }, [load]);
  // Any filter change returns to page 1.
  useEffect(() => { setPage(1); }, [staffView, filters, regionFilter, dateFrom, dateTo]);

  const act = async (ticketId: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.support.action(ticketId, payload);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The support action failed.'));
    } finally {
      setBusy(false);
    }
  };

  const bulk = async (action: string, extra: Record<string, unknown> = {}) => {
    if (selected.length === 0) { setError('Select at least one ticket first.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await api.support.bulk({ action, ticket_ids: selected, ...extra });
      setNotice(`${res.data.processed} ticket(s) processed, ${res.data.skipped} skipped.`);
      setSelected([]);
      setBulkBody('');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The bulk action failed.'));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (t: Ticket) => {
    const body = (replyDraft[t.id] || '').trim();
    if (!body) { setError('Write the response before sending.'); return; }
    await act(t.id, { action: 'respond', body });
    setReplyDraft((d) => ({ ...d, [t.id]: '' }));
  };

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ subject: '', body: '', category: 'OTHER', related_order_reference: '' });

  const submitTicket = async () => {
    if (!form.subject.trim() || !form.body.trim()) { setError('Subject and message are required.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.support.submitTicket({
        subject: form.subject.trim(),
        body: form.body.trim(),
        category: form.category,
        related_order_reference: form.related_order_reference.trim() || undefined,
      });
      setForm({ subject: '', body: '', category: 'OTHER', related_order_reference: '' });
      setFormOpen(false);
      setNotice('Support request submitted. Our team will respond here and by notification.');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not submit the request.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <LifeBuoy className="w-4 h-4" />
            <span>Customer Support</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            {staffView ? 'Support Inbox & Ticket Handling' : 'My Support Requests'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {!staffView && (
            <button onClick={() => setFormOpen((v) => !v)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#15803D] text-white">
              <LifeBuoy className="w-3.5 h-3.5" /> New request
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}

      {staffView && data && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            ['Incoming', data.summary.total_incoming],
            ['Unanswered', data.summary.unanswered],
            ['Assigned', data.summary.assigned],
            ['Urgent', data.summary.urgent],
            ['Answered', data.summary.answered],
            ['Closed', data.summary.closed],
          ].map(([label, value]) => (
            <div key={String(label)} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
              <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{String(value)}</div>
            </div>
          ))}
        </div>
      )}

      {staffView && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select aria-label="Filter tickets by status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All statuses</option>
            {['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select aria-label="Filter tickets by category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Filter tickets by priority" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All priorities</option>
            {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <select aria-label="Filter ticket assignment" value={filters.assigned} onChange={(e) => setFilters({ ...filters, assigned: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All assignments</option><option value="me">Assigned to me</option>
          </select>
          <input aria-label="Search requester" value={filters.requester} onChange={(e) => setFilters({ ...filters, requester: e.target.value })}
            placeholder="Search requester" className="w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5" />
          <label htmlFor="unanswered-only" className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <input type="checkbox" id="unanswered-only" checked={filters.unanswered} onChange={(e) => setFilters({ ...filters, unanswered: e.target.checked })} />
            <span>Unanswered only</span>
          </label>
          <select aria-label="Filter tickets by requester region" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All regions</option>
            {(data?.summary.by_region || []).map((r) => (
              <option key={r.region} value={r.region}>{r.region}</option>
            ))}
          </select>
          <input type="date" aria-label="Created from date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5" />
          <span className="text-slate-400">→</span>
          <input type="date" aria-label="Created to date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5" />
          <button
            onClick={() => { const d = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10); setDateFrom(d); setDateTo(''); }}
            className={`px-2 py-1.5 rounded-lg border text-[11px] font-semibold ${dateFrom === new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`}>
            Recent (7 days)
          </button>
          {(regionFilter || dateFrom || dateTo || filters.status || filters.category || filters.priority || filters.assigned || filters.requester || filters.unanswered) && (
            <button onClick={() => { setRegionFilter(''); setDateFrom(''); setDateTo(''); setFilters({ status: '', category: '', priority: '', assigned: '', requester: '', unanswered: false }); }}
              className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Per-region answered/unanswered breakdown — click a region to filter */}
      {staffView && data && (data.summary.by_region || []).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.summary.by_region.map((r) => (
            <button
              key={r.region}
              onClick={() => setRegionFilter(regionFilter === r.region ? '' : r.region)}
              className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                regionFilter === r.region
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-300'
              }`}
            >
              <span className="font-bold">{r.region}</span>
              <span className="font-mono"> · {r.total}</span>
              {r.unanswered > 0 && <span className="text-rose-600 dark:text-rose-400"> · {r.unanswered} unanswered</span>}
              {r.answered > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · {r.answered} answered</span>}
            </button>
          ))}
        </div>
      )}

      {staffView && selected.length > 0 && (
        <div className="p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-3">
          <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300">{selected.length} ticket(s) selected</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void bulk('priority', { priority: 'URGENT' })} disabled={busy} className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600">Mark urgent</button>
            {CATEGORIES.slice(0, 4).map((c) => (
              <button key={c} onClick={() => void bulk('category', { category: c })} disabled={busy} className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600">→ {c}</button>
            ))}
            <button onClick={() => void bulk('close')} disabled={busy} className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600">Close</button>
          </div>
          <div className="flex gap-2">
            <input
              value={bulkBody}
              onChange={(e) => setBulkBody(e.target.value)}
              placeholder="Approved common response sent to every selected ticket…"
              className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <button onClick={() => void bulk('respond', { body: bulkBody })} disabled={busy || !bulkBody.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
              <Send className="w-3.5 h-3.5" /> Send to all
            </button>
          </div>
        </div>
      )}

      {formOpen && !staffView && (
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Describe the problem or question</div>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Subject (e.g. Escrow funds not released)"
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3}
            placeholder="Explain what happened, including any order reference…"
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={form.related_order_reference} onChange={(e) => setForm({ ...form, related_order_reference: e.target.value })}
              placeholder="Related order reference (optional)"
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
          </div>
          <button onClick={() => void submitTicket()} disabled={busy}
            className="px-4 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500">Loading support tickets…</div>
      ) : !data || data.tickets.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
          {staffView ? 'No tickets match this filter.' : 'You have not submitted any support requests yet.'}
        </div>
      ) : staffView ? (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-2.5 px-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all tickets on this page"
                      checked={data.tickets.length > 0 && data.tickets.every((t) => selected.includes(t.id))}
                      onChange={() => {
                        const pageIds = data.tickets.map((t) => t.id);
                        const allSelected = pageIds.every((id) => selected.includes(id));
                        setSelected((prev) => (allSelected
                          ? prev.filter((id) => !pageIds.includes(id))
                          : [...new Set([...prev, ...pageIds])]));
                      }}
                    />
                  </th>
                  <th className="py-2.5 px-2">Reference</th>
                  <th className="py-2.5 px-3">Subject</th>
                  <th className="py-2.5 px-2">Requester</th>
                  <th className="py-2.5 px-2">Region</th>
                  <th className="py-2.5 px-2">Category</th>
                  <th className="py-2.5 px-2">Priority</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-2">Created</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.tickets.map((t) => (
                  <React.Fragment key={t.id}>
                    <tr
                      onClick={() => setExpandedTicket(expandedTicket === t.id ? null : t.id)}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${expandedTicket === t.id ? 'bg-emerald-50/50 dark:bg-emerald-950/20 font-medium' : ''}`}
                    >
                      <td className="py-2.5 px-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ticket ${t.reference}`}
                          checked={selected.includes(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggle(t.id)}
                        />
                      </td>
                      <td className="py-2.5 px-2 font-mono font-bold text-slate-800 dark:text-slate-100">{t.reference}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100 max-w-56 truncate" title={t.subject}>
                        {t.subject}
                        {t.unanswered && (
                          <span className="ml-2 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 text-[10px] font-bold">needs response</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-400">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{t.requester}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 capitalize">{t.requester_role.replace(/_/g, ' ')}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 text-[10px] font-bold">{t.requester_region}</span>
                      </td>
                      <td className="py-2.5 px-2 text-slate-600 dark:text-slate-400">{t.category}</td>
                      <td className="py-2.5 px-2">
                        {t.priority === 'URGENT'
                          ? <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-bold">URGENT</span>
                          : <span className="text-slate-400">Normal</span>}
                      </td>
                      <td className="py-2.5 px-2">
                        <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${STATUS_STYLES[t.status]}`}>{t.status.replace('_', ' ')}</span>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">{fmt(t.created_at)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400">
                          {expandedTicket === t.id ? 'Hide detail ↑' : 'View detail ↓'}
                        </span>
                      </td>
                    </tr>
                    {expandedTicket === t.id && (
                      <tr>
                        <td colSpan={10} className="bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                          <div className="space-y-2">
                            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              Conversation — {t.reference}
                              {t.related_order_reference ? ` · order ${t.related_order_reference}` : ''}
                              {t.assigned_to ? ` · assigned to ${t.assigned_to}` : ' · unassigned'}
                            </div>
                            <div className="space-y-1.5 max-h-56 overflow-y-auto">
                              {t.messages.map((m) => (
                                <div key={m.id} className={`p-2 rounded-lg text-xs ${m.author_kind === 'STAFF' ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800'}`}>
                                  <div className="font-semibold text-slate-600 dark:text-slate-300">{m.author_name} <span className="text-slate-400 font-normal">· {fmt(m.created_at)}</span></div>
                                  <div className="text-slate-700 dark:text-slate-200">{m.body}</div>
                                </div>
                              ))}
                            </div>
                            {t.status !== 'CLOSED' && (
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                {t.status !== 'ANSWERED' && (
                                  <>
                                    <input
                                      value={replyDraft[t.id] || ''}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setReplyDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                                      placeholder="Write the response the requester will receive…"
                                      className="flex-1 min-w-64 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                                    />
                                    <button onClick={(e) => { e.stopPropagation(); void respond(t); }} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
                                      <Send className="w-3.5 h-3.5" /> Respond &amp; send
                                    </button>
                                  </>
                                )}
                                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300" onClick={(e) => e.stopPropagation()}>
                                  <UserCheck className="w-3.5 h-3.5" /> Assign / reassign
                                  <select aria-label={`Assign ${t.reference}`} value={t.assigned_to_id || ''} disabled={busy}
                                    onChange={(e) => { if (e.target.value) void act(t.id, { action: 'assign', assignee_id: e.target.value }); }}
                                    className="max-w-48 rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800">
                                    <option value="">Choose support agent</option>
                                    {(data.assignees || []).map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name} · {agent.role.replace(/_/g, ' ').toLowerCase()}</option>)}
                                  </select>
                                </label>
                                <button onClick={(e) => { e.stopPropagation(); void act(t.id, { action: 'priority', priority: t.priority === 'URGENT' ? 'NORMAL' : 'URGENT' }); }} disabled={busy}
                                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
                                  {t.priority === 'URGENT' ? 'Normal priority' : 'Mark urgent'}
                                </button>
                                {t.status === 'ANSWERED' && (
                                  <button onClick={(e) => { e.stopPropagation(); void act(t.id, { action: 'close' }); }} disabled={busy}
                                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
                                    Close
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={data.pagination.page}
            pageSize={data.pagination.page_size}
            total={data.pagination.total_items}
            hasMore={Boolean(data.pagination.has_next)}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {data.tickets.map((t) => (
            <div key={t.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{t.reference}</span>
                <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLES[t.status]}`}>{t.status.replace('_', ' ')}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold text-slate-600 dark:text-slate-300">{t.category}</span>
                {t.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">URGENT</span>}
                {t.unanswered && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">needs response</span>}
                <span className="text-slate-400">{fmt(t.created_at)}</span>
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.subject}</div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {t.messages.map((m) => (
                  <div key={m.id} className={`p-2 rounded-lg text-xs ${m.author_kind === 'STAFF' ? 'bg-emerald-50 dark:bg-emerald-950/30' : m.author_kind === 'SYSTEM' ? 'bg-slate-50 dark:bg-slate-800/60 text-slate-500' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
                    <div className="font-semibold text-slate-600 dark:text-slate-300">{m.author_name} <span className="text-slate-400 font-normal">· {fmt(m.created_at)}</span></div>
                    <div className="text-slate-700 dark:text-slate-200">{m.body}</div>
                  </div>
                ))}
              </div>
              {!staffView && t.status !== 'CLOSED' && (
                <ReplyBox ticketId={t.id} onDone={load} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ReplyBox: React.FC<{ ticketId: string; onDone: () => void }> = ({ ticketId, onDone }) => {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (!body.trim()) { setErr('Write a message first.'); return; }
    setBusy(true);
    try {
      await api.support.reply(ticketId, { body });
      setBody('');
      onDone();
    } catch (e) {
      setErr(formatApiError(e, 'Could not send the message.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2">
      <input
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add information or ask a follow-up…"
        className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
      />
      <button onClick={() => void send()} disabled={busy} className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
        Send
      </button>
      {err && <span className="text-[11px] text-rose-600 self-center">{err}</span>}
    </div>
  );
};
