import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { RegionalAnalyticsPanel } from './RegionalAnalyticsPanel';
import { RegionalFinancialMetric, ZoneFinancialMetric } from '../../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import {
  Download,
  Printer,
  ChevronRight,
  Filter,
  Calendar,
  MapPin,
  TrendingUp,
  DollarSign,
  ArrowLeft,
  Building,
  Users,
  CheckCircle2,
  Clock,
  Shield,
  FileSpreadsheet,
} from 'lucide-react';

export const RegionalFinancialReportsView: React.FC = () => {
  const { regionalMetrics, regionalMetricsStatus, loadRegionalMetrics, setNotification } = useApp();
  const [period, setPeriod] = useState<'30d' | '90d' | '365d' | 'all'>('all');

  const changePeriod = (next: '30d' | '90d' | '365d' | 'all') => {
    setPeriod(next);
    if (next === 'all') { void loadRegionalMetrics(null); return; }
    const days = next === '30d' ? 30 : next === '90d' ? 90 : 365;
    void loadRegionalMetrics(new Date(Date.now() - days * 86400000).toISOString());
  };

  const [scopeTab, setScopeTab] = useState<'financial' | 'analytics'>('financial');
  const [selectedRegion, setSelectedRegion] = useState<RegionalFinancialMetric | null>(null);
  const [selectedZone, setSelectedZone] = useState<ZoneFinancialMetric | null>(null);

  // Aggregated totals across all regions
  const totalVolumeETB = regionalMetrics.reduce((acc, r) => acc + r.totalTransactionValueETB, 0);
  const totalVerifiedETB = regionalMetrics.reduce((acc, r) => acc + r.verifiedPaymentValueETB, 0);
  const totalPendingETB = regionalMetrics.reduce((acc, r) => acc + r.pendingPaymentValueETB, 0);
  const totalPayoutETB = regionalMetrics.reduce((acc, r) => acc + r.payoutValueETB, 0);
  const totalUsersCount = regionalMetrics.reduce((acc, r) => acc + r.totalUsers, 0);

  // Chart colors for visual distinction (not just one color)
  const COLORS = ['#15803D', '#2563EB', '#D97706', '#9333EA', '#0D9488', '#DC2626', '#4F46E5', '#EA580C'];

  // Formatted data for comparison bar chart
  const regionalComparisonData = regionalMetrics.map((r) => ({
    name: r.region.replace(' (Charter City)', '').replace(' (Charter Administration)', ''),
    'Volume (M ETB)': Number((r.totalTransactionValueETB / 1000000).toFixed(1)),
    'Verified (M ETB)': Number((r.verifiedPaymentValueETB / 1000000).toFixed(1)),
    'Payouts (M ETB)': Number((r.payoutValueETB / 1000000).toFixed(1)),
  }));

  // Donut chart distribution
  const regionalPieData = regionalMetrics.map((r) => ({
    name: r.region,
    value: r.totalTransactionValueETB,
  }));

  const handleExportCSV = () => {
    const headers = [
      'Region',
      'Total Users',
      'Farmers',
      'Wholesalers',
      'Retailers',
      'Total Transactions',
      'Transaction Value (ETB)',
      'Verified Payment (ETB)',
      'Pending Payment (ETB)',
      'Payout Value (ETB)',
      'Available Wallet (ETB)',
      'Held Wallet (ETB)',
    ];

    const rows = regionalMetrics.map((r) => [
      `"${r.region}"`,
      r.totalUsers,
      r.farmersCount,
      r.wholesalersCount,
      r.retailersCount,
      r.totalTransactions,
      r.totalTransactionValueETB,
      r.verifiedPaymentValueETB,
      r.pendingPaymentValueETB,
      r.payoutValueETB,
      r.availableWalletETB,
      r.heldWalletETB,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `GreenPath_Regional_Financial_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setNotification('Regional Financial Report CSV downloaded.');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center gap-2 text-xs font-semibold border-b border-slate-200 dark:border-slate-800 pb-3">
        {([['financial', 'Financial Reports'], ['analytics', 'Users, Registrations & Hierarchy']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setScopeTab(id)}
            className={`py-1.5 px-3 rounded-lg ${scopeTab === id ? 'bg-[#15803D] text-white' : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {scopeTab === 'analytics' && <RegionalAnalyticsPanel />}
      {scopeTab === 'financial' && regionalMetricsStatus === 'loading' && (
        <div className="space-y-4">
          <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
          </div>
        </div>
      )}
      {scopeTab === 'financial' && regionalMetricsStatus === 'error' && (
        <div role="alert" className="p-4 rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          Regional financial records could not be loaded. Your role may not have payment visibility, or the service is unavailable.
        </div>
      )}
      {scopeTab === 'financial' && regionalMetricsStatus === 'ready' && regionalMetrics.length === 0 && (
        <div className="p-10 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500 dark:text-slate-400">
          No regional financial records yet — metrics appear once users and verified payments exist.
        </div>
      )}
      {scopeTab === 'financial' && (regionalMetricsStatus === 'ready' && regionalMetrics.length > 0) && (<>
      {/* Scope Navigation / Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <button
              onClick={() => {
                setSelectedRegion(null);
                setSelectedZone(null);
              }}
              className="hover:text-[#15803D] dark:hover:text-emerald-400 flex items-center gap-1"
            >
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span>All Ethiopia</span>
            </button>
            {selectedRegion && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                <button
                  onClick={() => setSelectedZone(null)}
                  className="hover:text-[#15803D] dark:hover:text-emerald-400 font-bold text-slate-800 dark:text-slate-200"
                >
                  {selectedRegion.region}
                </button>
              </>
            )}
            {selectedZone && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                <span className="text-[#15803D] dark:text-emerald-400 font-bold">
                  {selectedZone.zoneName}
                </span>
              </>
            )}
          </div>

          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            {selectedZone
              ? `${selectedZone.zoneName} Financial Sub-Ledger`
              : selectedRegion
              ? `${selectedRegion.region} Regional Financial Audit`
              : 'Ethiopian Regional Financial Operations & Disbursal Reports'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time settlement telemetry, Chapa Escrow vault balance, and regional trade value in ETB.
          </p>
        </div>

        {/* Reporting period — backed by /superadmin/statistics/?from= */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-semibold" role="group" aria-label="Reporting period">
          {([['30d', '30 days'], ['90d', '90 days'], ['365d', '12 months'], ['all', 'All time']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => changePeriod(id)}
              aria-pressed={period === id}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                period === id
                  ? 'bg-white dark:bg-slate-900 text-[#15803D] dark:text-emerald-400 shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Action Controls & Export */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Aggregate KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Regional Volume</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {(selectedRegion ? selectedRegion.totalTransactionValueETB : totalVolumeETB).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {selectedRegion ? 'Regional records on file' : `Across ${regionalMetrics.length} administrative regions · current platform records`}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Verified Settlements</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {(selectedRegion ? selectedRegion.verifiedPaymentValueETB : totalVerifiedETB).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Chapa Escrow released to seller wallets
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Pending Escrow Balance</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-2">
            {(selectedRegion ? selectedRegion.pendingPaymentValueETB : totalPendingETB).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Locked in transit & quality inspection
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Bank Payouts Disbursed</span>
            <Shield className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {(selectedRegion ? selectedRegion.payoutValueETB : totalPayoutETB).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Transferred to CBE, Awash & Dashen
          </div>
        </div>
      </div>

      {/* Visualizations Section */}
      {!selectedZone && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Bar Chart: Regional Comparison */}
          <div className="lg:col-span-8 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Regional Financial Distribution (Million ETB)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Volume comparison across key agricultural trading corridors
                </p>
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 font-semibold">
                Currency: Millions ETB
              </div>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regionalComparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      borderColor: '#1E293B',
                      borderRadius: '8px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar dataKey="Volume (M ETB)" fill="#15803D" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Verified (M ETB)" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Payouts (M ETB)" fill="#D97706" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Donut Chart: Volume Share */}
          <div className="lg:col-span-4 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Market Volume Share by Region
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Proportion of gross marketplace settlements
              </p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={regionalPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                    >
                      {regionalPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => [`${(Number(val || 0) / 1000000).toFixed(1)}M ETB`, 'Value']}
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderRadius: '8px',
                        color: '#F8FAFC',
                        fontSize: '11px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
              {regionalMetrics.slice(0, 6).map((r, idx) => (
                <div key={r.region} className="flex items-center gap-1.5 truncate">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <span className="truncate">{r.region.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DRILL DOWN VIEW: Zones inside a selected Region */}
      {selectedRegion && !selectedZone && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Zonal Sub-Ledger for {selectedRegion.region}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click a zone to drill into district (Wereda) transactions
              </p>
            </div>
            <button
              onClick={() => setSelectedRegion(null)}
              className="text-xs text-[#15803D] dark:text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to All Regions</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {selectedRegion.zones.map((zone) => (
              <button
                key={zone.zoneName}
                onClick={() => setSelectedZone(zone)}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:border-[#15803D] text-left transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900 dark:text-slate-100 group-hover:text-[#15803D]">
                    {zone.zoneName}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:translate-x-1 transition-transform" />
                </div>
                <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-2">
                  {zone.totalValueETB.toLocaleString()} ETB
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                  <span>{zone.totalTransactions.toLocaleString()} txs</span>
                  <span>{zone.weredas.length} Weredas</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* DRILL DOWN VIEW: Weredas inside a selected Zone */}
      {selectedZone && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Wereda District Granular Breakdown: {selectedZone.zoneName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Micro-level financial transactions recorded at local municipal agro-sheds
              </p>
            </div>
            <button
              onClick={() => setSelectedZone(null)}
              className="text-xs text-[#15803D] dark:text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to {selectedRegion?.region} Zones</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedZone.weredas.map((wereda) => (
              <div
                key={wereda.weredaName}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              >
                <div className="font-bold text-xs text-slate-900 dark:text-slate-100">
                  {wereda.weredaName}
                </div>
                <div className="text-base font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                  {wereda.totalValueETB.toLocaleString()} ETB
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {wereda.totalTransactions.toLocaleString()} completed orders
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Master Regional Financial Table (with drill-down on row click) */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Regional Financial Ledger & Participant Roster
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any region to inspect internal zonal districts. All currency values in Ethiopian Birr (ETB).
            </p>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                <th className="py-3 px-3">Region</th>
                <th className="py-3 px-2 text-right">Users</th>
                <th className="py-3 px-2 text-right">Farmers</th>
                <th className="py-3 px-2 text-right">Wholesalers</th>
                <th className="py-3 px-2 text-right">Retailers</th>
                <th className="py-3 px-2 text-right">Orders</th>
                <th className="py-3 px-3 text-right">Total Value (ETB)</th>
                <th className="py-3 px-3 text-right">Verified (ETB)</th>
                <th className="py-3 px-3 text-right">Pending Escrow</th>
                <th className="py-3 px-3 text-right">Bank Payouts</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {regionalMetrics.map((r) => (
                <tr
                  key={r.region}
                  onClick={() => setSelectedRegion(r)}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${
                    selectedRegion?.region === r.region
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 font-medium'
                      : ''
                  }`}
                >
                  <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{r.region}</span>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                    {r.totalUsers.toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                    {r.farmersCount.toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                    {r.wholesalersCount.toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                    {r.retailersCount.toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                    {r.totalTransactions.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                    {r.totalTransactionValueETB.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-700 dark:text-emerald-400 font-semibold">
                    {r.verifiedPaymentValueETB.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                    {r.pendingPaymentValueETB.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-purple-700 dark:text-purple-400">
                    {r.payoutValueETB.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className="text-[11px] text-[#15803D] dark:text-emerald-400 font-semibold hover:underline">
                      Inspect Zones →
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>)}
    </div>
  );
};
