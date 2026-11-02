import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { useApp } from '../../context/AppContext';
import {
  Sliders,
  Shield,
  Layers,
  Settings,
  FileText,
  Activity,
  CheckCircle2,
  Lock,
  Globe,
  Plus,
  Trash2,
  Save,
  Server,
  Database,
  Key,
} from 'lucide-react';

export const SuperAdminDashboard: React.FC = () => {
  const { platformConfig, updatePlatformConfig, allUsers, orders, wallet, setNotification } = useApp();

  const [activeTab, setActiveTab] = useState<'overview' | 'content' | 'security' | 'categories' | 'health' | 'finance'>('overview');
  const [financialRows, setFinancialRows] = useState<any[]>([]);
  const [deliveryPricingRows, setDeliveryPricingRows] = useState<any[]>([]);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [financialError, setFinancialError] = useState('');
  const [pricingForm, setPricingForm] = useState({ name: '', pricing_model: 'A', fee_type: 'FIXED', fee_value: '', minimum_fee: '0', maximum_fee: '', category: '*', region: '', zone: '', wereda: '', vehicle_category: '*', business_agreement_reference: '', effective_from: new Date().toISOString().slice(0, 16), effective_to: '' });
  const [configKind, setConfigKind] = useState<'DELIVERY' | 'COMMISSION' | 'TAX'>('DELIVERY');
  const [configName, setConfigName] = useState('');
  const [configReason, setConfigReason] = useState('');
  const [configSource, setConfigSource] = useState('');
  const [configSourceUrl, setConfigSourceUrl] = useState('');
  const [configRules, setConfigRules] = useState('{"status":"PROVISIONAL — REQUIRES SUPER ADMIN APPROVAL"}');

  // Website Content Form State
  const [platformTitle, setPlatformTitle] = useState(platformConfig.platformTitle);
  const [amharicTitle, setAmharicTitle] = useState(platformConfig.amharicTitle);
  const [oromoTitle, setOromoTitle] = useState(platformConfig.oromoTitle);
  const [heroHeadline, setHeroHeadline] = useState(platformConfig.websiteContent.heroHeadline);
  const [heroSubtitle, setHeroSubtitle] = useState(platformConfig.websiteContent.heroSubtitle);
  const [aboutDescription, setAboutDescription] = useState(platformConfig.websiteContent.aboutDescription);

  // Security Form State
  const [maxFailedAttempts, setMaxFailedAttempts] = useState(platformConfig.security.maxFailedAttempts);
  const [lockoutDurationMinutes, setLockoutDurationMinutes] = useState(platformConfig.security.lockoutDurationMinutes);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(platformConfig.security.sessionTimeoutMinutes);

  // Categories Form State
  const [categories, setCategories] = useState<Array<{ id: string; name_en: string }>>([]);
  const [newCategory, setNewCategory] = useState('');

  const handleSaveContent = (e: React.FormEvent) => {
    e.preventDefault();
    updatePlatformConfig({
      platformTitle,
      amharicTitle,
      oromoTitle,
      websiteContent: {
        ...platformConfig.websiteContent,
        platformTitle,
        amharicTitle,
        oromoTitle,
        heroHeadline,
        heroSubtitle,
        aboutDescription,
      },
    });
  };

  const handleSaveSecurity = (e: React.FormEvent) => {
    e.preventDefault();
    updatePlatformConfig({
      security: {
        ...platformConfig.security,
        maxFailedAttempts,
        lockoutDurationMinutes,
        sessionTimeoutMinutes,
      },
    });
  };

  useEffect(() => {
    if (activeTab !== 'finance') return;
    setFinancialLoading(true);
    Promise.all([api.financialControls.configurations(), api.financialControls.deliveryPricing()])
      .then(([response, pricing]) => {
        setFinancialRows(Array.isArray(response.data) ? response.data : response.data?.results || []);
        setDeliveryPricingRows(Array.isArray(pricing.data) ? pricing.data : pricing.data?.results || []);
      })
      .catch((err) => setFinancialError(formatApiError(err, 'Financial configurations could not be loaded.')))
      .finally(() => setFinancialLoading(false));
  }, [activeTab]);

  const handleCreateFinancialDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    setFinancialError('');
    try {
      const response = await api.financialControls.createConfiguration({
        kind: configKind, name: configName.trim(), reason: configReason.trim(),
        rules: JSON.parse(configRules), effective_from: new Date().toISOString(),
        source: configSource, source_url: configSourceUrl,
      });
      setFinancialRows((rows) => [response.data, ...rows]);
      setConfigName('');
      setConfigReason('');
      setNotification?.('Financial configuration draft saved; approval is required before use.');
    } catch (err) {
      setFinancialError(err instanceof SyntaxError ? 'Rules must be valid JSON.' : formatApiError(err, 'Financial configuration could not be saved.'));
    }
  };

  const createDeliveryPricing = async (event: React.FormEvent) => {
    event.preventDefault();
    setFinancialError('');
    try {
      const payload = { ...pricingForm, fee_value: pricingForm.fee_value, minimum_fee: pricingForm.minimum_fee, maximum_fee: pricingForm.maximum_fee, effective_from: new Date(pricingForm.effective_from).toISOString(), effective_to: pricingForm.effective_to ? new Date(pricingForm.effective_to).toISOString() : null, region: pricingForm.region || null, zone: pricingForm.zone || null, wereda: pricingForm.wereda || null };
      const response = await api.financialControls.createDeliveryPricing(payload);
      setDeliveryPricingRows((rows) => [response.data, ...rows]);
      setNotification?.('Delivery pricing rule saved to the backend.');
    } catch (err) {
      setFinancialError(formatApiError(err, 'Delivery pricing rule could not be saved.'));
    }
  };

  const approveFinancialConfiguration = async (id: string) => {
    try {
      const response = await api.financialControls.approveConfiguration(id);
      setFinancialRows((rows) => rows.map((row) => row.id === id ? response.data : row));
    } catch (err) {
      setFinancialError(formatApiError(err, 'Financial configuration could not be approved.'));
    }
  };

  useEffect(() => {
    if (activeTab !== 'categories') return;
    api.superadmin
      .catalogCategories()
      .then((response) => {
        const rows = Array.isArray(response?.data)
          ? response.data
          : response?.data?.results || [];
        setCategories(rows);
      })
      .catch((err) => {
        setNotification?.(formatApiError(err, 'Categories could not be loaded.'));
      });
  }, [activeTab, setNotification]);

  const handleAddCategory = async () => {
    const name = newCategory.trim();
    if (!name || categories.some((category) => category.name_en === name)) return;
    try {
      const response = await api.superadmin.createCatalogCategory({
        name_en: name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        active: true,
        registration_enabled: true,
        sort_order: categories.length,
      });
      setCategories((prev) => [...prev, response.data]);
      setNewCategory('');
      setNotification?.('Category created in the product catalog.');
    } catch (err) {
      setNotification?.(formatApiError(err, 'Category could not be created.'));
    }
  };

  const handleRemoveCategory = async (category: { id: string; name_en: string }) => {
    try {
      await api.superadmin.deleteCatalogCategory(category.id);
      setCategories((prev) => prev.filter((row) => row.id !== category.id));
      setNotification?.('Category removed from the product catalog.');
    } catch (err) {
      setNotification?.(formatApiError(err, 'Category could not be removed.'));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-4 h-4" />
            <span>Platform Governance & Federal Administration</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Super Administrator Control Center
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dynamic landing page content, security policies (lockout threshold), product taxonomy, and API health.
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Total Registered Users</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {allUsers.length} Users
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-0.5">Across 11 Federal Regions</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Gross Platform Volume</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1">
            {wallet.totalVolumeETB.toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Settled via Chapa Escrow</div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">Security Lockout Policy</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
            {platformConfig.security.maxFailedAttempts} Attempts
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {platformConfig.security.lockoutDurationMinutes} min lockout duration
          </div>
        </div>
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="text-xs text-slate-500">System Integration Status</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1 flex items-center gap-1.5">
            <CheckCircle2 className="w-5 h-5" />
            <span>100% Operational</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Django API · Chapa · AI Engine</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('overview')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Overview & System Matrix
        </button>
        <button
          onClick={() => setActiveTab('content')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'content'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Website Content (Dynamic CMS)
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'security'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Security Policies & Lockout Rules
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'categories'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Product Taxonomy & Categories
        </button>
        <button
          onClick={() => setActiveTab('finance')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'finance' ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Financial Controls
        </button>
        <button
          onClick={() => setActiveTab('health')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'health'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          API & Integration Health
        </button>
      </div>

      {/* TAB: Website Content CMS */}
      {activeTab === 'content' && (
        <form
          onSubmit={handleSaveContent}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4"
        >
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Dynamic Website & Landing Page CMS
            </h3>
            <p className="text-xs text-slate-400">
              Modify the headlines, branding wordmarks, and copy displayed to public visitors.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">Platform Wordmark (English)</label>
              <input
                type="text"
                value={platformTitle}
                onChange={(e) => setPlatformTitle(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Amharic Wordmark (አማርኛ)</label>
              <input
                type="text"
                value={amharicTitle}
                onChange={(e) => setAmharicTitle(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Afaan Oromo Wordmark (Oromiffa)</label>
              <input
                type="text"
                value={oromoTitle}
                onChange={(e) => setOromoTitle(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Public Hero Headline</label>
              <input
                type="text"
                value={heroHeadline}
                onChange={(e) => setHeroHeadline(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Public Hero Subtitle</label>
              <textarea
                value={heroSubtitle}
                onChange={(e) => setHeroSubtitle(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">About GreenPath Overview</label>
              <textarea
                value={aboutDescription}
                onChange={(e) => setAboutDescription(e.target.value)}
                rows={3}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>Save & Publish Live Changes</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB: Security Policies */}
      {activeTab === 'security' && (
        <form
          onSubmit={handleSaveSecurity}
          className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4"
        >
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-600" />
              <span>Authentication Lockout & Security Policy</span>
            </h3>
            <p className="text-xs text-slate-400">
              Configure brute-force prevention and session longevity across the platform.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold mb-1">
                Max Failed Login Attempts Threshold
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={maxFailedAttempts}
                onChange={(e) => setMaxFailedAttempts(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
              />
              <span className="text-[10px] text-slate-400">Strict policy benchmark: 3 failed attempts</span>
            </div>

            <div>
              <label className="block font-semibold mb-1">Lockout Duration (Minutes)</label>
              <input
                type="number"
                min={5}
                max={60}
                value={lockoutDurationMinutes}
                onChange={(e) => setLockoutDurationMinutes(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
              />
              <span className="text-[10px] text-slate-400">Cooldown window before retry</span>
            </div>

            <div>
              <label className="block font-semibold mb-1">Session Inactivity Timeout (Minutes)</label>
              <input
                type="number"
                min={15}
                max={180}
                value={sessionTimeoutMinutes}
                onChange={(e) => setSessionTimeoutMinutes(Number(e.target.value))}
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold"
              />
              <span className="text-[10px] text-slate-400">Auto sign-out on idle</span>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-6 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>Update Security Parameters</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB: Categories */}
      {activeTab === 'categories' && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            Marketplace Crop Categories Taxonomy
          </h3>

          <div className="flex gap-2 max-w-md">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g., Oilseeds & Sesame"
              className="flex-1 p-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
            <button
              onClick={handleAddCategory}
              className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-medium"
              >
                <span>{cat.name_en}</span>
                <button
                  onClick={() => handleRemoveCategory(cat)}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'finance' && (
        <div className="space-y-5">
          <form onSubmit={handleCreateFinancialDraft} className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
            <h3 className="font-bold text-sm">Financial rule draft</h3>
            <p className="text-xs text-amber-700 dark:text-amber-300">Rates and amounts remain provisional until explicitly supported and approved. Tax rules require an authoritative source and URL.</p>
            {financialError && <p role="alert" className="text-sm text-red-600">{financialError}</p>}
            <div className="grid md:grid-cols-2 gap-3">
              <select value={configKind} onChange={(e) => setConfigKind(e.target.value as any)} className="p-2 rounded border dark:bg-slate-800">
                <option value="DELIVERY">Delivery pricing</option><option value="COMMISSION">Marketplace commission</option><option value="TAX">Tax</option>
              </select>
              <input required value={configName} onChange={(e) => setConfigName(e.target.value)} placeholder="Rule name" className="p-2 rounded border dark:bg-slate-800" />
              <textarea required value={configRules} onChange={(e) => setConfigRules(e.target.value)} aria-label="Rules JSON" className="p-2 rounded border dark:bg-slate-800 font-mono text-xs md:col-span-2" rows={3} />
              <textarea required value={configReason} onChange={(e) => setConfigReason(e.target.value)} placeholder="Reason for the change" className="p-2 rounded border dark:bg-slate-800 md:col-span-2" rows={2} />
              {configKind === 'TAX' && <><input required value={configSource} onChange={(e) => setConfigSource(e.target.value)} placeholder="Authoritative source name" className="p-2 rounded border dark:bg-slate-800" /><input required type="url" value={configSourceUrl} onChange={(e) => setConfigSourceUrl(e.target.value)} placeholder="Authoritative source URL" className="p-2 rounded border dark:bg-slate-800" /></>}
            </div>
            <button type="submit" className="px-4 py-2 bg-[#15803D] text-white rounded-lg text-sm font-semibold">Save draft</button>
          </form>
          <form onSubmit={createDeliveryPricing} className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <h3 className="font-bold text-sm">Option C delivery pricing rule</h3>
            <p className="text-xs text-slate-500">More-specific agreement, wereda, zone, region, category, and vehicle rules take precedence. Existing accepted agreements are not changed.</p>
            <div className="grid md:grid-cols-3 gap-3">
              <input required placeholder="Rule name" value={pricingForm.name} onChange={(e) => setPricingForm({ ...pricingForm, name: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <select value={pricingForm.pricing_model} onChange={(e) => setPricingForm({ ...pricingForm, pricing_model: e.target.value })} className="p-2 rounded border dark:bg-slate-800"><option value="A">Model A · retained fee</option><option value="B">Model B · separate fee</option></select>
              <select value={pricingForm.fee_type} onChange={(e) => setPricingForm({ ...pricingForm, fee_type: e.target.value })} className="p-2 rounded border dark:bg-slate-800"><option value="FIXED">Fixed</option><option value="PERCENTAGE">Percentage</option></select>
              <input required type="number" min="0.01" step="0.01" placeholder="Fee value" value={pricingForm.fee_value} onChange={(e) => setPricingForm({ ...pricingForm, fee_value: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input required type="number" min="0" step="0.01" placeholder="Minimum fee" value={pricingForm.minimum_fee} onChange={(e) => setPricingForm({ ...pricingForm, minimum_fee: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input required type="number" min="0.01" step="0.01" placeholder="Maximum fee" value={pricingForm.maximum_fee} onChange={(e) => setPricingForm({ ...pricingForm, maximum_fee: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input placeholder="Category or *" value={pricingForm.category} onChange={(e) => setPricingForm({ ...pricingForm, category: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input placeholder="Vehicle category or *" value={pricingForm.vehicle_category} onChange={(e) => setPricingForm({ ...pricingForm, vehicle_category: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input placeholder="Approved agreement reference" value={pricingForm.business_agreement_reference} onChange={(e) => setPricingForm({ ...pricingForm, business_agreement_reference: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input placeholder="Region ID" value={pricingForm.region} onChange={(e) => setPricingForm({ ...pricingForm, region: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input placeholder="Zone ID" value={pricingForm.zone} onChange={(e) => setPricingForm({ ...pricingForm, zone: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <input placeholder="Wereda ID" value={pricingForm.wereda} onChange={(e) => setPricingForm({ ...pricingForm, wereda: e.target.value })} className="p-2 rounded border dark:bg-slate-800" />
              <label className="text-xs">Effective from<input required type="datetime-local" value={pricingForm.effective_from} onChange={(e) => setPricingForm({ ...pricingForm, effective_from: e.target.value })} className="block w-full p-2 rounded border dark:bg-slate-800" /></label>
              <label className="text-xs">Effective to<input type="datetime-local" value={pricingForm.effective_to} onChange={(e) => setPricingForm({ ...pricingForm, effective_to: e.target.value })} className="block w-full p-2 rounded border dark:bg-slate-800" /></label>
            </div>
            <button type="submit" className="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm">Save delivery rule</button>
          </form>
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-bold text-sm mb-3">Delivery pricing rules and precedence</h3>
            {deliveryPricingRows.length === 0 ? <p className="text-sm text-slate-500">No delivery pricing rules.</p> : <div className="space-y-2">{deliveryPricingRows.map((rule) => <div key={rule.id} className="p-3 border rounded-lg dark:border-slate-700"><p className="font-semibold">{rule.name} · Model {rule.pricing_model} · {rule.fee_type} {rule.fee_value}</p><p className="text-xs text-slate-500">Scope: {rule.business_agreement_reference || '*'} / {rule.wereda || '*'} / {rule.zone || '*'} / {rule.region || '*'} / {rule.category} / {rule.vehicle_category}</p><p className="text-xs">Fee bounds {rule.minimum_fee}–{rule.maximum_fee} · {rule.active ? 'Active' : 'Inactive'} · {rule.effective_from} – {rule.effective_to || 'open'}</p>{rule.active && <button type="button" onClick={async () => { try { const response = await api.financialControls.deliveryPricingAction(rule.id, { reason: 'Superseded by Super Admin' }); setDeliveryPricingRows((rows) => rows.map((item) => item.id === rule.id ? response.data : item)); } catch (err) { setFinancialError(formatApiError(err, 'Rule could not be deactivated.')); } }} className="mt-2 text-xs px-3 py-1 rounded bg-rose-700 text-white">Deactivate for future agreements</button>}</div>)}</div>}
          </section>
          <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <h3 className="font-bold text-sm mb-3">Configuration history</h3>
            {financialLoading ? <p>Loading configurations…</p> : financialRows.length === 0 ? <p className="text-sm text-slate-500">No configuration records.</p> : <div className="space-y-3">{financialRows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700"><div><p className="font-semibold text-sm">{row.name} · {row.kind} v{row.version}</p><p className="text-xs text-slate-500">{row.status} · Effective {row.effective_from}</p><p className="text-xs">{row.reason}</p></div>{row.status === 'DRAFT' && <button onClick={() => approveFinancialConfiguration(row.id)} className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs">Approve</button>}</div>)}</div>}
          </section>
        </div>
      )}

      {/* TAB: Health */}
      {activeTab === 'health' && (
        <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
            API & Microservice Telemetry
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>Django REST Framework</span>
              </div>
              <div className="text-slate-400 mt-1">Status: 200 OK · Latency: 42ms</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>Chapa Escrow Gateway</span>
              </div>
              <div className="text-slate-400 mt-1">Multi-rail Webhooks: Active</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 font-bold text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>AI Marketplace Advisor</span>
              </div>
              <div className="text-slate-400 mt-1">Multilingual Model: Ready</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
