/**
 * Super Admin command center — comprehensive overview using real data from
 * GET /api/v1/auth/admin-overview/. Charts, KPIs, activity, quick actions.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { Activity, AlertTriangle, ArrowRight, Users, ShoppingCart, Wallet, Truck, LifeBuoy, Tag, TrendingUp, FileText, DollarSign,
} from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

const ROLE_COLORS = ['#15803D', '#0ea5e9', '#8b5cf6', '#f59e0b', '#64748b', '#ec4899', '#ef4444', '#14b8a6', '#a3e635', '#6366f1', '#f97316', '#06b6d4', '#84cc16'];

interface OverviewData {
  users: { total: number; pending: number; by_role: Record<string, number>; new_7d: number };
  orders: { total: number; completed: number; pending: number; disputed: number; gmv: string; new_7d: number };
  wallet: { available: string; held: string };
  financials: { revenue: string; expenses: string; payroll: string };
  freight: { open: number; assigned: number; completed: number; pending_bids: number };
  support: { open: number; unanswered: number; urgent: number };
  discounts: { active_campaigns: number; total_redemptions: number; total_discount_amount: string };
  wishlist_count: number;
  recent_audit: { action: string; detail: string; created_at: string }[];
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 ${className ?? ''}`}>{children}</div>;
}

function Kpi({ label, value, sub, icon: Icon, color, onClick, destination }: { label: string; value: string | number; sub?: string; icon: any; color?: string; onClick?: () => void; destination?: string }) {
  const interactive = Boolean(onClick && destination);
  return (
    <div
      onClick={onClick}
      {...(interactive ? { role: 'button', tabIndex: 0, 'aria-label': `${label} — open ${destination}`, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } } } : {})}
      className={`p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 ${interactive ? 'cursor-pointer hover:border-[#15803D] hover:shadow-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">{label}</span>
        <Icon className={`w-4 h-4 ${color ?? 'text-slate-500 dark:text-slate-400'}`} />
      </div>
      <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

const money = (v: string | number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const titleCase = (s: string) =>
  s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export const SuperAdminOverview: React.FC<{ onNavigate: (view: string) => void; refreshKey?: number }> = ({ onNavigate, refreshKey = 0 }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agriData, setAgriData] = useState<any>(null);
  const [agriError, setAgriError] = useState('');

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const res = await apiClient.get('/auth/admin-overview/');
      setData(res.data);
    } catch (err) {
      setError(formatApiError(err, 'Overview data could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    apiClient.get('/auth/agricultural-intel/')
      .then((res) => { setAgriData(res.data); setAgriError(''); })
      .catch((err) => setAgriError(formatApiError(err, 'Agricultural market intelligence could not be loaded.')));
  }, []);

  if (loading) return <div className="p-8 text-center text-xs text-slate-500">Loading platform overview…</div>;
  if (error) return <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>;
  if (!data) return null;

  const roleData = Object.entries(data.users.by_role)
    .map(([role, count]) => ({ name: titleCase(role), count }))
    .sort((a, b) => b.count - a.count);

  const orderStatus = [
    { name: 'Completed', value: data.orders.completed, color: '#15803D' },
    { name: 'Pending', value: data.orders.pending, color: '#f59e0b' },
    { name: 'Disputed', value: data.orders.disputed, color: '#ef4444' },
  ].filter(d => d.value > 0);

  const quickActions = [
    { label: 'Manage Users', view: 'all_users', icon: Users, sub: `${data.users.total} registered` },
    { label: 'Freight Bidding', view: 'freight_bids', icon: Truck, sub: data.freight.open > 0 ? `${data.freight.open} open jobs` : 'No open jobs' },
    { label: 'Support Inbox', view: 'support_management', icon: LifeBuoy, sub: data.support.open > 0 ? `${data.support.open} open tickets` : 'Inbox clear' },
    { label: 'Discounts', view: 'discount_management', icon: Tag, sub: data.discounts.active_campaigns > 0 ? `${data.discounts.active_campaigns} active` : 'No campaigns' },
    { label: 'Audit Logs', view: 'audit_logs', icon: FileText, sub: 'Latest platform events' },
    { label: 'Orders', view: 'orders', icon: ShoppingCart, sub: `${data.orders.total} lifetime orders` },
  ];

  return (
    <div className="space-y-5">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {quickActions.map((qa) => (
          <button
            key={qa.view}
            onClick={() => onNavigate(qa.view)}
            className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#15803D] hover:shadow-md transition-all text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <qa.icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mb-1.5" />
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{qa.label}</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{qa.sub}</div>
            <ArrowRight className="w-3 h-3 text-slate-300 group-hover:text-emerald-500 transition-colors mt-1" />
          </button>
        ))}
      </div>

      {/* KPI Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total Users" value={data.users.total} sub={`+${data.users.new_7d} this week`} icon={Users} color="text-emerald-600" onClick={() => onNavigate('all_users')} destination="All Users" />
        <Kpi label="Pending Registrations" value={data.users.pending} sub="Need review" icon={AlertTriangle} color={data.users.pending > 0 ? 'text-amber-600' : undefined} onClick={() => onNavigate('all_users')} destination="approval queue" />
        <Kpi label="Platform GMV" value={`${money(data.orders.gmv)} ETB`} sub={`${data.orders.new_7d} new orders this week`} icon={ShoppingCart} color="text-emerald-600" onClick={() => onNavigate('reports_regional')} destination="Regional Reports" />
        <Kpi label="Wallet Held (Escrow)" value={`${money(data.wallet.held)} ETB`} sub="Locked pending delivery" icon={Wallet} color="text-amber-600" onClick={() => onNavigate('system_admin')} destination="Wallet Oversight" />
      </div>

      {/* KPI Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Platform Revenue" value={`${money(data.financials.revenue)} ETB`} sub="Commission + delivery fees" icon={TrendingUp} color="text-emerald-600" onClick={() => onNavigate('reports_regional')} destination="Financial Reports" />
        <Kpi label="Payroll" value={`${money(data.financials.payroll)} ETB`} sub="Staff salaries paid" icon={Users} onClick={() => onNavigate('reports_regional')} destination="Financial Reports" />
        <Kpi label="Freight Assigned" value={`${data.freight.assigned} / ${data.freight.assigned + data.freight.open}`} sub="Deliveries with drivers" icon={Truck} onClick={() => onNavigate('freight_bids')} destination="Freight Bidding" />
        <Kpi label="Support Open" value={data.support.open} sub={`${data.support.unanswered} unanswered`} icon={LifeBuoy} color={data.support.unanswered > 0 ? 'text-amber-600' : undefined} onClick={() => onNavigate('support_management')} destination="Support Inbox" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Users by Role</div>
          <div className="h-56" role="img" aria-label="Horizontal bar chart: number of registered users for each role">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} interval={0} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
                  {roleData.map((_, i) => <Cell key={i} fill={ROLE_COLORS[i % ROLE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Order Status</div>
          <div className="h-56 relative" role="img" aria-label="Donut chart: share of orders that are completed, pending, or disputed">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={orderStatus} dataKey="value" nameKey="name" cx="50%" cy="45%" innerRadius={50} outerRadius={75} paddingAngle={4}>
                  {orderStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="!border-emerald-200 dark:!border-emerald-800">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Platform Revenue</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
            {money(data.financials.revenue)} ETB
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Commission + delivery service fees</div>
        </Card>
        <Card className="!border-violet-200 dark:!border-violet-800">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4 text-violet-600" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Active Campaigns</span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">{data.discounts.active_campaigns}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {data.discounts.total_redemptions} redemptions · {money(data.discounts.total_discount_amount)} ETB given
          </div>
        </Card>
        <Card className="!border-sky-200 dark:!border-sky-800">
          <div className="flex items-center gap-2 mb-2">
            <Wallet className="w-4 h-4 text-sky-600" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Wallet Available</span>
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
            {money(data.wallet.available)} ETB
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{money(data.wallet.held)} ETB held in escrow</div>
        </Card>
      </div>

      {/* Agricultural Market Intelligence */}
      {agriError && (
        <div role="alert" className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 text-xs text-amber-700 dark:text-amber-300">{agriError}</div>
      )}
      {agriData && (
        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Truck className="w-4 h-4 text-emerald-600" /> Agricultural Market Intelligence
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Active Products" value={agriData.summary.total_active_products} icon={ShoppingCart} />
            <Kpi label="Scarce Products" value={agriData.summary.total_scarce_products} icon={AlertTriangle} color={agriData.summary.total_scarce_products > 0 ? 'text-amber-600' : undefined} />
            <Kpi label="Weredas Covered" value={agriData.summary.total_weredas_covered} icon={Users} />
            <Kpi label="Product Categories" value={agriData.summary.total_categories} icon={Tag} />
          </div>
          <Card className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 px-3">Region</th>
                  <th className="py-2 px-3 text-right">Products</th>
                  <th className="py-2 px-3 text-right">Total Qty</th>
                  <th className="py-2 px-3 text-right">Market Value</th>
                  <th className="py-2 px-3 text-right">Farmers</th>
                  <th className="py-2 px-3 text-right">Weredas</th>
                  <th className="py-2 px-3">Top Category</th>
                </tr>
              </thead>
              <tbody>
                {agriData.regions.map((r: any) => (
                  <tr key={r.region} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-100">{r.region}</td>
                    <td className="py-2 px-3 text-right font-mono">{r.total_products}</td>
                    <td className="py-2 px-3 text-right font-mono">{Number(r.total_quantity).toLocaleString()}</td>
                    <td className="py-2 px-3 text-right font-mono">{Number(r.total_value_etb).toLocaleString()} ETB</td>
                    <td className="py-2 px-3 text-right">{r.active_farmers}</td>
                    <td className="py-2 px-3 text-right">{r.weredas_covered}</td>
                    <td className="py-2 px-3">{r.top_category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {agriData.scarce_products && agriData.scarce_products.length > 0 && (
            <div className="p-3 rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-2">⚠ Scarce Products (low stock)</div>
              <div className="space-y-1">
                {agriData.scarce_products.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{p.title}</span>
                    <span className="text-slate-500 dark:text-slate-400">({p.category})</span>
                    <span className="font-mono text-amber-600">{Number(p.quantity)} {p.unit}</span>
                    <span className="text-slate-500 dark:text-slate-400">{p.region} · {p.farmer}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recent Activity */}
      <Card>
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-emerald-600" /> Recent Platform Activity
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {data.recent_audit.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs border-b border-slate-50 dark:border-slate-800/50 pb-1">
              <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap w-14 shrink-0">{relTime(a.created_at)}</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200 min-w-32">{a.action.replace(/_/g, ' ')}</span>
              <span className="text-slate-500 dark:text-slate-400 truncate">{a.detail}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
