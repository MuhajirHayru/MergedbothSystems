import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Bell, Check, ShoppingBag, DollarSign, ShieldAlert, FileCheck2, Info, X } from 'lucide-react';

interface NotificationItem {
  id: string;
  title: string;
  description: string;
  category: 'Orders' | 'Financial' | 'Verification' | 'System';
  timestamp: string;
  read: boolean;
  linkView?: string;
}

export const NotificationsDropdown: React.FC = () => {
  const { setActiveView } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'All' | 'Orders' | 'Financial' | 'Verification'>('All');

  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: 'notif_1',
      title: 'Order Status Update',
      description: 'Order GP-ORD-2026-88192 is now being processed at Meki sorting shed.',
      category: 'Orders',
      timestamp: '10m ago',
      read: false,
      linkView: 'orders',
    },
    {
      id: 'notif_2',
      title: 'Deposit Awaiting Verification',
      description: 'Kifle Gebre submitted 350,000 ETB deposit reference via CBE Birr.',
      category: 'Financial',
      timestamp: '35m ago',
      read: false,
      linkView: 'payment_verification',
    },
    {
      id: 'notif_3',
      title: 'New Agribusiness Registration',
      description: 'Meron Asfaw submitted wholesale commercial documents for review.',
      category: 'Verification',
      timestamp: '1h ago',
      read: false,
      linkView: 'pending_registrations',
    },
    {
      id: 'notif_4',
      title: 'Escrow Settlement Released',
      description: '118,000 ETB released to Tewodros Kassie following avocado delivery.',
      category: 'Financial',
      timestamp: '3h ago',
      read: true,
      linkView: 'wallet',
    },
  ]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleNotificationClick = (item: NotificationItem) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, read: true } : n))
    );
    if (item.linkView) {
      setActiveView(item.linkView);
      setIsOpen(false);
    }
  };

  const filteredNotifications = notifications.filter(
    (n) => filter === 'All' || n.category === filter
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-[#15803D]"
        aria-label="Notification Center"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-emerald-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 z-50 overflow-hidden text-slate-900 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">Notifications</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline font-medium"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 px-3 py-1.5 gap-1 text-[11px] font-medium bg-slate-50 dark:bg-slate-900/50">
              {(['All', 'Orders', 'Financial', 'Verification'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filter === tab
                      ? 'bg-white dark:bg-slate-800 text-[#15803D] dark:text-emerald-400 font-semibold shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 scrollbar-thin">
              {filteredNotifications.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No notifications in this category.
                </div>
              ) : (
                filteredNotifications.map((notif) => {
                  let Icon = Info;
                  let iconColor = 'text-blue-500 bg-blue-50 dark:bg-blue-950/50';
                  if (notif.category === 'Orders') {
                    Icon = ShoppingBag;
                    iconColor = 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50';
                  } else if (notif.category === 'Financial') {
                    Icon = DollarSign;
                    iconColor = 'text-amber-600 bg-amber-50 dark:bg-amber-950/50';
                  } else if (notif.category === 'Verification') {
                    Icon = FileCheck2;
                    iconColor = 'text-purple-600 bg-purple-50 dark:bg-purple-950/50';
                  }

                  return (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`w-full p-3 text-left flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors ${
                        !notif.read ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''
                      }`}
                    >
                      <div className={`p-2 rounded-lg shrink-0 ${iconColor}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {notif.title}
                          </span>
                          <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                            {notif.timestamp}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mt-0.5">
                          {notif.description}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
