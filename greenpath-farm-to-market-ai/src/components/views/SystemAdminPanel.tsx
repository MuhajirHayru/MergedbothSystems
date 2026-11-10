/**
 * Part 22 — Super Admin System Administration panel.
 * Order oversight (search/status/pagination), wallet oversight
 * (search/role filter/pagination), announcement broadcasting with history,
 * expiry and end-broadcast, and system health with re-check.
 * All data from real APIs — no mock data.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ShoppingCart, Wallet, Megaphone, Activity, RefreshCw, Search, Send,
  XCircle,
} from 'lucide-react';
import { api } from '../../services/apiClient';
import { DataTable } from '../common/DataTable';
import { Pager } from '../common/Pager';
import { formatApiError } from '../../lib/apiErrors';

type Tab = 'orders' | 'wallets' | 'broadcast' | 'health';

const STATUS_STYLES: Record<string, string> = {
  Completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'Pending seller approval': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Accepted: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  Processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Shipped: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  Disputed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

const ROLES = [
  'FARMER', 'WHOLESALER', 'RETAILER', 'DRIVER', 'SUPER_ADMIN', 'USER_ADMIN',
  'TOP_USER_ADMIN', 'REGIONAL_ADMIN', 'ZONAL_ADMIN', 'WEREDA_ADMIN',
  'FINANCIAL_MANAGER', 'LOGISTICS_MANAGER', 'CUSTOMER_SUPPORT',
];

const money2 = (v: unknown) =>
  `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;

export const SystemAdminPanel: React.FC = () => {
  const [tab, setTab] = useState<Tab>('orders');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [orderSummary, setOrderSummary] = useState<any>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [debouncedOrderSearch, setDebouncedOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [orderPage, setOrderPage] = useState(1);
  const [wallets, setWallets] = useState<any[]>([]);
  const [walletSummary, setWalletSummary] = useState<any>(null);
  const [walletSearch, setWalletSearch] = useState('');
  const [debouncedWalletSearch, setDebouncedWalletSearch] = useState('');
  const [walletRole, setWalletRole] = useState('');
  const [walletPage, setWalletPage] = useState(1);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastExpires, setBroadcastExpires] = useState('');
  const [broadcastResult, setBroadcastResult] = useState('');
  const [broadcastHistory, setBroadcastHistory] = useState<any[]>([]);
  const [historySummary, setHistorySummary] = useState<any>(null);
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [healthError, setHealthError] = useState('');
  const [healthLoading, setHealthLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Debounce search inputs to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedOrderSearch(orderSearch), 400);
    return () => clearTimeout(timer);
  }, [orderSearch]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedWalletSearch(walletSearch), 400);
    return () => clearTimeout(timer);
  }, [walletSearch]);

  const loadOrders = useCallback(async (page = 1) => {
    setError(''); setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 25 };
      if (debouncedOrderSearch) params.search = debouncedOrderSearch;
      if (orderStatusFilter) params.status = orderStatusFilter;
      const res = await api.ordersOversight(params);
      setOrders(res.data.orders);
      setOrderSummary(res.data.summary);
      setOrderPage(res.data.summary?.page ?? page);
      setLastUpdated(new Date());
    } catch (err) {
      setError(formatApiError(err, 'Orders could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [debouncedOrderSearch, orderStatusFilter]);

  const loadWallets = useCallback(async (page = 1) => {
    setError(''); setLoading(true);
    try {
      const params: Record<string, unknown> = { page, page_size: 25 };
      if (debouncedWalletSearch) params.search = debouncedWalletSearch;
      if (walletRole) params.role = walletRole;
      const res = await api.walletsOversight(params);
      setWallets(res.data.wallets);
      setWalletSummary(res.data.summary);
      setWalletPage(res.data.summary?.page ?? page);
      setLastUpdated(new Date());
    } catch (err) {
      setError(formatApiError(err, 'Wallets could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [debouncedWalletSearch, walletRole]);

  const loadHistory = useCallback(async (page = 1) => {
    try {
      const params: Record<string, unknown> = { page, page_size: 10 };
      if (historyFrom) params.from = historyFrom;
      if (historyTo) params.to = historyTo;
      if (historyStatus) params.status = historyStatus;
      const res = await api.broadcastsHistory(params);
      setBroadcastHistory(res.data.broadcasts);
      setHistorySummary(res.data.summary);
      setHistoryPage(res.data.summary?.page ?? page);
      setLastUpdated(new Date());
    } catch {
      /* history stays stale on error; the composer still works */
    }
  }, [historyFrom, historyTo, historyStatus]);

  const loadHealth = useCallback(async (showSpinner = false) => {
    setHealthError('');
    if (showSpinner) setHealthLoading(true);
    try {
      const res = await api.healthDetailed();
      setHealth(res.data);
      setLastUpdated(new Date());
    } catch (err) {
      setHealthError(formatApiError(err, 'System health could not be loaded.'));
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'orders') void loadOrders(orderPage);
    if (tab === 'wallets') void loadWallets(walletPage);
    if (tab === 'broadcast') void loadHistory(historyPage);
    if (tab === 'health') void loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, loadOrders, loadWallets, loadHistory, loadHealth]);

  const [busy, setBusy] = useState(false);

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBusy(true);
    try {
      const res = await api.broadcast(broadcastMsg.trim(), broadcastExpires ? Number(broadcastExpires) : undefined);
      setBroadcastResult(
        `Delivered to ${res.data.recipients ?? res.data.sent_to} users.` +
        (res.data.expires_at ? ` Auto-removes at ${new Date(res.data.expires_at).toLocaleString()}.` : ''),
      );
      setBroadcastMsg('');
      setBroadcastExpires('');
      void loadHistory(1);
    } catch (err) {
      setBroadcastResult(formatApiError(err, 'Broadcast failed.'));
    } finally {
      setBusy(false);
    }
  };

  const endBroadcast = async (id: string) => {
    if (!window.confirm('Remove this announcement from every user\'s inbox? The history record is kept.')) return;
    setEndingId(id);
    try {
      await api.endBroadcast(id);
      void loadHistory(historyPage);
    } catch (err) {
      setBroadcastResult(formatApiError(err, 'Could not end the announcement.'));
    } finally {
      setEndingId(null);
    }
  };

  const refreshCurrent = () => {
    if (tab === 'orders') void loadOrders(orderPage);
    else if (tab === 'wallets') void loadWallets(walletPage);
    else if (tab === 'broadcast') void loadHistory(historyPage);
    else void loadHealth(true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
            System Administration
          </div>
          <h2 className="mt-1.5 text-xl font-bold text-slate-900 dark:text-slate-100">
            System Health &amp; Operations
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
            Order oversight, wallet oversight, platform announcements, and live
            system health — every figure loaded from the platform backend.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {lastUpdated && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500" title="Time of the most recent successful data load">
              Updated {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
          <button onClick={refreshCurrent} disabled={loading || healthLoading}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#116932] text-white text-xs font-bold transition-colors disabled:opacity-60">
            <RefreshCw className={`w-3.5 h-3.5 ${(loading || healthLoading) ? 'animate-spin' : ''}`} /> Refresh data
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 text-xs font-semibold border-b border-slate-200 dark:border-slate-800 pb-0 flex-wrap">
        {([
          ['orders', 'Order Oversight', ShoppingCart],
          ['wallets', 'Wallet Oversight', Wallet],
          ['broadcast', 'Broadcast', Megaphone],
          ['health', 'System Health', Activity],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`px-3 py-2 rounded-t-lg flex items-center gap-1.5 ${tab === id ? 'bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 font-bold' : 'text-slate-500'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {/* Orders Tab */}
      {tab === 'orders' && (
        <div className="space-y-3">
          {orderSummary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[['Total', orderSummary.total], ['Completed', orderSummary.completed], ['Pending', orderSummary.pending], ['Disputed', orderSummary.disputed]].map(([l, v]) => (
                <div key={String(l)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">{l}</div>
                  <div className="text-lg font-bold font-mono">{String(v)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-3 top-2.5" />
              <input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Search order, product, buyer…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            </div>
            <select value={orderStatusFilter} onChange={(e) => { setOrderStatusFilter(e.target.value); setOrderPage(1); }}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2">
              <option value="">All statuses</option>
              {['Completed', 'Pending seller approval', 'Accepted', 'Processing', 'Confirmed', 'Shipped', 'Disputed', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <DataTable
            rows={orders}
            rowId={(o) => o.id}
            rowIdentifier={(o) => o.reference}
            columns={[
              { key: 'reference', label: 'Reference', render: (o: any) => <span className="font-mono font-bold">{o.reference}</span> },
              { key: 'product', label: 'Product' },
              { key: 'buyer', label: 'Buyer' },
              { key: 'seller', label: 'Seller' },
              { key: 'total', label: 'Total', className: 'text-right font-mono', render: (o: any) => money2(o.total) },
              { key: 'discount', label: 'Discount', className: 'text-right font-mono', render: (o: any) => Number(o.discount) > 0 ? `-${money2(o.discount)}` : '—' },
              { key: 'status', label: 'Status', render: (o: any) => <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[o.status] ?? ''}`}>{o.status}</span> },
            ]}
            emptyMessage="No orders match this filter."
            loading={loading}
            error={error}
            filteredTotal={orderSummary?.total}
            bulkLabel="orders"
          />
          <Pager
            page={orderPage}
            pageSize={orderSummary?.page_size ?? 25}
            total={orderSummary?.total}
            hasMore={Boolean(orderSummary?.has_next)}
            onPrev={() => void loadOrders(Math.max(1, orderPage - 1))}
            onNext={() => void loadOrders(orderPage + 1)}
          />
        </div>
      )}

      {/* Wallets Tab */}
      {tab === 'wallets' && (
        <div className="space-y-3">
          {walletSummary && (
            <div className="grid grid-cols-3 gap-3">
              {[['Matching Wallets', walletSummary.total_wallets], ['Available (filtered scope)', money2(walletSummary.total_available)], ['Held (filtered scope)', money2(walletSummary.total_held)]].map(([l, v]) => (
                <div key={String(l)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">{l}</div>
                  <div className="text-lg font-bold font-mono">{String(v)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-3 top-2.5" />
              <input value={walletSearch} onChange={(e) => { setWalletSearch(e.target.value); setWalletPage(1); }} placeholder="Search user name or email…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            </div>
            <select value={walletRole} onChange={(e) => { setWalletRole(e.target.value); setWalletPage(1); }}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2">
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <DataTable
            rows={wallets}
            rowId={(w) => w.id}
            rowIdentifier={(w) => w.id}
            columns={[
              { key: 'user', label: 'User', render: (w: any) => <span className="font-semibold">{w.user}</span> },
              { key: 'email', label: 'Email', render: (w: any) => <span className="text-slate-500">{w.email}</span> },
              { key: 'role', label: 'Role', render: (w: any) => w.role.replace(/_/g, ' ') },
              { key: 'available', label: 'Available', className: 'text-right font-mono', render: (w: any) => money2(w.available) },
              { key: 'held', label: 'Held', className: 'text-right font-mono', render: (w: any) => money2(w.held) },
            ]}
            emptyMessage="No wallets match this filter."
            loading={loading}
            error={error}
            bulkLabel="wallets"
          />
          <Pager
            page={walletPage}
            pageSize={walletSummary?.page_size ?? 25}
            total={walletSummary?.total_wallets}
            hasMore={Boolean(walletSummary?.has_next)}
            onPrev={() => void loadWallets(Math.max(1, walletPage - 1))}
            onNext={() => void loadWallets(walletPage + 1)}
          />
        </div>
      )}

      {/* Broadcast Tab */}
      {tab === 'broadcast' && (
        <div className="space-y-3">
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Megaphone className="w-4 h-4 text-emerald-600" /> Broadcast Announcement to All Users
            </div>
            <textarea value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)} rows={3}
              placeholder="Write the announcement that will appear in every user's notifications…"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor="broadcast-expiry" className="text-[11px] text-slate-500 dark:text-slate-400">Auto-remove after:</label>
              <select id="broadcast-expiry" value={broadcastExpires} onChange={(e) => setBroadcastExpires(e.target.value)}
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1">
                <option value="">Never (stay until ended)</option>
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
              </select>
              <button onClick={() => void sendBroadcast()} disabled={busy || !broadcastMsg.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
                <Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send to All Users'}
              </button>
            </div>
            {broadcastResult && <div className="text-xs text-emerald-600 font-semibold">{broadcastResult}</div>}
          </div>

          {/* History */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Announcement History</div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <label className="text-[11px] text-slate-500 dark:text-slate-400">From</label>
              <input type="date" value={historyFrom} onChange={(e) => { setHistoryFrom(e.target.value); setHistoryPage(1); }}
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1" />
              <label className="text-[11px] text-slate-500 dark:text-slate-400">To</label>
              <input type="date" value={historyTo} onChange={(e) => { setHistoryTo(e.target.value); setHistoryPage(1); }}
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1" />
              <select value={historyStatus} onChange={(e) => { setHistoryStatus(e.target.value); setHistoryPage(1); }}
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
              </select>
            </div>
            {broadcastHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                No announcements sent yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="py-2 pr-3 font-bold">Message</th>
                      <th className="py-2 pr-3 font-bold">Sent</th>
                      <th className="py-2 pr-3 font-bold">In inboxes</th>
                      <th className="py-2 pr-3 font-bold">Created</th>
                      <th className="py-2 pr-3 font-bold">Removes</th>
                      <th className="py-2 pr-3 font-bold">Status</th>
                      <th className="py-2 font-bold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {broadcastHistory.map((b) => (
                      <tr key={b.id} className={`border-b border-slate-50 dark:border-slate-800/50 last:border-0 ${b.status !== 'active' ? 'opacity-60' : ''}`}>
                        <td className="py-2 pr-3 max-w-xs truncate" title={b.message}>{b.message}</td>
                        <td className="py-2 pr-3 font-mono">{b.recipient_count}</td>
                        <td className="py-2 pr-3 font-mono">{b.still_in_inboxes}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {b.ended_at ? '—' : b.expires_at ? new Date(b.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'never'}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${b.status === 'active' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                            {b.status}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          {b.status === 'active' && (
                            <button onClick={() => void endBroadcast(b.id)} disabled={endingId === b.id}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/40 text-[10px] font-bold disabled:opacity-50">
                              <XCircle className="w-3 h-3" /> {endingId === b.id ? 'Ending…' : 'End'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager
              page={historyPage}
              pageSize={historySummary?.page_size ?? 10}
              total={historySummary?.total}
              hasMore={Boolean(historySummary?.has_next)}
              onPrev={() => void loadHistory(Math.max(1, historyPage - 1))}
              onNext={() => void loadHistory(historyPage + 1)}
            />
          </div>
        </div>
      )}

      {/* Health Tab */}
      {tab === 'health' && healthError && (
        <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{healthError}</div>
      )}
      {tab === 'health' && !health && !healthError && (
        <div className="h-20 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
      )}
      {tab === 'health' && health && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className={`flex-1 p-4 rounded-2xl border text-xs font-bold ${health.status === 'operational' ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' : 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400'}`}>
              System Status: {health.status.toUpperCase()} · Failed actions last hour: {health.error_rate_last_hour}
            </div>
            <button onClick={() => void loadHealth(true)} disabled={healthLoading} aria-label="Re-run health checks"
              className="ml-3 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} /> {healthLoading ? 'Checking…' : 'Run checks'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.services.map((s: any) => (
              <div key={s.name} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-xs">{s.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'operational' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : s.status === 'configured' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' : 'bg-amber-100 text-amber-800'}`}>{s.status}</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{s.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
