import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { Plus, CheckCircle2, XCircle, Truck, Megaphone, Wallet, RefreshCw } from 'lucide-react';

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs';
const INPUT =
  'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500';
const LABEL = 'block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1';

type Any = Record<string, any>;

const EMPTY_FORM: Any = {
  transaction_type: 'FARMER_WHOLESALER',
  method: 'FIXED_TRANSACTION_FEE',
  payer: 'BUYER',
  name: '',
  calculation: 'FIXED',
  rate: '0',
  fixed_fee: '0',
  unit_fee: '0',
  seller_rate: '0',
  seller_fixed_fee: '0',
  buyer_rate: '0',
  buyer_fixed_fee: '0',
  company_share_percentage: '100',
  requires_agreement: true,
  notes: '',
};

const money = (value: any) =>
  Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const percentage = (value: any) => `${(Number(value ?? 0) * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;

const SOURCE_INFO: Record<string, { title: string; description: string }> = {
  MARKETPLACE_COMMISSION: { title: 'Marketplace fees', description: 'Seller/buyer commissions and order transaction fees.' },
  BUYER_FEE: { title: 'Buyer service fee', description: 'Separate buyer-side commission from Financial Controls.' },
  FREIGHT_MARGIN: { title: 'Freight margin', description: 'Company margin after the driver transport cost.' },
  INSPECTION: { title: 'Inspection', description: 'Inspection and verification service fees.' },
  SUBSCRIPTION: { title: 'Subscriptions', description: 'Participant subscription plan charges.' },
  ADVERTISING: { title: 'Advertising', description: 'Approved promotional package charges.' },
};

const METHOD_STATUS_LABELS: Record<string, string> = {
  IN_FORCE: 'In force', DRAFT: 'Draft — not charging', SCHEDULED: 'Scheduled',
  EXPIRED: 'Expired', DISABLED: 'Inactive', SUPERSEDED: 'Superseded',
  BLOCKED: 'Blocked by source setting',
};

const PayerBadge: React.FC<{ value: string }> = ({ value }) => (
  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 uppercase">
    {(value || '—').replace(/_/g, ' ')}
  </span>
);

export const RevenueMethodsPanel: React.FC = () => {
  const [methods, setMethods] = useState<Any[]>([]);
  const [choices, setChoices] = useState<any>({});
  const [chargeData, setChargeData] = useState<any>({ totals: {}, by_method: [], charges: [] });
  const [settlements, setSettlements] = useState<Any[]>([]);
  const [packages, setPackages] = useState<Any[]>([]);
  const [sources, setSources] = useState<Any[]>([]);
  const [sourceBusy, setSourceBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Any>({ ...EMPTY_FORM });
  const [packageForm, setPackageForm] = useState({ name: '', price: '', duration_days: '30' });
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [methodsRes, chargesRes, settlementsRes, packagesRes, sourcesRes] = await Promise.all([
        api.financialControls.revenueMethods(),
        api.financialControls.revenueCharges(),
        api.financialControls.freightSettlements(),
        api.financialControls.advertisingPackages(),
        api.financialControls.revenueSources(),
      ]);
      setMethods(methodsRes.data?.methods || []);
      setChoices(methodsRes.data?.choices || {});
      setChargeData(chargesRes.data || { totals: {}, by_method: [], charges: [] });
      setSettlements(settlementsRes.data?.settlements || []);
      setPackages(packagesRes.data?.packages || []);
      setSources(sourcesRes.data?.sources || []);
    } catch (err) {
      setError(formatApiError(err, 'Revenue methods could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createMethod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const agreementBacked = ['FARMER_WHOLESALER', 'WHOLESALER_RETAILER', 'FREIGHT'].includes(
        form.transaction_type,
      );
      const payload: Any = {
        ...form,
        name: form.name.trim() || `${form.method} · ${form.payer}`,
        // Marketplace and freight fees can never be charged without an
        // approved agreement, whatever the draft form says.
        requires_agreement: agreementBacked ? true : !!form.requires_agreement,
      };
      if (['SELLER_COMMISSION', 'BUYER_COMMISSION'].includes(form.method)) {
        Object.assign(payload, {
          rate: '0', fixed_fee: '0', unit_fee: '0', seller_rate: '0', seller_fixed_fee: '0',
          buyer_rate: '0', buyer_fixed_fee: '0', company_share_percentage: '100',
        });
      }
      delete payload.id;
      await api.financialControls.createRevenueMethod(payload);
      setNotice('Draft saved. Approve it before it can charge anyone.');
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The revenue method could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: 'APPROVE' | 'DEACTIVATE') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.financialControls.revenueMethodAction(id, { action });
      setNotice(action === 'APPROVE' ? 'Revenue method approved and in force.' : 'Revenue method deactivated.');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The revenue method could not be updated.'));
    } finally {
      setBusy(false);
    }
  };

  const createPackage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.financialControls.createAdvertisingPackage({
        name: packageForm.name,
        price: packageForm.price,
        duration_days: Number(packageForm.duration_days) || 30,
      });
      setPackageForm({ name: '', price: '', duration_days: '30' });
      setNotice('Advertising package created.');
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The advertising package could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  const editSource = (source: string, patch: Any) => {
    setSources((rows) => rows.map((row) => (row.source === source ? { ...row, ...patch } : row)));
  };

  const saveSource = async (row: Any) => {
    if (sourceBusy) return;
    setSourceBusy(row.source);
    setError('');
    try {
      await api.financialControls.updateRevenueSource(row.source, {
        enabled: !!row.enabled,
        default_percentage_rate: String(row.default_percentage_rate ?? '0'),
        default_fixed_fee: String(row.default_fixed_fee ?? '0'),
      });
      setNotice(
        `${String(row.source).replace(/_/g, ' ')} saved. Every charge from this source follows the new setting immediately.`,
      );
      await load();
    } catch (err) {
      setError(formatApiError(err, 'The revenue source could not be updated.'));
    } finally {
      setSourceBusy('');
    }
  };

  const totals = chargeData.totals || {};
  const isCommissionMethod = ['SELLER_COMMISSION', 'BUYER_COMMISSION'].includes(form.method);
  const showBoth = !isCommissionMethod && form.payer === 'BOTH';
  const agreementBacked = ['FARMER_WHOLESALER', 'WHOLESALER_RETAILER', 'FREIGHT'].includes(
    form.transaction_type,
  );
  const methodOptions = useMemo(() => choices.methods || [], [choices]);
  const payerOptions = useMemo(() => choices.payers || [], [choices]);
  const visiblePayerOptions = isCommissionMethod ? payerOptions.filter((option: Any) => option.value !== 'BOTH') : payerOptions;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" /> Revenue Methods & Payer Responsibility
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Every fee records its source, generating participant, payer, charged and collected amounts,
            company earnings, third-party payable and settlement status. No rule charges anyone until approved.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" /> New method
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Charged', totals.charged],
          ['Collected', totals.collected],
          ['Company earned', totals.company_earned],
          ['Third-party payable', totals.third_party_payable],
        ].map(([label, value]) => (
          <div key={String(label)} className={`${CARD} p-4`}>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
              {money(value)} <span className="text-[11px] font-sans text-slate-400">ETB</span>
            </div>
          </div>
        ))}
      </div>

      <section className={`${CARD} p-4 sm:p-5`} aria-labelledby="revenue-source-heading">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 id="revenue-source-heading" className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-emerald-600" /> Revenue source controls
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Turn a source on or off. Defaults apply only when an approved method has no rate of its own.
            </p>
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Rates use decimals: 0.02 = 2% · amounts are ETB</span>
        </div>
        {sources.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sources.map((row) => {
              const info = SOURCE_INFO[row.source] || { title: String(row.source).replace(/_/g, ' '), description: 'Default pricing and availability for this revenue source.' };
              return (
                <article key={row.source} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{info.title}</h4>
                      <p className="mt-1 min-h-8 text-[10px] leading-4 text-slate-500 dark:text-slate-400">{info.description}</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        aria-label={`Enable ${info.title}`}
                        checked={!!row.enabled}
                        onChange={(e) => editSource(row.source, { enabled: e.target.checked })}
                      />
                      {row.enabled ? 'On' : 'Off'}
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                      Default rate
                      <input
                        type="number" min="0" max="1" step="0.0001"
                        aria-label={`Default percentage rate for ${info.title}`}
                        className={`${INPUT} mt-1 font-mono`}
                        value={row.default_percentage_rate ?? '0'}
                        onChange={(e) => editSource(row.source, { default_percentage_rate: e.target.value })}
                      />
                    </label>
                    <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                      Default fixed fee (ETB)
                      <input
                        type="number" min="0" step="0.01"
                        aria-label={`Default fixed fee for ${info.title}`}
                        className={`${INPUT} mt-1 font-mono`}
                        value={row.default_fixed_fee ?? '0'}
                        onChange={(e) => editSource(row.source, { default_fixed_fee: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                    <span className={`text-[10px] font-semibold ${row.enabled ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {row.enabled ? 'Charges allowed when approved' : 'Charges blocked'}
                    </span>
                    <button
                      type="button"
                      disabled={sourceBusy === row.source}
                      onClick={() => void saveSource(row)}
                      className="px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-[11px] font-bold disabled:opacity-60"
                    >
                      {sourceBusy === row.source ? 'Saving…' : 'Save source'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 dark:border-slate-700">
            {loading ? 'Loading revenue sources…' : 'No revenue sources are configured.'}
          </div>
        )}
      </section>

      {showForm && (
        <form onSubmit={createMethod} className={`${CARD} p-5 space-y-4`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Configure a revenue method</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:underline">
              Close
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className={LABEL} htmlFor="rm-type">Transaction type</label>
              <select id="rm-type" className={INPUT} value={form.transaction_type}
                onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>
                {(choices.transaction_types || []).map((c: any) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="rm-method">Revenue method</label>
              <select id="rm-method" className={INPUT} value={form.method}
                onChange={(e) => {
                  const method = e.target.value;
                  const commission = ['SELLER_COMMISSION', 'BUYER_COMMISSION'].includes(method);
                  setForm({
                    ...form, method, payer: commission && form.payer === 'BOTH' ? 'SELLER' : form.payer,
                    ...(commission ? { rate: '0', fixed_fee: '0', unit_fee: '0', seller_rate: '0', seller_fixed_fee: '0', buyer_rate: '0', buyer_fixed_fee: '0', company_share_percentage: '100' } : {}),
                  });
                }}>
                {(methodOptions.length ? methodOptions : [{ value: form.method, label: form.method }]).map((c: any) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="rm-payer">Who pays</label>
              <select id="rm-payer" className={INPUT} value={form.payer}
                onChange={(e) => setForm({ ...form, payer: e.target.value })}>
                {(visiblePayerOptions.length ? visiblePayerOptions : [{ value: form.payer, label: form.payer }]).map((c: any) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="rm-name">Name</label>
              <input id="rm-name" className={INPUT} value={form.name}
                placeholder="e.g. Tomato per-quintal fee"
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            {isCommissionMethod ? (
              <div className="sm:col-span-2 lg:col-span-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-[11px] leading-4 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                Commission amount and tax rate come from the approved <b>Financial Controls</b> rules. This method sets who pays and requires an approved order agreement. To charge both sides, configure separate seller-commission and buyer-commission methods; set the buyer-side amount in the commission rule.
              </div>
            ) : (
              <>
                <div>
                  <label className={LABEL} htmlFor="rm-calc">Calculation</label>
                  <select id="rm-calc" className={INPUT} value={form.calculation}
                    onChange={(e) => setForm({ ...form, calculation: e.target.value })}>
                    {['PERCENTAGE', 'FIXED', 'PER_UNIT'].map((value) => (
                      <option key={value} value={value}>{value.replace('_', ' ').toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL} htmlFor="rm-share">Company share %</label>
                  <input id="rm-share" className={INPUT} value={form.company_share_percentage}
                    onChange={(e) => setForm({ ...form, company_share_percentage: e.target.value })} />
                </div>
              </>
            )}
            {!isCommissionMethod && !showBoth && (
              <>
                <div>
                  <label className={LABEL} htmlFor="rm-rate">Rate (decimal; 0.02 = 2%)</label>
                  <input id="rm-rate" type="number" min="0" max="1" step="0.0001" className={INPUT} value={form.rate}
                    onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="rm-fixed">Fixed fee (ETB)</label>
                  <input id="rm-fixed" type="number" min="0" step="0.01" className={INPUT} value={form.fixed_fee}
                    onChange={(e) => setForm({ ...form, fixed_fee: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="rm-unit">Per quintal (ETB)</label>
                  <input id="rm-unit" type="number" min="0" step="0.01" className={INPUT} value={form.unit_fee}
                    onChange={(e) => setForm({ ...form, unit_fee: e.target.value })} />
                </div>
              </>
            )}
            {showBoth && (
              <>
                <div>
                  <label className={LABEL} htmlFor="rm-seller-rate">Seller rate (decimal; 0.02 = 2%)</label>
                  <input id="rm-seller-rate" type="number" min="0" max="1" step="0.0001" className={INPUT} value={form.seller_rate}
                    onChange={(e) => setForm({ ...form, seller_rate: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="rm-seller-fixed">Seller fixed fee (ETB)</label>
                  <input id="rm-seller-fixed" type="number" min="0" step="0.01" className={INPUT} value={form.seller_fixed_fee}
                    onChange={(e) => setForm({ ...form, seller_fixed_fee: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="rm-buyer-rate">Buyer rate (decimal; 0.02 = 2%)</label>
                  <input id="rm-buyer-rate" type="number" min="0" max="1" step="0.0001" className={INPUT} value={form.buyer_rate}
                    onChange={(e) => setForm({ ...form, buyer_rate: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="rm-buyer-fixed">Buyer fixed fee (ETB)</label>
                  <input id="rm-buyer-fixed" type="number" min="0" step="0.01" className={INPUT} value={form.buyer_fixed_fee}
                    onChange={(e) => setForm({ ...form, buyer_fixed_fee: e.target.value })} />
                </div>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={agreementBacked ? true : !!form.requires_agreement}
              disabled={agreementBacked}
              onChange={(e) => setForm({ ...form, requires_agreement: e.target.checked })}
            />
            {agreementBacked
              ? 'An approved agreement is always required for marketplace and freight fees'
              : 'Require an approved agreement before charging (optional for this service type)'}
          </label>
          <div className="flex justify-end">
            <button type="submit" disabled={busy}
              className="px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold disabled:opacity-60">
              Save draft
            </button>
          </div>
        </form>
      )}

      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-slate-600 dark:text-slate-300">
            <tr>
              <th className="p-2.5">Transaction type</th>
              <th className="p-2.5">Method</th>
              <th className="p-2.5">Payer</th>
              <th className="p-2.5">Configuration</th>
              <th className="p-2.5">Status</th>
              <th className="p-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {methods.map((row) => (
              <tr key={row.id}>
                <td className="p-2.5">{row.transaction_type_display || row.transaction_type}</td>
                <td className="p-2.5 font-semibold">{row.method_display || row.method}</td>
                <td className="p-2.5"><PayerBadge value={row.payer_display || row.payer} /></td>
                <td className="p-2.5 font-mono text-[11px] text-slate-500">
                  {['SELLER_COMMISSION', 'BUYER_COMMISSION'].includes(row.method)
                    ? 'Amount set in Financial Controls'
                    : <>{row.calculation === 'PERCENTAGE' && `${percentage(row.rate)} of order value`}{row.calculation === 'FIXED' && `${money(row.fixed_fee)} ETB / order`}{row.calculation === 'PER_UNIT' && `${money(row.unit_fee)} ETB / quintal`}{row.payer === 'BOTH' && ` · seller ${percentage(row.seller_rate)} + ${money(row.seller_fixed_fee)} ETB · buyer ${percentage(row.buyer_rate)} + ${money(row.buyer_fixed_fee)} ETB`}</>}
                </td>
                <td className="p-2.5">
                  <span className={`font-semibold ${row.effective_status === 'IN_FORCE' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {METHOD_STATUS_LABELS[String(row.effective_status || '')] || (row.approved_by ? 'Not effective' : 'Draft — not charging')}
                  </span>
                </td>
                <td className="p-2.5 text-right">
                  {!row.approved_by && (
                    <button type="button" disabled={busy} onClick={() => void act(row.id, 'APPROVE')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-300 text-emerald-700 text-[11px] font-semibold mr-1">
                      <CheckCircle2 className="w-3 h-3" /> Approve
                    </button>
                  )}
                  {row.enabled && ['IN_FORCE', 'SCHEDULED'].includes(row.effective_status) && (
                    <button type="button" disabled={busy} onClick={() => void act(row.id, 'DEACTIVATE')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-300 text-rose-700 text-[11px] font-semibold">
                      <XCircle className="w-3 h-3" /> Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && methods.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">
                  No revenue method is configured yet — no additional fees can be charged.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recorded fees and their payers</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(chargeData.by_method || []).map((row: any) => (
            <span key={row.method} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-mono">
              {row.method}: {money(row.company_earned)} earned · {row.count} charge(s)
            </span>
          ))}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-3">Method</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Generated by</th>
                <th className="py-2 pr-3">Payer</th>
                <th className="py-2 pr-3 text-right">Charged</th>
                <th className="py-2 pr-3 text-right">Collected</th>
                <th className="py-2 pr-3 text-right">Company</th>
                <th className="py-2 pr-3 text-right">Third party</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(chargeData.charges || []).slice(0, 25).map((row: any) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3 font-semibold">{row.method_display || row.method}</td>
                  <td className="py-2 pr-3">{row.source_type} · <span className="font-mono">{row.source_reference}</span></td>
                  <td className="py-2 pr-3">{row.generating_name || '—'}</td>
                  <td className="py-2 pr-3"><PayerBadge value={row.payer_party} /></td>
                  <td className="py-2 pr-3 text-right font-mono">{money(row.amount_charged)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{money(row.amount_collected)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-emerald-700 dark:text-emerald-400">{money(row.amount_company_earned)}</td>
                  <td className="py-2 pr-3 text-right font-mono">{money(row.third_party_payable)}</td>
                  <td className="py-2">{row.settlement_status}</td>
                </tr>
              ))}
              {!loading && (chargeData.charges || []).length === 0 && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-slate-500">No fee has been charged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Truck className="w-4 h-4 text-emerald-600" /> Freight settlements
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          Driver payments are transport costs owed to the driver — never company revenue.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Shipper / payer</th>
                <th className="py-2 pr-3">Driver / provider</th>
                <th className="py-2 pr-3 text-right">Freight amount</th>
                <th className="py-2 pr-3 text-right">Transport cost</th>
                <th className="py-2 pr-3 text-right">Company margin</th>
                <th className="py-2">Settlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {settlements.slice(0, 20).map((row: any) => (
                <tr key={row.payment_reference}>
                  <td className="py-2 pr-3 font-mono">{row.order_reference}</td>
                  <td className="py-2 pr-3">{row.shipper}<div className="text-[10px] text-slate-400">{row.shipper_role}</div></td>
                  <td className="py-2 pr-3">{row.driver || '—'}<div className="text-[10px] text-slate-400">{row.transport_provider}</div></td>
                  <td className="py-2 pr-3 text-right font-mono">{money(row.freight_amount)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-slate-500">{money(row.transport_cost)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-emerald-700 dark:text-emerald-400">{money(row.company_freight_margin)}</td>
                  <td className="py-2">{row.settlement_status}</td>
                </tr>
              ))}
              {!loading && settlements.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-500">No verified freight settlement yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${CARD} p-4`}>
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-emerald-600" /> Advertising packages
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          The advertiser pays. Only wholesalers and retailers are eligible — shops and consumers are not.
        </p>
        <form onSubmit={createPackage} className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <div>
            <label className={LABEL} htmlFor="ad-name">Package name</label>
            <input id="ad-name" className={INPUT} value={packageForm.name} required
              onChange={(e) => setPackageForm({ ...packageForm, name: e.target.value })} />
          </div>
          <div>
            <label className={LABEL} htmlFor="ad-price">Price (ETB)</label>
            <input id="ad-price" className={INPUT} value={packageForm.price} required
              onChange={(e) => setPackageForm({ ...packageForm, price: e.target.value })} />
          </div>
          <div>
            <label className={LABEL} htmlFor="ad-days">Duration (days)</label>
            <input id="ad-days" className={INPUT} value={packageForm.duration_days}
              onChange={(e) => setPackageForm({ ...packageForm, duration_days: e.target.value })} />
          </div>
          <button type="submit" disabled={busy}
            className="px-3 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold disabled:opacity-60">
            Create package
          </button>
        </form>
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {packages.map((row) => (
            <li key={row.id} className="py-2 flex items-center justify-between text-xs">
              <span className="font-semibold">{row.name}</span>
              <span className="font-mono text-slate-500">
                {money(row.price)} ETB · {row.duration_days}d · {row.active ? 'active' : 'inactive'}
              </span>
            </li>
          ))}
          {!loading && packages.length === 0 && (
            <li className="py-3 text-center text-xs text-slate-500">No advertising package yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
};
