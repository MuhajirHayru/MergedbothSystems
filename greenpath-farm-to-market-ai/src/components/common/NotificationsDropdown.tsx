import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import {
  Bell, CheckCheck, ShoppingBag, DollarSign, FileCheck2,
  Info, X, UserPlus, RefreshCw, Package, MessageSquare,
} from 'lucide-react';

interface NotificationItem {
  id: string;
  type: string;
  message: string;
  target_url: string;
  is_read: boolean;
  created_at: string;
}

const TYPE_STYLE: Record<string, { icon: React.ElementType; bg: string; label: string }> = {
  ORDER:       { icon: ShoppingBag,  bg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', label: 'Orders' },
  PAYMENT:     { icon: DollarSign,   bg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', label: 'Payments' },
  REGISTRATION:{ icon: UserPlus,     bg: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300', label: 'Registrations' },
  APPROVAL:    { icon: FileCheck2,   bg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', label: 'Approvals' },
  REJECTION:   { icon: X,            bg: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300', label: 'Rejections' },
  MESSAGE:     { icon: MessageSquare,bg: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300', label: 'Messages' },
  PRODUCT:     { icon: Package,      bg: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300', label: 'Products' },
  SYSTEM:      { icon: Info,         bg: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', label: 'System' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const NotificationsDropdown: React.FC = () => {
  const { setActiveView } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, countRes] = await Promise.all([
        api.notifications.list(),
        api.notifications.unreadCount(),
      ]);
      const rows = Array.isArray(listRes.data) ? listRes.data : listRes.data?.results || listRes.data?.notifications || [];
      setItems(rows);
      setUnread(countRes.data?.unread_count ?? countRes.data?.count ?? 0);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isOpen) void load(); }, [isOpen, load]);

  const markAll = async () => {
    try {
      await api.notifications.markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    } catch { /* silent */ }
  };

  const markOne = async (id: string) => {
    try { await api.notifications.markRead(id); } catch { /* silent */ }
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread((c) => Math.max(0, c - 1));
  };

  const handleClick = async (item: NotificationItem) => {
    if (!item.is_read) void markOne(item.id);
    if (item.target_url) {
      const route: Record<string, string> = {
        '/wallet': 'wallet', '/orders': 'orders',
        '/financial-manager/payments': 'financial_dashboard',
        '/financial-manager/payouts': 'financial_dashboard',
      };
      setActiveView(route[item.target_url] || item.target_url.replace(/^\//, '').split('?')[0]);
    }
    setIsOpen(false);
  };

  const types = useMemo(() => {
    const set = new Set(items.map((n) => n.type));
    return ['all', ...[...set]];
  }, [items]);

  const visible = useMemo(() => {
    if (activeFilter === 'all') return items;
    if (activeFilter === 'unread') return items.filter((n) => !n.is_read);
    return items.filter((n) => n.type === activeFilter);
  }, [items, activeFilter]);

  return (
    <div className="relative">
      {/* Bell trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        <Bell className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} aria-hidden="true" />
          <div
            className="absolute right-0 mt-2 w-[360px] sm:w-[400px] bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700/80 z-50 overflow-hidden text-slate-900 dark:text-slate-100"
            role="dialog"
            aria-modal="false"
            aria-label="Notifications panel"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notifications</h3>
              <div className="flex items-center gap-2">
                {unread > 0 && (
                  <button onClick={() => void markAll()} className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline">
                    Mark all read
                  </button>
                )}
                <button onClick={() => void load()} className="p-0.5 text-slate-400 hover:text-emerald-600" aria-label="Refresh">
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button onClick={() => setIsOpen(false)} className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Type tabs */}
            <div className="flex gap-0.5 px-3 pt-2 pb-0 overflow-x-auto text-[11px] font-medium border-b border-slate-100 dark:border-slate-800">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveFilter(t)}
                  className={`px-2.5 py-1.5 rounded-t-md transition-colors whitespace-nowrap ${
                    activeFilter === t
                      ? 'text-emerald-700 dark:text-emerald-400 border-b-2 border-emerald-500 font-semibold'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                >
                  {t === 'all' ? 'All' : TYPE_STYLE[t]?.label ?? t}
                </button>
              ))}
            </div>

            {/* Items */}
            <div className="max-h-[360px] overflow-y-auto">
              {loading ? (
                <div className="space-y-1 p-3">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-12 rounded-md bg-slate-100 dark:bg-slate-800/60 animate-pulse" />)}
                </div>
              ) : visible.length === 0 ? (
                <div className="py-10 text-center">
                  <Bell className="w-7 h-7 text-slate-200 dark:text-slate-700 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Nothing here right now.</p>
                </div>
              ) : (
                visible.map((item) => {
                  const style = TYPE_STYLE[item.type] ?? { icon: Info, bg: 'bg-slate-100 dark:bg-slate-800 text-slate-500', label: item.type };
                  const Icon = style.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => void handleClick(item)}
                      className={`w-full px-4 py-2.5 text-left flex items-start gap-3 transition-colors border-b border-slate-50 dark:border-slate-800/50 last:border-b-0 ${!item.is_read ? 'bg-slate-50/80 dark:bg-slate-800/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'}`}
                    >
                      <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${style.bg}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs leading-snug ${!item.is_read ? 'font-medium text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
                          {item.message}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-slate-400">{timeAgo(item.created_at)}</span>
                          <span className="text-[10px] text-slate-300 dark:text-slate-600">·</span>
                          <span className="text-[10px] text-slate-400">{style.label}</span>
                        </div>
                      </div>
                      {!item.is_read && <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-center">
                <button
                  onClick={() => { setIsOpen(false); setActiveView('notifications'); }}
                  className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
                >
                  View all
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
