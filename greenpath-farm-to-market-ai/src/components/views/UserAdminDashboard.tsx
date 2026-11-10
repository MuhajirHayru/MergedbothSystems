import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/apiClient';
import { UserProfile } from '../../types';
import { UserDetailReviewModal } from './UserDetailReviewModal';
import { DataTable } from '../common/DataTable';
import { Pager, pageSlice } from '../common/Pager';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Users,
  FileCheck2,
  ShieldCheck,
  AlertTriangle,
  Search,
  CheckCircle2,
  Eye,
  BarChart3,
} from 'lucide-react';

type Tab = 'pending' | 'directory' | 'approved' | 'suspended';
const PAGE_SIZE = 10;

/** True when the raw ISO timestamp falls inside the selected From/To window.
 *  Records without a timestamp always stay visible (unknown ≠ excluded). */
const inDateRange = (raw: string | undefined, from: string, to: string): boolean => {
  if (!from && !to) return true;
  if (!raw) return true;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return true;
  if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
  if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
  return true;
};

export const UserAdminDashboard: React.FC<{ initialTab?: Tab; initialRole?: string }> = ({ initialTab, initialRole }) => {
  const {
    applications,
    updateApplicationStatus,
    allUsers,
    adminDataStatus,
    updateUserVerification,
    setNotification,
    setActiveView,
  } = useApp();

  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>(initialRole ?? 'all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pendingPage, setPendingPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [selectedReviewUser, setSelectedReviewUser] = useState<UserProfile | null>(null);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);

  // Region filter options come from the administrative reference data, with a
  // static fallback when the endpoint is unavailable for this role.
  useEffect(() => {
    apiClient.get('/superadmin/locations/')
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : res.data?.results || [];
        const names = [...new Set<string>(rows.filter((l: any) => l.level === 'REGION').map((l: any) => String(l.name)))];
        if (names.length) setRegionOptions(names);
      })
      .catch(() => undefined);
  }, []);

  // Any filter change resets pagination to the first page.
  useEffect(() => { setPendingPage(1); setUserPage(1); }, [activeTab, searchQuery, roleFilter, regionFilter, dateFrom, dateTo]);

  const dateFilteredPending = applications.filter(
    (a) => a.status === 'pending' && inDateRange(a.submittedAtRaw, dateFrom, dateTo),
  );
  const pendingApps = pageSlice(dateFilteredPending, pendingPage, PAGE_SIZE);

  const filteredUsers = allUsers.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.region.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.businessName && u.businessName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesRegion = regionFilter === 'all' || u.region === regionFilter;
    const matchesDate = inDateRange(u.registeredAt, dateFrom, dateTo);
    const matchesTab =
      activeTab === 'suspended'
        ? u.verificationStatus === 'suspended'
        : activeTab === 'approved'
        ? u.verificationStatus === 'verified'
        : true;

    return matchesSearch && matchesRole && matchesRegion && matchesDate && matchesTab;
  });
  const visibleUsers = pageSlice(filteredUsers, userPage, PAGE_SIZE);
  const approvedCount = allUsers.filter((u) => u.verificationStatus === 'verified').length;
  const suspendedCount = allUsers.filter((u) => u.verificationStatus === 'suspended').length;

  // ---- Composition charts: mirror exactly what the active tab's table shows,
  // ---- including every active filter (search / role / region / date window).
  const titleCase = (s: string) =>
    s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const isPendingTab = activeTab === 'pending';
  const scopeRows: UserProfile[] | null = isPendingTab ? null : filteredUsers;

  interface CompositionRow { role: string; total: number; pending?: number; approved?: number; pendingAcct?: number; suspended?: number; unverified?: number; }
  const compositionData: CompositionRow[] = (
    isPendingTab
      ? Object.entries(
          dateFilteredPending.reduce<Record<string, number>>((acc, a) => {
            acc[a.role] = (acc[a.role] || 0) + 1;
            return acc;
          }, {}),
        ).map(([role, pending]) => ({ role: titleCase(role), pending, total: pending }))
      : Object.entries(
          (scopeRows || []).reduce<Record<string, UserProfile[]>>((acc, u) => {
            (acc[u.role] = acc[u.role] || []).push(u);
            return acc;
          }, {}),
        )
          .map(([role, list]) => {
            const approved = list.filter((u) => u.verificationStatus === 'verified').length;
            const pendingAcct = list.filter((u) => u.verificationStatus === 'pending').length;
            const suspended = list.filter((u) => u.verificationStatus === 'suspended').length;
            return {
              role: titleCase(role),
              approved,
              pendingAcct,
              suspended,
              unverified: list.length - approved - pendingAcct - suspended,
              total: list.length,
            };
          })
  ).sort((a, b) => b.total - a.total);

  const statusDonutData = isPendingTab
    ? compositionData.map((d) => ({ name: d.role, value: d.pending }))
    : (['approved', 'pendingAcct', 'suspended', 'unverified'] as const)
        .map((key) => ({
          name: key === 'pendingAcct' ? 'Pending' : titleCase(key),
          value: (scopeRows || []).filter(
            (u) =>
              u.verificationStatus ===
              (key === 'pendingAcct' ? 'pending' : key),
          ).length,
        }))
        .filter((d) => d.value > 0);

  const DONUT_COLORS = ['#15803D', '#f59e0b', '#dc2626', '#94a3b8'];
  const scopeTotal = isPendingTab ? dateFilteredPending.length : filteredUsers.length;
  const scopeUnfilteredTotal = isPendingTab
    ? applications.filter((a) => a.status === 'pending').length
    : allUsers.length;
  const chartHeight = Math.max(180, compositionData.length * 36 + 24);

  const tabButton = (tab: Tab, label: string, count?: number) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`py-2.5 px-3 border-b-2 transition-colors ${
        activeTab === tab
          ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          {count}
        </span>
      )}
    </button>
  );

  /** Shared date-range filter row (label adapts per tab). */
  const DateFilter = (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
        {activeTab === 'pending' ? 'Submitted' : 'Registered'}
      </span>
      <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date"
        className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1.5" />
      <span className="text-[11px] text-slate-400">→</span>
      <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="To date"
        className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1.5" />
      {(dateFrom || dateTo) && (
        <button onClick={() => { setDateFrom(''); setDateTo(''); }}
          className="text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-semibold">
          Clear
        </button>
      )}
    </div>
  );

  const statusPill = (status: string) => (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
        status === 'verified'
          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
          : status === 'suspended'
          ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
          : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
      }`}
    >
      {status}
    </span>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>National Accreditation & User Identity Bureau</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            User Administrator Console
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            KYC / KYB Credential verification, agricultural land deeds, commercial licenses, and account governance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
            {dateFilteredPending.length} Applications Pending
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending Accreditation</span>
            <FileCheck2 className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-600 mt-2">
            {dateFilteredPending.length} Applications
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Awaiting MoA & trade validation</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Approved Users</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-600 mt-2">
            {approvedCount} Active
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">Accredited to trade</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Producer Farmers</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold font-mono text-blue-600 mt-2">
            {allUsers.filter((u) => u.role === 'farmer').length} Registered
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Rift Valley & Highland Growers</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Suspended Accounts</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-xl font-bold font-mono text-red-600 mt-2">
            {suspendedCount} Flagged
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Restricted from escrow trading</div>
        </div>
      </div>

      {/* Registration Composition — reacts to every active filter */}
      {adminDataStatus !== 'loading' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                {isPendingTab ? 'Pending Applications by Role' : 'Account Composition by Role & Status'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isPendingTab
                  ? `Showing ${scopeTotal} of ${scopeUnfilteredTotal} pending applications — updates with the submitted-date filter.`
                  : `Showing ${scopeTotal} of ${scopeUnfilteredTotal} registered accounts — updates with search, role, region, and date filters.`}
              </p>
            </div>
          </div>

          {scopeTotal === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
              No records match the current filters — adjust the search, role, region, or date window above.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-3">
              {/* Stacked bar chart */}
              <div className="lg:col-span-8">
                <div style={{ height: chartHeight }} role="img"
                  aria-label={isPendingTab ? 'Bar chart: pending applications per role' : 'Stacked bar chart: accounts per role split by verification status'}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={compositionData} layout="vertical" barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'currentColor' }} className="text-slate-600 dark:text-slate-300" />
                      <YAxis type="category" dataKey="role" width={118} tick={{ fontSize: 11, fill: 'currentColor' }} interval={0} className="text-slate-600 dark:text-slate-300" />
                      <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'var(--tooltip-bg, white)', border: '1px solid var(--tooltip-border, #e2e8f0)' }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {isPendingTab ? (
                        <Bar dataKey="pending" name="Pending applications" fill="#f59e0b" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}
                          label={{ position: 'right', fontSize: 11, fill: 'currentColor' }} />
                      ) : (
                        <>
                          <Bar dataKey="approved" stackId="s" name="Approved" fill="#15803D" barSize={16} isAnimationActive={false} />
                          <Bar dataKey="pendingAcct" stackId="s" name="Pending" fill="#f59e0b" barSize={16} isAnimationActive={false} />
                          <Bar dataKey="suspended" stackId="s" name="Suspended" fill="#dc2626" barSize={16} isAnimationActive={false} />
                          <Bar dataKey="unverified" stackId="s" name="Unverified" fill="#94a3b8" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                        </>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Status donut with visible totals */}
              <div className="lg:col-span-4 flex flex-col">
                <div className="h-44" role="img" aria-label="Donut chart: share of the current selection by status">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusDonutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={3} isAnimationActive={false}>
                        {statusDonutData.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11, backgroundColor: 'var(--tooltip-bg, white)', border: '1px solid var(--tooltip-border, #e2e8f0)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mt-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {statusDonutData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="truncate">{d.name}</span>
                      <span className="ml-auto font-mono font-bold text-slate-800 dark:text-slate-100">{d.value}</span>
                    </div>
                  ))}
                  <div className="col-span-2 flex items-center justify-between text-[11px] font-bold text-slate-800 dark:text-slate-100 pt-1">
                    <span>Total in view</span>
                    <span className="font-mono">{scopeTotal}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 text-xs font-semibold flex-wrap">
        {tabButton('pending', 'Pending Registrations Queue', dateFilteredPending.length)}
        {tabButton('directory', `All Registered Users & Directory (${allUsers.length})`)}
        {tabButton('approved', 'Approved Users', approvedCount)}
        {tabButton('suspended', 'Suspensions & Compliance Flags', suspendedCount)}
      </div>

      {adminDataStatus === 'error' && (
        <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          User records could not be loaded from the server. Refresh the page to retry.
        </div>
      )}

      {adminDataStatus === 'loading' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* TAB 1: Pending Registrations Queue — table format with actions */}
      {activeTab === 'pending' && adminDataStatus !== 'loading' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Incoming User Registration Applications
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                New farmers, wholesalers, retailers, and drivers awaiting credential review before platform access.
              </p>
            </div>
            {DateFilter}
          </div>

          <DataTable
            rows={pendingApps}
            rowId={(a) => a.id}
            rowIdentifier={(a) => a.trackingNumber || a.id}
            columns={[
              {
                key: 'applicant',
                label: 'Applicant',
                render: (a: any) => (
                  <div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{a.fullName}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 capitalize">
                      {a.role}
                      {a.businessName ? ` · ${a.businessName}` : ''}
                    </div>
                  </div>
                ),
              },
              {
                key: 'contact',
                label: 'Contact',
                render: (a: any) => (
                  <div className="font-mono text-slate-600 dark:text-slate-400">
                    <div>{a.email}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{a.phone || '—'}</div>
                  </div>
                ),
              },
              {
                key: 'location',
                label: 'Location',
                render: (a: any) => (
                  <div className="text-slate-600 dark:text-slate-400">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{a.region}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{a.zone} · {a.wereda}</div>
                  </div>
                ),
              },
              {
                key: 'submitted',
                label: 'Submitted',
                render: (a: any) => (
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{a.submittedAt}</span>
                ),
              },
              {
                key: 'documents',
                label: 'Documents',
                render: (a: any) => (
                  <span className="text-[11px] text-slate-600 dark:text-slate-400" title={a.documents.map((d: any) => d.name).join(', ') || 'No documents attached'}>
                    {a.documents.length} attached
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Review & Decide',
                className: 'text-right',
                render: (a: any) => (
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedReviewUser({
                          id: a.id,
                          name: a.fullName,
                          legalFullName: a.fullName,
                          email: a.email,
                          phone: a.phone,
                          age: a.age,
                          sex: a.sex,
                          role: a.role,
                          region: a.region,
                          zone: a.zone,
                          wereda: a.wereda,
                          registeredAddress: `${a.wereda}, ${a.zone}, ${a.region}`,
                          verificationStatus: 'pending',
                          registrationDate: a.submittedAt || '—',
                          businessName: a.businessName,
                          licenseNumber: a.licenseNumber,
                          documents: a.documents,
                        } as UserProfile);
                      }}
                      title="Inspect the full 6-tab profile"
                      className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-semibold rounded-lg flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateApplicationStatus(a.id, 'approved', 'Verified credentials'); }}
                      className="px-2.5 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-[11px] font-bold rounded-lg shadow-xs flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Approve
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateApplicationStatus(a.id, 'rejected', 'Missing valid tax or lease documentation'); }}
                      className="px-2 py-1.5 text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                    >
                      Reject
                    </button>
                  </div>
                ),
              },
            ]}
            emptyMessage={
              dateFrom || dateTo
                ? 'No pending applications inside the selected date window.'
                : 'All registration applications have been reviewed and verified.'
            }
            loading={false}
            filteredTotal={dateFilteredPending.length}
            bulkLabel="applications"
          />
          <Pager
            page={pendingPage}
            pageSize={PAGE_SIZE}
            total={dateFilteredPending.length}
            hasMore={pendingPage * PAGE_SIZE < dateFilteredPending.length}
            onPrev={() => setPendingPage((p) => Math.max(1, p - 1))}
            onNext={() => setPendingPage((p) => p + 1)}
          />
        </div>
      )}

      {/* TAB 2-4: Directory / Approved / Suspended — paginated tables */}
      {(activeTab === 'directory' || activeTab === 'approved' || activeTab === 'suspended') && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search user name, email, TIN, business..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="text-xs p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Roles</option>
                <option value="farmer">Farmers</option>
                <option value="wholesaler">Wholesalers</option>
                <option value="retailer">Retailers</option>
                <option value="driver">Drivers</option>
              </select>

              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="text-xs p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Regions</option>
                {(regionOptions.length
                  ? regionOptions
                  : ['Oromia', 'Addis Ababa', 'Amhara', 'Sidama', 'Central Ethiopia', 'Tigray', 'Somali']
                ).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              {DateFilter}
            </div>
          </div>

          <DataTable
            rows={visibleUsers}
            rowId={(u) => u.id}
            rowIdentifier={(u) => u.id}
            onRowClick={(u) => setSelectedReviewUser(u)}
            columns={[
              {
                key: 'user',
                label: 'User & Entity',
                render: (u: UserProfile) => (
                  <div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{u.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-xs">
                      {u.businessName || 'Individual Agribusiness'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'role',
                label: 'Role',
                render: (u: UserProfile) => (
                  <span className="capitalize font-medium text-slate-700 dark:text-slate-300">
                    {u.role.replace(/_/g, ' ')}
                  </span>
                ),
              },
              {
                key: 'contact',
                label: 'Contact Email & Phone',
                render: (u: UserProfile) => (
                  <div className="font-mono text-slate-600 dark:text-slate-400">
                    <div>{u.email}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{u.phone || '—'}</div>
                  </div>
                ),
              },
              {
                key: 'location',
                label: 'Administrative Location',
                render: (u: UserProfile) => (
                  <div className="text-slate-600 dark:text-slate-400">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">{u.region}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">{u.zone} · {u.wereda}</div>
                  </div>
                ),
              },
              {
                key: 'registered',
                label: 'Registered',
                render: (u: UserProfile) => (
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{u.registrationDate}</span>
                ),
              },
              {
                key: 'status',
                label: 'Verification Status',
                render: (u: UserProfile) => statusPill(u.verificationStatus),
              },
              {
                key: 'view',
                label: 'View',
                className: 'text-center',
                render: (u: UserProfile) => (
                  <span className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400">
                    Review 6 Tabs →
                  </span>
                ),
              },
            ]}
            emptyMessage="No accounts match the current search and filters."
            loading={false}
            filteredTotal={filteredUsers.length}
            bulkLabel="users"
          />
          <Pager
            page={userPage}
            pageSize={PAGE_SIZE}
            total={filteredUsers.length}
            hasMore={userPage * PAGE_SIZE < filteredUsers.length}
            onPrev={() => setUserPage((p) => Math.max(1, p - 1))}
            onNext={() => setUserPage((p) => p + 1)}
          />
        </div>
      )}

      {/* Individual User Review Modal */}
      {selectedReviewUser && (
        <UserDetailReviewModal
          user={selectedReviewUser}
          onClose={() => setSelectedReviewUser(null)}
        />
      )}
    </div>
  );
};
