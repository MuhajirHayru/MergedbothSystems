/**
 * Part 19 — Regional analytics over real user/registration records.
 *
 * Region comparison (users by role and account status), registration trend
 * charts, geographic drill-down (region → zone → wereda → kebele) and the
 * administrative activity report. Every number comes from the
 * /reports/regional-analytics/ and /reports/admin-activity/ endpoints.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Users, MapPin, Activity, ChevronRight } from 'lucide-react';
import { apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

interface RegionRow {
  location_id: string;
  name: string;
  total: number;
  farmer: number;
  wholesaler: number;
  retailer: number;
  driver: number;
  staff: number;
  other: number;
  active: number;
  inactive: number;
  suspended: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface AnalyticsData {
  generated_at: string;
  total_users: number;
  regions: RegionRow[];
  unclassified: RegionRow;
  role_breakdown: { role: string; total: number }[];
  trends: {
    monthly: { period: string; count: number }[];
    weekly: { period: string; count: number }[];
    daily: { period: string; count: number }[];
  };
}

interface DrilldownData {
  location: { id: string; name: string; level: string; parent_id: null | string };
  summary: Record<string, number>;
  users: { id: string; full_name: string; role: string; status: string; created_at: string }[];
  children: (RegionRow & { level: string })[];
  staff: { id: string; full_name: string; role: string; status: string; scope: string }[];
}

interface ActivityData {
  window_days: number;
  total_staff_actions: number;
  by_staff: { staff_id: string; name: string; role: string; actions: number; last_action: string }[];
  recent: { id: number; actor: string; actor_role: string; action: string; detail: string; created_at: string }[];
}

const STATUS_BADGES: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  SUSPENDED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  DEACTIVATED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const emptyBucket: Record<string, number> = {
  total: 0, farmer: 0, wholesaler: 0, retailer: 0, driver: 0, staff: 0,
  active: 0, pending: 0, suspended: 0, rejected: 0, inactive: 0,
};

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

export const RegionalAnalyticsPanel: React.FC = () => {
  const [tab, setTab] = useState<'users' | 'activity'>('users');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // drill-down path: [locationId, name] from root down
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [drilldown, setDrilldown] = useState<DrilldownData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [activityError, setActivityError] = useState('');

  const loadOverview = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const res = await apiClient.get('/reports/regional-analytics/');
      setData(res.data);
    } catch (err) {
      setError(formatApiError(err, 'Regional analytics could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const openNode = useCallback(async (id: string, name: string, append: boolean) => {
    setDrillLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/reports/regional-analytics/${id}/`);
      setDrilldown(res.data);
      setPath((prev) => (append ? [...prev, { id, name }] : [{ id, name }]));
    } catch (err) {
      setError(formatApiError(err, 'Drill-down could not be loaded.'));
    } finally {
      setDrillLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityError('');
    try {
      const res = await apiClient.get('/reports/admin-activity/', { params: { days: 365 } });
      setActivity(res.data);
    } catch (err) {
      setActivityError(formatApiError(err, 'Administrative activity could not be loaded.'));
    }
  }, []);

  useEffect(() => { if (tab === 'activity' && !activity) void loadActivity(); }, [tab, activity, loadActivity]);

  const trendData = (data?.trends.monthly ?? []).map((m) => ({
    period: m.period,
    registrations: m.count,
  }));

  const regionChart = (data?.regions ?? []).slice(0, 10).map((r) => ({
    name: r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name,
    fullName: r.name,
    Farmers: r.farmer,
    Wholesalers: r.wholesaler,
    Retailers: r.retailer,
    Drivers: r.driver,
    Staff: r.staff,
    total: r.total,
    id: r.location_id,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4" />
            <span>Real database analytics</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Regional Users, Registrations &amp; Administrative Activity
          </h2>
        </div>
        <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 text-xs font-semibold">
          {([['users', 'Users & Registrations'], ['activity', 'Administrative Activity']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`py-2 px-3 border-b-2 ${tab === id ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold' : 'border-transparent text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {tab === 'users' && (
        loading ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading regional analytics…</div>
        ) : data && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryCard label="Total users" value={data.total_users} hint="All accounts in the database" />
              <SummaryCard label="Regions with users" value={data.regions.length} hint="From registration locations" />
              <SummaryCard
                label="Pending accounts"
                value={(data.regions.reduce((s, r) => s + r.pending, 0)) + (data.unclassified?.pending ?? 0)}
                hint="Awaiting accreditation review"
              />
              <SummaryCard
                label="Staff accounts"
                value={data.role_breakdown.filter((r) => !['FARMER', 'WHOLESALER', 'RETAILER', 'DRIVER'].includes(r.role)).reduce((s, r) => s + r.total, 0)}
                hint="Administrative, finance & support"
              />
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Users by region and role (top 10 regions — click a bar to drill down)</div>
              <div className="h-72" role="img" aria-label="Stacked bar chart: registered users per region split by role for the top 10 regions">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regionChart} onClick={(state: any) => {
                    const idx = state?.activeTooltipIndex as number | undefined;
                    if (idx != null && regionChart[idx]) void openNode(regionChart[idx].id, regionChart[idx].fullName, true);
                  }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Farmers" stackId="a" fill="#15803D" />
                    <Bar dataKey="Wholesalers" stackId="a" fill="#0ea5e9" />
                    <Bar dataKey="Retailers" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="Drivers" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="Staff" stackId="a" fill="#64748b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Monthly registrations</div>
                <div className="h-56" role="img" aria-label="Line chart: new user registrations per month">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="registrations" stroke="#15803D" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Role breakdown (all accounts)</div>
                <table className="w-full text-xs">
                  <tbody>
                    {data.role_breakdown.map((r) => (
                      <tr key={r.role} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-1.5 text-slate-600 dark:text-slate-300">{r.role.replace(/_/g, ' ')}</td>
                        <td className="py-1.5 text-right font-mono font-bold">{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Drill-down */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-3 flex-wrap">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                <button onClick={() => { setPath([]); setDrilldown(null); }} className="hover:text-emerald-700 font-semibold">All Ethiopia</button>
                {path.map((p, i) => (
                  <React.Fragment key={p.id}>
                    <ChevronRight className="w-3 h-3 text-slate-300" />
                    <button
                      onClick={() => { setPath(path.slice(0, i + 1)); void openNode(p.id, p.name, false); }}
                      className={`hover:text-emerald-700 ${i === path.length - 1 ? 'font-bold text-slate-800 dark:text-slate-100' : ''}`}
                    >
                      {p.name}
                    </button>
                  </React.Fragment>
                ))}
                {drillLoading && <span className="ml-2 text-slate-400">loading…</span>}
              </div>

              {drilldown ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <SummaryCard label="Users here" value={drilldown.summary.total ?? 0} />
                    <SummaryCard label="Active" value={drilldown.summary.active ?? 0} />
                    <SummaryCard label="Pending" value={drilldown.summary.pending ?? 0} />
                    <SummaryCard label="Suspended" value={drilldown.summary.suspended ?? 0} />
                    <SummaryCard label="Staff" value={drilldown.summary.staff ?? 0} />
                  </div>

                  {drilldown.children.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">
                        Sub-administrations ({drilldown.children.length})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {drilldown.children.map((c) => (
                          <button
                            key={c.location_id}
                            onClick={() => void openNode(c.location_id, c.name, true)}
                            className={`text-left p-3 rounded-xl border text-xs transition-colors ${
                              c.total > 0
                                ? 'border-slate-200 dark:border-slate-700 hover:border-[#15803D] hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20'
                                : 'border-slate-100 dark:border-slate-800 opacity-60'
                            }`}
                          >
                            <div className="font-bold text-slate-800 dark:text-slate-100">{c.name}</div>
                            <div className="text-[11px] text-slate-500">{c.level} · {c.total} users</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Users at this level ({drilldown.users.length})</div>
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                          <tr className="text-left text-slate-500">
                            <th className="py-1.5 px-2">Name</th><th className="py-1.5 px-2">Role</th><th className="py-1.5 px-2">Status</th><th className="py-1.5 px-2">Registered</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drilldown.users.map((u) => (
                            <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800/60">
                              <td className="py-1.5 px-2">{u.full_name}</td>
                              <td className="py-1.5 px-2">{u.role.replace(/_/g, ' ')}</td>
                              <td className="py-1.5 px-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGES[u.status] || ''}`}>{u.status}</span>
                              </td>
                              <td className="py-1.5 px-2 text-slate-400">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                            </tr>
                          ))}
                          {drilldown.users.length === 0 && (
                            <tr><td colSpan={4} className="py-3 text-center text-slate-400">No users registered exactly at this level.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {drilldown.staff.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-2">Administrative staff &amp; assignments</div>
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-slate-500"><th className="py-1.5 px-2">Name</th><th className="py-1.5 px-2">Role</th><th className="py-1.5 px-2">Scope</th><th className="py-1.5 px-2">Status</th></tr></thead>
                        <tbody>
                          {drilldown.staff.map((s) => (
                            <tr key={s.id} className="border-b border-slate-100 dark:border-slate-800/60">
                              <td className="py-1.5 px-2">{s.full_name}</td>
                              <td className="py-1.5 px-2">{s.role.replace(/_/g, ' ')}</td>
                              <td className="py-1.5 px-2">{s.scope}</td>
                              <td className="py-1.5 px-2">{s.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Click a region bar (or use the region cards) to inspect zones, weredas and users.</p>
              )}
            </div>
          </div>
        )
      )}

      {tab === 'activity' && (
        activityError ? (
          <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{activityError}</div>
        ) : !activity ? (
          <div className="p-8 text-center text-xs text-slate-500">Loading administrative activity…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <SummaryCard label="Staff actions (365d)" value={activity.total_staff_actions} hint="From the immutable audit log" />
              <SummaryCard label="Active staff" value={activity.by_staff.length} hint="Made at least one recorded action" />
              <SummaryCard label="Window" value={`${activity.window_days} days`} />
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Actions per staff member</div>
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-1.5 px-2">Staff</th><th className="py-1.5 px-2">Role</th><th className="py-1.5 px-2 text-right">Actions</th><th className="py-1.5 px-2">Last action</th>
                </tr></thead>
                <tbody>
                  {activity.by_staff.map((s) => (
                    <tr key={s.staff_id} className="border-b border-slate-100 dark:border-slate-800/60">
                      <td className="py-1.5 px-2 font-semibold">{s.name}</td>
                      <td className="py-1.5 px-2">{s.role.replace(/_/g, ' ')}</td>
                      <td className="py-1.5 px-2 text-right font-mono font-bold">{s.actions}</td>
                      <td className="py-1.5 px-2 text-slate-400">{s.last_action ? new Date(s.last_action).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-600" /> Recent staff actions
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                    <tr className="text-left text-slate-500"><th className="py-1.5 px-2">When</th><th className="py-1.5 px-2">Staff</th><th className="py-1.5 px-2">Action</th><th className="py-1.5 px-2">Detail</th></tr>
                  </thead>
                  <tbody>
                    {activity.recent.map((a) => (
                      <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-1.5 px-2 whitespace-nowrap text-slate-400">{new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="py-1.5 px-2">{a.actor} <span className="text-slate-400">({a.actor_role.replace(/_/g, ' ')})</span></td>
                        <td className="py-1.5 px-2 font-mono text-[11px]">{a.action}</td>
                        <td className="py-1.5 px-2 text-slate-500 truncate max-w-sm">{a.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
};
