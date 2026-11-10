import React, { useCallback, useEffect, useState } from 'react';
import { useApp, ReviewOutcome } from '../../context/AppContext';
import { mapBankAccount } from '../../services/adapters';
import { api, apiClient } from '../../services/apiClient';
import { DiscountManagementView } from './DiscountManagementView';
import { formatApiError } from '../../lib/apiErrors';
import { Pager, pageSlice } from '../common/Pager';
import { DepositRecord, PayoutRequest, TransactionRecord } from '../../types';
import { ConfirmDialog, ReasonDialog } from '../common/ConfirmDialog';
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

export type FinancialTab =
  | 'financial_overview'
  | 'statement'
  | 'financial_controls'
  | 'overview'
  | 'verification'
  | 'payouts'
  | 'wallet_mgmt'
  | 'delivery_fees'
  | 'bank_accounts'
  | 'ledger'
  | 'discounts'
  | 'payroll'
  | 'expenses'
  | 'staff_invoices';

/** Money renders a real amount, or an explicit "Not available" instead of 0. */
const Money: React.FC<{ value: string | null | undefined; currency?: string }> = ({
  value,
  currency = 'ETB',
}) => {
  if (value === null || value === undefined || value === '') {
    return (
      <span
        className="text-slate-400 dark:text-slate-500"
        title="No trustworthy source exists for this figure yet"
      >
        Not available
      </span>
    );
  }
  const numeric = Number(value);
  return (
    <span className="font-mono">
      {Number.isFinite(numeric)
        ? numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : value}{' '}
      {currency}
    </span>
  );
};

/** One institutional statement block: revenue, liability, expense or neutral. */
const StatementCard: React.FC<{
  title: string;
  subtitle?: string;
  tone?: 'revenue' | 'liability' | 'expense' | 'neutral';
  rows: Array<{ label: string; value: string | null; note?: string; strong?: boolean }>;
}> = ({ title, subtitle, tone = 'neutral', rows }) => {
  const accent =
    tone === 'revenue'
      ? 'border-l-emerald-500'
      : tone === 'liability'
        ? 'border-l-amber-500'
        : tone === 'expense'
          ? 'border-l-rose-500'
          : 'border-l-slate-400';
  return (
    <section
      className={`rounded-xl border border-slate-200 dark:border-slate-800 border-l-4 ${accent} bg-white dark:bg-slate-900 p-4`}
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
        {title}
      </h3>
      {subtitle && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
      )}
      <dl className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-xs text-slate-600 dark:text-slate-300">
              {row.label}
              {row.note && (
                <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                  {row.note}
                </span>
              )}
            </dt>
            <dd
              className={`text-sm text-right ${
                row.strong
                  ? 'font-bold text-slate-900 dark:text-slate-100'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              <Money value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

export const FinancialManagerDashboard: React.FC<{ initialTab?: FinancialTab }> = ({
  initialTab,
}) => {
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
    currentUser,
  } = useApp();

  // Active sub-tab
  const initialFinancialTab = typeof window !== 'undefined' && window.location.hash === '#financial-controls';
  const [activeTab, setActiveTab] = useState<FinancialTab>(
    initialTab ?? (initialFinancialTab ? 'financial_controls' : 'financial_overview'),
  );

  // A sidebar destination (e.g. /financial-manager/payroll) must open its own
  // tab instead of dropping the user back on the summary.
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // Filters
  const [timeRange, setTimeRange] = useState<string>('30d');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [selectedRegionFilter, setSelectedRegionFilter] = useState<string>('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<string>('all');
  const [selectedPaymentTypeFilter, setSelectedPaymentTypeFilter] = useState<string>('all');
  const [searchLedger, setSearchLedger] = useState<string>('');
  const [pnl, setPnl] = useState<any>(null);
  const [pnlError, setPnlError] = useState('');

  // Real financial analytics (server-side aggregates only)
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [financialConfigs, setFinancialConfigs] = useState<any[]>([]);
  const [financialLedger, setFinancialLedger] = useState<any[]>([]);
  const [financialControlsError, setFinancialControlsError] = useState('');
  const [showRuleBuilder, setShowRuleBuilder] = useState(false);
  const [ruleBuilderRules, setRuleBuilderRules] = useState<any[]>([
    { rule_id: 'rule-1', name: '', seller_role: '*', product_type: '*', calculation: 'percentage', rate: '0.02', fixed_fee: '0', unit_fee: '0', unit: 'quintal', min_commission: '', max_commission: '', priority: 0, enabled: true },
  ]);
  const [previewSaleValue, setPreviewSaleValue] = useState('300000');
  const [previewQuantity, setPreviewQuantity] = useState('100');
  const [rulesBuilderBusy, setRulesBuilderBusy] = useState(false);
  const [taxRuleDraft, setTaxRuleDraft] = useState({
    name: '', ratePercent: '', sellerRole: '*', productType: '*',
    source: '', sourceUrl: '', reason: '',
  });
  const [taxRuleBusy, setTaxRuleBusy] = useState(false);
  const [taxRuleError, setTaxRuleError] = useState('');

  const updateRuleBuilderRule = (index: number, patch: Record<string, unknown>) => {
    setRuleBuilderRules((rules) => rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRuleBuilderRule = () => {
    setRuleBuilderRules((rules) => [...rules, {
      rule_id: `rule-${rules.length + 1}`, name: '', seller_role: '*', product_type: '*',
      calculation: 'percentage', rate: '0.02', fixed_fee: '0', unit_fee: '0', unit: 'quintal',
      min_commission: '', max_commission: '', priority: 0, enabled: true,
    }]);
  };
  const removeRuleBuilderRule = (index: number) => {
    setRuleBuilderRules((rules) => rules.filter((_, i) => i !== index));
  };
  const saveCommissionVersion = async () => {
    if (rulesBuilderBusy) return;
    setRulesBuilderBusy(true);
    try {
      const latest = financialConfigs.filter((c: any) => c.kind === 'COMMISSION').reduce((v, c: any) => Math.max(v, c.version || 0), 0);
      const createRes = await apiClient.post('/payments/financial/configurations/', {
        kind: 'COMMISSION',
        name: `Marketplace commission v${latest + 1}`,
        version: latest + 1,
        rules: { rules: ruleBuilderRules },
        reason: 'Rule version updated from the Revenue & Financial Rules Center',
        effective_from: new Date().toISOString(),
      });
      const newId = createRes.data.id;
      await apiClient.post(`/payments/financial/configurations/${newId}/approve/`, {});
      setNotification?.('New commission rule version approved — new settlements use it immediately.');
      setShowRuleBuilder(false);
      {
        const res = await api.financialControls.configurations();
        setFinancialConfigs(Array.isArray(res.data) ? res.data : res.data?.results || []);
      }
    } catch (err: any) {
      setNotification?.(formatApiError(err, 'Could not save the commission rule version.'));
    } finally {
      setRulesBuilderBusy(false);
    }
  };
  const saveTaxRuleDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (taxRuleBusy) return;
    setTaxRuleError('');
    setTaxRuleBusy(true);
    try {
      const latest = financialConfigs
        .filter((config: any) => config.kind === 'TAX')
        .reduce((version, config: any) => Math.max(version, config.version || 0), 0);
      await api.financialControls.createConfiguration({
        kind: 'TAX',
        name: taxRuleDraft.name.trim(),
        version: latest + 1,
        rules: {
          rules: [{
            rule_id: `tax-rule-${latest + 1}`,
            name: taxRuleDraft.name.trim(),
            seller_role: taxRuleDraft.sellerRole,
            product_type: taxRuleDraft.productType,
            calculation: 'percentage',
            rate: String(Number(taxRuleDraft.ratePercent) / 100),
            enabled: true,
          }],
        },
        source: taxRuleDraft.source.trim(),
        source_url: taxRuleDraft.sourceUrl.trim(),
        reason: taxRuleDraft.reason.trim(),
        effective_from: new Date().toISOString(),
      });
      const refreshed = await api.financialControls.configurations();
      setFinancialConfigs(Array.isArray(refreshed.data) ? refreshed.data : refreshed.data?.results || []);
      setTaxRuleDraft({ name: '', ratePercent: '', sellerRole: '*', productType: '*', source: '', sourceUrl: '', reason: '' });
      setNotification?.('Tax rule draft created. A Super Admin must approve it before it can apply to future settlements.');
    } catch (error: any) {
      const message = formatApiError(error, 'Could not create the tax rule draft.');
      setTaxRuleError(message);
      setNotification?.(message);
    } finally {
      setTaxRuleBusy(false);
    }
  };
  const approveFinancialConfiguration = async (id: string) => {
    try {
      await api.financialControls.approveConfiguration(id);
      const refreshed = await api.financialControls.configurations();
      setFinancialConfigs(Array.isArray(refreshed.data) ? refreshed.data : refreshed.data?.results || []);
      setNotification?.('Financial rule approved. It applies only to eligible settlements from its approved effective time.');
    } catch (error: any) {
      setNotification?.(formatApiError(error, 'Could not approve this financial rule.'));
    }
  };
  const [financialControlsLoading, setFinancialControlsLoading] = useState(false);
  const [revenueSources, setRevenueSources] = useState<any[]>([]);
  const [revenueSourcesLoading, setRevenueSourcesLoading] = useState(false);
  const [revSourceBusy, setRevSourceBusy] = useState<string | null>(null);
  const [subPlans, setSubPlans] = useState<any[]>([]);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [newPlan, setNewPlan] = useState({ name: '', participant_role: 'WHOLESALER', price: '', duration_days: '30', benefits: '' });
  const [otherRev, setOtherRev] = useState({ category: 'INSPECTION_REVENUE', amount: '', notes: '' });
  const [otherRevNotice, setOtherRevNotice] = useState('');

  const loadRevenueCenter = useCallback(async () => {
    setRevenueSourcesLoading(true);
    try {
      const [srcRes, planRes] = await Promise.all([
        apiClient.get('/payments/financial/revenue-sources/'),
        apiClient.get('/payments/financial/subscription-plans/'),
      ]);
      setRevenueSources(srcRes.data.sources || []);
      setSubPlans(planRes.data || []);
    } catch {
      /* the rest of the tab still renders */
    } finally {
      setRevenueSourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'financial_controls') void loadRevenueCenter();
  }, [activeTab, loadRevenueCenter]);

  const updateRevenueSource = async (source: string, patch: Record<string, unknown>) => {
    setRevSourceBusy(source);
    try {
      const res = await apiClient.put(`/payments/financial/revenue-sources/${source}/`, patch);
      setRevenueSources((rows) => rows.map((r) => (r.source === source ? res.data : r)));
    } catch (err: any) {
      setNotification?.(formatApiError(err, 'Could not update the revenue source.'));
    } finally {
      setRevSourceBusy(null);
    }
  };

  const createSubscriptionPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevSourceBusy('plan');
    try {
      const res = await apiClient.post('/payments/financial/subscription-plans/', {
        ...newPlan,
        price: newPlan.price || '0',
        duration_days: Number(newPlan.duration_days) || 30,
      });
      setSubPlans((rows) => [...rows, res.data]);
      setNotification?.(`Subscription plan "${res.data.name}" created.`);
      setNewPlan({ name: '', participant_role: 'WHOLESALER', price: '', duration_days: '30', benefits: '' });
      setShowPlanForm(false);
    } catch (err: any) {
      setNotification?.(formatApiError(err, 'Could not create the plan.'));
    } finally {
      setRevSourceBusy(null);
    }
  };

  const deactivatePlan = async (pk: string) => {
    setRevSourceBusy(pk);
    try {
      await apiClient.post(`/payments/financial/subscription-plans/${pk}/deactivate/`);
      setSubPlans((rows) => rows.map((r) => (r.id === pk ? { ...r, active: false } : r)));
    } catch (err: any) {
      setNotification?.(formatApiError(err, 'Could not deactivate the plan.'));
    } finally {
      setRevSourceBusy(null);
    }
  };

  const recordOtherRevenue = async (e: React.FormEvent) => {
    e.preventDefault();
    setRevSourceBusy('other');
    try {
      const res = await apiClient.post('/payments/financial/other-revenue/', {
        category: otherRev.category,
        amount: otherRev.amount,
        notes: otherRev.notes,
      });
      setOtherRevNotice(`${otherRev.category.replace(/_/g, ' ').toLowerCase()} recorded — ${res.data.amount} ETB (ledger reference ${res.data.reference}).`);
      setOtherRev((prev) => ({ ...prev, amount: '', notes: '' }));
    } catch (err: any) {
      setOtherRevNotice(formatApiError(err, 'Could not record the revenue.'));
    } finally {
      setRevSourceBusy(null);
    }
  };
  const [financialReport, setFinancialReport] = useState<any>(null);
  const [financialReportError, setFinancialReportError] = useState('');
  const [financialReconciliation, setFinancialReconciliation] = useState<any>(null);
  const [financialRefunds, setFinancialRefunds] = useState<any[]>([]);
  const [payrollRecords, setPayrollRecords] = useState<any[]>([]);
  const [payrollSummary, setPayrollSummary] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [empRegion, setEmpRegion] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empSearch, setEmpSearch] = useState('');
  const [empPage, setEmpPage] = useState(1);
  const EMP_PAGE_SIZE = 8;
  const [invPage, setInvPage] = useState(1);
  const INV_PAGE_SIZE = 8;
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [attendanceFor, setAttendanceFor] = useState<null | { id: string; name: string }>(null);
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [attendanceMonth, setAttendanceMonth] = useState('');
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState('');
  const [payrollBusyId, setPayrollBusyId] = useState<string | null>(null);
  const [newPayroll, setNewPayroll] = useState({ employee: '', period_start: '', period_end: '', base_amount: '', allowances: '0', deductions: '0', tax_amount: '0', commission_amount: '0' });
  const [newPayrollError, setNewPayrollError] = useState('');
  const [showPayrollForm, setShowPayrollForm] = useState(false);

  // Consolidated statement (single source-backed summary of the platform books)
  const [statement, setStatement] = useState<any>(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementError, setStatementError] = useState('');

  // Operating expenses
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState('');
  const [expenseBusyId, setExpenseBusyId] = useState<string | null>(null);
  const [expenseStatusFilter, setExpenseStatusFilter] = useState('ALL');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [newExpense, setNewExpense] = useState({
    category: '',
    amount: '',
    description: '',
    incurred_on: '',
    department: '',
    receipt_reference: '',
  });
  const [newExpenseError, setNewExpenseError] = useState('');
  const [expenseRejectTarget, setExpenseRejectTarget] = useState<any | null>(null);

  // Maker-checker: only Super Admin may approve, reject or pay an expense.
  const isSuperAdmin = currentUser?.role === 'super_admin';

  const loadStatement = useCallback(async () => {
    setStatementLoading(true);
    try {
      const response = await api.financialControls.statement();
      setStatement(response.data);
      setStatementError('');
    } catch (error) {
      setStatement(null);
      setStatementError(formatApiError(error, 'The financial statement is unavailable.'));
    } finally {
      setStatementLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'statement') return;
    void loadStatement();
  }, [activeTab, loadStatement]);

  const loadExpenses = useCallback(async () => {
    setExpenseLoading(true);
    try {
      const response = await api.financialControls.expenses();
      const rows = Array.isArray(response.data) ? response.data : response.data?.expenses ?? [];
      setExpenses(rows);
      setExpenseError('');
    } catch (error) {
      setExpenses([]);
      setExpenseError(formatApiError(error, 'Operating expenses are unavailable.'));
    } finally {
      setExpenseLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'expenses') return;
    void loadExpenses();
  }, [activeTab, loadExpenses]);

  const submitExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setNewExpenseError('');
    try {
      await api.financialControls.createExpense({
        ...newExpense,
        department: newExpense.department || undefined,
        receipt_reference: newExpense.receipt_reference || undefined,
      });
      setShowExpenseForm(false);
      setNewExpense({
        category: '',
        amount: '',
        description: '',
        incurred_on: '',
        department: '',
        receipt_reference: '',
      });
      setNotification('Expense submitted. A Super Admin must approve it before payment.');
      await loadExpenses();
    } catch (error) {
      setNewExpenseError(formatApiError(error, 'The expense could not be submitted.'));
    }
  };

  const reviewExpense = async (id: string, action: 'approve' | 'reject', reason = '') => {
    setExpenseBusyId(id);
    setExpenseError('');
    try {
      await api.financialControls.reviewExpense(id, { action, reason });
      setNotification(action === 'approve' ? 'Expense approved.' : 'Expense rejected.');
      setExpenseRejectTarget(null);
      await loadExpenses();
      if (statement) void loadStatement();
    } catch (error) {
      setExpenseError(formatApiError(error, 'The expense review failed.'));
    } finally {
      setExpenseBusyId(null);
    }
  };

  useEffect(() => {
    api.financialControls.report(timeRange === 'custom' && customDateFrom && customDateTo
      ? { start: customDateFrom, end: customDateTo }
      : { period: timeRange === 'today' ? 'daily' : timeRange === '7d' ? 'weekly' : timeRange === 'month' ? 'monthly' : 'monthly' })
      .then((response) => { setFinancialReport(response.data); setFinancialReportError(''); })
      .catch((error) => { setFinancialReport(null); setFinancialReportError(formatApiError(error, 'Financial report is unavailable.')); });
  }, [timeRange, customDateFrom, customDateTo]);

  useEffect(() => {
    if (activeTab !== 'ledger') return;
    apiClient.get('/payments/financial/pnl/')
      .then((res: any) => { setPnl(res.data); setPnlError(''); })
      .catch(() => setPnlError('Profit and loss is not available right now.'));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'payroll' && activeTab !== 'staff_invoices') return;
    setInvPage(1);
    setPayrollLoading(true);
    setPayrollError('');
    Promise.all([
      apiClient.get('/payments/financial/payroll/'),
      apiClient.get('/payments/financial/payroll/summary/'),
      apiClient.get('/payments/financial/employees/'),
    ])
      .then(([records, summary, registry]) => {
        setPayrollRecords(Array.isArray(records.data) ? records.data : records.data?.results || []);
        setPayrollSummary(summary.data);
        setEmployees(Array.isArray(registry.data?.employees) ? registry.data.employees : []);
        setStaffList(Array.isArray(registry.data?.staff) ? registry.data.staff : []);
      })
      .catch((err) => setPayrollError(formatApiError(err, 'Payroll data is unavailable.')))
      .finally(() => setPayrollLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const loadAttendance = useCallback(async (userId: string, month?: string) => {
    try {
      const res = await apiClient.get(`/payments/financial/attendance/${userId}/`, { params: month ? { month } : {} });
      setAttendanceData(res.data);
    } catch {
      setAttendanceData(null);
    }
  }, []);

  const payrollAction = async (pk: string, action: string, extra: Record<string, unknown> = {}) => {
    setPayrollBusyId(pk);
    setPayrollError('');
    try {
      const res = await apiClient.post(`/payments/financial/payroll/${pk}/action/`, { action, ...extra });
      setPayrollRecords((rows) => rows.map((row) => (row.id === pk ? res.data : row)));
      setNotification?.(`Payroll ${action} completed.`);
      apiClient.get('/payments/financial/payroll/summary/').then((r: any) => setPayrollSummary(r.data)).catch(() => undefined);
    } catch (err: any) {
      setPayrollError(formatApiError(err, `Payroll ${action} failed.`));
    } finally {
      setPayrollBusyId(null);
    }
  };

  const submitNewPayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewPayrollError('');
    try {
      const res = await apiClient.post('/payments/financial/payroll/', {
        employee: newPayroll.employee,
        period_start: newPayroll.period_start,
        period_end: newPayroll.period_end,
        base_amount: newPayroll.base_amount,
        commission_amount: newPayroll.commission_amount || '0',
        allowances: newPayroll.allowances || '0',
        deductions: newPayroll.deductions || '0',
        tax_amount: newPayroll.tax_amount || '0',
      });
      setPayrollRecords((rows) => [res.data, ...rows]);
      setNewPayroll({ employee: '', period_start: '', period_end: '', base_amount: '', commission_amount: '0', allowances: '0', deductions: '0', tax_amount: '0' });
      setShowPayrollForm(false);
      setNotification?.('Payroll record prepared — submit it for approval.');
    } catch (err: any) {
      const data = err?.response?.data;
      setNewPayrollError(typeof data === 'string' ? data : formatApiError(err, 'Payroll record could not be created.'));
    }
  };

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
      ? Math.ceil((Date.now() - new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()) / 86400000)
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
  const [manualPayoutTarget, setManualPayoutTarget] = useState<PayoutRequest | null>(null);
  const [manualPayoutReference, setManualPayoutReference] = useState('');
  const [payrollRejectTarget, setPayrollRejectTarget] = useState<any | null>(null);
  const [payrollPayTarget, setPayrollPayTarget] = useState<any | null>(null);
  const [bankAccountReviewTarget, setBankAccountReviewTarget] = useState<any | null>(null);

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

  const runPayoutApproval = async (payout: PayoutRequest, reference = '') => {
    if (payoutBusyId) return;
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
      setManualPayoutTarget(null);
      setManualPayoutReference('');
    } finally {
      setPayoutBusyId(null);
    }
  };

  const flagBankAccountForReview = async (accountId: string, notes: string) => {
    setAccountBusyId(accountId);
    try {
      await api.wallet.requireBankAccountReview(accountId, { notes: notes.trim() });
      setNotification('Account flagged for further review.');
      setBankAccountReviewTarget(null);
      await loadReviewAccounts();
    } catch (err) {
      setAccountsError(formatApiError(err, 'Could not flag account for review.'));
    } finally {
      setAccountBusyId(null);
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
        <div role="button" tabIndex={0} aria-label="Total Escrow Volume — open Wallet Vault & Escrow" onClick={() => setActiveTab('wallet_mgmt')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('wallet_mgmt'); } }} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors">
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

        <div role="button" tabIndex={0} aria-label="Active Available Balances — open Wallet Vault & Escrow" onClick={() => setActiveTab('wallet_mgmt')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('wallet_mgmt'); } }} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors">
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

        <div role="button" tabIndex={0} aria-label="Held in Platform Escrow — open Wallet Vault & Escrow" onClick={() => setActiveTab('wallet_mgmt')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('wallet_mgmt'); } }} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs cursor-pointer hover:border-amber-300 dark:hover:border-amber-700 transition-colors">
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

        <div role="button" tabIndex={0} aria-label="Pending Verifications — open Deposit Verifications" onClick={() => setActiveTab('verification')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('verification'); } }} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs cursor-pointer hover:border-purple-300 dark:hover:border-purple-700 transition-colors">
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

      {/* Sub-Tabs Navigation — two tiers: group pills, then the active group's tabs */}
      {(() => {
        const NAV_GROUPS: Array<{ group: string; tabs: Array<{ id: string; label: string }> }> = [
          { group: 'Overview', tabs: [
            { id: 'statement', label: 'Financial Statement' },
            { id: 'financial_overview', label: 'Financial Summary' },
            { id: 'overview', label: 'Analytics & Trends' },
          ]},
          { group: 'Wallet Operations', tabs: [
            { id: 'verification', label: `Deposit Verifications (${pendingDepositCount})` },
            { id: 'payouts', label: `Payout Requests (${pendingPayoutCount})` },
            { id: 'wallet_mgmt', label: 'Wallet Vault & Escrow' },
            { id: 'bank_accounts', label: 'Bank Accounts Review' },
          ]},
          { group: 'Escrow, Delivery & Controls', tabs: [
            { id: 'delivery_fees', label: 'Delivery Fee Agreements' },
            { id: 'financial_controls', label: 'Financial Controls' },
            { id: 'discounts', label: 'Discounts & Promotions' },
          ]},
          { group: 'Income & Expenses', tabs: [
            { id: 'expenses', label: 'Operating Expenses' },
            { id: 'payroll', label: 'Payroll & Employees' },
          ]},
          { group: 'Staff Invoices', tabs: [
            { id: 'staff_invoices', label: `Salary Invoices (${payrollRecords.filter((r) => r.status !== 'PAID').length} open)` },
            { id: 'ledger', label: 'Append-Only Ledger & P&L' },
          ]},
        ];
        const activeGroup = NAV_GROUPS.find((g) => g.tabs.some((t) => t.id === activeTab)) ?? NAV_GROUPS[0];
        const groupTabs = activeGroup.tabs;
        return (
          <div className="space-y-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {/* Tier 1 — group pills */}
            <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 pb-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mr-1.5">Section</span>
              {NAV_GROUPS.map((g) => {
                const isActive = g.group === activeGroup.group;
                const groupBadge = g.tabs.reduce((n, t) => n + ((/\((\d+)\)/.exec(t.label)?.[1]) ? Number(/\((\d+)\)/.exec(t.label)![1]) : 0), 0);
                return (
                  <button
                    key={g.group}
                    onClick={() => { if (!isActive) setActiveTab(g.tabs[0].id as any); }}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      isActive
                        ? 'bg-[#15803D] text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-300'
                    }`}
                  >
                    {g.group}
                    {groupBadge > 0 && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${isActive ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                        {groupBadge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Tier 2 — tabs of the active group */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 overflow-x-auto text-xs font-semibold scrollbar-none px-2">
              {groupTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  aria-pressed={activeTab === tab.id}
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
          </div>
        );
      })()}


      {activeTab === 'statement' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Consolidated financial statement
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                Platform revenue, customer-held funds and participant liabilities are reported
                separately. Every figure is aggregated from POSTED ledger entries or a persisted
                operational table; a missing source reads “Not available”, never zero.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statement?.as_of && (
                <span className="text-[11px] text-slate-400">
                  As of {new Date(statement.as_of).toLocaleString()}
                </span>
              )}
              <button
                type="button"
                onClick={() => void loadStatement()}
                disabled={statementLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${statementLoading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {statementError && (
            <div role="alert" className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {statementError}
            </div>
          )}

          {!statement && statementLoading && (
            <p className="text-sm text-slate-500" role="status">Loading statement…</p>
          )}

          {statement && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <StatementCard
                  tone="revenue"
                  title="Platform revenue"
                  subtitle="Recognised revenue — excludes escrow and participant money"
                  rows={[
                    { label: 'Marketplace commission', value: statement.platform_revenue.marketplace_commission },
                    { label: 'Company delivery margin', value: statement.platform_revenue.delivery_service_fees },
                    { label: 'Total recognised revenue', value: statement.platform_revenue.total, strong: true },
                  ]}
                />
                <StatementCard
                  tone="liability"
                  title="Customer-held funds"
                  subtitle="Held for participants — a liability, never revenue"
                  rows={[
                    { label: 'Wallet available', value: statement.customer_funds.wallet_available, note: `${statement.customer_funds.wallet_accounts} wallet account(s)` },
                    { label: 'Wallet held', value: statement.customer_funds.wallet_held },
                    { label: 'Escrow held in orders', value: statement.customer_funds.escrow_held, note: `${statement.customer_funds.escrow_orders} order(s) awaiting settlement`, strong: true },
                    { label: 'Released order value', value: statement.customer_funds.released_order_value, note: `${statement.customer_funds.released_orders} settled order(s)` },
                  ]}
                />
                <StatementCard
                  tone="liability"
                  title="Seller & driver liabilities"
                  subtitle="Owed to sellers and drivers"
                  rows={[
                    { label: 'Seller proceeds settled', value: statement.seller_payables.settled_proceeds, note: `${statement.seller_payables.settled_orders} released order(s)` },
                    { label: 'Seller payable before release', value: statement.seller_payables.pending_release, note: 'Commission is only snapshotted at release' },
                    { label: 'Driver compensation payable', value: statement.driver_compensation.payable, note: `${statement.driver_compensation.payable_count} verified delivery payment(s)` },
                    { label: 'Driver compensation paid', value: statement.driver_compensation.paid, note: `${statement.driver_compensation.paid_count} paid` },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <StatementCard
                  tone="expense"
                  title="Operating expenses"
                  rows={[
                    { label: 'Pending approval', value: statement.operating_expenses.pending.amount, note: `${statement.operating_expenses.pending.count} expense(s)` },
                    { label: 'Approved, unpaid', value: statement.operating_expenses.approved_outstanding.amount, note: `${statement.operating_expenses.approved_outstanding.count} expense(s)`, strong: true },
                    { label: 'Paid', value: statement.operating_expenses.paid.amount, note: `${statement.operating_expenses.paid.count} expense(s)` },
                    { label: 'Rejected', value: statement.operating_expenses.rejected.amount, note: `${statement.operating_expenses.rejected.count} expense(s)` },
                  ]}
                />
                <StatementCard
                  tone="expense"
                  title="Payroll"
                  subtitle="Employee salaries, separate from driver compensation"
                  rows={[
                    { label: 'Draft', value: statement.payroll.draft.amount, note: `${statement.payroll.draft.count} record(s)` },
                    { label: 'Pending approval', value: statement.payroll.pending.amount, note: `${statement.payroll.pending.count} record(s)` },
                    { label: 'Approved, unpaid', value: statement.payroll.approved_outstanding.amount, note: `${statement.payroll.approved_outstanding.count} record(s)`, strong: true },
                    { label: 'Paid', value: statement.payroll.paid.amount, note: `${statement.payroll.paid.count} record(s)` },
                  ]}
                />
                <StatementCard
                  tone="neutral"
                  title="Delivery, tax & refunds"
                  rows={[
                    { label: 'Verified delivery collections', value: statement.delivery_collections.verified, note: `${statement.delivery_collections.verified_count} payment(s)` },
                    { label: 'Platform fee within collections', value: statement.delivery_collections.platform_fee },
                    { label: 'Outstanding delivery collections', value: statement.delivery_collections.outstanding },
                    { label: 'Tax collected on settlements', value: statement.tax.collected_on_settlements },
                    { label: 'Tax liability posted to ledger', value: statement.tax.posted_liability },
                    { label: 'Refunds pending', value: statement.refunds.pending.amount, note: `${statement.refunds.pending.count} request(s)` },
                    { label: 'Refunds paid', value: statement.refunds.paid.amount, note: `${statement.refunds.paid.count} request(s)` },
                  ]}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Ledger reconciliation
                  </h3>
                  {statement.reconciliation ? (
                    <div className="mt-2 text-xs space-y-1">
                      <p className={statement.reconciliation.complete ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-amber-700 dark:text-amber-400 font-semibold'}>
                        {statement.reconciliation.complete
                          ? 'All delivery and settlement sources reconcile to the ledger.'
                          : `${statement.reconciliation.issue_count} unresolved discrepancy(ies) require investigation.`}
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('ledger')}
                        className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 underline"
                      >
                        Open the append-only ledger
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Reconciliation is unavailable right now.</p>
                  )}
                </section>

                <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Not yet integrated
                  </h3>
                  <ul className="mt-2 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 list-disc pl-4">
                    {(statement.unavailable || []).map((row: any) => (
                      <li key={row.field}>
                        <span className="font-mono text-[10px] text-slate-400">{row.field}</span> — {row.reason}
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'expenses' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Operating expenses</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Submit and track operating costs. Approval, rejection and payment stay with Super Admin
                so the person preparing an expense can never approve it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void loadExpenses()}
                disabled={expenseLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${expenseLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowExpenseForm((open) => !open)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#15803D] text-white hover:bg-emerald-800"
              >
                {showExpenseForm ? 'Close form' : 'New expense'}
              </button>
            </div>
          </div>

          {expenseError && (
            <div role="alert" className="p-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              {expenseError}
            </div>
          )}

          {showExpenseForm && (
            <form onSubmit={submitExpense} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Category</span>
                <input required value={newExpense.category} onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })} placeholder="e.g. FUEL" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5" />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Amount (ETB)</span>
                <input required type="number" min="0.01" step="0.01" value={newExpense.amount} onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5 font-mono" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Description</span>
                <input required value={newExpense.description} onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5" />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Incurred on</span>
                <input required type="date" value={newExpense.incurred_on} onChange={(e) => setNewExpense({ ...newExpense, incurred_on: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5" />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-slate-600 dark:text-slate-300">Receipt reference</span>
                <input value={newExpense.receipt_reference} onChange={(e) => setNewExpense({ ...newExpense, receipt_reference: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent px-2.5 py-1.5" />
              </label>
              {newExpenseError && <p role="alert" className="sm:col-span-2 text-red-600">{newExpenseError}</p>}
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="submit" className="px-3 py-1.5 font-semibold rounded-lg bg-[#15803D] text-white hover:bg-emerald-800">Submit expense</button>
              </div>
            </form>
          )}

          <div className="flex flex-wrap gap-1.5">
            {['ALL', 'PENDING', 'APPROVED', 'PAID', 'REJECTED'].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setExpenseStatusFilter(status)}
                aria-pressed={expenseStatusFilter === status}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${expenseStatusFilter === status ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="p-2.5">Category</th>
                  <th className="p-2.5">Description</th>
                  <th className="p-2.5">Incurred</th>
                  <th className="p-2.5 text-right">Amount</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Review</th>
                  {isSuperAdmin && <th className="p-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {expenses
                  .filter((row) => expenseStatusFilter === 'ALL' || row.status === expenseStatusFilter)
                  .map((row) => (
                    <tr key={row.id}>
                      <td className="p-2.5 font-semibold">{row.category}</td>
                      <td className="p-2.5 text-slate-600 dark:text-slate-300 max-w-[320px] truncate" title={row.description}>{row.description}</td>
                      <td className="p-2.5 font-mono text-[11px]">{row.incurred_on}</td>
                      <td className="p-2.5 text-right"><Money value={row.amount} currency={row.currency || 'ETB'} /></td>
                      <td className="p-2.5"><span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-semibold">{row.status}</span></td>
                      <td className="p-2.5 text-[11px] text-slate-500">{row.review_reason || '—'}</td>
                      {isSuperAdmin && (
                        <td className="p-2.5 text-right whitespace-nowrap">
                          {row.status === 'PENDING' ? (
                            <div className="flex justify-end gap-1.5">
                              <button type="button" disabled={expenseBusyId === row.id} onClick={() => void reviewExpense(row.id, 'approve')} className="px-2 py-1 rounded border border-emerald-300 text-emerald-700 font-semibold disabled:opacity-50">Approve</button>
                              <button type="button" disabled={expenseBusyId === row.id} onClick={() => setExpenseRejectTarget(row)} className="px-2 py-1 rounded border border-red-300 text-red-700 font-semibold disabled:opacity-50">Reject</button>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                {!expenseLoading &&
                  expenses.filter((row) => expenseStatusFilter === 'ALL' || row.status === expenseStatusFilter).length === 0 && (
                    <tr>
                      <td colSpan={isSuperAdmin ? 7 : 6} className="p-4 text-center text-slate-500">
                        No expenses match this filter.
                      </td>
                    </tr>
                  )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'discounts' && (
        <DiscountManagementView />
      )}

      {activeTab === 'financial_controls' && (
        <div className="space-y-5">
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-bold text-sm mb-2">Financial Rule Versions</h3>
            <p className="text-xs text-slate-500 mb-3">Rules are versioned. Tax proposals require an authoritative source; only Super Admin can approve them.</p>
            {financialControlsLoading ? <p>Loading…</p> : financialControlsError ? <p role="alert" className="text-sm text-red-600">{financialControlsError}</p> : financialConfigs.length === 0 ? <p className="text-sm text-slate-500">No financial configuration records.</p> : <div className="space-y-2">{financialConfigs.map((rule) => <div key={rule.id} className="flex flex-wrap items-start justify-between gap-3 p-3 border rounded-lg dark:border-slate-700"><div className="min-w-0"><p className="font-semibold text-sm">{rule.name} · {rule.kind} v{rule.version} · {rule.status}</p><p className="text-xs text-slate-500">{rule.reason}</p>{rule.kind === 'TAX' && <p className="mt-1 text-xs text-slate-500">Source: {rule.source || 'Not provided'} {rule.source_url}</p>}</div>{isSuperAdmin && rule.status === 'DRAFT' && <button type="button" onClick={() => void approveFinancialConfiguration(rule.id)} className="shrink-0 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800">Approve rule</button>}</div>)}</div>}
          </section>
          {/* Revenue Sources — central control (Super Admin) */}
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div>
              <h3 className="font-bold text-sm">Revenue Sources — central control</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Enable or disable each platform revenue source and set its default rate.
                Disabled sources never post revenue; commission rules are scoped further
                in the rule builder below.
              </p>
            </div>
            {revenueSourcesLoading ? (
              <p className="text-xs text-slate-500">Loading revenue sources…</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {revenueSources.map((s) => (
                  <div key={s.source} className={`p-3 rounded-xl border ${s.enabled ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {String(s.source).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (ch: string) => ch.toUpperCase())}
                      </span>
                      <label className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          disabled={revSourceBusy === s.source}
                          onChange={(e) => void updateRevenueSource(s.source, { enabled: e.target.checked })}
                          className="mr-1"
                        />
                        <span className="text-[10px] font-bold text-slate-500">{s.enabled ? 'ON' : 'OFF'}</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <input
                        type="number" min="0" max="100" step="0.01"
                        value={Number(s.default_percentage_rate) * 100}
                        onChange={(e) => void updateRevenueSource(s.source, { default_percentage_rate: Number(e.target.value) / 100 })}
                        aria-label={`${s.source} percentage rate`}
                        className="px-2 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        placeholder="%"
                      />
                      <input
                        type="number" min="0" step="0.01"
                        value={Number(s.default_fixed_fee)}
                        onChange={(e) => void updateRevenueSource(s.source, { default_fixed_fee: e.target.value })}
                        aria-label={`${s.source} fixed fee`}
                        className="px-2 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                        placeholder="Fixed ETB"
                      />
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">Default % rate and fixed fee (ETB)</div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">Subscription plans</h4>
                <button onClick={() => setShowPlanForm((v) => !v)} className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline">
                  {showPlanForm ? 'Hide form' : 'New plan'}
                </button>
              </div>
              {showPlanForm && (
                <form onSubmit={createSubscriptionPlan} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  <input required value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} placeholder="Plan name" aria-label="Plan name"
                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                  <select value={newPlan.participant_role} onChange={(e) => setNewPlan({ ...newPlan, participant_role: e.target.value })} aria-label="Participant role"
                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    {['FARMER', 'WHOLESALER', 'RETAILER', 'DRIVER'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input required type="number" min="0" step="0.01" value={newPlan.price} onChange={(e) => setNewPlan({ ...newPlan, price: e.target.value })} placeholder="Price ETB" aria-label="Plan price"
                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                  <input required type="number" min="1" value={newPlan.duration_days} onChange={(e) => setNewPlan({ ...newPlan, duration_days: e.target.value })} placeholder="Days" aria-label="Duration days"
                    className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                  <button type="submit" disabled={revSourceBusy === 'plan'} className="px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-bold disabled:opacity-60">
                    Create plan
                  </button>
                </form>
              )}
              <div className="flex flex-wrap gap-2">
                {subPlans.filter((p) => p.active).map((p) => (
                  <div key={p.id} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px]">
                    <span className="font-bold text-slate-800 dark:text-slate-100">{p.name}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {p.participant_role} · {Number(p.price).toLocaleString()} ETB / {p.duration_days}d · {p.subscriber_count} active</span>
                    <button onClick={() => void deactivatePlan(p.id)} className="ml-2 text-rose-600 hover:underline font-semibold">Deactivate</button>
                  </div>
                ))}
                {subPlans.length === 0 && <p className="text-xs text-slate-400">No subscription plans yet.</p>}
              </div>
            </div>

            <form onSubmit={recordOtherRevenue} className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">Record revenue (inspection · advertising · other)</div>
              <div className="flex flex-wrap items-center gap-2">
                <select value={otherRev.category} onChange={(e) => setOtherRev({ ...otherRev, category: e.target.value })} aria-label="Revenue category"
                  className="text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5">
                  <option value="INSPECTION_REVENUE">Inspection &amp; verification</option>
                  <option value="ADVERTISING_REVENUE">Advertising / promotion</option>
                  <option value="OTHER_REVENUE">Other approved revenue</option>
                </select>
                <input required type="number" min="0.01" step="0.01" value={otherRev.amount} onChange={(e) => setOtherRev({ ...otherRev, amount: e.target.value })} placeholder="Amount ETB" aria-label="Revenue amount"
                  className="w-32 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                <input value={otherRev.notes} onChange={(e) => setOtherRev({ ...otherRev, notes: e.target.value })} placeholder="Reference / notes (optional)" aria-label="Revenue notes"
                  className="flex-1 min-w-48 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                <button type="submit" disabled={revSourceBusy === 'other' || !otherRev.amount} className="px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-bold disabled:opacity-60">
                  Record
                </button>
              </div>
              {otherRevNotice && <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">{otherRevNotice}</div>}
            </form>
          </section>
          <section id="financial-tax-rule-proposal" className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Propose a tax rule</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Enter the rate and authoritative source for tax on platform commission. This creates a draft for Super Admin review; it does not change past settlements.
              </p>
            </div>
            <form onSubmit={(event) => void saveTaxRuleDraft(event)} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Rule name
                <input required maxLength={120} value={taxRuleDraft.name} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Name from the applicable tax policy" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Tax rate on commission (%)
                <input required type="number" min="0" max="100" step="0.01" value={taxRuleDraft.ratePercent} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, ratePercent: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Enter the sourced rate" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Seller role
                <select value={taxRuleDraft.sellerRole} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, sellerRole: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
                  <option value="*">All seller roles</option>
                  <option value="FARMER">Farmer</option>
                  <option value="WHOLESALER">Wholesaler</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Product type
                <select value={taxRuleDraft.productType} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, productType: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
                  <option value="*">All product types</option>
                  <option value="FARMER_LISTING">Farmer listing</option>
                  <option value="WHOLESALER_LISTING">Wholesaler listing</option>
                </select>
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Authoritative source
                <input required maxLength={255} value={taxRuleDraft.source} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, source: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Issuing authority and document" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Source URL
                <input required type="url" maxLength={500} value={taxRuleDraft.sourceUrl} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, sourceUrl: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="https://…" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 sm:col-span-2 lg:col-span-3">
                Applicability and rationale
                <textarea required rows={2} value={taxRuleDraft.reason} onChange={(event) => setTaxRuleDraft((draft) => ({ ...draft, reason: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800" placeholder="Describe which transactions this source covers and why this rate applies." />
              </label>
              {taxRuleError && <p role="alert" className="text-xs text-rose-600 sm:col-span-2 lg:col-span-3">{taxRuleError}</p>}
              <div className="sm:col-span-2 lg:col-span-3">
                <button type="submit" disabled={taxRuleBusy} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
                  {taxRuleBusy ? 'Creating draft…' : 'Create tax rule draft'}
                </button>
              </div>
            </form>
          </section>
          {/* Revenue & Financial Rules Center — commission rule builder (SA) */}
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Revenue &amp; Financial Rules Center — Marketplace Commission</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Dynamic, versioned commission rules. One rule wins per transaction
                  (explicit priority, then specificity). Saving creates a new version —
                  previous transactions keep their original calculation.
                </p>
              </div>
              {isSuperAdmin && (
                <button onClick={() => setShowRuleBuilder((v) => !v)}
                  className="px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-bold">
                  {showRuleBuilder ? 'Close builder' : 'New rule version'}
                </button>
              )}
            </div>

            {/* Existing configs with parsed rules */}
            {financialConfigs
              .filter((c: any) => c.kind === 'COMMISSION')
              .map((c: any) => (
                <div key={c.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="font-semibold text-xs">{c.name} · v{c.version}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${c.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>{c.status}</span>
                  </div>
                  {(() => {
                    const rules = c.rules?.rules || [];
                    if (!rules.length) return <p className="text-xs text-slate-400">No rules defined.</p>;
                    return (
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="text-left text-slate-400 uppercase tracking-wider">
                            <th className="py-1 pr-3 font-bold">Rule</th>
                            <th className="py-1 pr-3 font-bold">Scope</th>
                            <th className="py-1 pr-3 font-bold">Calculation</th>
                            <th className="py-1 pr-3 text-center font-bold">Priority</th>
                            <th className="py-1 font-bold text-center">Enabled</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {rules.map((r: any, i: number) => (
                            <tr key={r.rule_id || i}>
                              <td className="py-1 pr-3 font-semibold text-slate-700 dark:text-slate-200">{r.name || r.rule_id}</td>
                              <td className="py-1 pr-3 text-slate-500 dark:text-slate-400">
                                {[r.seller_role !== '*' ? String(r.seller_role).replace(/_/g, ' ') : null,
                                  r.product_type !== '*' ? String(r.product_type).replace(/_/g, ' ') : null,
                                  r.region_id ? 'region' : null,
                                  r.min_quantity ? `qty ≥ ${r.min_quantity}` : null].filter(Boolean).join(' · ') || 'All transactions'}
                              </td>
                              <td className="py-1 pr-3 font-mono text-slate-700 dark:text-slate-200">
                                {r.calculation === 'percentage' ? `${(Number(r.rate) * 100).toFixed(2)}%`
                                  : r.calculation === 'per_unit' ? `${r.unit_fee}/${r.unit || 'unit'}`
                                  : `${r.fixed_fee} fixed`}
                                {r.min_commission ? ` · min ${r.min_commission}` : ''}
                                {r.max_commission ? ` · max ${r.max_commission}` : ''}
                              </td>
                              <td className="py-1 pr-3 text-center font-mono">{r.priority || 0}</td>
                              <td className="py-1 text-center">{r.enabled === false ? '—' : '✓'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              ))}

            {/* Rule builder with live preview (Super Admin only) */}
            {isSuperAdmin && showRuleBuilder && (
              <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
                <div className="text-xs font-bold text-emerald-800 dark:text-emerald-300">New commission rule (creates the next approved version)</div>
                {ruleBuilderRules.map((r, i) => (
                  <div key={i} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <input value={r.name} onChange={(e) => updateRuleBuilderRule(i, { name: e.target.value })} placeholder="Rule name (e.g. Tomato Sales Commission)"
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 sm:col-span-2" />
                      <select value={r.seller_role} onChange={(e) => updateRuleBuilderRule(i, { seller_role: e.target.value })} aria-label="Seller role"
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                        <option value="*">All seller roles</option>
                        {['FARMER', 'WHOLESALER', 'RETAILER'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                      </select>
                      <select value={r.calculation} onChange={(e) => updateRuleBuilderRule(i, { calculation: e.target.value })} aria-label="Calculation method"
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                        <option value="percentage">Percentage of sale</option>
                        <option value="fixed">Fixed fee per order</option>
                        <option value="per_unit">Per unit (kg / quintal…)</option>
                      </select>
                      {r.calculation === 'percentage' && (
                        <input type="number" min="0" max="100" step="0.01" value={Number(r.rate) * 100} onChange={(e) => updateRuleBuilderRule(i, { rate: String(Number(e.target.value) / 100) })}
                          placeholder="Rate %" aria-label="Rate percentage"
                          className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                      )}
                      {r.calculation === 'per_unit' && (
                        <>
                          <input type="number" min="0" step="0.01" value={r.unit_fee} onChange={(e) => updateRuleBuilderRule(i, { unit_fee: e.target.value })}
                            placeholder="Fee per unit" aria-label="Fee per unit"
                            className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                          <select value={r.unit} onChange={(e) => updateRuleBuilderRule(i, { unit: e.target.value })} aria-label="Unit"
                            className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                            {['quintal', 'kg', 'tonne', 'crate', 'sack'].map((u) => <option key={u} value={u}>per {u}</option>)}
                          </select>
                        </>
                      )}
                      {r.calculation === 'fixed' && (
                        <input type="number" min="0" step="0.01" value={r.fixed_fee} onChange={(e) => updateRuleBuilderRule(i, { fixed_fee: e.target.value })}
                          placeholder="Fixed fee" aria-label="Fixed fee"
                          className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                      )}
                      <input type="number" min="0" step="0.01" value={r.min_commission} onChange={(e) => updateRuleBuilderRule(i, { min_commission: e.target.value })}
                        placeholder="Min commission (optional)" aria-label="Minimum commission"
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                      <input type="number" min="0" step="0.01" value={r.max_commission} onChange={(e) => updateRuleBuilderRule(i, { max_commission: e.target.value })}
                        placeholder="Max commission (optional)" aria-label="Maximum commission"
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                      <input type="number" min="0" value={r.priority} onChange={(e) => updateRuleBuilderRule(i, { priority: Number(e.target.value) })}
                        placeholder="Priority" aria-label="Rule priority"
                        className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                    </div>
                    {ruleBuilderRules.length > 1 && (
                      <button onClick={() => removeRuleBuilderRule(i)} className="text-[11px] text-rose-600 hover:underline font-semibold">Remove rule</button>
                    )}
                  </div>
                ))}
                <button onClick={addRuleBuilderRule} className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline">+ Add another rule</button>

                {/* Live preview */}
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Live preview</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Sale value (ETB)</span>
                    <input type="number" min="0" value={previewSaleValue} onChange={(e) => setPreviewSaleValue(e.target.value)}
                      aria-label="Preview sale value"
                      className="w-40 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                    <input type="number" min="0" value={previewQuantity} onChange={(e) => setPreviewQuantity(e.target.value)}
                      aria-label="Preview quantity"
                      className="w-28 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                    <span className="text-xs text-slate-500 dark:text-slate-400">units</span>
                  </div>
                  {(() => {
                    const gross = Number(previewSaleValue || 0);
                    const qty = Number(previewQuantity || 0);
                    const pick = (rule: any) => {
                      const calc = (rule.calculation || 'percentage').toLowerCase();
                      if (calc === 'percentage') return gross * Number(rule.rate || 0) + Number(rule.fixed_fee || 0);
                      if (calc === 'per_unit') return qty * Number(rule.unit_fee || 0) + Number(rule.fixed_fee || 0);
                      return Number(rule.fixed_fee || 0);
                    };
                    const rows = ruleBuilderRules.map((r) => {
                      let amount = pick(r);
                      if (r.min_commission && amount < Number(r.min_commission)) amount = Number(r.min_commission);
                      if (r.max_commission && amount > Number(r.max_commission)) amount = Number(r.max_commission);
                      return { name: r.name || r.rule_id || `Rule`, amount };
                    });
                    const winner = rows.reduce((best, r) => (r.amount > (best?.amount ?? -1) ? r : best), rows[0]);
                    return (
                      <table className="w-full text-[11px]">
                        <thead><tr className="text-left text-slate-400 uppercase"><th className="py-1 font-bold">Rule</th><th className="py-1 text-right font-bold">Commission on preview</th></tr></thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.name} className={winner && r.name === winner.name ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}>
                              <td className="py-1">{r.name}{winner && r.name === winner.name ? ' (applies)' : ''}</td>
                              <td className="py-1 text-right font-mono">{r.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB</td>
                            </tr>
                          ))}
                          {winner && (
                            <tr className="font-bold text-slate-900 dark:text-slate-100">
                              <td className="py-1">Seller proceeds (winner rule)</td>
                              <td className="py-1 text-right font-mono">{(gross - winner.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>

                {financialControlsError && <p role="alert" className="text-xs text-rose-600">{financialControlsError}</p>}
                <button onClick={() => void saveCommissionVersion()} disabled={rulesBuilderBusy}
                  className="px-4 py-2 rounded-lg bg-[#15803D] text-white text-xs font-bold disabled:opacity-60">
                  {rulesBuilderBusy ? 'Saving…' : 'Save as new approved version'}
                </button>
              </div>
            )}
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
              <p className="text-xs text-slate-500 mt-1">{financialReport.unresolved_completed_orders > 0 ? `${financialReport.unresolved_completed_orders} completed order(s) with a positive commission are excluded until approved commission and tax treatment is available. Posted revenue below remains recognized.` : 'Completed orders are accounted for; orders with no approved commission have zero commission and no commission tax base.'}</p>
              {financialReport.tax_status_message && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{financialReport.tax_status_message}</p>}
              {(() => {
                const fmtVal = (v: any) => v == null ? null : `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
                const unavailableLabel = (label: string) => {
                  const key = label.toLowerCase();
                  if (key.includes('profit')) return 'Incomplete';
                  if (key.includes('cogs') || key.includes('acquisition cost')) return 'Not recorded';
                  if (key.includes('tax')) return 'Needs approved tax treatment';
                  return 'Not tracked yet';
                };
                const unavailableReason = (label: string) => {
                  const key = label.toLowerCase();
                  if (key.includes('profit') || key.includes('cogs') || key.includes('acquisition cost')) return 'Gross and net profit need product acquisition cost / COGS records.';
                  if (key.includes('tax')) return financialReport.tax_status_message || 'A verified transaction is missing an approved, effective tax treatment.';
                  return 'No eligible accounting data exists for this figure yet.';
                };
                const Metric = ({ label, value }: { label: string; value: any }) => (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3" title={value == null ? unavailableReason(label) : undefined}>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                    {value == null ? (
                      <p className="font-mono text-sm mt-1 text-slate-400 dark:text-slate-500 italic">{unavailableLabel(label)}</p>
                    ) : (
                      <p className="font-mono font-semibold text-sm mt-1 text-slate-900 dark:text-slate-100">{fmtVal(value)}</p>
                    )}
                  </div>
                );
                const groups: Array<{ title: string; rows: Array<[string, any]> }> = [
                  { title: 'Marketplace & Commission', rows: [
                    ['Marketplace GMV', financialReport.gmv],
                    ['Total recognized platform revenue', financialReport.platform_revenue],
                    ['Platform commission', financialReport.commission_revenue],
                    ['Other platform revenue', financialReport.other_platform_revenue],
                  ]},
                  { title: 'Service Fee Revenue', rows: [
                    ['Farmer marketplace commissions', financialReport.farmer_service_fee_revenue],
                    ['Wholesaler marketplace commissions', financialReport.wholesaler_service_fee_revenue],
                    ['Retailer marketplace commissions', financialReport.retailer_service_fee_revenue],
                    ['Company delivery margin', financialReport.delivery_service_revenue],
                  ]},
                  { title: 'Delivery Economics', rows: [
                    ['Delivery payments collected', financialReport.delivery_collections_collected],
                    ['Outstanding delivery collections', financialReport.delivery_collections_outstanding],
                    ['Failed delivery collections', financialReport.delivery_collections_failed],
                    ['Driver delivery fee expense', financialReport.driver_compensation],
                    ['Driver compensation paid', financialReport.delivery_driver_paid],
                    ['Driver compensation payable', financialReport.delivery_driver_payable],
                    ['Delivery tax collected', financialReport.delivery_tax_collected],
                    ['Refunds and reversals', financialReport.delivery_refunds],
                  ]},
                  { title: 'Taxes', rows: [
                    ['Tax collected', financialReport.tax_collected],
                    ['Tax payable', financialReport.tax_payable],
                  ]},
                  { title: 'Costs & Profit', rows: [
                    ['Product acquisition cost / COGS', financialReport.cost_of_goods_sold],
                    ['Operating expenses', financialReport.operating_expenses],
                    ['Payroll expenses', financialReport.payroll_expenses],
                  ]},
                ];
                const profitTone = (v: any) => Number(v) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400';
                const hero = (label: string, v: any, sub: string) => (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                    <p className={`text-xl font-bold font-mono mt-1.5 ${v == null ? 'text-slate-400 dark:text-slate-500 italic text-base' : Number(v) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>{v == null ? (label.toLowerCase().includes('profit') ? 'Incomplete' : 'Not available') : `${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{sub}</p>
                  </div>
                );
                return (
                  <div className="space-y-5 mt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {hero('Marketplace GMV', financialReport.gmv, 'Completed-order transaction value')}
                      {hero('Gross profit', financialReport.gross_profit, 'Unavailable until product acquisition cost / COGS is recorded')}
                      {hero('Net profit', financialReport.net_profit, 'Unavailable until COGS and all operating costs are complete')}
                    </div>
                    {groups.map((g) => (
                      <div key={g.title}>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">{g.title}</div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          {g.rows.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
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

          <section
            aria-labelledby="recognized-revenue-heading"
            className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm dark:border-emerald-900/70 dark:bg-slate-900"
          >
            <div className="border-b border-emerald-100 bg-emerald-50/70 px-5 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/25">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                    <DollarSign className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="recognized-revenue-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {revenueState.available ? 'Recognized Platform Revenue' : 'No Platform Revenue Posted'}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Revenue recognized from posted ledger entries
                    </p>
                  </div>
                </div>
                {revenueState.available && (
                  <div className="text-right">
                    <p className="font-mono text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
                      {Number(revenueState.recognized_revenue ?? revenueState.revenue ?? 0).toLocaleString()} ETB
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Recognized revenue</p>
                  </div>
                )}
              </div>
              {!revenueState.available && (
                <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">
                  {revenueState.reason || 'No recognized revenue postings were recorded in this period.'}
                </p>
              )}
            </div>

            {revenueState.available && (
              <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-slate-800">
                {[
                  ['Marketplace commission', revenueState.commission_revenue],
                  ['Delivery service', revenueState.delivery_service_revenue],
                  ['Other platform revenue', revenueState.other_platform_revenue],
                ].map(([label, amount]) => (
                  <div key={String(label)} className="px-5 py-3.5">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="mt-1 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {Number(amount || 0).toLocaleString()} ETB
                    </p>
                  </div>
                ))}
              </div>
            )}

            {Number(revenueState.unresolved_order_count || 0) > 0 && (
              <div className="mx-5 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/25">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-relaxed text-amber-950 dark:text-amber-200">
                      {Number(revenueState.unresolved_order_count)} completed order(s) · {Number(revenueState.unresolved_order_gross || 0).toLocaleString()} ETB gross excluded
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-900 dark:text-amber-300">
                      These orders settled without a complete approved commission and tax treatment attached. Their settlement records are preserved; approving a rule now will not change these past transactions or deduct fees from participants.
                    </p>
                    {Array.isArray(revenueState.unresolved_orders) && revenueState.unresolved_orders.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {revenueState.unresolved_orders.map((order: any) => (
                          <li key={order.order_reference} className="rounded-lg border border-amber-200/80 bg-white/70 px-3 py-2 text-[11px] dark:border-amber-900/60 dark:bg-slate-900/50">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">
                              {order.order_reference} · {Number(order.gross_order_value || 0).toLocaleString()} ETB
                            </span>
                            <span className="ml-2 text-slate-500 dark:text-slate-400">
                              Settled {new Date(order.settled_at).toLocaleString()}
                            </span>
                            {Array.isArray(order.reasons) && order.reasons.length > 0 && (
                              <span className="mt-1 block text-amber-800 dark:text-amber-300">{order.reasons.join(' · ')}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('financial_controls');
                        window.setTimeout(() => document.getElementById('financial-tax-rule-proposal')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                      }}
                      className="mt-3 inline-flex items-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/60"
                    >
                      Review commission and tax rules
                      <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
              {revenueState.available && (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">Profit is incomplete.</span>{' '}
                  Record product acquisition cost / cost of goods sold to calculate it.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
                <p className="text-slate-600 dark:text-slate-300">
                  <span className="font-medium">Verified marketplace payments:</span>{' '}
                  <span className="font-mono font-semibold">{verifiedPaymentAmount.toLocaleString()} ETB</span>{' '}
                  <span className="text-slate-500 dark:text-slate-400">({Number(overviewActivity.payments?.verified_count || 0)} records · settlement value, not platform revenue)</span>
                </p>
              </div>
              {(revenueState.missing || []).length > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-600 dark:text-slate-300">Missing data:</span>{' '}
                  {(revenueState.missing || []).join(' · ')}
                </p>
              )}
            </div>
          </section>

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
                    <Bar dataKey="requested" name="Requested" fill="#2563EB" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
                    <Bar dataKey="decided" name="Approved / Paid" fill="#15803D" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
                    <Bar dataKey="pending" name="Pending now" fill="#D97706" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
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
                    Daily Financial Transaction Trend
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
                    Weekly Financial Performance
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
                    <Bar dataKey="deposits" name="Deposits" fill="#2563EB" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
                    <Bar dataKey="payouts" name="Payouts" fill="#9333EA" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
                    <Bar dataKey="escrowVolume" name="Escrow Locked" fill="#D97706" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
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
                    Monthly Financial Performance
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
                    Regional Transaction Distribution
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
                    <Bar dataKey="volumeM" name="Value (Million ETB)" fill="#16A34A" radius={[4, 4, 0, 0]} isAnimationActive={false}>
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
                  Wallet Balance Distribution
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
                Deposit vs Payout Comparison
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
                    <Bar dataKey="deposits" name="Inflow Deposits" stackId="a" fill="#15803D"  isAnimationActive={false} />
                    <Bar dataKey="payouts" name="Outflow Payouts" stackId="a" fill="#DC2626"  isAnimationActive={false} />
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
                Payment Method Distribution
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
                    <Bar dataKey="avgRate" name="Avg Rate (ETB)" fill="#4F46E5" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 10: Financial performance by user role (Bar) */}
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Performance by User Role
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
                    <Bar dataKey="grossSettlement" name="Settlement" fill="#15803D" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
                    <Bar dataKey="payoutsClaimed" name="Payouts" fill="#EA580C" radius={[4, 4, 0, 0]}  isAnimationActive={false} />
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
                          onClick={() => {
                            if (!pay.payoutAccount) {
                              setManualPayoutTarget(pay);
                            } else {
                              void runPayoutApproval(pay);
                            }
                          }}
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
                               onClick={() => setBankAccountReviewTarget(account)}
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

      {/* SUB-TAB: Staff Invoices — salary invoices with the full approval/payment flow */}
      {activeTab === 'staff_invoices' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Open invoices', payrollRecords.filter((r) => r.status === 'PENDING' || r.status === 'APPROVED').length, 'Awaiting approval or payment'],
              ['Paid this period', payrollRecords.filter((r) => r.status === 'PAID').length, 'Credited to staff wallets'],
              ['Rejected', payrollRecords.filter((r) => r.status === 'REJECTED').length, 'Returned to the preparer'],
              ['Invoiced value', `${Number(payrollRecords.reduce((a, r) => a + Number(r.net_amount || 0), 0)).toLocaleString()} ETB`, 'All records, net of deductions'],
            ].map(([label, value, hint]) => (
              <div key={String(label)} className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">{label}</div>
                <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{String(value)}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>
              </div>
            ))}
          </div>

          {payrollError && (
            <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{payrollError}</div>
          )}

          {payrollRecords.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
              No salary invoices yet — prepare one from Payroll &amp; Employees.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                      <th className="py-2.5 px-2">Invoice</th>
                      <th className="py-2.5 px-3">Employee</th>
                      <th className="py-2.5 px-2">Region</th>
                      <th className="py-2.5 px-2">Period</th>
                      <th className="py-2.5 px-2 text-right">Base</th>
                      <th className="py-2.5 px-2 text-right">Commission</th>
                      <th className="py-2.5 px-2 text-right">Pension</th>
                      <th className="py-2.5 px-2 text-right">Deductions</th>
                      <th className="py-2.5 px-2 text-right">Net payable</th>
                      <th className="py-2.5 px-2">Status</th>
                      <th className="py-2.5 px-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {pageSlice(payrollRecords, invPage, INV_PAGE_SIZE).map((inv: any) => {
                      const invStatus = String(inv.status).toLowerCase();
                      const canApprove = invStatus === 'pending';
                      const canPay = invStatus === 'approved';
                      const tone =
                        invStatus === 'paid' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : invStatus === 'approved' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
                        : invStatus === 'rejected' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
                      return (
                        <React.Fragment key={inv.id}>
                          <tr
                            onClick={() => setExpandedInvoice(expandedInvoice === inv.id ? null : inv.id)}
                            className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${expandedInvoice === inv.id ? 'bg-emerald-50/50 dark:bg-emerald-950/20 font-medium' : ''}`}
                          >
                            <td className="py-2.5 px-2 font-mono font-bold text-slate-800 dark:text-slate-100">
                              INV-{String(inv.id).slice(0, 8).toUpperCase()}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-900 dark:text-slate-100">{inv.employee_name}</div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{inv.employee_email}</div>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 text-[10px] font-bold">
                                {inv.employee_region}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {inv.period_start} → {inv.period_end}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono">{Number(inv.base_amount).toLocaleString()}</td>
                            <td className="py-2.5 px-2 text-right font-mono">{Number(inv.commission_amount || 0).toLocaleString()}</td>
                            <td className="py-2.5 px-2 text-right font-mono">{Number(inv.pension_employee || 0).toLocaleString()}</td>
                            <td className="py-2.5 px-2 text-right font-mono">{Number(inv.deductions || 0).toLocaleString()}</td>
                            <td className="py-2.5 px-2 text-right font-mono font-bold text-emerald-700 dark:text-emerald-400">
                              {Number(inv.net_amount).toLocaleString()} ETB
                            </td>
                            <td className="py-2.5 px-2">
                              <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase ${tone}`}>{inv.status}</span>
                            </td>
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              {canApprove && (
                                <button onClick={(e) => { e.stopPropagation(); void payrollAction(inv.id, 'approve'); }} disabled={payrollBusyId === inv.id}
                                  className="px-2.5 py-1.5 rounded-lg bg-[#15803D] text-white text-[11px] font-bold disabled:opacity-60 mr-1">
                                  Approve
                                </button>
                              )}
                              {canPay && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void payrollAction(inv.id, 'pay', { payment_reference: `SALARY-${String(inv.id).slice(0, 8).toUpperCase()}` }); }}
                                  disabled={payrollBusyId === inv.id}
                                  className="px-2.5 py-1.5 rounded-lg bg-[#15803D] text-white text-[11px] font-bold disabled:opacity-60 mr-1"
                                  title="Credits the employee's wallet — withdrawable via a payout request"
                                >
                                  Pay to wallet
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); setExpandedInvoice(expandedInvoice === inv.id ? null : inv.id); }}
                                className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400 hover:underline"
                              >
                                {expandedInvoice === inv.id ? 'Hide ↑' : 'View detail ↓'}
                              </button>
                            </td>
                          </tr>
                          {expandedInvoice === inv.id && (
                            <tr>
                              <td colSpan={11} className="bg-slate-50/80 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                                <div className="space-y-2 text-xs">
                                  <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Salary invoice — approval & payment chain
                                  </div>
                                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                                    <span>Prepared by <span className="font-semibold text-slate-800 dark:text-slate-100">{inv.prepared_by_name || '—'}</span></span>
                                    {inv.approved_by_name && <span>Approved by <span className="font-semibold text-slate-800 dark:text-slate-100">{inv.approved_by_name}</span></span>}
                                    {inv.paid_at && <span>Paid {new Date(inv.paid_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · ref <span className="font-mono">{inv.payment_reference || '—'}</span></span>}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 pt-1">
                                    {canApprove && (
                                      <button onClick={(e) => { e.stopPropagation(); void payrollAction(inv.id, 'reject'); }} disabled={payrollBusyId === inv.id}
                                        className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-rose-300 text-rose-700 dark:border-rose-900 dark:text-rose-300 disabled:opacity-60">
                                        Reject invoice
                                      </button>
                                    )}
                                    {invStatus !== 'paid' && invStatus !== 'rejected' && (
                                      <span className="text-[11px] text-slate-400">
                                        {canApprove ? 'Awaiting approval — approving does not move money.' : 'Approved — pay to credit the staff wallet.'}
                                      </span>
                                    )}
                                    {invStatus === 'paid' && (
                                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                        Credited to {inv.employee_name}&apos;s wallet — withdrawable via a payout request.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {pageSlice(payrollRecords, invPage, INV_PAGE_SIZE).length === 0 && (
                      <tr><td colSpan={11} className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">No invoices on this page.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Pager
                page={invPage}
                pageSize={INV_PAGE_SIZE}
                total={payrollRecords.length}
                hasMore={invPage * INV_PAGE_SIZE < payrollRecords.length}
                onPrev={() => setInvPage((p) => Math.max(1, p - 1))}
                onNext={() => setInvPage((p) => p + 1)}
              />
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 7: Append-Only Ledger */}
      {activeTab === 'payroll' && (
        <div className="space-y-5">
          {payrollError && (
            <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{payrollError}</div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ['Employees', payrollSummary?.employees?.total, `${payrollSummary?.employees?.active ?? 0} active`],
              ['Pending approvals', payrollSummary?.pending_approvals, 'Awaiting Super Admin'],
              ['Paid (records)', payrollSummary?.paid?.count, 'Completed payments'],
              ['Unpaid (approved)', payrollSummary?.unpaid?.count, 'Ready to pay'],
              ['Tax withheld', payrollSummary?.tax_and_liabilities != null ? `${Number(payrollSummary.tax_and_liabilities).toLocaleString()} ETB` : '—', 'Liability, not expense'],
            ].map(([label, value, hint]) => (
              <div key={String(label)} className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">{label}</div>
                <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">{value ?? '—'}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{hint}</div>
              </div>
            ))}
          </div>

          {/* Employees (staff) directory — every staff user is an employee, with region + payroll linkage */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Employees — Staff Directory</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Every staff account is an employee: from Top User Admin down to Wereda admins, plus Logistics, Customer Support and Financial Managers. Filter by region or role.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Search name or email…"
                    aria-label="Search staff employees"
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <select
                  value={empRegion}
                  onChange={(e) => setEmpRegion(e.target.value)}
                  aria-label="Filter employees by region"
                  className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5"
                >
                  <option value="">All regions</option>
                  {[...new Set(staffList.map((s) => s.region))].sort().map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <select
                  value={empRole}
                  onChange={(e) => setEmpRole(e.target.value)}
                  aria-label="Filter employees by role"
                  className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5"
                >
                  <option value="">All roles</option>
                  {[...new Set(staffList.map((s) => s.role))].sort().map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>

            {(() => {
              const filteredAll = staffList.filter((s) => {
                const matchesRegion = !empRegion || s.region === empRegion;
                const matchesRole = !empRole || s.role === empRole;
                const q = empSearch.toLowerCase();
                const matchesSearch = !q || s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q);
                return matchesRegion && matchesRole && matchesSearch;
              });
              const visibleStaff = pageSlice(filteredAll, empPage, EMP_PAGE_SIZE);
              if (staffList.length === 0) {
                return (
                  <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                    No staff accounts found.
                  </div>
                );
              }
              return (
                <>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                        <th className="py-2.5 px-3">Employee</th>
                        <th className="py-2.5 px-2">Role</th>
                        <th className="py-2.5 px-2">Region</th>
                        <th className="py-2.5 px-2 text-right">Monthly salary</th>
                        <th className="py-2.5 px-2 text-right">Commission</th>
                        <th className="py-2.5 px-2 text-center" title="Sign-ins this month">Logins</th>
                        <th className="py-2.5 px-2 text-center" title="Recorded actions this month">Actions</th>
                        <th className="py-2.5 px-2 text-center" title="Approvals performed this month">Approvals</th>
                        <th className="py-2.5 px-2 text-right">Payroll records</th>
                        <th className="py-2.5 px-2 text-right">Paid</th>
                        <th className="py-2.5 px-2 text-right">Unpaid</th>
                        <th className="py-2.5 px-3 text-right">Total net paid</th>
                        <th className="py-2.5 px-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {visibleStaff.map((s) => (
                        <React.Fragment key={s.id}>
                        <tr
                          onClick={() => setAttendanceFor(attendanceFor?.id === s.id ? null : { id: s.id, name: s.full_name })}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition-colors ${attendanceFor?.id === s.id ? 'bg-sky-50/50 dark:bg-sky-950/20 font-medium' : ''}`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900 dark:text-slate-100">{s.full_name}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{s.email}</div>
                          </td>
                          <td className="py-2.5 px-2">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                              {s.role.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-2.5 px-2">
                            <span className="px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 text-[10px] font-bold">
                              {s.region}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                            {s.base_monthly_salary != null ? Number(s.base_monthly_salary).toLocaleString() : '—'}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                            {s.monthly_commission != null ? Number(s.monthly_commission).toLocaleString() : '—'}
                          </td>
                          <td className="py-2.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">{s.month_logins}</td>
                          <td className="py-2.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">{s.month_actions}</td>
                          <td className="py-2.5 px-2 text-center font-mono text-emerald-700 dark:text-emerald-400">{s.month_approvals}</td>
                          <td className="py-2.5 px-2 text-right font-mono">{s.payroll_records}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-emerald-700 dark:text-emerald-400">{s.payroll_paid}</td>
                          <td className="py-2.5 px-2 text-right font-mono text-amber-700 dark:text-amber-400">{s.payroll_unpaid}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                            {Number(s.total_net_paid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-2 text-center whitespace-nowrap">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttendanceFor(attendanceFor?.id === s.id ? null : { id: s.id, name: s.full_name });
                                setAttendanceData(null);
                                void loadAttendance(s.id);
                              }}
                              className="text-[11px] font-semibold text-sky-700 dark:text-sky-400 hover:underline mr-2"
                            >
                              Attendance
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setNewPayroll({
                                  ...newPayroll,
                                  employee: s.id,
                                  base_amount: s.base_monthly_salary != null ? String(s.base_monthly_salary) : newPayroll.base_amount,
                                  commission_amount: s.monthly_commission != null ? String(s.monthly_commission) : '0',
                                });
                                setShowPayrollForm(true);
                                const el = document.getElementById('pr-employee');
                                if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                              }}
                              className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400 hover:underline whitespace-nowrap"
                            >
                              Prepare payroll →
                            </button>
                          </td>
                        </tr>
                        {attendanceFor?.id === s.id && (
                          <tr>
                            <td colSpan={13} className="bg-sky-50/60 dark:bg-sky-950/20 border-b border-sky-200 dark:border-sky-900 px-4 py-3">
                              {!attendanceData ? (
                                <div className="py-3 text-center text-xs text-slate-400">Loading attendance for {s.full_name}…</div>
                              ) : (
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between flex-wrap gap-2">
                                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                      Attendance — {s.full_name} <span className="font-mono text-slate-400">{attendanceData.month}</span>
                                    </div>
                                    <input
                                      type="month"
                                      value={attendanceMonth}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => { setAttendanceMonth(e.target.value); void loadAttendance(s.id, e.target.value); }}
                                      aria-label="Attendance month"
                                      className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1"
                                    />
                                  </div>
                                  <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
                                    {[
                                      ['Present days', attendanceData.summary.present_days],
                                      ['Absent days', attendanceData.summary.absent_days],
                                      ['Total logins', attendanceData.summary.total_logins],
                                      ['Total actions', attendanceData.summary.total_actions],
                                      ['Approvals', attendanceData.summary.total_approvals],
                                      ['Screen time', `${Math.floor(attendanceData.summary.total_active_minutes / 60)}h ${attendanceData.summary.total_active_minutes % 60}m`],
                                    ].map(([l, v]) => (
                                      <div key={String(l)} className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                                        <div className="text-[9px] text-slate-500 uppercase font-bold">{l}</div>
                                        <div className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">{String(v)}</div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
                                    <table className="w-full text-xs">
                                      <thead className="bg-slate-50 dark:bg-slate-800/70 sticky top-0">
                                        <tr className="text-left text-slate-500 dark:text-slate-300">
                                          <th className="py-2 px-3 font-semibold">Date</th>
                                          <th className="py-2 px-2 text-center font-semibold">Logins</th>
                                          <th className="py-2 px-2 text-center font-semibold">Actions</th>
                                          <th className="py-2 px-2 text-center font-semibold">Approvals</th>
                                          <th className="py-2 px-2 font-semibold">First seen</th>
                                          <th className="py-2 px-2 font-semibold">Last seen</th>
                                          <th className="py-2 px-3 text-right font-semibold">Screen time</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                                        {attendanceData.days.map((d: any) => (
                                          <tr key={d.date}>
                                            <td className="py-1.5 px-3 font-mono text-slate-700 dark:text-slate-200">{d.date}</td>
                                            <td className="py-1.5 px-2 text-center font-mono">{d.logins}</td>
                                            <td className="py-1.5 px-2 text-center font-mono">{d.actions}</td>
                                            <td className="py-1.5 px-2 text-center font-mono text-emerald-700 dark:text-emerald-400">{d.approvals}</td>
                                            <td className="py-1.5 px-2 font-mono text-slate-500">{d.first_seen || '—'}</td>
                                            <td className="py-1.5 px-2 font-mono text-slate-500">{d.last_seen || '—'}</td>
                                            <td className="py-1.5 px-3 text-right font-mono">
                                              {d.active_minutes >= 60
                                                ? `${Math.floor(d.active_minutes / 60)}h ${d.active_minutes % 60}m`
                                                : `${d.active_minutes}m`}
                                            </td>
                                          </tr>
                                        ))}
                                        {attendanceData.days.length === 0 && (
                                          <tr><td colSpan={7} className="py-4 text-center text-xs text-slate-400">No recorded activity in this month.</td></tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      ))}
                      {filteredAll.length === 0 && (
                        <tr>
                          <td colSpan={13} className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                            No staff match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={empPage}
                  pageSize={EMP_PAGE_SIZE}
                  total={filteredAll.length}
                  hasMore={empPage * EMP_PAGE_SIZE < filteredAll.length}
                  onPrev={() => setEmpPage((p) => Math.max(1, p - 1))}
                  onNext={() => setEmpPage((p) => p + 1)}
                />
                </>
              );
            })()}

          </div>

          {/* Prepare new payroll record */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Prepare payroll record</h3>
              <button onClick={() => setShowPayrollForm((v) => !v)} className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                {showPayrollForm ? 'Hide form' : 'New record'}
              </button>
            </div>
            {showPayrollForm && (
              <form onSubmit={submitNewPayroll} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                <div className="sm:col-span-3">
                  <label htmlFor="pr-employee" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Employee</label>
                  <select id="pr-employee" required value={newPayroll.employee} onChange={(e) => setNewPayroll({ ...newPayroll, employee: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                    <option value="">Select an employee…</option>
                    {employees.map((emp: any) => (
                      <option key={`reg-${emp.id}`} value={emp.user}>
                        {emp.user_name} {emp.job_title ? `— ${emp.job_title}` : ''} ({emp.employee_code})
                      </option>
                    ))}
                    {staffList.map((s: any) => (
                      <option key={`staff-${s.id}`} value={s.id}>
                        {s.full_name} — {String(s.role).replace(/_/g, ' ').toLowerCase()} ({s.region})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pr-start" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Period start</label>
                  <input id="pr-start" required type="date" value={newPayroll.period_start} onChange={(e) => setNewPayroll({ ...newPayroll, period_start: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label htmlFor="pr-end" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Period end</label>
                  <input id="pr-end" required type="date" value={newPayroll.period_end} onChange={(e) => setNewPayroll({ ...newPayroll, period_end: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
                </div>
                <div>
                  <label htmlFor="pr-base" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Base salary (ETB)</label>
                  <input id="pr-base" required type="number" min="0" step="0.01" value={newPayroll.base_amount} onChange={(e) => setNewPayroll({ ...newPayroll, base_amount: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                </div>
                <div>
                  <label htmlFor="pr-allow" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Allowances (ETB)</label>
                  <input id="pr-allow" type="number" min="0" step="0.01" value={newPayroll.allowances} onChange={(e) => setNewPayroll({ ...newPayroll, allowances: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                </div>
                <div>
                  <label htmlFor="pr-deduct" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Other deductions (ETB)</label>
                  <input id="pr-deduct" type="number" min="0" step="0.01" value={newPayroll.deductions} onChange={(e) => setNewPayroll({ ...newPayroll, deductions: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono" />
                </div>
                <div className="sm:col-span-3">
                  {(() => {
                    const base = Number(newPayroll.base_amount || 0);
                    const allow = Number(newPayroll.allowances || 0);
                    const comm = Number(newPayroll.commission_amount || 0);
                    const other = Number(newPayroll.deductions || 0);
                    if (base <= 0) return null;
                    const gross = base + allow + comm;
                    const pensionEmp = Math.round(base * 0.07 * 100) / 100;
                    const taxable = gross - pensionEmp;
                    const brackets: Array<[number, number, number]> = [
                      [0, 0, 0], [600.01, 0.10, 60], [1650.01, 0.15, 142.5], [3200.01, 0.20, 302.5],
                      [5250.01, 0.25, 565], [7800.01, 0.30, 955], [10900.01, 0.35, 1500],
                    ];
                    let tax = 0;
                    for (let i = 0; i < brackets.length; i++) {
                      const upper = i < brackets.length - 1 ? brackets[i + 1][0] - 0.01 : Infinity;
                      if (taxable <= upper) { tax = Math.round((taxable * brackets[i][1] - brackets[i][2]) * 100) / 100; break; }
                    }
                    const net = gross - pensionEmp - tax - other;
                    const fmt = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    return (
                      <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20 grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]" aria-label="Statutory payroll preview">
                        <div><div className="text-slate-500 dark:text-slate-400 uppercase font-bold text-[9px]">Gross</div><div className="font-mono font-bold text-slate-800 dark:text-slate-100">{fmt(gross)}</div></div>
                        <div><div className="text-slate-500 dark:text-slate-400 uppercase font-bold text-[9px]">Pension (7%)</div><div className="font-mono text-slate-800 dark:text-slate-200">{fmt(pensionEmp)}</div></div>
                        <div><div className="text-slate-500 dark:text-slate-400 uppercase font-bold text-[9px]">Income tax</div><div className="font-mono text-slate-800 dark:text-slate-200">{fmt(tax)}</div></div>
                        <div><div className="text-slate-500 dark:text-slate-400 uppercase font-bold text-[9px]">Other deductions</div><div className="font-mono text-slate-800 dark:text-slate-200">{fmt(other)}</div></div>
                        <div><div className="text-emerald-700 dark:text-emerald-400 uppercase font-bold text-[9px]">Net to wallet</div><div className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{fmt(net)} ETB</div></div>
                        <div className="col-span-2 sm:col-span-5 text-[10px] text-slate-400">
                          Statutory preview — Proclamation 979/2016 income tax schedule and the 7% employee / 11% employer pension contribution. Recomputed authoritatively on submission.
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <label htmlFor="pr-tax" className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">Tax withheld (ETB) — statutory</label>
                  <input id="pr-tax" type="text" readOnly value="Computed from the statutory schedule below" className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 text-slate-400 cursor-not-allowed" />
                </div>
                {newPayrollError && <div role="alert" className="sm:col-span-3 p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{newPayrollError}</div>}
                <div className="sm:col-span-3 flex justify-end">
                  <button type="submit" className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold">Prepare record</button>
                </div>
              </form>
            )}
          </div>

          {/* Payroll records with maker-checker workflow */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr className="text-left text-slate-500 dark:text-slate-300">
                  <th scope="col" className="py-2.5 px-3 font-semibold">Employee</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Period</th>
                  <th scope="col" className="py-2.5 px-3 text-right font-semibold">Base</th>
                  <th scope="col" className="py-2.5 px-3 text-right font-semibold">Net</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Status</th>
                  <th scope="col" className="py-2.5 px-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {payrollLoading && <tr><td colSpan={6} className="py-8 text-center text-xs text-slate-400">Loading payroll records…</td></tr>}
                {!payrollLoading && payrollRecords.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-xs text-slate-400">No payroll records yet — prepare the first one above.</td></tr>
                )}
                {payrollRecords.map((row) => {
                  const statusPill = {
                    DRAFT: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                    PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                    APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
                    REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
                    PAID: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
                  }[row.status as string] ?? 'bg-slate-100 text-slate-600';
                  const canSubmit = row.status === 'DRAFT';
                  const canApprove = row.status === 'PENDING' && currentUser?.role === 'super_admin' && row.prepared_by !== currentUser?.id;
                  const canPay = row.status === 'APPROVED' && currentUser?.role === 'super_admin';
                  return (
                    <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-100">{row.employee_name || row.employee_email || row.employee}</td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 font-mono">{row.period_start} → {row.period_end}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{Number(row.base_amount).toLocaleString()}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">{Number(row.net_amount ?? 0).toLocaleString()} ETB</td>
                      <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusPill}`}>{row.status}</span></td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {canSubmit && (
                          <button onClick={() => void payrollAction(row.id, 'submit')} disabled={payrollBusyId === row.id} className="px-2 py-1 rounded text-[10px] font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 mr-1">
                            Submit
                          </button>
                        )}
                        {canApprove && (
                          <>
                            <button onClick={() => void payrollAction(row.id, 'approve')} disabled={payrollBusyId === row.id} className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 mr-1">Approve</button>
                            <button onClick={() => setPayrollRejectTarget(row)} disabled={payrollBusyId === row.id} className="px-2 py-1 rounded text-[10px] font-bold bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300">Reject</button>
                          </>
                        )}
                        {canPay && (
                          <button onClick={() => setPayrollPayTarget(row)} disabled={payrollBusyId === row.id} className="px-2 py-1 rounded text-[10px] font-bold bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300">Mark paid</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400">Maker–checker: the preparer submits; only the Super Admin approves, rejects, or marks payroll paid. Tax withheld is a liability, not an expense.</p>
        </div>
      )}

      {activeTab === 'ledger' && (
        <div className="space-y-5">
        {pnl && (
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Profit &amp; Loss (from posted ledger)</h3>
              <p className="text-[11px] text-slate-400">{pnl.note}</p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Platform revenue</div>
                <div className="text-lg font-bold font-mono text-emerald-700 dark:text-emerald-400">{pnl.revenue.available ? `${pnl.revenue.total} ETB` : 'Unavailable'}</div>
                {pnl.revenue.available && <div className="text-[10px] text-slate-400">{pnl.revenue.lines.map((l: any) => `${l.category.replace(/_/g, ' ')}: ${l.amount}`).join(' · ')}</div>}
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Expenses</div>
                <div className="text-lg font-bold font-mono text-rose-700 dark:text-rose-400">{pnl.expenses.available ? `${pnl.expenses.total} ETB` : 'Unavailable'}</div>
                {pnl.expenses.available && <div className="text-[10px] text-slate-400">promo {pnl.expenses.promotion ?? '—'} · payroll {pnl.expenses.payroll ?? '—'} · opex {pnl.expenses.operating ?? '—'}</div>}
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Gross profit</div>
                <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{pnl.gross_profit != null ? `${pnl.gross_profit} ETB` : 'Unavailable'}</div>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Net profit</div>
                <div className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{pnl.net_profit != null ? `${pnl.net_profit} ETB` : 'Unavailable — inputs incomplete'}</div>
              </div>
            </div>
          </div>
        )}
        {pnlError && (
          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 text-xs text-amber-700 dark:text-amber-300">{pnlError}</div>
        )}
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

      {/* Expense Reject Dialog */}
      <ReasonDialog
        open={!!expenseRejectTarget}
        title="Reject this operating expense?"
        description={expenseRejectTarget ? <>Rejecting <b>{expenseRejectTarget.category}</b> ({Number(expenseRejectTarget.amount).toLocaleString()} ETB). The reason will be recorded in the financial audit trail.</> : undefined}
        label="Rejection reason"
        confirmLabel="Reject expense"
        danger
        busy={expenseBusyId === expenseRejectTarget?.id}
        onConfirm={(reason) => {
          if (expenseRejectTarget) void reviewExpense(expenseRejectTarget.id, 'reject', reason);
        }}
        onCancel={() => setExpenseRejectTarget(null)}
      />

      {/* Manual Payout Reference Dialog */}
      <ReasonDialog
        open={!!manualPayoutTarget}
        title="Confirm manual payout disbursement"
        description={manualPayoutTarget ? <>Enter the verified bank or transfer reference for paying <b>{Number(manualPayoutTarget.amountETB).toLocaleString()} ETB</b> to {manualPayoutTarget.userName}.</> : undefined}
        label="Transfer / Bank Reference"
        placeholder="e.g. CBE-TXN-982341"
        confirmLabel="Approve & mark disbursed"
        busy={payoutBusyId === manualPayoutTarget?.id}
        onConfirm={(ref) => {
          if (manualPayoutTarget) void runPayoutApproval(manualPayoutTarget, ref);
        }}
        onCancel={() => { setManualPayoutTarget(null); setManualPayoutReference(''); }}
      />

      {/* Payroll Reject Dialog */}
      <ReasonDialog
        open={!!payrollRejectTarget}
        title="Reject payroll record"
        description={payrollRejectTarget ? <>Rejecting payroll period {payrollRejectTarget.period_start} to {payrollRejectTarget.period_end} for employee ID {payrollRejectTarget.employee}.</> : undefined}
        label="Rejection reason"
        confirmLabel="Reject payroll"
        danger
        busy={payrollBusyId === payrollRejectTarget?.id}
        onConfirm={(reason) => {
          if (payrollRejectTarget) void payrollAction(payrollRejectTarget.id, 'reject', { reason });
          setPayrollRejectTarget(null);
        }}
        onCancel={() => setPayrollRejectTarget(null)}
      />

      {/* Payroll Pay Dialog */}
      <ReasonDialog
        open={!!payrollPayTarget}
        title="Mark payroll as paid"
        description={payrollPayTarget ? <>Enter the bank transaction reference confirming salary transfer for {payrollPayTarget.period_start} to {payrollPayTarget.period_end}.</> : undefined}
        label="Payment Reference"
        placeholder="e.g. SAL-TXN-2026-001"
        confirmLabel="Confirm paid"
        busy={payrollBusyId === payrollPayTarget?.id}
        onConfirm={(ref) => {
          if (payrollPayTarget) void payrollAction(payrollPayTarget.id, 'pay', { payment_reference: ref });
          setPayrollPayTarget(null);
        }}
        onCancel={() => setPayrollPayTarget(null)}
      />

      {/* Bank Account Review Flag Dialog */}
      <ReasonDialog
        open={!!bankAccountReviewTarget}
        title="Flag bank account for compliance review"
        description={bankAccountReviewTarget ? <>Flag {bankAccountReviewTarget.bank_name} account ending in {bankAccountReviewTarget.account_number?.slice(-4)} ({bankAccountReviewTarget.account_holder_name}) for further verification.</> : undefined}
        label="Reason for review"
        placeholder="e.g., Mismatched account holder name, suspicious activity pattern"
        confirmLabel="Flag for review"
        danger
        busy={accountBusyId === bankAccountReviewTarget?.id}
        error={accountsError}
        onConfirm={(notes) => {
          if (bankAccountReviewTarget) void flagBankAccountForReview(bankAccountReviewTarget.id, notes);
        }}
        onCancel={() => setBankAccountReviewTarget(null)}
      />
     </div>
  );
};
