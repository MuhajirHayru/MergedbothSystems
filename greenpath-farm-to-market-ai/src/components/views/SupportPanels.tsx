/**
 * Parts 27.3 & 29 & 30 — user-facing screens for verified backends.
 * - WishlistPanel: persistent server-owned wishlist (wholesaler/retailer).
 * - AdminProductsPanel: product visibility within the admin's scope (29).
 * - MessagingOversightPanel: Super Admin conversation metadata + audited content (30).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Heart, Package, Eye, RefreshCw, BarChart3, MapPin, Search, AlertTriangle,
  Layers, Globe2, Banknote, ChevronRight, ShieldCheck,
} from 'lucide-react';
import { api, apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import {
  LineChart, Line, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip,
  BarChart, Bar, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { Pager, pageSlice } from '../common/Pager';

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
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
  const CAT_COLORS = ['#15803D', '#2563EB', '#D97706', '#9333EA'];
  const MANAGE_PAGE_SIZE = 10;

  // ---- Regional overview state (real aggregates from /auth/agricultural-intel/) ----
  const [intel, setIntel] = useState<any>(null);
  const [intelError, setIntelError] = useState('');
  const [intelLoading, setIntelLoading] = useState(true);
  const [productRows, setProductRows] = useState<any[]>([]);
  const [expandedRegion, setExpandedRegion] = useState<string | null>(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const LEDGER_PAGE_SIZE = 8;

  // ---- Manage listings state ----
  const [activeTab, setActiveTab] = useState<'overview' | 'manage'>('overview');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [managePage, setManagePage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmVisibility, setConfirmVisibility] = useState<null | { id: string; title: string; next: 'ACTIVE' | 'INACTIVE' }>(null);
  const [visibilityReason, setVisibilityReason] = useState('');

  const loadIntel = useCallback(async () => {
    setIntelError(''); setIntelLoading(true);
    try {
      const [a, b] = await Promise.all([
        apiClient.get('/auth/agricultural-intel/'),
        apiClient.get('/auth/product-regions/'),
      ]);
      setIntel(a.data);
      setProductRows(b.data.rows || []);
      setIntelError('');
    } catch (err) {
      setIntelError(formatApiError(err, 'Regional product intelligence could not be loaded.'));
    } finally {
      setIntelLoading(false);
    }
  }, []);

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
    void loadIntel();
    setLedgerPage(1);
  }, [loadIntel]);

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => { setManagePage(1); }, [search, statusFilter]);

  const changeVisibility = async () => {
    if (!confirmVisibility) return;
    setBusyId(confirmVisibility.id); setError(''); setNotice('');
    try {
      const res = await apiClient.patch('/admin/products/', {
        product_id: confirmVisibility.id,
        status: confirmVisibility.next,
        reason: visibilityReason.trim(),
      });
      setNotice(`"${res.data.product.title}" is now ${String(res.data.product.status).toLowerCase()} — marketplace discovery updated.`);
      setConfirmVisibility(null); setVisibilityReason('');
      await Promise.all([load(), loadIntel()]);
    } catch (err) {
      setError(formatApiError(err, 'Visibility change failed.'));
    } finally {
      setBusyId(null);
    }
  };

  // ---- Derived overview data (all real, from the intel endpoint) ----
  const regions: any[] = intel?.regions || [];
  const summary = intel?.summary;
  const barData = [...regions]
    .sort((a, b) => b.total_products - a.total_products)
    .map((r) => ({ name: r.region, products: r.total_products, value: Number(r.total_value_etb) }));
  const topCategories: string[] = (intel?.categories || []).slice(0, 4).map((c: any) => c.category);
  const mixData = regions.map((r) => {
    const row: any = { name: r.region, total: r.total_products };
    let covered = 0;
    topCategories.forEach((cat) => {
      row[cat] = r.category_counts?.[cat] || 0;
      covered += row[cat];
    });
    row.Other = Math.max(0, r.total_products - covered);
    return row;
  });
  const chartHeight = Math.max(180, barData.length * 36 + 24);
  const manageProducts: any[] = data?.products || [];
  const visibleManageProducts = pageSlice(manageProducts, managePage, MANAGE_PAGE_SIZE);

  const kpis: Array<[string, any, React.ElementType, string]> = [
    ['Active Listings', summary?.total_active_products ?? '—', Package, 'Public marketplace records'],
    ['Regions With Listings', regions.filter((r) => r.region !== 'Unspecified').length, Globe2, 'From registration hierarchy'],
    ['Product Categories', summary?.total_categories ?? '—', Layers, 'Across all regions'],
    ['Listed Value', `${Number(summary?.total_listed_value_etb || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} ETB`, Banknote, 'Quantity × unit price'],
    ['Low Stock', summary?.total_scarce_products ?? '—', AlertTriangle, 'Quantity at or below 10'],
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Marketplace Catalogue
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1.5">Products &amp; Listings</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            What is listed where — regional distribution, category mix, and listing governance. Every figure from live platform records.
          </p>
        </div>
        <button onClick={() => { void loadIntel(); void load(); }} disabled={intelLoading || loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#116932] text-white text-xs font-bold transition-colors disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${(intelLoading || loading) ? 'animate-spin' : ''}`} /> Refresh data
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 text-xs font-semibold border-b border-slate-200 dark:border-slate-800 pb-0 flex-wrap">
        {([['overview', 'Regional Overview', BarChart3], ['manage', 'Manage Listings', ShieldCheck]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setActiveTab(id as 'overview' | 'manage')}
            className={`px-3 py-2 rounded-t-lg flex items-center gap-1.5 ${activeTab === id ? 'bg-slate-100 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 font-bold' : 'text-slate-500'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ----------------------------- TAB 1: Regional Overview ----------------------------- */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {intelError && (
            <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{intelError}</div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {kpis.map(([label, value, Icon, sub]) => (
              <div key={label} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span>{label}</span>
                  <Icon className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">{String(value)}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{sub}</div>
              </div>
            ))}
          </div>

          {intelLoading ? (
            <div className="p-6 text-center text-xs text-slate-500">Loading regional product intelligence…</div>
          ) : regions.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
              No active listings yet — regional distribution appears once sellers publish products.
            </div>
          ) : (
            <>
              {/* Charts row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top-down listings by region */}
                <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Listings by Region</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">Highest-supply regions first — hover for listed value.</p>
                  <div style={{ height: chartHeight }} role="img" aria-label="Horizontal bar chart: number of active listings per region">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} layout="vertical" barCategoryGap="28%" margin={{ right: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'currentColor' }} className="text-slate-600 dark:text-slate-300" />
                        <YAxis type="category" dataKey="name" width={124} tick={{ fontSize: 11, fill: 'currentColor' }} interval={0} className="text-slate-600 dark:text-slate-300" />
                        <Tooltip
                          formatter={(val: any, key: any) => (key === 'products' ? [`${val} listing${val === 1 ? '' : 's'}`, 'Listings'] : [val, key])}
                          contentStyle={{ fontSize: 11, backgroundColor: 'var(--tooltip-bg, white)', border: '1px solid var(--tooltip-border, #e2e8f0)' }}
                        />
                        <Bar dataKey="products" name="Listings" fill="#15803D" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}
                          label={{ position: 'right', fontSize: 11, fill: 'currentColor' }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Category mix compared across regions */}
                <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Category Mix — Region to Region</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Which product category dominates each region, and which barely appears.
                  </p>
                  <div style={{ height: chartHeight }} role="img" aria-label="Stacked horizontal bar chart: category composition per region">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mixData} layout="vertical" barCategoryGap="28%" margin={{ right: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'currentColor' }} className="text-slate-600 dark:text-slate-300" />
                        <YAxis type="category" dataKey="name" width={124} tick={{ fontSize: 11, fill: 'currentColor' }} interval={0} className="text-slate-600 dark:text-slate-300" />
                        <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'var(--tooltip-bg, white)', border: '1px solid var(--tooltip-border, #e2e8f0)' }} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {topCategories.map((cat, i) => (
                          <Bar key={cat} dataKey={cat} stackId="mix" name={cat} fill={CAT_COLORS[i % CAT_COLORS.length]} barSize={16} isAnimationActive={false} />
                        ))}
                        <Bar dataKey="Other" stackId="mix" name="Other" fill="#94a3b8" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Most / Least per region — with inline product accordion */}
              <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Most &amp; Least Product Category — Regional Ledger</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Click a region to list the products registered inside it.
                  </p>
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                        <th className="py-2.5 px-3">Region</th>
                        <th className="py-2.5 px-2 text-right">Listings</th>
                        <th className="py-2.5 px-2">Most Listed</th>
                        <th className="py-2.5 px-2">Least Listed</th>
                        <th className="py-2.5 px-2 text-right">Farmer l.</th>
                        <th className="py-2.5 px-2 text-right">Wholesaler l.</th>
                        <th className="py-2.5 px-3 text-right">Listed Value</th>
                        <th className="py-2.5 px-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {pageSlice(regions, ledgerPage, LEDGER_PAGE_SIZE).map((r) => (
                        <React.Fragment key={r.region}>
                          <tr
                            onClick={() => setExpandedRegion(expandedRegion === r.region ? null : r.region)}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${expandedRegion === r.region ? 'bg-emerald-50/50 dark:bg-emerald-950/20 font-medium' : ''}`}
                          >
                            <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> <span>{r.region}</span>
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono">{r.total_products}</td>
                            <td className="py-2.5 px-2">
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">{r.top_category}</span>
                              <span className="text-slate-400"> ({r.category_counts?.[r.top_category] ?? 0})</span>
                            </td>
                            <td className="py-2.5 px-2 text-slate-500 dark:text-slate-400">
                              {r.least_category === r.top_category && r.total_products === 1 ? '—' : `${r.least_category} (${r.category_counts?.[r.least_category] ?? 0})`}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono">{r.farmer_listings}</td>
                            <td className="py-2.5 px-2 text-right font-mono">{r.wholesaler_listings}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                              {Number(r.total_value_etb).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <span className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400">
                                {expandedRegion === r.region ? 'Hide ↑' : 'View ↓'}
                              </span>
                            </td>
                          </tr>
                          {expandedRegion === r.region && (
                            <tr>
                              <td colSpan={8} className="bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                                {(() => {
                                  const rows = productRows.filter((pr) => pr.region === r.region);
                                  if (rows.length === 0) return (
                                    <div className="py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                                      No per-product records for this region.
                                    </div>
                                  );
                                  const zoneAgg: Record<string, Record<string, number>> = {};
                                  rows.forEach((pr) => {
                                    Object.entries(pr.zone_wereda || {}).forEach(([z, weredas]) => {
                                      zoneAgg[z] = zoneAgg[z] || {};
                                      Object.entries(weredas as Record<string, string>).forEach(([w, q]) => {
                                        zoneAgg[z][w] = (zoneAgg[z][w] || 0) + Number(q);
                                      });
                                    });
                                  });
                                  const zoneNames = Object.keys(zoneAgg);
                                  return (
                                    <div className="space-y-3">
                                      <table className="w-full text-xs text-left">
                                        <thead>
                                          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                                            <th className="py-1.5 pr-3 font-bold">Product</th>
                                            <th className="py-1.5 pr-3 font-bold">Category</th>
                                            <th className="py-1.5 pr-3 font-bold">Type</th>
                                            <th className="py-1.5 pr-3 font-bold">Seller(s)</th>
                                            <th className="py-1.5 pr-3 text-right font-bold">Qty</th>
                                            <th className="py-1.5 pr-3 font-bold">Unit</th>
                                            <th className="py-1.5 pr-3 text-right font-bold">Avg Price</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {rows.map((pr, i) => (
                                            <tr key={`${pr.product}-${pr.category}-${i}`} className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
                                              <td className="py-1.5 pr-3 font-semibold text-slate-800 dark:text-slate-100">{pr.product}</td>
                                              <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{pr.category}</td>
                                              <td className="py-1.5 pr-3 text-[10px] text-slate-500 dark:text-slate-400">{String(pr.product_type || '').replace(/_/g, ' ').toLowerCase()}</td>
                                              <td className="py-1.5 pr-3 text-slate-600 dark:text-slate-400">{(pr.sellers || []).join(', ') || '—'}</td>
                                              <td className="py-1.5 pr-3 text-right font-mono">{pr.total_quantity}</td>
                                              <td className="py-1.5 pr-3 text-slate-500">{pr.unit}</td>
                                              <td className="py-1.5 pr-3 text-right font-mono">{Number(pr.avg_price).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                        <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                          Zonal &amp; Wereda distribution — listed quantity
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                          {zoneNames.map((z) => {
                                            const zoneTotal = Object.values(zoneAgg[z]).reduce((a, b) => a + b, 0);
                                            return (
                                              <div key={z} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                                                <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 dark:text-slate-100">
                                                  <span className="truncate">{z}</span>
                                                  <span className="font-mono">{zoneTotal.toLocaleString()} {rows[0]?.unit || ''}</span>
                                                </div>
                                                <div className="mt-1 space-y-0.5">
                                                  {Object.entries(zoneAgg[z]).map(([w, q]) => (
                                                    <div key={w} className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                                                      <span className="truncate">{w}</span>
                                                      <span className="font-mono">{q.toLocaleString()}</span>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={ledgerPage}
                  pageSize={LEDGER_PAGE_SIZE}
                  total={regions.length}
                  hasMore={ledgerPage * LEDGER_PAGE_SIZE < regions.length}
                  onPrev={() => setLedgerPage((p) => Math.max(1, p - 1))}
                  onNext={() => setLedgerPage((p) => p + 1)}
                />
              </div>

              {/* Low stock strip */}
              {(intel?.scarce_products || []).length > 0 && (
                <div className="p-4 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20">
                  <div className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> Low stock alerts (quantity ≤ 10)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {intel.scarce_products.slice(0, 12).map((s: any, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900 text-[11px] text-slate-700 dark:text-slate-200">
                        <span className="font-bold">{s.title}</span> · {s.quantity} {s.unit} · {s.region}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ----------------------------- TAB 2: Manage Listings ----------------------------- */}
      {activeTab === 'manage' && (
        <div className="space-y-4">
          {confirmVisibility && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
              <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 space-y-3" role="dialog" aria-modal="true" aria-label="Change listing visibility">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {confirmVisibility.next === 'INACTIVE' ? 'Hide' : 'Publish'} &quot;{confirmVisibility.title}&quot;?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {confirmVisibility.next === 'INACTIVE'
                    ? 'The listing is removed from marketplace discovery immediately. The seller keeps the record.'
                    : 'The listing becomes visible to all marketplace users again.'}
                  {' '}A reason is recorded in the audit trail.
                </p>
                {error && <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Reason (required, min 5 characters)
                  <textarea value={visibilityReason} onChange={(e) => setVisibilityReason(e.target.value)} rows={2}
                    className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </label>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmVisibility(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200">Cancel</button>
                  <button onClick={() => void changeVisibility()} disabled={visibilityReason.trim().length < 5 || busyId === confirmVisibility.id}
                    className={`px-4 py-2 rounded-lg text-white text-xs font-bold disabled:opacity-60 ${confirmVisibility.next === 'INACTIVE' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#15803D] hover:bg-[#166534]'}`}>
                    {confirmVisibility.next === 'INACTIVE' ? 'Hide listing' : 'Publish listing'}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              <Package className="w-4 h-4 text-emerald-600" /> Product listings {data?.scope_limited ? 'within your assigned scope' : '(platform-wide)'}
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-2.5" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or seller…" aria-label="Search listings by title or seller"
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter listings by status"
                className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
                <option value="">All statuses</option>
                {['ACTIVE', 'SOLD', 'PENDING', 'INACTIVE'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {notice && <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}
          {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">Loading products…</div>
          ) : manageProducts.length === 0 ? (
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
                  {visibleManageProducts.map((p: any) => (
                    <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-100">
                        {p.title}
                        {(p.status === 'ACTIVE' || p.status === 'INACTIVE') && (
                          <button
                            onClick={() => { setConfirmVisibility({ id: p.id, title: p.title, next: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); setVisibilityReason(''); }}
                            disabled={busyId === p.id}
                            className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold ${p.status === 'ACTIVE' ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'}`}
                            aria-label={`${p.status === 'ACTIVE' ? 'Hide from marketplace' : 'Publish to marketplace'}: ${p.title}`}
                          >
                            {busyId === p.id ? '…' : p.status === 'ACTIVE' ? 'Hide' : 'Publish'}
                          </button>
                        )}
                      </td>
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
          <Pager
            page={managePage}
            pageSize={MANAGE_PAGE_SIZE}
            total={manageProducts.length}
            hasMore={managePage * MANAGE_PAGE_SIZE < manageProducts.length}
            onPrev={() => setManagePage((p) => Math.max(1, p - 1))}
            onNext={() => setManagePage((p) => p + 1)}
          />
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
  const [insights, setInsights] = useState<any>(null);

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

  useEffect(() => {
    // Counts-only intelligence strip; conversation bodies stay behind the
    // reason-gated oversight flow below.
    apiClient.get('/superadmin/messaging-insights/')
      .then((res) => setInsights(res.data))
      .catch(() => setInsights(null));
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
    {/* Messaging intelligence strip — counts only, from /superadmin/messaging-insights/ */}
    {insights && (
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Messaging insights (platform-wide counts)</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ['Conversations', insights.totals?.conversations],
            ['Messages', insights.totals?.messages],
            ['Unread', insights.totals?.unread],
            ['Voice', insights.totals?.voice_messages],
            ['Active 7d', insights.totals?.active_conversations_7d],
            ['Today', insights.activity?.today],
          ].map(([label, value]) => (
            <div key={String(label)} className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">{label}</div>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">{value ?? '—'}</div>
            </div>
          ))}
        </div>
        {(insights.trend_14d ?? []).some((p: any) => p.messages > 0) && (
          <div className="h-40" role="img" aria-label="Line chart of messages sent over the last 14 days">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={insights.trend_14d}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="messages" stroke="#15803D" strokeWidth={2} dot={false}  isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Top senders by role</div>
            <table className="w-full text-xs">
              <tbody>
                {(insights.top_senders_by_role ?? []).slice(0, 5).map((row: any) => (
                  <tr key={`${row.actor}-${row.role}`} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-1 font-semibold text-slate-700 dark:text-slate-200">{row.actor}</td>
                    <td className="py-1 text-slate-500 dark:text-slate-400">{String(row.role).replace(/_/g, ' ').toLowerCase()}</td>
                    <td className="py-1 text-right font-mono">{row.messages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Moderation status</div>
            <div className="space-y-1">
              {Object.entries(insights.totals?.by_moderation_status ?? {}).map(([status, count]) => (
                <div key={status} className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{String(status).replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="font-mono font-semibold">{String(count)}</span>
                </div>
              ))}
              {(insights.unavailable ?? []).length > 0 && (
                <div className="text-[10px] text-slate-400 pt-1">Unavailable: {insights.unavailable.map((u: string) => u.split(':')[0]).join(', ')}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    )}
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
