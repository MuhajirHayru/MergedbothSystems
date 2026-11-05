import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/apiClient';
import { SuperAdminOverview } from './SuperAdminOverview';
import { formatApiError } from '../../lib/apiErrors';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useApp } from '../../context/AppContext';
import {
  Shield, LayoutDashboard, Globe, Lock, Layers, Wallet, Activity,
  CheckCircle2, AlertTriangle, Lock as LockIcon, Plus, Trash2, Save,
  RefreshCw, ChevronRight, XCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Shared design tokens — one visual language for every tab            */
/* ------------------------------------------------------------------ */
const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs';
const SECTION_TITLE = 'text-sm font-bold text-slate-900 dark:text-slate-100';
const SECTION_HINT = 'text-xs text-slate-500 dark:text-slate-400 mt-0.5';
const LABEL = 'block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5';
const INPUT =
  'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-colors';
const BTN_PRIMARY =
  'inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900';
const BTN_DANGER =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400';

type TabId = 'overview' | 'content' | 'security' | 'categories' | 'finance' | 'health';

export type { TabId };

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'content', label: 'Website Content', icon: Globe },
  { id: 'security', label: 'Security Policies', icon: Lock },
  { id: 'categories', label: 'Product Categories', icon: Layers },
  { id: 'finance', label: 'Financial Controls', icon: Wallet },
  { id: 'health', label: 'System Health', icon: Activity },
];

const STATUS_PILL: Record<string, string> = {
  DRAFT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  SUPERSEDED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  ACTIVE: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  INACTIVE: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  operational: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  degraded: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  down: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

const Pill = ({ value }: { value: string }) => (
  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${STATUS_PILL[value] ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
    {value.replace(/_/g, ' ').toLowerCase()}
  </span>
);

export const SuperAdminDashboard: React.FC<{ initialTab?: TabId }> = ({ initialTab }) => {
  const { platformConfig, updatePlatformConfig, setNotification, setActiveView } = useApp();

  const [activeTab, setActiveTab] = useState<TabId>(initialTab ?? 'overview');

  // Sidebar entries deep-link into a specific tab; keep state in sync when the
  // same mounted component receives a different initialTab.
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  const [refreshKey, setRefreshKey] = useState(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* ---------- Financial controls state ---------- */
  const [financialRows, setFinancialRows] = useState<any[]>([]);
  const [deliveryPricingRows, setDeliveryPricingRows] = useState<any[]>([]);
  const [regionOptions, setRegionOptions] = useState<{ id: string; name: string; parent?: string | null }[]>([]);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [pricingError, setPricingError] = useState('');
  const [listError, setListError] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [pricingForm, setPricingForm] = useState({ name: '', pricing_model: 'A', fee_type: 'FIXED', fee_value: '', minimum_fee: '0', maximum_fee: '', category: '*', region: '', zone: '', wereda: '', vehicle_category: '*', business_agreement_reference: '', effective_from: new Date().toISOString().slice(0, 16), effective_to: '' });
  const [configKind, setConfigKind] = useState<'DELIVERY' | 'COMMISSION' | 'TAX'>('DELIVERY');
  const [configName, setConfigName] = useState('');
  const [configReason, setConfigReason] = useState('');
  const [configSource, setConfigSource] = useState('');
  const [configSourceUrl, setConfigSourceUrl] = useState('');
  const [configRules, setConfigRules] = useState('{\n  "status": "PROVISIONAL"\n}');

  /* ---------- Website content form state ---------- */
  const [platformTitle, setPlatformTitle] = useState(platformConfig.platformTitle);
  const [amharicTitle, setAmharicTitle] = useState(platformConfig.amharicTitle);
  const [oromoTitle, setOromoTitle] = useState(platformConfig.oromoTitle);
  const [heroHeadline, setHeroHeadline] = useState(platformConfig.websiteContent.heroHeadline);
  const [heroSubtitle, setHeroSubtitle] = useState(platformConfig.websiteContent.heroSubtitle);
  const [aboutDescription, setAboutDescription] = useState(platformConfig.websiteContent.aboutDescription);
  const [savingContent, setSavingContent] = useState(false);

  /* ---------- Security form state ---------- */
  const [maxFailedAttempts, setMaxFailedAttempts] = useState(platformConfig.security.maxFailedAttempts);
  const [lockoutDurationMinutes, setLockoutDurationMinutes] = useState(platformConfig.security.lockoutDurationMinutes);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(platformConfig.security.sessionTimeoutMinutes);
  const [savingSecurity, setSavingSecurity] = useState(false);

  /* ---------- Categories state ---------- */
  const [categories, setCategories] = useState<Array<any>>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoryStatusFilter, setCategoryStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [categorySearch, setCategorySearch] = useState('');

  /* ---------- System health state (real API — no hardcoded data) ---------- */
  const [health, setHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');

  /* ---------- Handlers ---------- */
  const handleSaveContent = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingContent(true);
    try {
      await updatePlatformConfig({
        platformTitle,
        amharicTitle,
        oromoTitle,
        websiteContent: {
          ...platformConfig.websiteContent,
          platformTitle, amharicTitle, oromoTitle,
          heroHeadline, heroSubtitle, aboutDescription,
        },
      });
    } finally {
      setSavingContent(false);
    }
  };

  const handleSaveSecurity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSecurity(true);
    try {
      await updatePlatformConfig({
        security: {
          ...platformConfig.security,
          maxFailedAttempts, lockoutDurationMinutes, sessionTimeoutMinutes,
        },
      });
    } finally {
      setSavingSecurity(false);
    }
  };

  const loadFinancialData = (showSpinner: boolean) => {
    if (showSpinner) setFinancialLoading(true);
    Promise.all([api.financialControls.configurations(), api.financialControls.deliveryPricing(), api.superadmin.locations()])
      .then(([response, pricing, locations]) => {
        setFinancialRows(Array.isArray(response.data) ? response.data : response.data?.results || []);
        setDeliveryPricingRows(Array.isArray(pricing.data) ? pricing.data : pricing.data?.results || []);
        const locRows = Array.isArray(locations.data) ? locations.data : locations.data?.results || [];
        setRegionOptions(locRows.filter((l: any) => l.level === 'REGION').map((l: any) => ({ id: l.id, name: l.name, parent: l.parent ?? null })));
        setListError('');
      })
      .catch((err) => setListError(formatApiError(err, 'Financial configurations could not be loaded.')))
      .finally(() => setFinancialLoading(false));
  };

  useEffect(() => {
    if (activeTab !== 'finance') return;
    loadFinancialData(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const rulesJsonValid = useMemo(() => {
    try { JSON.parse(configRules); return true; } catch { return false; }
  }, [configRules]);

  const handleCreateFinancialDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    setDraftError('');
    setSavingDraft(true);
    try {
      const response = await api.financialControls.createConfiguration({
        kind: configKind, name: configName.trim(), reason: configReason.trim(),
        rules: JSON.parse(configRules), effective_from: new Date().toISOString(),
        source: configSource, source_url: configSourceUrl,
      });
      setFinancialRows((rows) => [response.data, ...rows]);
      setConfigName(''); setConfigReason('');
      setNotification?.('Financial configuration draft saved; approval is required before use.');
    } catch (err) {
      setDraftError(err instanceof SyntaxError ? 'Rules must be valid JSON — check the syntax.' : formatApiError(err, 'Financial configuration could not be saved.'));
    } finally {
      setSavingDraft(false);
    }
  };

  const createDeliveryPricing = async (event: React.FormEvent) => {
    event.preventDefault();
    setPricingError('');
    setSavingPricing(true);
    try {
      const payload = { ...pricingForm, effective_from: new Date(pricingForm.effective_from).toISOString(), effective_to: pricingForm.effective_to ? new Date(pricingForm.effective_to).toISOString() : null, region: pricingForm.region || null, zone: pricingForm.zone || null, wereda: pricingForm.wereda || null };
      const response = await api.financialControls.createDeliveryPricing(payload);
      setDeliveryPricingRows((rows) => [response.data, ...rows]);
      setNotification?.('Delivery pricing rule saved to the backend.');
      setPricingForm((f) => ({ ...f, name: '', fee_value: '' }));
    } catch (err) {
      setPricingError(formatApiError(err, 'Delivery pricing rule could not be saved.'));
    } finally {
      setSavingPricing(false);
    }
  };

  const approveFinancialConfiguration = async (id: string) => {
    setApprovingId(id);
    try {
      const response = await api.financialControls.approveConfiguration(id);
      setFinancialRows((rows) => rows.map((row) => row.id === id ? response.data : row));
      setNotification?.('Configuration approved and now in force.');
    } catch (err) {
      setListError(formatApiError(err, 'Financial configuration could not be approved.'));
    } finally {
      setApprovingId(null);
    }
  };

  const deactivatePricingRule = async (id: string) => {
    setDeactivatingId(id);
    try {
      const response = await api.financialControls.deliveryPricingAction(id, { reason: 'Superseded by Super Admin' });
      setDeliveryPricingRows((rows) => rows.map((item) => item.id === id ? response.data : item));
      setNotification?.('Rule deactivated for future agreements.');
    } catch (err) {
      setListError(formatApiError(err, 'Rule could not be deactivated.'));
    } finally {
      setDeactivatingId(null);
    }
  };

  useEffect(() => {
    if (activeTab !== 'categories') return;
    setCategoriesLoading(true);
    api.superadmin.catalogCategories()
      .then((response) => {
        const rows = Array.isArray(response?.data) ? response.data : response?.data?.results || [];
        setCategories(rows);
      })
      .catch((err) => setNotification?.(formatApiError(err, 'Categories could not be loaded.')))
      .finally(() => setCategoriesLoading(false));
  }, [activeTab, setNotification]);

  /* ---------- Category create/edit modal ---------- */
  const emptyCategoryForm = { name_en: '', name_am: '', name_am_latin: '', description: '', parent: '', sort_order: '0', registration_enabled: true, active: true };
  const [categoryModal, setCategoryModal] = useState<null | { mode: 'create' | 'edit'; id?: string }>(null);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [categoryFieldErrors, setCategoryFieldErrors] = useState<Record<string, string>>({});
  const [categoryFormError, setCategoryFormError] = useState('');
  const [categorySaving, setCategorySaving] = useState(false);
  const categoryPanelRef = useModalA11y<HTMLDivElement>(() => setCategoryModal(null));

  const openCategoryCreate = () => {
    setCategoryForm(emptyCategoryForm);
    setCategoryFieldErrors({});
    setCategoryFormError('');
    setCategoryModal({ mode: 'create' });
  };

  const openCategoryEdit = (cat: any) => {
    setCategoryForm({
      name_en: cat.name_en ?? '',
      name_am: cat.name_am ?? '',
      name_am_latin: cat.name_am_latin ?? '',
      description: cat.description ?? '',
      parent: cat.parent ?? '',
      sort_order: String(cat.sort_order ?? 0),
      registration_enabled: !!cat.registration_enabled,
      active: !!cat.active,
    });
    setCategoryFieldErrors({});
    setCategoryFormError('');
    setCategoryModal({ mode: 'edit', id: cat.id });
  };

  const submitCategoryForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setCategoryFormError('');
    setCategoryFieldErrors({});
    setCategorySaving(true);
    const name = categoryForm.name_en.trim();
    const payload: Record<string, unknown> = {
      name_en: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name_am: categoryForm.name_am.trim(),
      name_am_latin: categoryForm.name_am_latin.trim(),
      description: categoryForm.description.trim(),
      parent: categoryForm.parent || null,
      sort_order: Number(categoryForm.sort_order) || 0,
      registration_enabled: categoryForm.registration_enabled,
      active: categoryForm.active,
    };
    try {
      if (categoryModal?.mode === 'edit' && categoryModal.id) {
        const response = await api.superadmin.updateCatalogCategory(categoryModal.id, payload);
        setCategories((prev) => prev.map((row) => (row.id === categoryModal.id ? response.data : row)));
        setNotification?.(`Category "${payload.name_en}" updated.`);
      } else {
        const response = await api.superadmin.createCatalogCategory(payload);
        setCategories((prev) => [...prev, response.data]);
        setNotification?.(`Category "${payload.name_en}" created in the product catalog.`);
      }
      setCategoryModal(null);
    } catch (err: any) {
      const raw = err?.response?.data;
      // Backend wraps field errors as {success:false, error:{field:[...]}}; also
      // accept {detail} and DRF-style flat field maps so every rejection is visible.
      const data = raw?.error && typeof raw.error === 'object' ? raw.error : raw;
      if (data && typeof data === 'object') {
        const fieldMessages: Record<string, string> = {};
        for (const [field, message] of Object.entries(data)) {
          const text = Array.isArray(message) ? String(message[0]) : typeof message === 'string' ? message : null;
          if (!text) continue;
          if (field === 'detail' || field === 'error') setCategoryFormError((prev) => prev || text);
          else fieldMessages[field] = text;
        }
        setCategoryFieldErrors(fieldMessages);
        if (!Object.keys(fieldMessages).length) {
          setCategoryFormError((prev) => prev || formatApiError(err, 'Category could not be saved.'));
        }
      } else {
        setCategoryFormError(formatApiError(err, 'Category could not be saved.'));
      }
    } finally {
      setCategorySaving(false);
    }
  };

  const toggleCategoryActive = async (cat: any) => {
    try {
      const response = await api.superadmin.updateCatalogCategory(cat.id, { active: !cat.active });
      setCategories((prev) => prev.map((row) => (row.id === cat.id ? response.data : row)));
      setNotification?.(`Category "${cat.name_en}" ${cat.active ? 'deactivated' : 'activated'}.`);
    } catch (err) {
      setNotification?.(formatApiError(err, 'Category status could not be changed.'));
    }
  };

  /* ---------- Category delete (real delete or guided deactivate) ---------- */
  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<any | null>(null);
  const [deleteCategoryBusy, setDeleteCategoryBusy] = useState(false);
  const [deleteCategoryError, setDeleteCategoryError] = useState('');
  const deletePanelRef = useModalA11y<HTMLDivElement>(() => { setConfirmDeleteCategory(null); setDeleteCategoryError(''); });

  const requestDeleteCategory = (cat: any) => {
    setDeleteCategoryError('');
    setConfirmDeleteCategory(cat);
  };

  const categoryInUse = (cat: any) =>
    (cat.listing_count ?? 0) > 0 || categories.some((c) => c.parent === cat.id);

  const handleRemoveCategory = async () => {
    if (!confirmDeleteCategory) return;
    setDeleteCategoryBusy(true);
    setDeleteCategoryError('');
    try {
      await api.superadmin.deleteCatalogCategory(confirmDeleteCategory.id);
      setCategories((prev) => prev.filter((row) => row.id !== confirmDeleteCategory.id));
      setNotification?.(`Category "${confirmDeleteCategory.name_en}" permanently deleted.`);
      setConfirmDeleteCategory(null);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error;
      setDeleteCategoryError(detail || formatApiError(err, 'Category could not be deleted.'));
    } finally {
      setDeleteCategoryBusy(false);
    }
  };

  const loadHealth = (showSpinner: boolean) => {
    if (showSpinner) setHealthLoading(true);
    setHealthError('');
    api.healthDetailed()
      .then((res) => setHealth(res.data))
      .catch((err) => setHealthError(formatApiError(err, 'System health could not be loaded.')))
      .finally(() => setHealthLoading(false));
  };

  useEffect(() => {
    if (activeTab !== 'health') return;
    loadHealth(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  /* Keyboard support for the tab strip: ← → move between tabs */
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setActiveTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const checkedAt = health?.checked_at ? new Date(health.checked_at) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-4 h-4" />
            <span>Platform Governance &amp; Federal Administration</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Super Administrator Control Center
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Platform overview, landing page CMS, security policies, product taxonomy, financial controls, and live system health.
          </p>
        </div>
        {activeTab === 'overview' && (
          <button onClick={() => setRefreshKey((k) => k + 1)} className={`${BTN_PRIMARY} shrink-0`} aria-label="Refresh overview data">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh data
          </button>
        )}
      </div>

      {/* Tab strip — always directly under the header, content below */}
      <div
        role="tablist"
        aria-label="Super Admin sections"
        className="mt-5 flex gap-1 text-xs font-semibold border-b border-slate-200 dark:border-slate-800 overflow-x-auto -mb-px"
      >
        {TABS.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            ref={(el) => { tabRefs.current[id] = el; }}
            role="tab"
            id={`sa-tab-${id}`}
            aria-selected={activeTab === id}
            aria-controls={`sa-panel-${id}`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setActiveTab(id)}
            onKeyDown={(e) => onTabKeyDown(e, index)}
            className={`px-3.5 py-2.5 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 rounded-t-md ${
              activeTab === id
                ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="pt-5 space-y-5">
        {/* ============ TAB: Overview ============ */}
        <div role="tabpanel" id="sa-panel-overview" aria-labelledby="sa-tab-overview" hidden={activeTab !== 'overview'}>
          {activeTab === 'overview' && <SuperAdminOverview onNavigate={setActiveView} refreshKey={refreshKey} />}
        </div>

        {/* ============ TAB: Website Content CMS ============ */}
        {activeTab === 'content' && (
          <div role="tabpanel" id="sa-panel-content" aria-labelledby="sa-tab-content">
            <form onSubmit={handleSaveContent} className={`${CARD} p-6 space-y-6 max-w-4xl`}>
              <div>
                <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
                  <Globe className="w-4 h-4 text-emerald-600" /> Dynamic Website &amp; Landing Page CMS
                </h3>
                <p className={SECTION_HINT}>Headlines, branding wordmarks, and copy shown to public visitors. Changes publish immediately.</p>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Branding wordmarks</legend>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="cms-title-en" className={LABEL}>English wordmark</label>
                    <input id="cms-title-en" type="text" value={platformTitle} onChange={(e) => setPlatformTitle(e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="cms-title-am" className={LABEL}>Amharic (አማርኛ)</label>
                    <input id="cms-title-am" type="text" value={amharicTitle} onChange={(e) => setAmharicTitle(e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="cms-title-om" className={LABEL}>Afaan Oromoo</label>
                    <input id="cms-title-om" type="text" value={oromoTitle} onChange={(e) => setOromoTitle(e.target.value)} className={INPUT} />
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Public landing copy</legend>
                <div>
                  <label htmlFor="cms-hero-headline" className={LABEL}>Hero headline</label>
                  <input id="cms-hero-headline" type="text" value={heroHeadline} onChange={(e) => setHeroHeadline(e.target.value)} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="cms-hero-subtitle" className={LABEL}>Hero subtitle</label>
                  <textarea id="cms-hero-subtitle" value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} rows={2} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="cms-about" className={LABEL}>About GreenPath overview</label>
                  <textarea id="cms-about" value={aboutDescription} onChange={(e) => setAboutDescription(e.target.value)} rows={3} className={INPUT} />
                </div>
              </fieldset>

              <div className="flex items-center justify-end gap-3 pt-1">
                {savingContent && <span className="text-xs text-slate-500 dark:text-slate-400">Publishing…</span>}
                <button type="submit" disabled={savingContent} className={BTN_PRIMARY}>
                  <Save className="w-4 h-4" /> {savingContent ? 'Publishing…' : 'Save & Publish Live Changes'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ============ TAB: Security Policies ============ */}
        {activeTab === 'security' && (
          <div role="tabpanel" id="sa-panel-security" aria-labelledby="sa-tab-security">
            <div className="max-w-4xl space-y-5">
              <form onSubmit={handleSaveSecurity} className={`${CARD} p-6 space-y-5`}>
                <div>
                  <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
                    <LockIcon className="w-4 h-4 text-emerald-600" /> Authentication Lockout &amp; Security Policy
                  </h3>
                  <p className={SECTION_HINT}>Brute-force prevention and session longevity, applied platform-wide at the next sign-in attempt.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="sec-attempts" className={LABEL}>Max failed login attempts</label>
                    <input id="sec-attempts" type="number" min={1} max={10} value={maxFailedAttempts} onChange={(e) => setMaxFailedAttempts(Number(e.target.value))} className={`${INPUT} font-mono font-bold`} />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Recommended: 3 attempts</span>
                  </div>
                  <div>
                    <label htmlFor="sec-lockout" className={LABEL}>Lockout duration (minutes)</label>
                    <input id="sec-lockout" type="number" min={5} max={1440} value={lockoutDurationMinutes} onChange={(e) => setLockoutDurationMinutes(Number(e.target.value))} className={`${INPUT} font-mono font-bold`} />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Cooldown window before retry</span>
                  </div>
                  <div>
                    <label htmlFor="sec-session" className={LABEL}>Session inactivity timeout (minutes)</label>
                    <input id="sec-session" type="number" min={15} max={480} value={sessionTimeoutMinutes} onChange={(e) => setSessionTimeoutMinutes(Number(e.target.value))} className={`${INPUT} font-mono font-bold`} />
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Auto sign-out when idle</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-1">
                  {savingSecurity && <span className="text-xs text-slate-500 dark:text-slate-400">Updating…</span>}
                  <button type="submit" disabled={savingSecurity} className={BTN_PRIMARY}>
                    <Save className="w-4 h-4" /> {savingSecurity ? 'Updating…' : 'Update Security Parameters'}
                  </button>
                </div>
              </form>

              {/* Current policy summary — makes this thin tab useful */}
              <div className={`${CARD} p-5`}>
                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-3">What this policy means in practice</h4>
                <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300 list-decimal list-inside">
                  <li>After <b>{maxFailedAttempts}</b> failed sign-in attempts, the account locks.</li>
                  <li>It stays locked for <b>{lockoutDurationMinutes}</b> minutes — even with the correct password.</li>
                  <li>Locked accounts unlock automatically; admins can also unlock from Platform Users &amp; Staff.</li>
                  <li>Idle sessions longer than <b>{sessionTimeoutMinutes}</b> minutes require a fresh sign-in.</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* ============ TAB: Categories ============ */}
        {activeTab === 'categories' && (
          <div role="tabpanel" id="sa-panel-categories" aria-labelledby="sa-tab-categories">
            <div className={`${CARD} p-6 space-y-4`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className={SECTION_TITLE}>Marketplace Crop Categories Taxonomy</h3>
                  <p className={SECTION_HINT}>Categories available to farmers when listing produce. Deactivated categories disappear from registration but keep their history.</p>
                </div>
                <button onClick={openCategoryCreate} className={BTN_PRIMARY}>
                  <Plus className="w-4 h-4" /> New category
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Search categories…"
                  aria-label="Search categories"
                  className={`${INPUT} max-w-xs`}
                />
                <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-semibold" role="group" aria-label="Filter by status">
                  {([['ALL', 'All'], ['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setCategoryStatusFilter(id)}
                      aria-pressed={categoryStatusFilter === id}
                      className={`px-2.5 py-1 rounded-md transition-colors ${categoryStatusFilter === id ? 'bg-white dark:bg-slate-900 text-[#15803D] dark:text-emerald-400 shadow-xs' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 sm:ml-auto">{categories.length} categories</span>
              </div>

              {categoriesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
                </div>
              ) : categories.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  No categories yet — create the first one with "New category".
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/70">
                      <tr className="text-left text-slate-500 dark:text-slate-300">
                        <th scope="col" className="py-2.5 px-3 font-semibold">Category</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Type</th>
                        <th scope="col" className="py-2.5 px-3 text-right font-semibold">Listings</th>
                        <th scope="col" className="py-2.5 px-3 text-right font-semibold">Order</th>
                        <th scope="col" className="py-2.5 px-3 font-semibold">Status</th>
                        <th scope="col" className="py-2.5 px-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                      {categories
                        .filter((cat) => categoryStatusFilter === 'ALL' || (categoryStatusFilter === 'ACTIVE') === cat.active)
                        .filter((cat) => !categorySearch.trim() || (cat.name_en || '').toLowerCase().includes(categorySearch.trim().toLowerCase()) || (cat.slug || '').includes(categorySearch.trim().toLowerCase()))
                        .map((cat) => (
                        <tr key={cat.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{cat.name_en}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{cat.slug}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                            {cat.parent ? <span>Sub of <b>{cat.parent_name || '—'}</b></span> : 'Main'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-200">{cat.listing_count ?? 0}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400">{cat.sort_order}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cat.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>
                              {cat.active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <button onClick={() => openCategoryEdit(cat)} className="px-2 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Edit ${cat.name_en}`}>Edit</button>
                            <button onClick={() => toggleCategoryActive(cat)} className="px-2 py-1 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30" aria-label={`${cat.active ? 'Deactivate' : 'Activate'} ${cat.name_en}`}>
                              {cat.active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={() => requestDeleteCategory(cat)} className="px-2 py-1 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30" aria-label={`Delete ${cat.name_en}`}>Delete</button>
                          </td>
                        </tr>
                      ))}
                      {categories.filter((cat) => categoryStatusFilter === 'ALL' || (categoryStatusFilter === 'ACTIVE') === cat.active).filter((cat) => !categorySearch.trim() || (cat.name_en || '').toLowerCase().includes(categorySearch.trim().toLowerCase()) || (cat.slug || '').includes(categorySearch.trim().toLowerCase())).length === 0 && (
                        <tr><td colSpan={6} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">No categories match the current search and filter.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============ TAB: Financial Controls ============ */}
        {activeTab === 'finance' && (
          <div role="tabpanel" id="sa-panel-finance" aria-labelledby="sa-tab-finance">
            <div className="space-y-5">
              {listError && (
                <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{listError}</div>
              )}

              {/* Rule draft */}
              <form onSubmit={handleCreateFinancialDraft} className={`${CARD} p-6 space-y-4 max-w-4xl`}>
                <div>
                  <h3 className={SECTION_TITLE}>Financial rule draft</h3>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    Rates and amounts remain provisional until approved. Tax rules require an authoritative source and URL.
                  </p>
                </div>
                {draftError && <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{draftError}</div>}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="fin-kind" className={LABEL}>Rule type</label>
                    <select id="fin-kind" value={configKind} onChange={(e) => setConfigKind(e.target.value as any)} className={INPUT}>
                      <option value="DELIVERY">Delivery pricing</option>
                      <option value="COMMISSION">Marketplace commission</option>
                      <option value="TAX">Tax</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="fin-name" className={LABEL}>Rule name</label>
                    <input id="fin-name" required value={configName} onChange={(e) => setConfigName(e.target.value)} placeholder="e.g., Q3 commission adjustment" className={INPUT} />
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor="fin-rules" className={LABEL}>
                      Rules (JSON) <span className={`ml-2 font-normal ${rulesJsonValid ? 'text-emerald-600' : 'text-rose-500'}`}>{rulesJsonValid ? '✓ valid JSON' : '✗ invalid JSON'}</span>
                    </label>
                    <textarea id="fin-rules" required value={configRules} onChange={(e) => setConfigRules(e.target.value)} className={`${INPUT} font-mono`} rows={3} aria-invalid={!rulesJsonValid} />
                  </div>
                  <div className="md:col-span-2">
                    <label htmlFor="fin-reason" className={LABEL}>Reason for the change</label>
                    <textarea id="fin-reason" required value={configReason} onChange={(e) => setConfigReason(e.target.value)} placeholder="Why is this rule being introduced?" className={INPUT} rows={2} />
                  </div>
                  {configKind === 'TAX' && (
                    <>
                      <div>
                        <label htmlFor="fin-source" className={LABEL}>Authoritative source name</label>
                        <input id="fin-source" required value={configSource} onChange={(e) => setConfigSource(e.target.value)} placeholder="e.g., Ministry of Revenue directive" className={INPUT} />
                      </div>
                      <div>
                        <label htmlFor="fin-source-url" className={LABEL}>Authoritative source URL</label>
                        <input id="fin-source-url" required type="url" value={configSourceUrl} onChange={(e) => setConfigSourceUrl(e.target.value)} placeholder="https://…" className={INPUT} />
                      </div>
                    </>
                  )}
                </div>
                <div className="flex justify-end">
                  <button type="submit" disabled={savingDraft || !rulesJsonValid} className={BTN_PRIMARY}>
                    <Save className="w-4 h-4" /> {savingDraft ? 'Saving…' : 'Save draft'}
                  </button>
                </div>
              </form>

              {/* Delivery pricing rule */}
              <form onSubmit={createDeliveryPricing} className={`${CARD} p-6 space-y-4 max-w-5xl`}>
                <div>
                  <h3 className={SECTION_TITLE}>Option C delivery pricing rule</h3>
                  <p className={SECTION_HINT}>More-specific agreement, wereda, zone, region, category, and vehicle rules take precedence. Existing accepted agreements are not changed.</p>
                </div>
                {pricingError && <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{pricingError}</div>}
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="dp-name" className={LABEL}>Rule name</label>
                    <input id="dp-name" required placeholder="e.g., Oromia corridor · ISUZU" value={pricingForm.name} onChange={(e) => setPricingForm({ ...pricingForm, name: e.target.value })} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="dp-model" className={LABEL}>Pricing model</label>
                    <select id="dp-model" value={pricingForm.pricing_model} onChange={(e) => setPricingForm({ ...pricingForm, pricing_model: e.target.value })} className={INPUT}>
                      <option value="A">Model A · platform-retained fee</option>
                      <option value="B">Model B · separate fee</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="dp-fee-type" className={LABEL}>Fee type</label>
                    <select id="dp-fee-type" value={pricingForm.fee_type} onChange={(e) => setPricingForm({ ...pricingForm, fee_type: e.target.value })} className={INPUT}>
                      <option value="FIXED">Fixed (ETB)</option>
                      <option value="PERCENTAGE">Percentage (%)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="dp-fee" className={LABEL}>Fee value</label>
                    <input id="dp-fee" required type="number" min="0.01" step="0.01" placeholder={pricingForm.fee_type === 'FIXED' ? 'e.g., 250' : 'e.g., 5'} value={pricingForm.fee_value} onChange={(e) => setPricingForm({ ...pricingForm, fee_value: e.target.value })} className={`${INPUT} font-mono`} />
                  </div>
                  <div>
                    <label htmlFor="dp-min" className={LABEL}>Minimum fee (ETB)</label>
                    <input id="dp-min" required type="number" min="0" step="0.01" placeholder="0" value={pricingForm.minimum_fee} onChange={(e) => setPricingForm({ ...pricingForm, minimum_fee: e.target.value })} className={`${INPUT} font-mono`} />
                  </div>
                  <div>
                    <label htmlFor="dp-max" className={LABEL}>Maximum fee (ETB)</label>
                    <input id="dp-max" required type="number" min="0.01" step="0.01" placeholder="e.g., 5000" value={pricingForm.maximum_fee} onChange={(e) => setPricingForm({ ...pricingForm, maximum_fee: e.target.value })} className={`${INPUT} font-mono`} />
                  </div>

                  <div className="md:col-span-3 pt-1">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Scope (leave blank or * for all)</div>
                    <div className="grid md:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="dp-region" className={LABEL}>Region</label>
                        <select id="dp-region" value={pricingForm.region} onChange={(e) => setPricingForm({ ...pricingForm, region: e.target.value })} className={INPUT}>
                          <option value="">All regions (*)</option>
                          {regionOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        {regionOptions.length === 0 && <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Region list unavailable — leave blank for all regions.</span>}
                      </div>
                      <div>
                        <label htmlFor="dp-zone" className={LABEL}>Zone (UUID, optional)</label>
                        <input id="dp-zone" placeholder="All zones" value={pricingForm.zone} onChange={(e) => setPricingForm({ ...pricingForm, zone: e.target.value })} className={INPUT} />
                      </div>
                      <div>
                        <label htmlFor="dp-wereda" className={LABEL}>Wereda (UUID, optional)</label>
                        <input id="dp-wereda" placeholder="All weredas" value={pricingForm.wereda} onChange={(e) => setPricingForm({ ...pricingForm, wereda: e.target.value })} className={INPUT} />
                      </div>
                      <div>
                        <label htmlFor="dp-category" className={LABEL}>Product category</label>
                        <input id="dp-category" placeholder="* (all categories)" value={pricingForm.category} onChange={(e) => setPricingForm({ ...pricingForm, category: e.target.value })} className={INPUT} />
                      </div>
                      <div>
                        <label htmlFor="dp-vehicle" className={LABEL}>Vehicle category</label>
                        <input id="dp-vehicle" placeholder="* (all vehicles)" value={pricingForm.vehicle_category} onChange={(e) => setPricingForm({ ...pricingForm, vehicle_category: e.target.value })} className={INPUT} />
                      </div>
                      <div>
                        <label htmlFor="dp-agreement" className={LABEL}>Approved agreement reference</label>
                        <input id="dp-agreement" placeholder="Optional" value={pricingForm.business_agreement_reference} onChange={(e) => setPricingForm({ ...pricingForm, business_agreement_reference: e.target.value })} className={INPUT} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="dp-from" className={LABEL}>Effective from</label>
                    <input id="dp-from" required type="datetime-local" value={pricingForm.effective_from} onChange={(e) => setPricingForm({ ...pricingForm, effective_from: e.target.value })} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="dp-to" className={LABEL}>Effective to (optional)</label>
                    <input id="dp-to" type="datetime-local" value={pricingForm.effective_to} onChange={(e) => setPricingForm({ ...pricingForm, effective_to: e.target.value })} className={INPUT} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button type="submit" disabled={savingPricing} className={BTN_PRIMARY}>
                    <Save className="w-4 h-4" /> {savingPricing ? 'Saving…' : 'Save delivery rule'}
                  </button>
                </div>
              </form>

              {/* Delivery pricing rules list */}
              <section className={`${CARD} p-6`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={SECTION_TITLE}>Delivery pricing rules &amp; precedence</h3>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{deliveryPricingRows.length} rules</span>
                </div>
                {financialLoading ? (
                  <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
                ) : deliveryPricingRows.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">No delivery pricing rules yet — create the first one above.</p>
                ) : (
                  <div className="space-y-2">
                    {deliveryPricingRows.map((rule) => (
                      <div key={rule.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{rule.name}</span>
                          <Pill value={rule.active ? 'ACTIVE' : 'INACTIVE'} />
                          <span className="text-xs text-slate-500 dark:text-slate-400">Model {rule.pricing_model}</span>
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{rule.fee_type === 'PERCENTAGE' ? `${rule.fee_value}%` : `${Number(rule.fee_value).toLocaleString()} ETB`}</span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 space-y-0.5">
                          <div>Scope: agreement <b>{rule.business_agreement_reference || '*'}</b> · wereda <b>{rule.wereda || '*'}</b> · zone <b>{rule.zone || '*'}</b> · region <b>{rule.region || '*'}</b> · category <b>{rule.category}</b> · vehicle <b>{rule.vehicle_category}</b></div>
                          <div className="font-mono">Bounds {Number(rule.minimum_fee).toLocaleString()}–{Number(rule.maximum_fee).toLocaleString()} ETB · effective {rule.effective_from ? String(rule.effective_from).slice(0, 10) : '—'} → {rule.effective_to ? String(rule.effective_to).slice(0, 10) : 'open'}</div>
                        </div>
                        {rule.active && (
                          <button
                            type="button"
                            onClick={() => deactivatePricingRule(rule.id)}
                            disabled={deactivatingId === rule.id}
                            className={`${BTN_DANGER} mt-3`}
                          >
                            {deactivatingId === rule.id ? 'Deactivating…' : 'Deactivate for future agreements'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Configuration history */}
              <section className={`${CARD} p-6`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={SECTION_TITLE}>Configuration history</h3>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{financialRows.length} records</span>
                </div>
                {financialLoading ? (
                  <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>
                ) : financialRows.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">No configuration records — drafts you save will appear here for approval.</p>
                ) : (
                  <div className="space-y-3">
                    {financialRows.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-slate-900 dark:text-slate-100">{row.name}</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">· {row.kind} v{row.version}</span>
                            <Pill value={row.status} />
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            Effective {row.effective_from ? String(row.effective_from).slice(0, 10) : '—'}{row.reason ? ` — ${row.reason}` : ''}
                          </p>
                        </div>
                        {row.status === 'DRAFT' && (
                          <button onClick={() => approveFinancialConfiguration(row.id)} disabled={approvingId === row.id} className={BTN_PRIMARY}>
                            {approvingId === row.id ? 'Approving…' : 'Approve'} <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* ============ TAB: System Health (real API data) ============ */}
        {activeTab === 'health' && (
          <div role="tabpanel" id="sa-panel-health" aria-labelledby="sa-tab-health">
            <div className="space-y-5 max-w-5xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className={`${SECTION_TITLE} flex items-center gap-2`}>
                    <Activity className="w-4 h-4 text-emerald-600" /> API &amp; Integration Health
                  </h3>
                  <p className={SECTION_HINT}>Live status from the platform backend — refreshed on demand, never simulated.</p>
                </div>
                <button onClick={() => loadHealth(true)} disabled={healthLoading} className={BTN_PRIMARY} aria-label="Re-run health checks">
                  <RefreshCw className={`w-3.5 h-3.5 ${healthLoading ? 'animate-spin' : ''}`} /> {healthLoading ? 'Checking…' : 'Run checks'}
                </button>
              </div>

              {healthError && (
                <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{healthError}</div>
              )}

              {health && (
                <>
                  <div className={`p-4 rounded-2xl border text-sm font-bold flex items-center gap-2 ${
                    health.status === 'operational'
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                      : 'border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400'
                  }`}>
                    {health.status === 'operational' ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    All systems {health.status}
                    <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-auto">
                      {health.error_rate_last_hour} failed actions in the last hour
                      {checkedAt && <> · checked {checkedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {health.services.map((s: any) => (
                      <div key={s.name} className={`${CARD} p-4`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-xs text-slate-800 dark:text-slate-100">{s.name}</span>
                          <Pill value={s.status} />
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">{s.detail}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {healthLoading && !health && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============ Category create/edit modal ============ */}
      {categoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div ref={categoryPanelRef} tabIndex={-1} className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl my-8" role="dialog" aria-modal="true" aria-label={categoryModal.mode === 'edit' ? 'Edit category' : 'New category'}>
            <form onSubmit={submitCategoryForm} className="p-6 space-y-4">
              <div>
                <h3 className={SECTION_TITLE}>{categoryModal.mode === 'edit' ? 'Edit category' : 'New category'}</h3>
                <p className={SECTION_HINT}>Categories support one level of subcategories; only main categories can be enabled at registration.</p>
              </div>
              {categoryFormError && <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{categoryFormError}</div>}

              <div>
                <label htmlFor="cat-name" className={LABEL}>Name (English) <span className="text-rose-500">*</span></label>
                <input id="cat-name" required value={categoryForm.name_en} onChange={(e) => setCategoryForm({ ...categoryForm, name_en: e.target.value })} className={INPUT} aria-invalid={!!categoryFieldErrors.name_en} />
                {categoryFieldErrors.name_en && <p className="text-[11px] text-rose-600 mt-1">{categoryFieldErrors.name_en}</p>}
                {categoryFieldErrors.slug && <p className="text-[11px] text-rose-600 mt-1">{categoryFieldErrors.slug}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cat-name-am" className={LABEL}>Name (Amharic)</label>
                  <input id="cat-name-am" value={categoryForm.name_am} onChange={(e) => setCategoryForm({ ...categoryForm, name_am: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label htmlFor="cat-name-om" className={LABEL}>Name (Afaan Oromoo)</label>
                  <input id="cat-name-om" value={categoryForm.name_am_latin} onChange={(e) => setCategoryForm({ ...categoryForm, name_am_latin: e.target.value })} className={INPUT} />
                </div>
              </div>

              <div>
                <label htmlFor="cat-desc" className={LABEL}>Description</label>
                <textarea id="cat-desc" rows={2} value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} className={INPUT} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="cat-parent" className={LABEL}>Parent category</label>
                  <select id="cat-parent" value={categoryForm.parent} onChange={(e) => setCategoryForm({ ...categoryForm, parent: e.target.value })} className={INPUT}>
                    <option value="">None — main category</option>
                    {categories.filter((c) => !c.parent && (!categoryModal?.id || c.id !== categoryModal.id)).map((c) => (
                      <option key={c.id} value={c.id}>{c.name_en}</option>
                    ))}
                  </select>
                  {categoryFieldErrors.parent && <p className="text-[11px] text-rose-600 mt-1">{categoryFieldErrors.parent}</p>}
                </div>
                <div>
                  <label htmlFor="cat-order" className={LABEL}>Display order</label>
                  <input id="cat-order" type="number" min={0} value={categoryForm.sort_order} onChange={(e) => setCategoryForm({ ...categoryForm, sort_order: e.target.value })} className={`${INPUT} font-mono`} />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={categoryForm.registration_enabled} onChange={(e) => setCategoryForm({ ...categoryForm, registration_enabled: e.target.checked })} disabled={!!categoryForm.parent} />
                  Available at registration
                </label>
                {categoryModal.mode === 'edit' && (
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <input type="checkbox" checked={categoryForm.active} onChange={(e) => setCategoryForm({ ...categoryForm, active: e.target.checked })} />
                    Active
                  </label>
                )}
                {categoryFieldErrors.registration_enabled && <p className="text-[11px] text-rose-600">{categoryFieldErrors.registration_enabled}</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCategoryModal(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
                <button type="submit" disabled={categorySaving} className={BTN_PRIMARY}>
                  <Save className="w-4 h-4" /> {categorySaving ? 'Saving…' : categoryModal.mode === 'edit' ? 'Save changes' : 'Create category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Category delete confirmation ============ */}
      {confirmDeleteCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div ref={deletePanelRef} tabIndex={-1} className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 space-y-4" role="dialog" aria-modal="true" aria-label="Delete category">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Delete &quot;{confirmDeleteCategory.name_en}&quot;?</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {categoryInUse(confirmDeleteCategory)
                  ? `This category is in use (${confirmDeleteCategory.listing_count ?? 0} listing(s) and/or subcategories), so deletion will be refused by the platform — deactivate it instead to remove it from farmer registration while keeping its history.`
                  : 'This permanently removes the category from the product catalog. This cannot be undone.'}
              </p>
            </div>
            {deleteCategoryError && <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{deleteCategoryError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmDeleteCategory(null); setDeleteCategoryError(''); }} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
              {categoryInUse(confirmDeleteCategory) ? (
                <button onClick={() => { setConfirmDeleteCategory(null); void toggleCategoryActive(confirmDeleteCategory); }} className={BTN_PRIMARY}>
                  Deactivate instead
                </button>
              ) : (
                <button onClick={() => void handleRemoveCategory()} disabled={deleteCategoryBusy} className={BTN_DANGER}>
                  {deleteCategoryBusy ? 'Deleting…' : 'Delete permanently'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
