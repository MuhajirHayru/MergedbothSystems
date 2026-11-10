/**
 * Part 23 — banner & announcement management (Super Admin).
 * Create, schedule, reorder, activate/deactivate and remove promotional
 * banners; the public landing page renders active banners from this data.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, Plus, Trash2, ArrowUp, ArrowDown, Power } from 'lucide-react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

interface Banner {
  id: number;
  title: string;
  description: string;
  image_url: null | string;
  destination_url: string;
  display_order: number;
  starts_at: null | string;
  ends_at: null | string;
  is_active: boolean;
  scheduled_now: boolean;
}

const emptyForm = { title: '', description: '', destination_url: '', display_order: '0', starts_at: '', ends_at: '' };

function fmt(iso: null | string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const BannerManagementView: React.FC = () => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState<File | null>(null);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.banners.adminList();
      setBanners(res.data.banners);
    } catch (err) {
      setError(formatApiError(err, 'Banners could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.title.trim()) { setFormError('A banner title is required.'); return; }
    setBusy(true);
    setFormError('');
    try {
      const data = new FormData();
      data.append('title', form.title.trim());
      if (form.description.trim()) data.append('description', form.description.trim());
      if (form.destination_url.trim()) data.append('destination_url', form.destination_url.trim());
      data.append('display_order', form.display_order || '0');
      if (form.starts_at) data.append('starts_at', new Date(form.starts_at).toISOString());
      if (form.ends_at) data.append('ends_at', new Date(form.ends_at).toISOString());
      if (image) data.append('image', image);
      await api.banners.create(data);
      setForm(emptyForm);
      setImage(null);
      setNotice('Banner created. It appears on the landing page once active and scheduled.');
      await load();
    } catch (err) {
      setFormError(formatApiError(err, 'Could not create the banner.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (b: Banner) => {
    const data = new FormData();
    data.append('is_active', String(!b.is_active));
    setBusy(true);
    try {
      await api.banners.update(b.id, data);
      setNotice(`Banner "${b.title}" ${b.is_active ? 'deactivated' : 'activated'}.`);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not update the banner.'));
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const order = banners.map((b) => b.id);
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setBusy(true);
    try {
      await api.banners.reorder(order);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Reorder failed.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: Banner) => {
    setBusy(true);
    try {
      await api.banners.remove(b.id);
      setNotice(`Banner "${b.title}" deleted.`);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Delete failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div>
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4" />
          <span>Landing page content</span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
          Banners &amp; Announcements
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Active, scheduled banners render on the public landing page in display order.
        </p>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}

      {/* Create form */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">New banner</div>
        {formError && <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{formError}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Banner title *"
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <input value={form.destination_url} onChange={(e) => setForm({ ...form, destination_url: e.target.value })} placeholder="Destination link (optional, https://…)"
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Description (optional)"
            className="sm:col-span-2 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <input value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} placeholder="Display order (0 = first)"
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            className="text-xs text-slate-600 dark:text-slate-300" />
          <label className="text-[11px] text-slate-500">Starts at
            <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              className="mt-0.5 w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          </label>
          <label className="text-[11px] text-slate-500">Ends at
            <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              className="mt-0.5 w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          </label>
        </div>
        <button onClick={() => void create()} disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold disabled:opacity-60">
          <Plus className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Create banner'}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500">Loading banners…</div>
      ) : banners.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
          No banners yet. The landing page keeps its default branding until one is created.
        </div>
      ) : (
        <div className="space-y-2">
          {banners.map((b, i) => (
            <div key={b.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-3">
              {b.image_url ? (
                <img src={b.image_url} alt={b.title} className="w-16 h-10 object-cover rounded-lg" />
              ) : (
                <div className="w-16 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-48">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{b.title}</div>
                {b.description && <div className="text-xs text-slate-500">{b.description}</div>}
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  order #{b.display_order} · {fmt(b.starts_at)} → {fmt(b.ends_at)} · {b.destination_url || 'no link'}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                b.scheduled_now ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                {b.scheduled_now ? 'LIVE' : b.is_active ? 'scheduled/inactive window' : 'inactive'}
              </span>
              <div className="flex items-center gap-1.5">
                <button onClick={() => void move(i, -1)} disabled={busy || i === 0} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button onClick={() => void move(i, 1)} disabled={busy || i === banners.length - 1} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"><ArrowDown className="w-3.5 h-3.5" /></button>
                <button onClick={() => void toggleActive(b)} disabled={busy} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"><Power className={`w-3.5 h-3.5 ${b.is_active ? 'text-rose-600' : 'text-emerald-600'}`} /></button>
                <button onClick={() => void remove(b)} disabled={busy} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5 text-rose-600" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
