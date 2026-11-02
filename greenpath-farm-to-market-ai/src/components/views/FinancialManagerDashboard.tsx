import React, { useCallback, useEffect, useState } from 'react';
import { useApp, ReviewOutcome } from '../../context/AppContext';
import { mapBankAccount } from '../../services/adapters';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { DepositRecord, PayoutRequest, TransactionRecord } from '../../types';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  ShieldCheck,
  Download,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Filter,
  Calendar,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  Lock,
  FileText,
  CreditCard,
  Truck,
  Eye,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

export const FinancialManagerDashboard: React.FC = () => {
  const {
    wallet,
    approveDeposit,
    flagDeposit,
    rejectDeposit,
    approvePayout,
    orders,
    bankAccounts,
    setNotification,
    setActiveView,
  } = useApp();

  // Active sub-tab
  const initialFinancialTab = typeof window !== 'undefined' && window.location.hash === '#financial-controls';
  const [activeTab, setActiveTab] = useState<
    | 'financial_overview'
    | 'financial_controls'
    | 'overview'
    | 'verification'
    | 'payouts'
    | 'wallet_mgmt'
    | 'delivery_fees'
    | 'bank_accounts'
    | 'ledger'
  >(initialFinancialTab ? 'financial_controls' : 'financial_overview');

  // Filters
  const [timeRange, setTimeRange] = useState<string>('30d');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [selectedPaymentTypeFilter, setSelectedPaymentTypeFilter] = useState<string>('all');
  const [searchLedger, setSearchLedger] = useState<string>('');

  // Real financial analytics (server-side aggregates only)
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [financialConfigs, setFinancialConfigs] = useState<any[]>([]);
  const [financialLedger, setFinancialLedger] = useState<any[]>([]);
  const [financialControlsError, setFinancialControlsError] = useState('');
  const [financialControlsLoading, setFinancialControlsLoading] = useState(false);
  const [financialReport, setFinancialReport] = useState<any>(null);
  const [financialReportError, setFinancialReportError] = useState('');
  const [financialReconciliation, setFinancialReconciliation] = useState<any>(null);
  const [financialRefunds, setFinancialRefunds] = useState<any[]>([]);

  useEffect(() => {
    api.financialControls.report(timeRange === 'custom' && customDateFrom && customDateTo
      ? { start: customDateFrom, end: customDateTo }
      : { period: timeRange === 'today' ? 'daily' : timeRange === '7d' ? 'weekly' : timeRange === 'month' ? 'monthly' : 'monthly' })
      .then((response) => { setFinancialReport(response.data); setFinancialReportError(''); })
      .catch((error) => { setFinancialReport(null); setFinancialReportError(formatApiError(error, 'Financial report is unavailable.')); });
  }, [timeRange, customDateFrom, customDateTo]);

  useEffect(() => {
    if (activeTab !== 'financial_controls') return;
    setFinancialControlsLoading(true);
    setFinancialControlsError('');
    Promise.all([api.financialControls.configurations(), api.financialControls.ledger(), api.financialControls.reconciliation(), api.financialControls.refunds()])
      .then(([configs, ledger, reconciliation, refunds]) => {
        setFinancialConfigs(Array.isArray(configs.data) ? configs.data : configs.data?.results || []);
        setFinancialLedger(Array.isArray(ledger.data) ? ledger.data : ledger.data?.results || []);
        setFinancialReconciliation(reconciliation.data);
        setFinancialRefunds(Array.isArray(refunds.data) ? refunds.data : refunds.data?.results || []);
      })
      .catch((error) => setFinancialControlsError(formatApiError(error, 'Financial controls could not be loaded.')))
      .finally(() => setFinancialControlsLoading(false));
  }, [activeTab]);

  const rangeDays =
    timeRange === 'today'
      ? 1
      : timeRange === '7d'
      ? 7
      : timeRange === 'month'
      ? new Date().getDate()
      : 30;
  useEffect(() => {
    let cancelled = false;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    api.dashboard
      .financialAnalytics(
        timeRange === 'custom' && customDateFrom && customDateTo
          ? { date_from: customDateFrom, date_to: customDateTo }
          : { days: rangeDays }
      )
      .then((response) => {
        if (!cancelled) setAnalytics(response?.data ?? null);
      })
      .catch((err) => {
        if (!cancelled) {
          setAnalyticsError(
            formatApiError(err, 'Financial analytics could not be loaded.')
          );
          setAnalytics(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeDays, customDateFrom, customDateTo, timeRange]);

  // Server-side operations summary: platform wallet totals, role split,
  // pending/paid funding and payouts, GMV and the explicit revenue gap.
  const [operations, setOperations] = useState<any>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState('');

  // Bank accounts review state
  const [reviewAccounts, setReviewAccounts] = useState<any[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [accountBusyId, setAccountBusyId] = useState<string | null>(null);
  const [accountDetails, setAccountDetails] = useState<any | null>(null);

  const loadOperations = useCallback(async () => {
    setOperationsLoading(true);
    setOperationsError('');
    try {
      const response = await api.dashboard.financialOperations(
        timeRange === 'custom' && customDateFrom && customDateTo
          ? { date_from: customDateFrom, date_to: customDateTo }
          : { days: rangeDays }
      );
      setOperations(response?.data ?? null);
    } catch (err) {
      setOperationsError(
        formatApiError(err, 'The financial overview could not be loaded.')
      );
      setOperations(null);
    } finally {
      setOperationsLoading(false);
    }
  }, [rangeDays, customDateFrom, customDateTo, timeRange]);

  useEffect(() => {
    void loadOperations();
  }, [loadOperations]);

  // Load bank accounts for FM review with search/filter support
  const loadReviewAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError('');
    try {
      const params: any = { page_size: 100 };
      if (accountSearch.trim()) params.search = accountSearch.trim();
      if (accountStatus.trim()) params.status = accountStatus.trim();
      
      const response = await api.wallet.bankAccounts(params);
      const rows = response?.data?.results ?? response?.data ?? [];
      const mapped = Array.isArray(rows) ? rows.map(mapBankAccount) : [];
      setReviewAccounts(mapped);
    } catch (err) {
      setAccountsError(formatApiError(err, 'Could not load bank accounts for review.'));
      setReviewAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, [accountSearch, accountStatus]);

  // Load accounts when bank_accounts tab is active
  useEffect(() => {
    if (activeTab === 'bank_accounts') {
      void loadReviewAccounts();
    }
  }, [activeTab, loadReviewAccounts]);

  // Action state: one in-flight decision at a time, with a persistent result
  // banner so the reference is still visible after the toast expires.
  const [depositBusyId, setDepositBusyId] = useState<string | null>(null);
  const [payoutBusyId, setPayoutBusyId] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ReviewOutcome | null>(null);
  const [showProcessedDeposits, setShowProcessedDeposits] = useState(false);
  const [showProcessedPayouts, setShowProcessedPayouts] = useState(false);

  // Flag/Reject modals state
  const [flagModalDeposit, setFlagModalDeposit] = useState<DepositRecord | null>(null);
  const [flagReason, setFlagReason] = useState<string>('');
  const [rejectModalDeposit, setRejectModalDeposit] = useState<DepositRecord | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const runDepositDecision = async (
    action: 'approve' | 'reject' | 'flag',
    deposit: DepositRecord,
    reason = ''
  ) => {
    if (depositBusyId) return;
    setDepositBusyId(deposit.id);
    setActionResult(null);
    try {
      if (action === 'reject' && !reason.trim()) {
        throw new Error('Provide a reason when rejecting a deposit.');
      }
      const outcome =
        action === 'approve'
          ? await approveDeposit(deposit.id)
          : action === 'reject'
          ? await rejectDeposit(deposit.id, reason)
          : await flagDeposit(deposit.id, reason);
      setActionResult(outcome);
    } catch (err: any) {
      const message = err?.message || 'The deposit decision could not be completed.';
      setActionResult({ ok: false, id: deposit.id, message });
      setNotification(message);
    } finally {
      setDepositBusyId(null);
    }
  };

  const runPayoutApproval = async (payout: PayoutRequest) => {
    if (payoutBusyId) return;
    let reference = '';
    if (!payout.payoutAccount) {
      const entered = window.prompt(
        'Enter the verified bank or transfer reference for this manual payout:'
      );
      if (!entered?.trim()) return;
      reference = entered.trim();
    }
    setPayoutBusyId(payout.id);
    setActionResult(null);
    try {
      const outcome = await approvePayout(
        payout.id,
        reference,
        reference
          ? 'Manual payout confirmed by Financial Manager.'
          : 'Approved for disbursement.'
      );
      setActionResult(outcome);
    } finally {
      setPayoutBusyId(null);
    }
  };

  // Real driver delivery-fee agreements awaiting financial review.
  const [deliveryAgreements, setDeliveryAgreements] = useState<any[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState('');
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [rejectingAgreement, setRejectingAgreement] = useState<any | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const loadDeliveryAgreements = useCallback(async () => {
    setDeliveryLoading(true);
    setDeliveryError('');
    try {
      const response = await api.payments.deliveryFeeAgreements({ status: 'all' });
      const rows = Array.isArray(response?.data?.results)
        ? response.data.results
        : Array.isArray(response?.data)
        ? response.data
        : [];
      setDeliveryAgreements(rows);
    } catch (err: any) {
      setDeliveryError(
        formatApiError(err, 'Delivery-fee agreements could not be loaded.')
      );
      setDeliveryAgreements([]);
    } finally {
      setDeliveryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'delivery_fees') return;
    void loadDeliveryAgreements();
  }, [activeTab, loadDeliveryAgreements]);

  const reviewDeliveryFee = async (
    agreement: any,
    decision: 'approved' | 'rejected'
  ) => {
    setReviewBusyId(agreement.id);
    setDeliveryError('');
    try {
      await api.payments.reviewDeliveryFeeAgreement(agreement.id, {
        decision,
        proposal_version: agreement.driver_proposal_version,
        ...(decision === 'rejected'
          ? { rejection_reason: rejectionReason.trim() }
          : {}),
      });
      setNotification?.(
        `Delivery fee ${decision} for order ${agreement.order_reference}.`
      );
      setRejectingAgreement(null);
      setRejectionReason('');
      await loadDeliveryAgreements();
    } catch (err: any) {
      setDeliveryError(formatApiError(err, 'The delivery-fee review could not be saved.'));
    } finally {
      setReviewBusyId(null);
    }
  };

  // 10 Distinct Recharts Data Models with rich Ethiopian financial telemetry
  // 1. Daily financial transaction trend (Line Chart)
  const dailyTrendData = analytics?.daily_trend ?? [];

  // 2. Weekly financial performance (Bar Chart)
  const weeklyPerformanceData = analytics?.weekly_performance ?? [];

  // 3. Monthly financial performance (Area Chart)
  const monthlyPerformanceData = analytics?.monthly_performance ?? [];

  // 4. Regional transaction distribution (Bar Chart)
  const regionalDistData = analytics?.regional_distribution ?? [];

  // 5. Wallet balance distribution (Donut Chart)
  const walletDistData = analytics?.wallet_distribution ?? [];

  // 6. Deposit and payout comparison (Stacked Bar Chart)
  const depositPayoutComparisonData = analytics?.deposit_payout_comparison ?? [];

  // 7. Pending versus verified payments (Donut Chart)
  const pendingVsVerifiedData = analytics?.pending_vs_verified ?? [];

  // 8. Payment method distribution (Donut Chart)
  const paymentMethodData = (analytics?.payment_methods ?? []).map((row: any, index: number) => ({ ...row, value: row.value, color: ["#2563EB","#0D9488","#9333EA","#64748B","#D97706"][index % 5] }));

  // 9. Delivery fee financial summary (Bar Chart)
  const deliveryFeeData = analytics?.delivery_fees ?? [];

  // 10. Financial performance by user role (Bar Chart)
  const rolePerformanceData = analytics?.role_performance ?? [];

  const pendingDeposits = wallet.deposits.filter(
    (deposit) => deposit.status === 'Pending' || deposit.status === 'Flagged'
  );
  const pendingPayouts = wallet.payouts.filter((p) => p.status === 'pending');
  const visibleDeposits = showProcessedDeposits ? wallet.deposits : pendingDeposits;
  const visiblePayouts = showProcessedPayouts ? wallet.payouts : pendingPayouts;
  const financeSummary = analytics?.summary ?? {};
  const totalVolume = financeSummary.totalVolumeETB ?? wallet.totalVolumeETB ?? 0;
  const availableBalance =
    financeSummary.availableBalanceETB ?? wallet.availableBalanceETB ?? 0;
  const heldBalance =
    financeSummary.heldBalanceETB ?? wallet.heldBalanceETB ?? 0;
  const pendingDepositCount =
    financeSummary.pendingDeposits ?? pendingDeposits.length;
  const pendingPayoutCount =
    financeSummary.pendingPayouts ?? pendingPayouts.length;

  const filteredLedgerTransactions = wallet.transactions.filter(
    (t) =>
      t.reference.toLowerCase().includes(searchLedger.toLowerCase()) ||
      t.counterparty.toLowerCase().includes(searchLedger.toLowerCase()) ||
      t.description.toLowerCase().includes(searchLedger.toLowerCase())
  );

  const operationsSummary = operations || {};
  const platformWallets = operationsSummary.wallets || {};
  const overviewActivity = operationsSummary.activity || {};
  const revenueState = operationsSummary.revenue || {};
  const roleBreakdown = Object.entries(platformWallets.by_role || {}).map(
    ([role, value]: [string, any]) => ({
      role: role
        .replace('_', ' ')
        .toLowerCase()
        .replace(/\b\w/g, (character) => character.toUpperCase()),
      wallets: Number(value?.count || 0),
      available: Number(value?.available_balance || 0),
      held: Number(value?.held_balance || 0),
      total:
        Number(value?.total_balance || 0) ||
        Number(value?.available_balance || 0) + Number(value?.held_balance || 0),
    })
  );
  const activityChartData = [
    {
      stage: 'Deposits',
      requested: Number(overviewActivity.funding?.requested?.amount || 0),
      decided: Number(overviewActivity.funding?.approved?.amount || 0),
      pending: Number(overviewActivity.funding?.pending_current?.amount || 0),
    },
    {
      stage: 'Payouts',
      requested: Number(overviewActivity.payouts?.requested?.amount || 0),
      decided: Number(overviewActivity.payouts?.paid?.amount || 0),
      pending: Number(overviewActivity.payouts?.pending_current?.amount || 0),
    },
  ];
  const gmvValue = Number(overviewActivity.orders?.gmv || 0);
  const verifiedPaymentAmount = Number(
    overviewActivity.payments?.verified_amount || 0
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>Escrow Oversight & Financial Intelligence Bureau</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Financial Manager Operations Center
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Chapa Escrow vault balancing, automated payment rails, bank settlements, and multi-regional audits.
          </p>
        </div>

        {/* Global Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Filter */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-semibold">
            {[
              { id: 'today', label: 'Today' },
              { id: '7d', label: '7D' },
              { id: '30d', label: '30D' },
              { id: 'month', label: 'This Month' },
              { id: 'custom', label: 'Custom' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTimeRange(t.id)}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  timeRange === t.id
                    ? 'bg-white dark:bg-slate-900 text-[#15803D] dark:text-emerald-400 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {timeRange === 'custom' && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                aria-label="Start date"
                value={customDateFrom}
                max={customDateTo || undefined}
                onChange={(event) => setCustomDateFrom(event.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <input
                type="date"
                aria-label="End date"
                value={customDateTo}
                min={customDateFrom || undefined}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setCustomDateTo(event.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
          )}

          <button
            onClick={() => setActiveView('reports_regional')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Regional Financial Reports →</span>
          </button>
        </div>
      </div>

      {/* Aggregate Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Escrow Volume</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {Number(totalVolume).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            <span>
              {analytics?.range?.days ?? 30}-day verified wallet volume
            </span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Active Available Balances</span>
            <Building2 className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-2">
            {Number(availableBalance).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Ready for instant purchase allocation
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Held in Platform Escrow</span>
            <Lock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-2">
            {Number(heldBalance).toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Locked across active cargo transit
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Pending Verifications</span>
            <Clock className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-xl font-bold font-mono text-purple-600 dark:text-purple-400 mt-2">
            {pendingDepositCount + pendingPayoutCount} items
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {pendingDepositCount} deposits / {pendingPayoutCount} payouts
          </div>
        </div>
      </div>

      {actionResult && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
            actionResult.ok
              ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
              : 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}
        >
          {actionResult.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <div className="font-bold">
              {actionResult.ok ? 'Decision recorded' : 'Decision failed'}
              {actionResult.status ? ` · ${actionResult.status}` : ''}
            </div>
            <div>{actionResult.message}</div>
            {actionResult.reference && (
              <div className="font-mono text-[11px] opacity-80">
                Reference: {actionResult.reference}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActionResult(null)}
            className="ml-auto underline font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sub-Tabs Navigation */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto text-xs font-semibold scrollbar-none">
        {[
          { id: 'financial_overview', label: 'Financial Overview' },
          { id: 'financial_controls', label: 'Financial Controls' },
          { id: 'overview', label: '10 Financial Charts Overview' },
          { id: 'verification', label: `Deposit Verifications (${pendingDepositCount})` },
          { id: 'payouts', label: `Payout Requests (${pendingPayoutCount})` },
          { id: 'wallet_mgmt', label: 'Wallet Vault & Escrow' },
          { id: 'delivery_fees', label: 'Delivery Fee Agreements' },
          { id: 'bank_accounts', label: 'Bank Accounts Review' },
          { id: 'ledger', label: 'Append-Only Ledger' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-2.5 px-3 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'financial_controls' && (
        <div className="space-y-5">
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-bold text-sm mb-2">Approved Financial Rules</h3>
            <p className="text-xs text-slate-500 mb-3">Financial Managers can review controls and propose changes; approval is restricted to Super Admin.</p>
            {financialControlsLoading ? <p>Loading…</p> : financialControlsError ? <p role="alert" className="text-sm text-red-600">{financialControlsError}</p> : financialConfigs.length === 0 ? <p className="text-sm text-slate-500">No financial configuration records.</p> : <div className="space-y-2">{financialConfigs.map((rule) => <div key={rule.id} className="p-3 border rounded-lg dark:border-slate-700"><p className="font-semibold text-sm">{rule.name} · {rule.kind} v{rule.version} · {rule.status}</p><p className="text-xs text-slate-500">{rule.reason}</p>{rule.kind === 'TAX' && <p className="text-xs">Source: {rule.source || 'Not provided'} {rule.source_url}</p>}</div>)}</div>}
          </section>
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-bold text-sm mb-2">Financial Journal</h3>
            <p className="text-xs text-slate-500 mb-3">Only explicit double-entry postings appear here. Wallet balances are not treated as revenue.</p>
            {financialLedger.length === 0 ? <p className="text-sm text-slate-500">No journal entries recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-2">Date</th><th className="p-2">Ref</th><th className="p-2">Category</th><th className="p-2">Debit</th><th className="p-2">Credit</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>{financialLedger.map((entry) => <tr key={entry.id} className="border-b dark:border-slate-700"><td className="p-2">{new Date(entry.created_at).toLocaleDateString()}</td><td className="p-2 font-mono">{entry.reference}</td><td className="p-2">{entry.category}</td><td className="p-2">{entry.debit_account}</td><td className="p-2">{entry.credit_account}</td><td className="p-2 text-right">{entry.amount} {entry.currency}</td></tr>)}</tbody></table></div>}
          </section>
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <h3 className="font-bold text-sm">Delivery collection reconciliation</h3>
            {!financialReconciliation ? <p className="text-sm text-slate-500">Reconciliation unavailable.</p> : <><p className="text-sm">{financialReconciliation.complete ? 'No discrepancies reported.' : `${financialReconciliation.issue_count} discrepancy(s) require review.`}</p>{(financialReconciliation.discrepancies || []).map((item: any, index: number) => <p key={`${item.reference}-${index}`} className="text-xs text-amber-700">{item.source}: {item.reference} — {item.issue}</p>)}</>}
            <h3 className="font-bold text-sm pt-2">Refunds and reversals</h3>
            {!financialRefunds.length ? <p className="text-sm text-slate-500">No refund records returned.</p> : financialRefunds.map((refund: any) => <div key={refund.id} className="text-xs border-b py-2"><span className="font-mono">{refund.order__reference}</span> · {refund.amount} ETB · {refund.status} · {refund.payment_reference || 'No payment reference'}</div>)}
          </section>
        </div>
      )}

      {/* SUB-TAB 0: Complete Financial Overview (wallet, activity, revenue gap) */}
      {activeTab === 'financial_overview' && (
        <div className="space-y-6">
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-bold text-sm">Revenue and profit (ledger-backed)</h3>
            {financialReportError ? <p role="alert" className="text-sm text-red-600">{financialReportError}</p> : !financialReport ? <p className="text-sm text-slate-500">Loading report…</p> : <>
              <p className="text-xs text-slate-500 mt-1">{financialReport.complete ? 'Commission configuration coverage is complete for completed orders.' : `Unavailable: ${financialReport.unsupported_completed_orders} completed order(s) lack complete accounting snapshots.`}</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">{[
                ['Marketplace GMV', financialReport.gmv], ['Platform commission', financialReport.commission_revenue], ['Farmer service fees', financialReport.farmer_service_fee_revenue], ['Wholesaler service fees', financialReport.wholesaler_service_fee_revenue], ['Retailer service fees', financialReport.retailer_service_fee_revenue], ['Driver service fees', financialReport.driver_service_fee_revenue], ['Delivery service revenue', financialReport.delivery_service_revenue], ['Driver compensation', financialReport.driver_compensation], ['Tax collected', financialReport.tax_collected], ['Tax payable', financialReport.tax_payable], ['Delivery payments collected', financialReport.delivery_collections_collected], ['Driver compensation payable', financialReport.delivery_driver_payable], ['Delivery service-fee revenue', financialReport.delivery_service_revenue], ['Delivery tax collected', financialReport.delivery_tax_collected], ['Outstanding delivery collections', financialReport.delivery_collections_outstanding], ['Failed delivery collections', financialReport.delivery_collections_failed], ['Refunds and reversals', financialReport.delivery_refunds], ['Operating expenses', financialReport.operating_expenses], ['Payroll expenses', financialReport.payroll_expenses], ['Gross profit', financialReport.gross_profit], ['Net profit', financialReport.net_profit],
              ].map(([label, value]) => <div key={label} className="rounded-lg border p-3 dark:border-slate-700"><p className="text-xs text-slate-500">{label}</p><p className="font-mono font-semibold mt-1">{value == null ? 'Unavailable' : `${value} ETB`}</p></div>)}</div>
              <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Underlying accounting transactions</summary><div className="overflow-x-auto mt-2"><table className="w-full text-xs"><thead><tr className="text-left border-b"><th className="p-2">Reference</th><th className="p-2">Type</th><th className="p-2">Source</th><th className="p-2">Debit</th><th className="p-2">Credit</th><th className="p-2 text-right">Amount</th></tr></thead><tbody>{(financialReport.transactions || []).map((row: any) => <tr key={row.reference} className="border-b dark:border-slate-700"><td className="p-2 font-mono">{row.reference}</td><td className="p-2">{row.category}</td><td className="p-2">{row.source_reference}</td><td className="p-2">{row.debit_account__code}</td><td className="p-2">{row.credit_account__code}</td><td className="p-2 text-right">{row.amount} {row.currency}</td></tr>)}</tbody></table></div></details>
            </>}
          </section>
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Complete Financial Overview
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {operationsSummary.period?.label
                    ? `Current wallet position with activity from ${operationsSummary.period.label}.`
                    : 'Current wallet position and period activity, computed from persisted records.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadOperations()}
                disabled={operationsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${operationsLoading ? 'animate-spin' : ''}`}
                />
                <span>{operationsLoading ? 'Refreshing…' : 'Refresh overview'}</span>
              </button>
            </div>
          </div>

          {operationsError && (
            <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{operationsError}</span>
              <button
                type="button"
                onClick={() => void loadOperations()}
                className="ml-auto underline font-semibold"
              >
                Retry
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Total Platform Wallet Balance
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
                {Number(platformWallets.total_balance || 0).toLocaleString()} ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {Number(platformWallets.count || 0)} participant wallets
              </div>
            </div>
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 shadow-xs">
              <div className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold">
                Available for Trade
              </div>
              <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-2">
                {Number(platformWallets.available_balance || 0).toLocaleString()} ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Spendable participant funds
              </div>
            </div>
            <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs">
              <div className="text-xs text-amber-800 dark:text-amber-300 font-semibold">
                Held in Escrow
              </div>
              <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-2">
                {Number(platformWallets.held_balance || 0).toLocaleString()} ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Locked against active orders and payouts
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Pending Deposit Verifications
              </div>
              <div className="text-xl font-bold font-mono text-purple-600 dark:text-purple-400 mt-2">
                {Number(
                  overviewActivity.funding?.pending_current?.amount || 0
                ).toLocaleString()}{' '}
                ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {Number(overviewActivity.funding?.pending_current?.count || 0)} requests
                awaiting review
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Pending Payout Requests
              </div>
              <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-2">
                {Number(overviewActivity.payouts?.pending_current?.amount || 0).toLocaleString()}{' '}
                ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {Number(overviewActivity.payouts?.pending_current?.count || 0)} requests
                awaiting disbursement
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Completed-Order GMV
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
                {gmvValue.toLocaleString()} ETB
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {Number(overviewActivity.orders?.completed_count || 0)} completed orders
                in period · marketplace turnover, not revenue
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="font-bold text-sm text-amber-900 dark:text-amber-200">
                  Revenue, Expenses and Profit: Not Tracked
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  {revenueState.reason ||
                    'The platform has no commission, fee or expense ledger, so revenue and profit are unavailable rather than estimated.'}
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Verified marketplace payments: {verifiedPaymentAmount.toLocaleString()}{' '}
                  ETB ({Number(overviewActivity.payments?.verified_count || 0)} records).
                  This is settlement value, not platform revenue. Missing data:{' '}
                  {(revenueState.missing || []).join(', ') || 'commission, expenses, cost of goods'}.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Wallet Balances by Role
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                Available versus escrow-held funds per participant role
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={roleBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="role" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: any) => [
                        `${Number(value || 0).toLocaleString()} ETB`,
                      ]}
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderRadius: '8px',
                        color: '#FFF',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar
                      dataKey="available"
                      name="Available"
                      stackId="wallet"
                      fill="#15803D"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="held"
                      name="Held"
                      stackId="wallet"
                      fill="#D97706"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Funding and Payout Activity
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                Requested, approved/paid and still-pending value in the selected period
              </p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityChartData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: any) => [
                        `${Number(value || 0).toLocaleString()} ETB`,
                      ]}
                      contentStyle={{
                        backgroundColor: '#0F172A',
                        borderRadius: '8px',
                        color: '#FFF',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="requested" name="Requested" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="decided" name="Approved / Paid" fill="#15803D" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pending" name="Pending now" fill="#D97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Role Breakdown
            </h3>
            {roleBreakdown.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No participant wallets exist yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                      <th className="py-2 px-3">Role</th>
                      <th className="py-2 px-3 text-right">Wallets</th>
                      <th className="py-2 px-3 text-right">Available (ETB)</th>
                      <th className="py-2 px-3 text-right">Held (ETB)</th>
                      <th className="py-2 px-3 text-right">Total (ETB)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {roleBreakdown.map((row) => (
                      <tr key={row.role}>
                        <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                          {row.role}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{row.wallets}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                          {row.available.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-amber-700 dark:text-amber-400">
                          {row.held.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {row.total.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 1: 10 Visualizations (Recharts) */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {(analyticsLoading || analyticsError) && (
            <div
              className={`p-3 rounded-lg border text-xs font-semibold ${
                analyticsError
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
                  : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900'
              }`}
            >
              {analyticsError
                ? analyticsError
                : 'Loading live financial aggregates...'}
            </div>
          )}
          {/* Charts Row 1: Daily Trend & Weekly Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Daily financial transaction trend (Line) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    1. Daily Financial Transaction Trend
                  </h3>
                  <p className="text-xs text-slate-400">Daily gross settlement trajectory in ETB</p>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  Line Chart
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Volume']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line
                      type="monotone"
                      dataKey="volumeETB"
                      name="Volume (ETB)"
                      stroke="#15803D"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Weekly financial performance (Bar) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    2. Weekly Financial Performance
                  </h3>
                  <p className="text-xs text-slate-400">Deposits vs payouts vs escrow commitment</p>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                  Bar Chart
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyPerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Value']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="deposits" name="Deposits" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="payouts" name="Payouts" fill="#9333EA" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="escrowVolume" name="Escrow Locked" fill="#D97706" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Charts Row 2: Monthly Area & Regional Distribution Bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 3: Monthly financial performance (Area) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    3. Monthly Financial Performance
                  </h3>
                  <p className="text-xs text-slate-400">Gross volume vs net settlement progression</p>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                  Area Chart
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyPerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Amount']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Area
                      type="monotone"
                      dataKey="grossVolumeETB"
                      name="Gross Volume"
                      stroke="#0D9488"
                      fill="#0D9488"
                      fillOpacity={0.25}
                    />
                    <Area
                      type="monotone"
                      dataKey="netSettlementETB"
                      name="Net Settlement"
                      stroke="#15803D"
                      fill="#15803D"
                      fillOpacity={0.4}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 4: Regional transaction distribution (Bar) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    4. Regional Transaction Distribution
                  </h3>
                  <p className="text-xs text-slate-400">Total trade value per Ethiopian region</p>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  Bar Chart
                </span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regionalDistData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="region" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${val}M ETB`, 'Value']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Bar dataKey="volumeM" name="Value (Million ETB)" fill="#16A34A" radius={[4, 4, 0, 0]}>
                      {regionalDistData.map((_: any, index: number) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={['#15803D', '#2563EB', '#D97706', '#9333EA', '#0D9488', '#DC2626'][index % 6]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Charts Row 3: Wallet Donut, Deposit/Payout Stacked, Pending vs Verified */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart 5: Wallet balance distribution (Donut) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  5. Wallet Balance Distribution
                </h3>
                <p className="text-xs text-slate-400 mb-2">Available vs Held Escrow vs Disbursal</p>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={walletDistData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={3}
                      >
                        {walletDistData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Balance']}
                        contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-1 text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800">
                {walletDistData.map((w: any) => (
                  <div key={w.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: w.color }} />
                      <span className="text-slate-500 truncate">{w.name}</span>
                    </div>
                    <span className="font-mono font-bold">{w.value.toLocaleString()} ETB</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Chart 6: Deposit and payout comparison (Stacked Bar) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                6. Deposit vs Payout Comparison
              </h3>
              <p className="text-xs text-slate-400 mb-2">Inflow deposits stacked against outflows</p>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={depositPayoutComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${(Number(val || 0) / 1000000).toFixed(1)}M ETB`, 'Value']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="deposits" name="Inflow Deposits" stackId="a" fill="#15803D" />
                    <Bar dataKey="payouts" name="Outflow Payouts" stackId="a" fill="#DC2626" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 7: Pending vs verified payments (Donut) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  7. Pending vs Verified Payments
                </h3>
                <p className="text-xs text-slate-400 mb-2">Escrow clearance status ratio</p>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pendingVsVerifiedData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={3}
                      >
                        {pendingVsVerifiedData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Status']}
                        contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-1 text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800">
                {pendingVsVerifiedData.map((p: any) => (
                  <div key={p.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                      <span className="text-slate-500 truncate">{p.name}</span>
                    </div>
                    <span className="font-mono font-bold">{p.value.toLocaleString()} ETB</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Charts Row 4: Payment Method, Delivery Fee, Role Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart 8: Payment method distribution (Donut) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                8. Payment Method Distribution
              </h3>
              <p className="text-xs text-slate-400 mb-2">Verified funding volume by payment rail</p>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={paymentMethodData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={(entry: any) => `${((entry?.percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {paymentMethodData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Funding']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 9: Delivery fee financial summary (Bar) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                9. Delivery Fee Corridor Summary
              </h3>
              <p className="text-xs text-slate-400 mb-2">Average freight rate per corridor (ETB)</p>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deliveryFeeData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="corridor" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${Number(val || 0).toLocaleString()} ETB`, 'Avg Freight']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Bar dataKey="avgRate" name="Avg Rate (ETB)" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 10: Financial performance by user role (Bar) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                10. Performance by User Role
              </h3>
              <p className="text-xs text-slate-400 mb-2">Gross settlement & payouts claimed (M ETB)</p>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rolePerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                    <XAxis dataKey="role" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(val: any) => [`${(Number(val || 0) / 1000000).toFixed(1)}M ETB`, 'Volume']}
                      contentStyle={{ backgroundColor: '#0F172A', borderRadius: '8px', color: '#FFF' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="grossSettlement" name="Settlement" fill="#15803D" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="payoutsClaimed" name="Payouts" fill="#EA580C" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Deposit Verification (Approve / Flag / Reject) */}
      {activeTab === 'verification' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Multi-Rail Payment Deposit Verification Queue
              </h3>
              <p className="text-xs text-slate-400">
                Confirm inbound banking references, Chapa API receipts, and wire transfers
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowProcessedDeposits((value) => !value)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {showProcessedDeposits
                  ? 'Hide processed history'
                  : `Show processed (${wallet.deposits.length - pendingDepositCount})`}
              </button>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                {pendingDepositCount} Awaiting Verification
              </span>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">Deposit Ref</th>
                  <th className="py-3 px-3">Depositor / Entity</th>
                  <th className="py-3 px-2">Role</th>
                  <th className="py-3 px-3 text-right">Amount (ETB)</th>
                  <th className="py-3 px-2">Method</th>
                  <th className="py-3 px-3">Bank Channel</th>
                  <th className="py-3 px-2">Submitted</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-3 text-center">Verification Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleDeposits.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No deposits are awaiting verification.
                    </td>
                  </tr>
                )}
                {visibleDeposits.map((dep) => (
                  <tr key={dep.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {dep.reference}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {dep.userName}
                    </td>
                    <td className="py-3 px-2 capitalize text-slate-500">
                      {dep.userRole}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {dep.amountETB.toLocaleString()}
                    </td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {dep.method}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-500 text-[11px]">
                      {dep.bankAccount || 'Direct Rail'}
                    </td>
                    <td className="py-3 px-2 text-slate-400 font-mono text-[11px]">
                      {dep.timestamp}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                          dep.status === 'Approved'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            : dep.status === 'Flagged' || dep.status === 'Rejected'
                            ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {dep.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {dep.status === 'Pending' || dep.status === 'Flagged' ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            disabled={depositBusyId !== null}
                            onClick={() => void runDepositDecision('approve', dep)}
                            className="px-2.5 py-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded shadow-xs transition-colors"
                          >
                            {depositBusyId === dep.id ? 'Verifying…' : 'Verify & Credit'}
                          </button>
                          <button
                            type="button"
                            disabled={depositBusyId !== null}
                            onClick={() => {
                              setFlagModalDeposit(dep);
                              setFlagReason('');
                            }}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-bold rounded shadow-xs transition-colors"
                          >
                            Flag
                          </button>
                          <button
                            type="button"
                            disabled={depositBusyId !== null}
                            onClick={() => {
                              setRejectModalDeposit(dep);
                              setRejectReason('');
                            }}
                            className="px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">Processed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Payout Requests */}
      {activeTab === 'payouts' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Commercial Bank Disbursal & Payout Requests
              </h3>
              <p className="text-xs text-slate-400">
                Disburse verified wallet balances into commercial bank accounts (CBE, Awash, Dashen, Abyssinia)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowProcessedPayouts((value) => !value)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {showProcessedPayouts
                  ? 'Hide processed history'
                  : `Show processed (${wallet.payouts.length - pendingPayoutCount})`}
              </button>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                {pendingPayoutCount} Pending Payouts
              </span>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">Payout ID</th>
                  <th className="py-3 px-3">Beneficiary</th>
                  <th className="py-3 px-2">Role</th>
                  <th className="py-3 px-3 text-right">Amount (ETB)</th>
                  <th className="py-3 px-3">Target Bank</th>
                  <th className="py-3 px-3">Account Number</th>
                  <th className="py-3 px-2">Requested</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-3 text-center">Disbursement Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visiblePayouts.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No payouts are awaiting disbursement.
                    </td>
                  </tr>
                )}
                {visiblePayouts.map((pay) => (
                  <tr key={pay.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {pay.id}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {pay.accountHolderName}
                    </td>
                    <td className="py-3 px-2 capitalize text-slate-500">
                      {pay.role}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {pay.amountETB.toLocaleString()}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300 font-medium">
                      {pay.bankName}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-500">
                      {pay.accountNumber}
                    </td>
                    <td className="py-3 px-2 text-slate-400 font-mono text-[11px]">
                      {pay.requestedAt}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                          pay.status === 'approved'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            : pay.status === 'rejected'
                            ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {pay.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {pay.status === 'pending' ? (
                        <button
                          type="button"
                          disabled={payoutBusyId !== null}
                          onClick={() => void runPayoutApproval(pay)}
                          className="px-3 py-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded shadow-xs transition-colors"
                        >
                          {payoutBusyId === pay.id
                            ? 'Processing…'
                            : pay.payoutAccount
                            ? 'Approve & Send'
                            : 'Disburse Manually'}
                        </button>
                      ) : pay.status === 'rejected' ? (
                        <span className="text-red-600 font-semibold text-[11px] flex items-center justify-center gap-1">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Rejected</span>
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-semibold text-[11px] flex items-center justify-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Disbursed</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: Wallet Management & Escrow */}
      {activeTab === 'wallet_mgmt' && (
        <div className="space-y-6">
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Platform Escrow Vault State (Chapa Protected)
            </h3>
            <p className="text-xs text-slate-400">
              Strict separation between Available balances and In-Transit Held Escrow funds.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                <div className="text-xs text-slate-500">Total Participant Wallet Balance</div>
                <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                  {Number(
                    platformWallets.total_balance ?? availableBalance + heldBalance
                  ).toLocaleString()}{' '}
                  ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Sum of all farmer, wholesaler and retailer wallets
                </div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                <div className="text-xs text-emerald-800 dark:text-emerald-300 font-semibold">
                  Available for Trade
                </div>
                <div className="text-xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                  {Number(
                    platformWallets.available_balance ?? availableBalance
                  ).toLocaleString()}{' '}
                  ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Instant purchasing power</div>
              </div>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-amber-50/50 dark:bg-amber-950/20">
                <div className="text-xs text-amber-800 dark:text-amber-300 font-semibold">
                  Locked Escrow Vault
                </div>
                <div className="text-xl font-bold font-mono text-amber-700 dark:text-amber-400 mt-1">
                  {Number(platformWallets.held_balance ?? heldBalance).toLocaleString()} ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">Awaiting delivery sign-off</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-900 bg-purple-50/40 dark:bg-purple-950/20">
                <div className="text-xs text-purple-800 dark:text-purple-300 font-semibold">
                  Deposits Awaiting Verification
                </div>
                <div className="text-lg font-bold font-mono text-purple-700 dark:text-purple-400 mt-1">
                  {Number(
                    overviewActivity.funding?.pending_current?.amount || 0
                  ).toLocaleString()}{' '}
                  ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {Number(overviewActivity.funding?.pending_current?.count || 0)} requests
                </div>
              </div>
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20">
                <div className="text-xs text-blue-800 dark:text-blue-300 font-semibold">
                  Payouts Awaiting Disbursement
                </div>
                <div className="text-lg font-bold font-mono text-blue-700 dark:text-blue-400 mt-1">
                  {Number(
                    overviewActivity.payouts?.pending_current?.amount || 0
                  ).toLocaleString()}{' '}
                  ETB
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {Number(overviewActivity.payouts?.pending_current?.count || 0)} requests
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Wallet Position by Role
              </h3>
              <button
                type="button"
                onClick={() => setActiveTab('financial_overview')}
                className="text-[11px] font-semibold text-[#15803D] dark:text-emerald-400 underline"
              >
                Open Financial Overview
              </button>
            </div>
            {roleBreakdown.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No participant wallets have been created yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                      <th className="py-2 px-3">Role</th>
                      <th className="py-2 px-3 text-right">Wallets</th>
                      <th className="py-2 px-3 text-right">Available (ETB)</th>
                      <th className="py-2 px-3 text-right">Held (ETB)</th>
                      <th className="py-2 px-3 text-right">Total (ETB)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {roleBreakdown.map((row) => (
                      <tr key={row.role}>
                        <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                          {row.role}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{row.wallets}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-700 dark:text-emerald-400">
                          {row.available.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-amber-700 dark:text-amber-400">
                          {row.held.toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold">
                          {row.total.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              Revenue, expenses and profit are not shown because no commission or
              expense ledger exists yet.
            </p>
          </div>
        </div>
      )}

      {/* SUB-TAB 5: Delivery Fee Reviews */}
      {activeTab === 'delivery_fees' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Freight Logistics & Delivery Fee Reviews
              </h3>
              <p className="text-xs text-slate-400">
                Corridor freight agreements negotiated between Wholesalers and accredited Drivers
              </p>
            </div>
          </div>

          {deliveryLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading delivery-fee
              agreements…
            </div>
          ) : deliveryError ? (
            <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{deliveryError}</span>
              <button
                onClick={() => void loadDeliveryAgreements()}
                className="ml-auto underline font-semibold"
              >
                Retry
              </button>
            </div>
          ) : deliveryAgreements.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No driver delivery-fee agreements have been reported by the DriverApp yet.
            </p>
          ) : (
            <div className="space-y-3">
              {deliveryAgreements.map((agreement) => (
                <div
                  key={agreement.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm flex items-center gap-2">
                        <Truck className="w-4 h-4 text-emerald-600" />
                        <span>{agreement.order_reference}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800">
                          {agreement.review_status || 'pending'}
                        </span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-1">
                        {agreement.buyer_name} → {agreement.seller_name} · driver shipment{' '}
                        {agreement.driver_shipment_id} · proposal v
                        {agreement.driver_proposal_version}
                      </div>
                      {agreement.review?.rejection_reason && (
                        <div className="text-red-600 dark:text-red-400 mt-1">
                          Rejected: {agreement.review.rejection_reason}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold font-mono text-[#15803D] dark:text-emerald-400">
                        {Number(agreement.amount).toLocaleString()} {agreement.currency}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Buyer and driver accepted
                      </div>
                    </div>
                  </div>

                  {!agreement.review && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <button
                        disabled={reviewBusyId === agreement.id}
                        onClick={() => void reviewDeliveryFee(agreement, 'approved')}
                        className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white font-bold"
                      >
                        Approve fee
                      </button>
                      <button
                        disabled={reviewBusyId === agreement.id}
                        onClick={() => {
                          setRejectingAgreement(agreement);
                          setRejectionReason('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-bold"
                      >
                        Reject fee
                      </button>
                    </div>
                  )}

                  {rejectingAgreement?.id === agreement.id && (
                    <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <textarea
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        rows={2}
                        placeholder="Reason for rejecting this delivery fee"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                      <div className="flex gap-2">
                        <button
                          disabled={reviewBusyId === agreement.id}
                          onClick={() => {
                            if (!rejectionReason.trim()) {
                              setDeliveryError('A rejection reason is required.');
                              return;
                            }
                            void reviewDeliveryFee(agreement, 'rejected');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold disabled:opacity-60"
                        >
                          Confirm rejection
                        </button>
                        <button
                          onClick={() => setRejectingAgreement(null)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 6: Bank Accounts Review */}
      {activeTab === 'bank_accounts' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Registered Commercial Bank Accounts (National Clearance)
              </h3>
              <p className="text-xs text-slate-400">
                Bank accounts verified against National Identification & CBE Commercial Registrar.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadReviewAccounts()}
                disabled={accountsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${accountsLoading ? 'animate-spin' : ''}`} />
                <span>{accountsLoading ? 'Refreshing…' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          {/* Filter controls */}
          <div className="flex flex-wrap gap-2">
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void loadReviewAccounts()}
                placeholder="Search by name, email, or account holder..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
            <select
              value={accountStatus}
              onChange={(e) => setAccountStatus(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="">All Statuses</option>
              <option value="VERIFIED">Verified</option>
              <option value="REQUIRES_REVIEW">Requires Review</option>
              <option value="NOT_VERIFIED">Not Verified</option>
            </select>
            <button
              type="button"
              onClick={() => void loadReviewAccounts()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#15803D] hover:bg-[#166534] text-white"
            >
              Apply Filters
            </button>
          </div>

          {accountsError && (
            <div className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{accountsError}</span>
              <button
                type="button"
                onClick={() => void loadReviewAccounts()}
                className="ml-auto underline font-semibold"
              >
                Retry
              </button>
            </div>
          )}

          {accountsLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Loading bank accounts…
            </div>
          ) : reviewAccounts.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No bank accounts found matching the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                    <th className="py-3 px-3">Account Owner</th>
                    <th className="py-3 px-2">Role</th>
                    <th className="py-3 px-3">Bank</th>
                    <th className="py-3 px-3">Account Holder</th>
                    <th className="py-3 px-3">Account Number</th>
                    <th className="py-3 px-2">Status</th>
                    <th className="py-3 px-2">Primary</th>
                    <th className="py-3 px-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reviewAccounts.map((account) => (
                    <tr key={account.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {account.ownerName || 'Unknown'}
                      </td>
                      <td className="py-3 px-2 capitalize text-slate-500">
                        {account.ownerRole?.toLowerCase().replace('_', ' ') || 'Unknown'}
                      </td>
                      <td className="py-3 px-3">{account.bankName}</td>
                      <td className="py-3 px-3">{account.accountHolderName}</td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                        {account.maskedAccountNumber}
                      </td>
                      <td className="py-3 px-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                            account.status === 'VERIFIED'
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                              : account.status === 'REQUIRES_REVIEW'
                              ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {account.status?.replace('_', ' ').toLowerCase() || 'Unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        {account.isPrimary ? (
                          <span className="text-emerald-600 font-bold">✓</span>
                        ) : (
                          <span className="text-slate-400">–</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            disabled={accountBusyId !== null}
                            onClick={async () => {
                              setAccountBusyId(account.id);
                              try {
                                const response = await api.wallet.bankAccountFullDetails(account.id);
                                setAccountDetails(response?.data);
                                setNotification('Account details retrieved (audited).');
                              } catch (err) {
                                setNotification(
                                  formatApiError(err, 'Could not load full account details.')
                                );
                              } finally {
                                setAccountBusyId(null);
                              }
                            }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded shadow-xs transition-colors"
                          >
                            View
                          </button>
                          {account.status !== 'REQUIRES_REVIEW' && (
                            <button
                              type="button"
                              disabled={accountBusyId !== null}
                              onClick={async () => {
                                const reason = window.prompt(
                                  'Enter reason for requiring further review:'
                                );
                                if (!reason?.trim()) return;
                                setAccountBusyId(account.id);
                                try {
                                  await api.wallet.requireBankAccountReview(account.id, {
                                    notes: reason.trim(),
                                  });
                                  setNotification('Account flagged for further review.');
                                  await loadReviewAccounts();
                                } catch (err) {
                                  setNotification(
                                    formatApiError(err, 'Could not flag account for review.')
                                  );
                                } finally {
                                  setAccountBusyId(null);
                                }
                              }}
                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white font-bold rounded shadow-xs transition-colors"
                            >
                              Flag
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {accountDetails && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs">
              <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                    Full Account Details (Audited View)
                  </h3>
                  <button
                    type="button"
                    onClick={() => setAccountDetails(null)}
                    className="text-slate-500 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-slate-500">Owner</div>
                    <div className="font-semibold">{accountDetails.user_name || 'Unknown'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Role</div>
                    <div className="font-semibold capitalize">
                      {accountDetails.user_role?.toLowerCase().replace('_', ' ') || 'Unknown'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Bank</div>
                    <div className="font-semibold">{accountDetails.bank_name || 'Unknown'}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Account Holder</div>
                    <div className="font-semibold">{accountDetails.account_holder_name || ''}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-slate-500">Full Account Number (Decrypted)</div>
                    <div className="font-mono font-bold bg-slate-100 dark:bg-slate-800 p-2 rounded">
                      {accountDetails.account_number || 'REDACTED'}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      This view is logged in the audit trail.
                    </p>
                  </div>
                  <div>
                    <div className="text-slate-500">Status</div>
                    <div className="font-semibold">{accountDetails.status || ''}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Registered</div>
                    <div className="font-semibold">
                      {new Date(accountDetails.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 7: Append-Only Ledger */}
      {activeTab === 'ledger' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Immutable Financial Transaction Ledger
              </h3>
              <p className="text-xs text-slate-400">
                Cryptographically tracked transaction records with Chapa Tx reference hashes
              </p>
            </div>
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchLedger}
                onChange={(e) => setSearchLedger(e.target.value)}
                placeholder="Search tx reference, party..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-2">Type</th>
                  <th className="py-3 px-3 text-right">Amount (ETB)</th>
                  <th className="py-3 px-2 text-right">Fee (ETB)</th>
                  <th className="py-3 px-3">Counterparty</th>
                  <th className="py-3 px-2">Status</th>
                  <th className="py-3 px-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLedgerTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                      {tx.date}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {tx.reference}
                    </td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 capitalize text-[10px]">
                        {tx.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                      {tx.amountETB.toLocaleString()}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-slate-400">
                      {tx.feeETB}
                    </td>
                    <td className="py-3 px-3 text-slate-800 dark:text-slate-200 font-medium">
                      {tx.counterparty}
                    </td>
                    <td className="py-3 px-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 capitalize">
                        {tx.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-500 max-w-xs truncate">
                      {tx.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-500" />
              <span>Reject Deposit</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reference:{' '}
              <strong className="font-mono">{rejectModalDeposit.reference}</strong> (
              {rejectModalDeposit.amountETB.toLocaleString()} ETB by{' '}
              {rejectModalDeposit.userName})
            </p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="State the reason (e.g., bank reference not found, amount mismatch, duplicate request)..."
              rows={3}
              className="w-full text-xs p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-[11px] text-slate-400">
              A reason is required. Rejection never credits the wallet and the user is
              notified.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setRejectModalDeposit(null);
                  setRejectReason('');
                }}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || depositBusyId !== null}
                onClick={() => {
                  const target = rejectModalDeposit;
                  const reason = rejectReason.trim();
                  setRejectModalDeposit(null);
                  setRejectReason('');
                  void runDepositDecision('reject', target, reason);
                }}
                className="px-4 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg shadow-xs"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag Modal */}
      {flagModalDeposit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <span>Flag Deposit for Compliance Review</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Reference: <strong className="font-mono">{flagModalDeposit.reference}</strong> ({flagModalDeposit.amountETB.toLocaleString()} ETB by {flagModalDeposit.userName})
            </p>
            <textarea
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
              placeholder="State reason (e.g., Unmatched bank transaction ID, mismatched depositor name)..."
              rows={3}
              className="w-full text-xs p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFlagModalDeposit(null)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!flagReason.trim() || depositBusyId !== null}
                onClick={() => {
                  const target = flagModalDeposit;
                  const reason = flagReason.trim() || 'Unverified bank slip';
                  setFlagModalDeposit(null);
                  setFlagReason('');
                  void runDepositDecision('flag', target, reason);
                }}
                className="px-4 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg shadow-xs"
              >
                Confirm Flag
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
