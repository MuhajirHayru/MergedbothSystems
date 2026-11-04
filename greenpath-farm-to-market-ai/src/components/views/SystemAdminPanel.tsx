/**
 * Part 22 — Super Admin System Administration panel.
 * Order oversight, wallet oversight, announcement broadcasting, system health.
 * All data from real APIs — no mock data.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, Wallet, Megaphone, Activity, RefreshCw, Search, Send } from 'lucide-react';
import { api } from '../../services/apiClient';
import { DataTable } from '../common/DataTable';
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

export const SystemAdminPanel: React.FC = () => {
  const [tab, setTab] = useState<Tab>('orders');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<any[]>([]);
  const [orderSummary, setOrderSummary] = useState<any>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [wallets, setWallets] = useState<any[]>([]);
  const [walletSummary, setWalletSummary] = useState<any>(null);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastResult, setBroadcastResult] = useState('');
  const [health, setHealth] = useState<any>(null);
  const [healthError, setHealthError] = useState('');

  const loadOrders = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (orderSearch) params.search = orderSearch;
      if (orderStatusFilter) params.status = orderStatusFilter;
      const res = await api.ordersOversight(params);
      setOrders(res.data.orders);
      setOrderSummary(res.data.summary);
    } catch (err) {
      setError(formatApiError(err, 'Orders could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [orderSearch, orderStatusFilter]);

  const loadWallets = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const res = await api.walletsOversight();
      setWallets(res.data.wallets);
      setWalletSummary(res.data.summary);
    } catch (err) {
      setError(formatApiError(err, 'Wallets could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    setHealthError('');
    try {
      const res = await api.healthDetailed();
      setHealth(res.data);
    } catch (err) {
      setHealthError(formatApiError(err, 'System health could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    if (tab === 'orders') void loadOrders();
    if (tab === 'wallets') void loadWallets();
    if (tab === 'health') void loadHealth();
  }, [tab, loadOrders, loadWallets, loadHealth]);

  const [busy, setBusy] = useState(false);

  const sendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBusy(true);
    try {
      const res = await api.broadcast(broadcastMsg.trim());
      setBroadcastResult(`Announcement sent to ${res.data.sent_to} users.`);
      setBroadcastMsg('');
    } catch (err) {
      setError(formatApiError(err, 'Broadcast failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
          System Administration
        </div>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

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
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} placeholder="Search order, product, buyer…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            </div>
            <select value={orderStatusFilter} onChange={(e) => setOrderStatusFilter(e.target.value)}
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
              { key: 'total', label: 'Total', className: 'text-right font-mono', render: (o: any) => `${Number(o.total).toLocaleString()} ETB` },
              { key: 'discount', label: 'Discount', className: 'text-right', render: (o: any) => Number(o.discount) > 0 ? `-${Number(o.discount).toLocaleString()}` : '—' },
              { key: 'status', label: 'Status', render: (o: any) => <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[o.status] ?? ''}`}>{o.status}</span> },
            ]}
            emptyMessage="No orders match this filter."
            loading={loading}
            error={error}
            filteredTotal={orderSummary?.total}
            bulkLabel="orders"
          />
        </div>
      )}

      {/* Wallets Tab */}
      {tab === 'wallets' && (
        <div className="space-y-3">
          {walletSummary && (
            <div className="grid grid-cols-3 gap-3">
              {[['Total Wallets', walletSummary.total_wallets], ['Total Available', `${Number(walletSummary.total_available).toLocaleString()} ETB`], ['Total Held', `${Number(walletSummary.total_held).toLocaleString()} ETB`]].map(([l, v]) => (
                <div key={String(l)} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                  <div className="text-[10px] text-slate-500 uppercase font-bold">{l}</div>
                  <div className="text-lg font-bold font-mono">{String(v)}</div>
                </div>
              ))}
            </div>
          )}
          <DataTable
            rows={wallets}
            rowId={(w) => w.id}
            rowIdentifier={(w) => w.email}
            columns={[
              { key: 'user', label: 'User', render: (w: any) => <span className="font-semibold">{w.user}</span> },
              { key: 'email', label: 'Email', render: (w: any) => <span className="text-slate-500">{w.email}</span> },
              { key: 'role', label: 'Role', render: (w: any) => w.role.replace(/_/g, ' ') },
              { key: 'available', label: 'Available', className: 'text-right font-mono', render: (w: any) => `${Number(w.available).toLocaleString()} ETB` },
              { key: 'held', label: 'Held', className: 'text-right font-mono', render: (w: any) => `${Number(w.held).toLocaleString()} ETB` },
            ]}
            emptyMessage="No wallets found."
            loading={loading}
            error={error}
            bulkLabel="wallets"
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
            <button onClick={() => void sendBroadcast()} disabled={busy || !broadcastMsg.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
              <Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send to All Users'}
            </button>
            {broadcastResult && <div className="text-xs text-emerald-600 font-semibold">{broadcastResult}</div>}
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
          <div className={`p-4 rounded-2xl border text-xs font-bold ${health.status === 'operational' ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400' : 'border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400'}`}>
            System Status: {health.status.toUpperCase()} · Error rate last hour: {health.error_rate_last_hour}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.services.map((s: any) => (
              <div key={s.name} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 text-xs">{s.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'operational' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800'}`}>{s.status}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">{s.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
