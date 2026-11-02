import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import {
  ApiOrder,
  buyerIdOf,
  formatDateTime,
  formatEtb,
  formatQuantity,
  mediaUrl,
  paymentClasses,
  sellerIdOf,
  shipmentStateLabel,
  statusClasses,
} from '../../lib/orders';
import {
  AlertCircle,
  ChevronRight,
  Inbox,
  Loader2,
  Package,
  Search,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react';

type Tab = 'incoming' | 'purchases';

const STATUS_OPTIONS = [
  'All statuses',
  'Pending seller approval',
  'Accepted',
  'Processing',
  'Confirmed',
  'Shipped',
  'Delivered',
  'Awaiting quality confirmation',
  'Awaiting payment release',
  'Completed',
  'Rejected',
  'Disputed',
  'Cancelled',
];

export const OrdersView: React.FC = () => {
  const { currentUser, setActiveView } = useApp();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('incoming');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All statuses');

  const meId = String(currentUser?.id || '');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.orders.list();
      const rows = Array.isArray(res?.data?.results)
        ? res.data.results
        : Array.isArray(res?.data)
        ? res.data
        : [];
      setOrders(rows as ApiOrder[]);
    } catch (err: any) {
      setError(formatApiError(err, 'Orders could not be loaded.'));
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, meId]);

  const incoming = useMemo(
    () => orders.filter((order) => sellerIdOf(order) === meId),
    [orders, meId]
  );
  const purchases = useMemo(
    () => orders.filter((order) => buyerIdOf(order) === meId),
    [orders, meId]
  );

  // A wholesaler can both sell and buy, so the workspace defaults to the tab
  // that has work in it instead of an empty screen.
  useEffect(() => {
    if (loading) return;
    if (incoming.length === 0 && purchases.length > 0) setTab('purchases');
  }, [loading, incoming.length, purchases.length]);

  const visible = (tab === 'incoming' ? incoming : purchases).filter((order) => {
    const query = search.trim().toLowerCase();
    const matchesQuery =
      !query ||
      [order.reference, order.product_title, order.buyer_name, order.seller_name].some(
        (value) => String(value || '').toLowerCase().includes(query)
      );
    const matchesStatus = status === 'All statuses' || order.status === status;
    return matchesQuery && matchesStatus;
  });

  const openOrder = (order: ApiOrder) => {
    setActiveView('orders');
    navigate(`/orders/${order.id}`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            Escrow order workspace
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">
            Incoming orders & purchases
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Orders are matched to the real seller of the product: farmer-owned listings
            notify the farmer, wholesaler-owned listings notify the wholesaler.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="self-start px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setTab('incoming')}
          className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
            tab === 'incoming'
              ? 'bg-[#15803D] text-white'
              : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
          }`}
        >
          <Inbox className="w-3.5 h-3.5" />
          Incoming orders ({incoming.length})
        </button>
        <button
          onClick={() => setTab('purchases')}
          className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
            tab === 'purchases'
              ? 'bg-[#15803D] text-white'
              : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          My purchases ({purchases.length})
        </button>

        <div className="relative flex-1 min-w-[200px] max-w-sm ml-auto">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search reference, product, buyer or seller"
            className="w-full pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="text-xs px-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{error}</span>
          <button
            onClick={() => void load()}
            className="ml-auto underline font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-10 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading orders…
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2">
          <Package className="w-7 h-7 text-slate-400 mx-auto" />
          <p className="text-sm font-semibold">
            {tab === 'incoming' ? 'No incoming orders' : 'No purchases yet'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {search || status !== 'All statuses'
              ? 'No order matches the current search and status filter.'
              : tab === 'incoming'
              ? 'When a buyer orders one of your active listings it appears here with the buyer\'s escrow state and the actions your role can take.'
              : 'Orders you place on the marketplace appear here with their escrow and delivery progress.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visible.map((order) => {
            const isSeller = sellerIdOf(order) === meId;
            return (
              <button
                key={order.id}
                onClick={() => openOrder(order)}
                className="text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#15803D] dark:hover:border-emerald-600 transition-colors space-y-3"
              >
                <div className="flex items-start gap-3">
                  {order.product_image ? (
                    <img
                      src={mediaUrl(order.product_image)}
                      alt={order.product_title}
                      className="w-14 h-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold">{order.reference}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusClasses(
                          order.status
                        )}`}
                      >
                        {order.status}
                      </span>
                    </div>
                    <div className="text-sm font-semibold truncate mt-0.5">
                      {order.product_title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {formatQuantity(order)} · {formatEtb(order.total_amount)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Seller: </span>
                    {order.seller_name}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Buyer: </span>
                    {order.buyer_name}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Placed: </span>
                    {formatDateTime(order.created_at)}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">Payment: </span>
                    <span className={`font-semibold ${paymentClasses(order.payment_status)}`}>
                      {order.payment_status_display || 'No escrow record'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-500 dark:text-slate-400">Delivery: </span>
                    {shipmentStateLabel(order)}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isSeller
                      ? order.status === 'Pending seller approval'
                        ? 'Seller action required: accept or reject'
                        : `Seller view · ${order.status}`
                      : `Buyer view · ${order.status}`}
                  </span>
                  <span className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400">
                    Open order →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrdersView;
