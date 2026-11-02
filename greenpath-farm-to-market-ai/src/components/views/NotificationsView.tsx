import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { Bell, CheckCircle2 } from 'lucide-react';

interface N { id: string; type: string; type_display: string; message: string; target_url?: string; is_read: boolean; actor?: string; created_at: string; }

export const NotificationsView: React.FC = () => {
  const { currentUser } = useApp();
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [listRes, countRes] = await Promise.all([api.notifications.list(), api.notifications.unreadCount()]);
      const data = listRes?.data;
      const list: N[] = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
      setItems(list);
      setUnread(countRes?.data?.unread_count ?? 0);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Failed to load notifications');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [currentUser?.id, load]);

  const markRead = async (id: string) => {
    try { await api.notifications.markRead(id); await load(); } catch (e: any) { setError(e?.message || 'Failed'); }
  };
  const markAll = async () => {
    try { await api.notifications.markAllRead(); await load(); } catch (e: any) { setError(e?.message || 'Failed'); }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold flex items-center gap-2"><Bell className="w-5 h-5 text-emerald-600" /> Notifications</h1>
        <button onClick={markAll} className="text-xs font-bold text-emerald-700">Mark all read</button>
      </div>
      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>}
      {loading ? <div className="text-xs text-slate-500">Loading...</div> :
       items.length === 0 ? <div className="text-xs text-slate-500">No notifications.</div> :
       <div className="space-y-2">
         {items.map((n) => (
           <div key={n.id} className={`p-3 rounded-xl border text-xs ${n.is_read ? 'bg-white border-slate-200' : 'bg-emerald-50 border-emerald-200'}`}>
             <div className="flex items-center justify-between gap-2">
               <span className="font-bold">{n.type_display}</span>
               <span className="text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
             </div>
             <p className="mt-1">{n.message}</p>
             {!n.is_read && <button onClick={() => markRead(n.id)} className="mt-2 text-emerald-700 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Mark read</button>}
           </div>
         ))}
       </div>}
      <div className="mt-4 text-xs text-slate-500">Unread: {unread}</div>
    </div>
  );
};

export default NotificationsView;
