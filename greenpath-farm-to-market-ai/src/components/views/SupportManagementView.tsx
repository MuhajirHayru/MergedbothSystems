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
  assigned_to: null | string; related_order_reference: string;
  created_at: string; answered_at: null | string; messages: TicketMessage[];
}
interface InboxData {
  summary: {
    total_incoming: number; unanswered: number; assigned: number; urgent: number;
    answered: number; closed: number; by_category: { category: string; total: number }[];
  };
  tickets: Ticket[];
}

export const SupportManagementView: React.FC<{ staffView?: boolean }> = ({ staffView = false }) => {
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState<{ status: string; category: string; unanswered: boolean }>({
    status: '', category: '', unanswered: false,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [bulkBody, setBulkBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.unanswered) params.unanswered = 'true';
      const res = staffView
        ? await api.support.inbox(params)
        : await api.support.myTickets();
      setData(res.data);
    } catch (err) {
      setError(formatApiError(err, 'Support inbox could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [staffView, filters]);

  useEffect(() => { void load(); }, [load]);

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
    <div className="space-y-5">
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
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All statuses</option>
            {['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={filters.unanswered} onChange={(e) => setFilters({ ...filters, unanswered: e.target.checked })} />
            Unanswered only
          </label>
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
      ) : (
        <div className="space-y-3">
          {data.tickets.map((t) => (
            <div key={t.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {staffView && (
                  <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} className="mr-1" />
                )}
                <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{t.reference}</span>
                <span className={`px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLES[t.status]}`}>{t.status.replace('_', ' ')}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold text-slate-600 dark:text-slate-300">{t.category}</span>
                {t.priority === 'URGENT' && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">URGENT</span>}
                {t.unanswered && <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">needs response</span>}
                <span className="text-slate-400">{fmt(t.created_at)}</span>
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.subject}</div>
              {staffView && (
                <div className="text-[11px] text-slate-500">
                  Requester: {t.requester} ({t.requester_role.replace(/_/g, ' ')})
                  {t.related_order_reference ? ` · order ${t.related_order_reference}` : ''}
                  {t.assigned_to ? ` · assigned to ${t.assigned_to}` : ' · unassigned'}
                </div>
              )}
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {t.messages.map((m) => (
                  <div key={m.id} className={`p-2 rounded-lg text-xs ${m.author_kind === 'STAFF' ? 'bg-emerald-50 dark:bg-emerald-950/30' : m.author_kind === 'SYSTEM' ? 'bg-slate-50 dark:bg-slate-800/60 text-slate-500' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
                    <div className="font-semibold text-slate-600 dark:text-slate-300">{m.author_name} <span className="text-slate-400 font-normal">· {fmt(m.created_at)}</span></div>
                    <div className="text-slate-700 dark:text-slate-200">{m.body}</div>
                  </div>
                ))}
              </div>
              {staffView && t.status !== 'CLOSED' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {t.status !== 'ANSWERED' && (
                    <>
                      <input
                        value={replyDraft[t.id] || ''}
                        onChange={(e) => setReplyDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                        placeholder="Write the response the requester will receive…"
                        className="flex-1 min-w-64 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                      <button onClick={() => void respond(t)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
                        <Send className="w-3.5 h-3.5" /> Respond
                      </button>
                    </>
                  )}
                  {!t.assigned_to && (
                    <button onClick={() => void act(t.id, { action: 'assign', assignee_id: 'me' })} disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
                      <UserCheck className="w-3.5 h-3.5" /> Assign to me
                    </button>
                  )}
                  <button onClick={() => void act(t.id, { action: 'priority', priority: t.priority === 'URGENT' ? 'NORMAL' : 'URGENT' })} disabled={busy}
                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
                    {t.priority === 'URGENT' ? 'Normal priority' : 'Mark urgent'}
                  </button>
                  {t.status === 'ANSWERED' && (
                    <button onClick={() => void act(t.id, { action: 'close' })} disabled={busy}
                      className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60">
                      Close
                    </button>
                  )}
                </div>
              )}
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
