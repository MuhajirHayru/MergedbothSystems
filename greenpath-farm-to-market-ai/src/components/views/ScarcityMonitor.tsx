/**
 * Product Availability & Scarcity Monitoring — Super Admin intelligence view.
 *
 * All figures come from the real agricultural-intelligence and product-region
 * endpoints. The metric tracked is LISTING availability (active listings and
 * sellers per product/area) — the platform does not track physical warehouse
 * inventory, so quantity-based wording is deliberately avoided; the label
 * states what is measured. Classification thresholds are Super Admin
 * configurable at runtime.
 */
import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { AlertTriangle, Package, RefreshCw } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

const CLASS_COLORS: Record<string, string> = {
  'Critical': '#dc2626',
  'Low': '#f59e0b',
  'Moderate': '#0ea5e9',
  'Sufficient': '#15803d',
};

export const ScarcityMonitor: React.FC = () => {
  const [intel, setIntel] = useState<any>(null);
  const [regionRows, setRegionRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [criticalThreshold, setCriticalThreshold] = useState(2);
  const [lowThreshold, setLowThreshold] = useState(5);
  const [thresholdsSaved, setThresholdsSaved] = useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    setError('');
    // Persisted thresholds come from PlatformSettings (Super Admin configurable).
    apiClient.get('/superadmin/settings/')
      .then((res) => {
        const cfg = res.data?.settings ?? res.data;
        if (typeof cfg?.scarcity_critical_sellers === 'number') setCriticalThreshold(cfg.scarcity_critical_sellers);
        if (typeof cfg?.scarcity_low_sellers === 'number') setLowThreshold(cfg.scarcity_low_sellers);
      })
      .catch(() => undefined);
    Promise.all([
      apiClient.get('/auth/agricultural-intel/'),
      apiClient.get('/auth/product-regions/'),
    ])
      .then(([intelRes, regionsRes]) => {
        setIntel(intelRes.data);
        setRegionRows(Array.isArray(regionsRes.data?.rows) ? regionsRes.data.rows : []);
      })
      .catch((err) => setError(formatApiError(err, 'Availability data could not be loaded.')))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  /** Threshold changes persist to PlatformSettings so reports use them everywhere. */
  const persistThreshold = (field: 'scarcity_critical_sellers' | 'scarcity_low_sellers', value: number) => {
    apiClient.patch('/superadmin/settings/', { [field]: value, reason: `Scarcity threshold ${field} set to ${value} from the monitoring view` })
      .then(() => { setThresholdsSaved(true); window.setTimeout(() => setThresholdsSaved(false), 2000); })
      .catch((err) => setError(formatApiError(err, 'Threshold could not be saved.')));
  };

  const regions = useMemo(
    () => ['all', ...new Set<string>(regionRows.map((r) => r.region).filter(Boolean))],
    [regionRows],
  );

  /** Classification is computed from real seller/listing counts per product+region. */
  const classified = useMemo(() => {
    if (!regionRows.length) return [];
    const filtered = regionFilter === 'all' ? regionRows : regionRows.filter((r) => r.region === regionFilter);
    const grouped = new Map<string, { product: string; category: string; sellers: number; regions: Set<string> }>();
    for (const row of filtered) {
      const key = `${row.product}||${row.category}`;
      const entry = grouped.get(key) ?? { product: row.product, category: row.category, sellers: 0, regions: new Set<string>() };
      entry.sellers += Number(row.farmer_count ?? 0);
      entry.regions.add(row.region);
      grouped.set(key, entry);
    }
    return [...grouped.values()]
      .map((entry) => {
        const sellers = entry.sellers;
        const classification =
          sellers === 0 ? 'Data unavailable' :
          sellers <= criticalThreshold ? 'Critical' :
          sellers <= lowThreshold ? 'Low' :
          sellers <= lowThreshold * 2 ? 'Moderate' : 'Sufficient';
        return { ...entry, sellers, classification, regions: [...entry.regions].join(', ') };
      })
      .sort((a, b) => a.sellers - b.sellers);
  }, [regionRows, regionFilter, criticalThreshold, lowThreshold]);

  const classificationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of classified) counts.set(row.classification, (counts.get(row.classification) ?? 0) + 1);
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [classified]);

  const scarceByRegion = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of (intel?.scarce_products ?? [])) {
      counts.set(row.region, (counts.get(row.region) ?? 0) + 1);
    }
    return [...counts.entries()].map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count);
  }, [intel]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Package className="w-4 h-4" /> Product Availability &amp; Scarcity Monitoring
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Where listings are thin, and where attention is needed
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Measured by listing/seller availability — the platform does not track physical warehouse inventory.
          </p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold shadow-xs disabled:opacity-60" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

      {/* Configurable thresholds — the rule is transparent and editable */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="sc-critical" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Critical scarcity: sellers ≤</label>
          <input id="sc-critical" type="number" min={0} value={criticalThreshold} onChange={(e) => { const v = Number(e.target.value) || 0; setCriticalThreshold(v); persistThreshold('scarcity_critical_sellers', v); }} className="w-24 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
        </div>
        <div>
          <label htmlFor="sc-low" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Low availability: sellers ≤</label>
          <input id="sc-low" type="number" min={criticalThreshold} value={lowThreshold} onChange={(e) => { const v = Number(e.target.value) || 0; setLowThreshold(v); persistThreshold('scarcity_low_sellers', v); }} className="w-24 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
        </div>
        <div>
          <label htmlFor="sc-region" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Region</label>
          <select id="sc-region" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            {regions.map((r) => <option key={r} value={r}>{r === 'all' ? 'All regions' : r}</option>)}
          </select>
        </div>
        {intel && (
          <div className="text-xs text-slate-500 dark:text-slate-400 sm:ml-auto">
            {thresholdsSaved ? <span className="text-emerald-600 font-semibold mr-2">Thresholds saved ✓</span> : null}
            {intel.summary?.total_active_products ?? 0} active products · {intel.summary?.total_weredas_covered ?? 0} weredas covered
          </div>
        )}
      </div>

      {loading && !intel ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Availability classification (product/area combinations)</div>
              <div className="h-60" role="img" aria-label="Pie chart of products classified by listing availability">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={classificationCounts} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3} isAnimationActive={false}>
                      {classificationCounts.map((d) => <Cell key={d.name} fill={CLASS_COLORS[d.name] ?? '#64748b'} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Low-quantity products by region (quantity ≤ 10)</div>
              <div className="h-60" role="img" aria-label="Bar chart of low-quantity products per region">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scarceByRegion}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="region" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} barSize={26}  isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr className="text-left text-slate-500 dark:text-slate-300">
                  <th scope="col" className="py-2.5 px-3 font-semibold">Product</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Category</th>
                  <th scope="col" className="py-2.5 px-3 text-right font-semibold">Sellers (listing availability)</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Regions</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Classification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {classified.slice(0, 60).map((row) => (
                  <tr key={`${row.product}-${row.category}`} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-100">{row.product}</td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">{row.category}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.sellers}</td>
                    <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{row.regions}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: CLASS_COLORS[row.classification] ?? '#64748b' }}>
                        {row.classification}
                      </span>
                    </td>
                  </tr>
                ))}
                {classified.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No product/area combinations match this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {(intel?.scarce_products ?? []).length > 0 && (
            <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Low-quantity products (quantity ≤ 10) — from live records
              </div>
              <div className="space-y-1">
                {intel.scarce_products.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{p.title}</span>
                    <span className="text-slate-400">({p.category})</span>
                    <span className="font-mono text-amber-600">{Number(p.quantity)} {p.unit}</span>
                    <span className="text-slate-400">{p.region} · {p.farmer}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
