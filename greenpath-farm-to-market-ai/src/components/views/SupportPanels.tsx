/**
 * Parts 27.3 & 29 & 30 — user-facing screens for verified backends.
 * - WishlistPanel: persistent server-owned wishlist (wholesaler/retailer).
 * - AdminProductsPanel: product visibility within the admin's scope (29).
 * - MessagingOversightPanel: Super Admin conversation metadata + audited content (30).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Heart, Package, Eye, RefreshCw } from 'lucide-react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

function fmtDate(iso: null | string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ------------------------------- Wishlist ------------------------------- */

interface WishlistItem {
  id: string; note: string; added_at: string;
  product: { id: string; title: string; category: string; price_per_unit: string; unit: string; status: string; quantity: string; available: boolean };
}

export const WishlistPanel: React.FC<{ products?: { id: string; title: string }[] }> = ({ products: productsProp }) => {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [note, setNote] = useState('');

  const [products, setProducts] = useState<{ id: string; title: string }[]>(productsProp ?? []);

  useEffect(() => {
    if (productsProp && productsProp.length > 0) return;
    let cancelled = false;
    Promise.all([api.products.farmerListings({ page_size: 50 }), api.products.wholesalerListings({ page_size: 50 })])
      .then(([farmer, wholesaler]) => {
        if (cancelled) return;
        const rows = [
          ...((farmer.data?.results ?? []) as any[]),
          ...((wholesaler.data?.results ?? []) as any[]),
        ].map((p) => ({ id: String(p.id), title: p.title }));
        setProducts(rows);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [productsProp]);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await api.wishlist.list();
      setItems(res.data.items);
    } catch (err) {
      setError(formatApiError(err, 'Wishlist could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!selectedProduct) { setError('Pick a product to save.'); return; }
    setError(''); setNotice('');
    try {
      await api.wishlist.add(selectedProduct, note.trim() || undefined);
      setNotice('Saved to your wishlist.');
      setSelectedProduct(''); setNote('');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not save to the wishlist.'));
    }
  };

  const remove = async (productId: string) => {
    try {
      await api.wishlist.remove(productId);
      await load();
    } catch (err) {
      setError(formatApiError(err, 'Could not remove the item.'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Heart className="w-4 h-4 text-rose-500" /> My Wishlist
          <span className="text-slate-500 dark:text-slate-400 font-normal">· saved products with live availability</span>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}

      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <label className="flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
          Save a product
          <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <option value="">Choose a product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        <label className="flex-1 text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. restock Monday"
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
        </label>
        <button onClick={() => void add()} className="px-4 py-2 rounded-lg bg-[#15803D] text-white text-xs font-semibold">
          Save
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading wishlist…</div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
          Nothing saved yet. Wishlist entries persist in your account, not in this browser.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-56">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.product.title}</div>
                <div className="text-[11px] text-slate-500">
                  {item.product.price_per_unit} ETB / {item.product.unit} · {item.product.quantity} available ·
                  {' '}<span className={item.product.available ? 'text-emerald-600 font-semibold' : 'text-rose-500 font-semibold'}>
                    {item.product.available ? 'available now' : `currently ${item.product.status.toLowerCase()}`}
                  </span>
                  {item.note && <> · “{item.note}”</>}
                </div>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">saved {fmtDate(item.added_at)}</span>
              <button onClick={() => void remove(item.product.id)} className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* --------------------- Part 29 — admin product visibility --------------------- */

export const AdminProductsPanel: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await api.oversight.adminProducts(params);
      setData(res.data);
    } catch (err) {
      setError(formatApiError(err, 'Products could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Package className="w-4 h-4 text-emerald-600" /> Product listings {data?.scope_limited ? 'within your assigned scope' : '(platform-wide)'}
        </div>
        <div className="flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or seller…" aria-label="Search listings by title or seller"
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter listings by status"
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
            <option value="">All statuses</option>
            {['ACTIVE', 'SOLD', 'PENDING', 'INACTIVE'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading products…</div>
      ) : !data || data.products.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">No listings match.</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <th scope="col" className="py-2.5 px-3">Title</th><th scope="col" className="py-2.5 px-3">Seller</th>
                <th scope="col" className="py-2.5 px-3">Category</th><th scope="col" className="py-2.5 px-3 text-right">Price</th>
                <th scope="col" className="py-2.5 px-3 text-right">Qty</th><th scope="col" className="py-2.5 px-3">Status</th><th scope="col" className="py-2.5 px-3">Listed</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p: any) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-100">{p.title}</td>
                  <td className="py-2 px-3">{p.seller} <span className="text-slate-500 dark:text-slate-400">({p.seller_role.replace(/_/g, ' ')})</span></td>
                  <td className="py-2 px-3">{p.category}</td>
                  <td className="py-2 px-3 text-right font-mono">{p.price_per_unit}</td>
                  <td className="py-2 px-3 text-right font-mono">{p.quantity}</td>
                  <td className="py-2 px-3">{p.status}</td>
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{fmtDate(p.listed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* --------------- Part 30 — messaging oversight (Super Admin) --------------- */

export const MessagingOversightPanel: React.FC = () => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [openMessages, setOpenMessages] = useState<null | { id: string; messages: any[] }>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const res = await api.oversight.conversations();
      setConversations(res.data.conversations);
    } catch (err) {
      setError(formatApiError(err, 'Conversations could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openConversation = async (id: string) => {
    if (reason.trim().length < 10) {
      setError('Enter a specific reason (10+ characters) before opening a conversation — it is recorded in the audit trail.');
      return;
    }
    setBusyId(id); setError('');
    try {
      const res = await api.oversight.conversationMessages(id, reason.trim());
      setOpenMessages({ id, messages: res.data.messages });
    } catch (err) {
      setError(formatApiError(err, 'Could not open the conversation.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Eye className="w-4 h-4 text-emerald-600" /> Conversation oversight
          <span className="text-slate-500 dark:text-slate-400 font-normal">· metadata is open; message content requires a recorded reason</span>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

      <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
        Inspection reason (recorded in the immutable audit trail):
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Resolving support ticket SUP-… about this order"
          className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-800" />
      </div>

      {loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading conversations…</div>
      ) : conversations.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">No conversations exist yet.</div>
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => (
            <div key={c.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs">
                  <div className="font-bold text-slate-800 dark:text-slate-100">{c.participants.join(' ↔ ')}</div>
                  <div className="text-[11px] text-slate-500">
                    {c.participant_roles.map((r: string) => r.replace(/_/g, ' ')).join(' ↔ ')} · {c.message_count} messages · last {fmtDate(c.last_message_at)}
                  </div>
                </div>
                <button
                  onClick={() => void openConversation(c.id)}
                  disabled={busyId === c.id}
                  className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 disabled:opacity-60"
                >
                  {busyId === c.id ? 'Opening…' : 'Open with reason'}
                </button>
              </div>
              {openMessages && openMessages.id === c.id && (
                <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto border-t border-slate-100 dark:border-slate-800 pt-3">
                  {openMessages.messages.map((m) => (
                    <div key={m.id} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 text-xs">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{m.sender}</span>
                      <span className="text-slate-500 dark:text-slate-400 ml-2">{fmtDate(m.created_at)}</span>
                      <div className="text-slate-600 dark:text-slate-300">{m.body}</div>
                    </div>
                  ))}
                  {openMessages.messages.length === 0 && <div className="text-xs text-slate-500 dark:text-slate-400">No messages.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
