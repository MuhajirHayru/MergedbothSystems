/**
 * Discount campaigns and redemption reporting (Part 3.4 frontend).
 *
 * Super Admin: create campaigns, edit eligible campaigns, activate/deactivate.
 * Financial Manager and other staff: reporting/inspection only — every
 * mutating control is hidden, and the backend enforces the same rule.
 *
 * All data comes from the discount APIs and the immutable redemption
 * snapshots; no invented statistics.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DataTable } from '../common/DataTable';
import { BadgePercent, Plus, Search, RefreshCw, Pencil, Power, Tag } from 'lucide-react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import type {
  DiscountCampaign,
  DiscountCampaignInput,
  DiscountFundingSource,
  DiscountRedemptionRow,
  DiscountType,
  Product,
} from '../../lib/types';

const CATEGORY_OPTIONS = [
  'Vegetables', 'Fruits', 'Grains', 'Pulses', 'Oilseeds', 'Spices',
  'Coffee', 'Dairy', 'Poultry', 'Livestock',
];

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  SCHEDULED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  INACTIVE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  EXPIRED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

const FUNDING_STYLES: Record<DiscountFundingSource, string> = {
  PLATFORM:
    'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  SELLER:
    'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
};

interface FormState {
  name: string;
  code: string;
  description: string;
  discount_type: DiscountType;
  discount_value: string;
  max_discount_amount: string;
  min_order_value: string;
  first_order_only: boolean;
  funding_source: DiscountFundingSource;
  product: string;
  product_category: string;
  seller: string;
  usage_limit: string;
  per_user_limit: string;
  starts_at: string;
  ends_at: string;
}

const emptyForm: FormState = {
  name: '',
  code: '',
  description: '',
  discount_type: 'PERCENTAGE',
  discount_value: '10',
  max_discount_amount: '',
  min_order_value: '0',
  first_order_only: false,
  funding_source: 'PLATFORM',
  product: '',
  product_category: '',
  seller: '',
  usage_limit: '',
  per_user_limit: '1',
  starts_at: '',
  ends_at: '',
};

function toLocalInput(iso: null | string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatEtb(value: null | string | number): string {
  const n = Number(value ?? 0);
  if (Number.isNaN(n)) return String(value);
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

function formatDate(iso: null | string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}


function fmtDate(iso: null | string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const DiscountManagementView: React.FC = () => {
  const [tab, setTab] = useState<'campaigns' | 'redemptions'>('campaigns');

  // Campaign list state
  const [campaigns, setCampaigns] = useState<DiscountCampaign[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountCampaign | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [listings, setListings] = useState<Product[]>([]);

  // Redemption state
  const [redemptions, setRedemptions] = useState<DiscountRedemptionRow[]>([]);
  const [redemptionSummary, setRedemptionSummary] = useState<{ count: number; total_discount_amount: string } | null>(null);
  const [redemptionCampaign, setRedemptionCampaign] = useState('');
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);
  const [redemptionsError, setRedemptionsError] = useState('');

  const { currentRole } = useApp();
  const isSuperAdmin = currentRole === 'super_admin';

  const loadCampaigns = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const response = await api.discounts.campaigns();
      setCampaigns(response.data);
    } catch (err) {
      setError(formatApiError(err, 'Could not load discount campaigns.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRedemptions = useCallback(async (campaignId: string) => {
    setRedemptionsError('');
    setRedemptionsLoading(true);
    try {
      const response = await api.discounts.redemptions(
        campaignId ? { campaign: campaignId } : undefined,
      );
      setRedemptions(response.data.redemptions);
      setRedemptionSummary(response.data.summary);
    } catch (err) {
      setRedemptionsError(formatApiError(err, 'Could not load redemption history.'));
    } finally {
      setRedemptionsLoading(false);
    }
  }, []);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => {
    if (tab === 'redemptions') void loadRedemptions(redemptionCampaign);
  }, [tab, redemptionCampaign, loadRedemptions]);

  const openCreate = async () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
    if (listings.length === 0) {
      try {
        const [farmer, wholesaler] = await Promise.all([
          api.products.farmerListings({ page: 1 }),
          api.products.wholesalerListings({ page: 1 }),
        ]);
        setListings([
          ...(farmer.data?.results ?? []),
          ...(wholesaler.data?.results ?? []),
        ]);
      } catch {
        // eligibility dropdown simply stays empty; code stays accepted by backend
      }
    }
  };

  const openEdit = (campaign: DiscountCampaign) => {
    setEditing(campaign);
    setForm({
      name: campaign.name,
      code: campaign.code,
      description: campaign.description,
      discount_type: campaign.discount_type,
      discount_value: campaign.discount_value,
      max_discount_amount: campaign.max_discount_amount ?? '',
      min_order_value: campaign.min_order_value,
      first_order_only: campaign.first_order_only,
      funding_source: campaign.funding_source,
      product: campaign.product ?? '',
      product_category: campaign.product_category,
      seller: campaign.seller ?? '',
      usage_limit: campaign.usage_limit != null ? String(campaign.usage_limit) : '',
      per_user_limit: String(campaign.per_user_limit),
      starts_at: toLocalInput(campaign.starts_at),
      ends_at: toLocalInput(campaign.ends_at),
    });
    setFormError('');
    setFormOpen(true);
  };

  const validateForm = (): string => {
    if (!form.name.trim()) return 'Campaign name is required.';
    const code = form.code.trim();
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(code)) return 'Coupon code must be 3-40 letters, digits, - or _.';
    if (!form.starts_at) return 'A start date is required.';
    if (form.ends_at && form.ends_at <= form.starts_at) return 'End date must be after the start date.';
    const value = Number(form.discount_value);
    if (!Number.isFinite(value) || value <= 0) return 'Discount value must be greater than zero.';
    if (form.discount_type === 'PERCENTAGE' && value > 100) return 'Percentage discounts use percent (0-100).';
    if (form.discount_type === 'PERCENTAGE' && !form.max_discount_amount.trim()) {
      return 'Percentage discounts must cap the maximum discount amount.';
    }
    if (form.discount_type === 'FIXED' && Number(form.min_order_value || 0) > 0 && value > Number(form.min_order_value)) {
      // allowed, but the discount can never exceed the order total; keep as info
    }
    const perUser = Number(form.per_user_limit || 1);
    if (!Number.isInteger(perUser) || perUser < 1) return 'Per-user limit must be at least 1.';
    return '';
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateForm();
    if (problem) { setFormError(problem); return; }
    setSaving(true);
    setFormError('');
    try {
      const payload: DiscountCampaignInput = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        discount_type: form.discount_type,
        discount_value: form.discount_value,
        max_discount_amount: form.discount_type === 'PERCENTAGE' && form.max_discount_amount.trim()
          ? form.max_discount_amount
          : null,
        min_order_value: form.min_order_value || '0',
        first_order_only: form.first_order_only,
        funding_source: form.funding_source,
        product: form.product || null,
        product_category: form.product_category,
        seller: form.seller || null,
        usage_limit: form.usage_limit.trim() ? Number(form.usage_limit) : null,
        per_user_limit: Number(form.per_user_limit || 1),
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      };
      if (editing) {
        // Eligible active campaigns can be edited; the backend rejects invalid edits.
        await api.discounts.updateCampaign(editing.id, payload);
        setNotice(`Campaign "${payload.name}" updated.`);
      } else {
        await api.discounts.createCampaign(payload);
        setNotice(`Campaign "${payload.name}" created with code ${payload.code}.`);
      }
      setFormOpen(false);
      await loadCampaigns();
    } catch (err) {
      setFormError(formatApiError(err, 'Could not save the campaign.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (campaign: DiscountCampaign) => {
    const action = campaign.is_active ? 'deactivate' : 'activate';
    setBusyId(campaign.id);
    setError('');
    setNotice('');
    try {
      await api.discounts.campaignAction(campaign.id, {
        action,
        reason: action === 'deactivate' ? 'Deactivated from discount administration UI' : '',
      });
      setNotice(`Campaign "${campaign.name}" ${action}d.`);
      await loadCampaigns();
    } catch (err) {
      setError(formatApiError(err, 'Could not change the campaign state.'));
    } finally {
      setBusyId(null);
    }
  };

  const bulkToggle = async (ids: string[], activate: boolean) => {
    let processed = 0;
    const failures: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        await api.discounts.campaignAction(id, {
          action: activate ? 'activate' : 'deactivate',
          reason: 'Bulk action from discount administration',
        });
        processed += 1;
      } catch (err) {
        failures.push({ id, reason: formatApiError(err, 'Action failed') });
      }
    }
    await loadCampaigns();
    return { processed, skipped: 0, failures };
  };

  const filteredCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      const matchesSearch =
        !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'ALL' || c.effective_status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, search, statusFilter]);

  const platformRows = redemptions.filter((r) => r.funded_by === 'PLATFORM');
  const sellerRows = redemptions.filter((r) => r.funded_by === 'SELLER');

  const redemptionTable = (rows: DiscountRedemptionRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <th className="py-2 pr-3 font-semibold">Coupon</th>
            <th className="py-2 pr-3 font-semibold">Order</th>
            <th className="py-2 pr-3 font-semibold">Buyer</th>
            <th className="py-2 pr-3 font-semibold text-right">Original</th>
            <th className="py-2 pr-3 font-semibold text-right">Discount</th>
            <th className="py-2 pr-3 font-semibold text-right">Final payable</th>
            <th className="py-2 font-semibold">Applied</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800/60">
              <td className="py-2 pr-3 font-mono">{r.code}</td>
              <td className="py-2 pr-3">{r.order_reference}</td>
              <td className="py-2 pr-3">{r.buyer}</td>
              <td className="py-2 pr-3 text-right">{formatEtb(r.original_amount)}</td>
              <td className="py-2 pr-3 text-right text-rose-600 dark:text-rose-400">-{formatEtb(r.discount_amount)}</td>
              <td className="py-2 pr-3 text-right font-semibold">{formatEtb(r.final_amount)}</td>
              <td className="py-2">{formatDate(r.applied_at)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-slate-500">No redemptions recorded.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <BadgePercent className="w-4 h-4" />
            <span>Marketplace Promotions</span>
          </div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Discounts &amp; Campaign Management
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isSuperAdmin
              ? 'Create campaigns, schedule promotions, and toggle activation. Accounting snapshots are immutable once a coupon is used.'
              : 'Read-only discount reporting. Campaign creation and state changes are restricted to Super Admin.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void loadCampaigns(); if (tab === 'redemptions') void loadRedemptions(redemptionCampaign); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => void openCreate()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#15803D] text-white hover:bg-[#166534]"
            >
              <Plus className="w-3.5 h-3.5" /> New Campaign
            </button>
          )}
        </div>
      </div>

      {/* Tab switch */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 text-xs font-semibold">
        {([['campaigns', 'Campaigns'], ['redemptions', 'Redemption History']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`py-2 px-3 border-b-2 transition-colors ${
              tab === id
                ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search campaign name or coupon code..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-slate-900 dark:text-slate-100"
            >
              {['ALL', 'ACTIVE', 'SCHEDULED', 'INACTIVE', 'EXPIRED'].map((s) => (
                <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s}</option>
              ))}
            </select>
          </div>
          <DataTable
            rows={filteredCampaigns}
            rowId={(c) => c.id}
            rowIdentifier={(c) => `${c.code} · ${c.id.slice(0, 8)}`}
            columns={[
              { key: 'name', label: 'Campaign', render: (c) => (<div className="font-semibold text-slate-800 dark:text-slate-100">{c.name}</div>) },
              { key: 'discount', label: 'Discount', render: (c) => c.discount_type === 'PERCENTAGE' ? `${Number(c.discount_value)}% (max ${c.max_discount_amount} ETB)` : `${c.discount_value} ETB` },
              { key: 'funding', label: 'Funding', render: (c) => (<span className={`px-2 py-0.5 rounded-full font-semibold ${c.funding_source === 'PLATFORM' ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300'}`}>{c.funding_source === 'PLATFORM' ? 'Green Path' : 'Seller'}</span>) },
              { key: 'window', label: 'Window', render: (c) => (<div>{fmtDate(c.starts_at)}<div className="text-[11px] text-slate-400">→ {c.ends_at ? fmtDate(c.ends_at) : 'no end'}</div></div>) },
              { key: 'status', label: 'Status', render: (c) => (<span className="px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{c.effective_status}</span>) },
              { key: 'used', label: 'Used', className: 'text-right', render: (c) => `${c.total_redemptions}${c.usage_limit != null ? ` / ${c.usage_limit}` : ''}` },
              { key: 'total_discount', label: 'Total discount', className: 'text-right font-mono', render: (c) => `${c.total_discount_amount} ETB` },
            ]}
            emptyMessage="No campaigns match this filter yet."
            loading={loading}
            error={error || undefined}
            filteredTotal={filteredCampaigns.length}
            bulkActions={isSuperAdmin ? [
              { label: 'Activate selected', run: (ids) => bulkToggle(ids, true) },
              { label: 'Deactivate selected', danger: true, run: (ids) => bulkToggle(ids, false) },
            ] : []}
            bulkLabel="campaigns"
          />
        </div>
      )}

      {tab === 'redemptions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Total redemptions</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {redemptionSummary ? redemptionSummary.count : '—'}
              </div>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Total discount given</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {redemptionSummary ? formatEtb(redemptionSummary.total_discount_amount) : '—'}
              </div>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold">Filter by campaign</div>
              <select
                value={redemptionCampaign}
                onChange={(e) => setRedemptionCampaign(e.target.value)}
                className="mt-1 w-full text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-slate-900 dark:text-slate-100"
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>
          </div>

          {redemptionsError && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
              {redemptionsError}
            </div>
          )}

          {redemptionsLoading ? (
            <div className="p-8 text-center text-xs text-slate-500">Loading redemptions…</div>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${FUNDING_STYLES.PLATFORM}`}>
                    Platform funded
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Green Path absorbs the discount; sellers keep their agreed earnings (booked as promotion expense).
                  </span>
                </div>
                {redemptionTable(platformRows)}
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${FUNDING_STYLES.SELLER}`}>
                    Seller funded
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Sellers settle on the discounted amount; no platform promotion expense is created.
                  </span>
                </div>
                {redemptionTable(sellerRows)}
              </div>
            </>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setFormOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitForm}
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Tag className="w-4 h-4 text-emerald-600" />
                {editing ? `Edit campaign: ${editing.name}` : 'Create discount campaign'}
              </h3>
              <button type="button" onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Campaign name *
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Coupon code *
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  disabled={!!editing}
                  placeholder="E.g. HARVEST10"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono disabled:opacity-60" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Discount type *
                <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as DiscountType })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <option value="PERCENTAGE">Percentage (%)</option>
                  <option value="FIXED">Fixed amount (ETB)</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                {form.discount_type === 'PERCENTAGE' ? 'Discount percent (0-100) *' : 'Discount amount (ETB) *'}
                <input value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
              {form.discount_type === 'PERCENTAGE' && (
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                  Maximum discount cap (ETB) *
                  <input value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })}
                    placeholder="E.g. 100.00"
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
                </label>
              )}
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Minimum order value (ETB)
                <input value={form.min_order_value} onChange={(e) => setForm({ ...form, min_order_value: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Funding source *
                <select value={form.funding_source} onChange={(e) => setForm({ ...form, funding_source: e.target.value as DiscountFundingSource })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <option value="PLATFORM">Green Path funded (promotion expense)</option>
                  <option value="SELLER">Seller funded (settle on discounted amount)</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Eligible product (optional)
                <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <option value="">All products</option>
                  {listings.map((p) => (
                    <option key={p.id} value={p.id}>{p.title} — {p.owner_name}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Product category (optional)
                <select value={form.product_category} onChange={(e) => setForm({ ...form, product_category: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100">
                  <option value="">All categories</option>
                  {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Total usage limit (optional)
                <input value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                  placeholder="Unlimited"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Per-user limit *
                <input value={form.per_user_limit} onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Starts at *
                <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1">
                Ends at (optional)
                <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={form.first_order_only} onChange={(e) => setForm({ ...form, first_order_only: e.target.checked })} />
              First order only
            </label>

            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 space-y-1 block">
              Description (optional)
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setFormOpen(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[#15803D] text-white hover:bg-[#166534] disabled:opacity-60">
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
