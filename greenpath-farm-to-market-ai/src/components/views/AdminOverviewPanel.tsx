/**
 * Part 22/34 — Super Admin comprehensive overview.
 * Aggregates data from every subsystem: users, orders, wallets, freight,
 * support, discounts, audit, payroll, and financials. All values from
 * GET /api/v1/auth/admin-overview/ — no mock data.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, ShoppingCart, Wallet, Truck, LifeBuoy, Tag,
  Activity, TrendingUp, TrendingDown, DollarSign,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

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

const ROLE_COLORS: Record<string, string> = {
  FARMER: '#15803D', WHOLESALER: '#0ea5e9', RETAILER: '#8b5cf6',
  DRIVER: '#f59e0b', USER_ADMIN: '#64748b', FINANCIAL_MANAGER: '#ec4899',
  SUPER_ADMIN: '#ef4444', LOGISTICS_MANAGER: '#14b8a6', CUSTOMER_SUPPORT: '#a3e635',
  WEREDA_ADMIN: '#6366f1', ZONAL_ADMIN: '#f97316', TOP_USER_ADMIN: '#06b6d4',
};

function Kpi({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`text-2xl font-bold font-mono mt-1 ${color ?? 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export const AdminOverviewPanel: React.FC = () => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const res = await apiClient.get('/auth/admin-overview/');
      setData(res.data);
    } catch (err) {
      setError(formatApiError(err, 'Dashboard data could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-8 text-center text-xs text-slate-500">Loading overview…</div>;
  if (error) return <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700">{error}</div>;
  if (!data) return null;

  const roleData = Object.entries(data.users.by_role).map(([role, count]) => ({
    name: role.replace(/_/g, ' '), count,
  }));
  const orderData = [
    { name: 'Completed', value: data.orders.completed },
    { name: 'Pending', value: data.orders.pending },
    { name: 'Disputed', value: data.orders.disputed },
  ].filter((d) => d.value > 0);
  const COLORS_ORDER = ['#15803D', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-4 h-4" /> Mission Control
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Platform Overview — All Systems
          </h2>
        </div>
      </div>

      {/* KPI Row 1 — Users & Orders */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Total Users" value={data.users.total} sub={`+${data.users.new_7d} this week`} />
        <Kpi label="Pending Registrations" value={data.users.pending} sub="Need review" color={data.users.pending > 0 ? 'text-amber-600' : undefined} />
        <Kpi label="Total Orders" value={data.orders.total} sub={`${data.orders.new_7d} this week`} />
        <Kpi label="Completed" value={data.orders.completed} color="text-emerald-600" />
        <Kpi label="Platform GMV" value={`${Number(data.orders.gmv).toLocaleString()} ETB`} color="text-emerald-600" />
        <Kpi label="Open Freight Jobs" value={data.freight.open} sub={`${data.freight.pending_bids} pending bids`} />
      </div>

      {/* KPI Row 2 — Financials + Support */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Kpi label="Platform Revenue" value={`${Number(data.financials.revenue).toLocaleString()} ETB`} color="text-emerald-600" />
        <Kpi label="Payroll" value={`${Number(data.financials.payroll).toLocaleString()} ETB`} />
        <Kpi label="Promotion Expenses" value={`${Number(data.financials.expenses).toLocaleString()} ETB`} />
        <Kpi label="Wallet Available" value={`${Number(data.wallet.available).toLocaleString()} ETB`} />
        <Kpi label="Wallet Held (Escrow)" value={`${Number(data.wallet.held).toLocaleString()} ETB`} color="text-amber-600" />
        <Kpi label="Support Open" value={data.support.open} sub={`${data.support.urgent} urgent`} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Users by Role</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Bar dataKey="count" fill="#15803D" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Order Status Distribution</div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={orderData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4}
                  label={({ name, value }) => `${name}: ${value}`}>
                  {orderData.map((_, i) => <Cell key={i} fill={COLORS_ORDER[i % COLORS_ORDER.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Audit Activity */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-emerald-600" /> Recent Platform Activity
        </div>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {data.recent_audit.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-xs border-b border-slate-50 dark:border-slate-800/50 pb-1">
              <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap">{new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200 min-w-32">{a.action.replace(/_/g, ' ')}</span>
              <span className="text-slate-400 truncate">{a.detail}</span>
            </div>
          ))}
          {data.recent_audit.length === 0 && <div className="text-xs text-slate-400">No recent activity.</div>}
        </div>
      </div>
    </div>
  );
};
