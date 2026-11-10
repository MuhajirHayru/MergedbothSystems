import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Truck,
  Activity, ArrowDownRight, ArrowRight, BarChart3, Check,
  ClipboardCheck, Flag, LoaderCircle, MapPin, Package, Plus,
  RefreshCw, Search, ShieldCheck, Users, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { formatApiError } from '../../lib/apiErrors';
import { apiClient } from '../../services/apiClient';
import { LocationPicker, AdministrativeLocation } from '../staff/LocationPicker';
import { RegionalFinancialReportsView } from './RegionalFinancialReportsView';

type TabId = 'overview' | 'reports' | 'administrators' | 'products';
type AdminRole = 'REGIONAL_ADMIN' | 'ZONAL_ADMIN' | 'WEREDA_ADMIN';
type FeatureKey = 'regional_reports' | 'user_management' | 'admin_management' | 'registration_review' | 'product_oversight' | 'administrative_audit';

type RegionRecord = {
  location_id: string;
  name: string;
  total: number;
  farmer: number;
  wholesaler: number;
  retailer: number;
  driver: number;
  staff: number;
  active: number;
  pending: number;
  suspended: number;
};

type AdminRecord = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  role_display?: string;
  status: string;
  location_name?: string;
  location_id?: string;
  location_level?: string;
  location_flag_image?: string;
  scope_label?: string;
  dashboard_features?: FeatureKey[];
};

type ProductRecord = {
  id: string;
  title: string;
  seller: string;
  seller_role: string;
  category: string;
  quantity: string;
  price_per_unit: string;
  status: string;
  unit: string;
  listed_at: string;
};

const FEATURE_OPTIONS: { id: FeatureKey; label: string; detail: string }[] = [
  { id: 'regional_reports', label: 'Regional reports', detail: 'Regional, zonal and wereda report data' },
  { id: 'user_management', label: 'User directory', detail: 'Search and manage accounts within assigned geography' },
  { id: 'admin_management', label: 'Manage subordinate admins', detail: 'Create child admins and delegate features inside your geography' },
  { id: 'registration_review', label: 'Registration review', detail: 'Review applications and verification documents' },
  { id: 'product_oversight', label: 'Product oversight', detail: 'Inspect and moderate listings within assigned geography' },
  { id: 'administrative_audit', label: 'Administrative audit', detail: 'View administrative actions in assigned geography' },
];

const ADMIN_ROLES: { value: AdminRole; label: string; level: string; scopeType: string }[] = [
  { value: 'REGIONAL_ADMIN', label: 'Regional administrator', level: 'REGION', scopeType: 'REGIONAL' },
  { value: 'ZONAL_ADMIN', label: 'Zonal administrator', level: 'ZONE', scopeType: 'ZONAL' },
  { value: 'WEREDA_ADMIN', label: 'Wereda administrator', level: 'WOREDA', scopeType: 'WOREDA' },
];

const listFrom = <T,>(payload: any): T[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

function StatCard({ label, value, note, icon: Icon, tone = 'green' }: {
  label: string; value: string | number; note: string; icon: React.ElementType; tone?: 'green' | 'blue' | 'amber' | 'violet';
}) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    blue: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</div>
          <div className="mt-2 text-3xl font-bold tracking-tight text-slate-950 dark:text-white">{value}</div>
        </div>
        <div className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{note}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || '').toUpperCase();
  const tone = normalized === 'APPROVED' || normalized === 'ACTIVE'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
    : normalized === 'PENDING'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${tone}`}>{normalized.replace(/_/g, ' ') || 'UNKNOWN'}</span>;
}

export const TopUserAdminDashboard: React.FC = () => {
  const { currentUser, setNotification } = useApp();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [regions, setRegions] = useState<RegionRecord[]>([]);
  const [availableFeatures, setAvailableFeatures] = useState<FeatureKey[]>(FEATURE_OPTIONS.map((item) => item.id));
  const [creatableRoles, setCreatableRoles] = useState<AdminRole[]>(ADMIN_ROLES.map((item) => item.value));
  const [canManageAdminFeatures, setCanManageAdminFeatures] = useState(true);
  const [currentScope, setCurrentScope] = useState('Nationwide');
  const [currentFlag, setCurrentFlag] = useState('');
  const [currentFlagImage, setCurrentFlagImage] = useState('');
  const [canSetLocationFlag, setCanSetLocationFlag] = useState(false);
  const [scopeLocationId, setScopeLocationId] = useState<string | null>(null);
  const [currentScopeLevel, setCurrentScopeLevel] = useState('NATIONWIDE');
  const [unclassified, setUnclassified] = useState<any>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(false);
  const [adminsError, setAdminsError] = useState('');
  const [selectedAdminId, setSelectedAdminId] = useState('');
  const [stagedFeatures, setStagedFeatures] = useState<FeatureKey[]>([]);
  const [featureSaving, setFeatureSaving] = useState(false);
  const [featureMessage, setFeatureMessage] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createRole, setCreateRole] = useState<AdminRole>('REGIONAL_ADMIN');
  const [createLocation, setCreateLocation] = useState<AdministrativeLocation | null>(null);
  const [createFlagFile, setCreateFlagFile] = useState<File | null>(null);
  const [createFlagPath, setCreateFlagPath] = useState('');
  const [createSalary, setCreateSalary] = useState('');
  const [createCommission, setCreateCommission] = useState('');
  const [createName, setCreateName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createFeatures, setCreateFeatures] = useState<FeatureKey[]>(FEATURE_OPTIONS.map((item) => item.id));
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createMessage, setCreateMessage] = useState('');
  const [productLocation, setProductLocation] = useState<AdministrativeLocation | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productStatus, setProductStatus] = useState('ALL');
  const [productPage, setProductPage] = useState(1);
  const [productPages, setProductPages] = useState(1);
  const [productTotal, setProductTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const response = await apiClient.get('/reports/regional-analytics/');
      setRegions(Array.isArray(response.data?.regions) ? response.data.regions : []);
      setUnclassified(response.data?.unclassified || null);
      setGeneratedAt(response.data?.generated_at || '');
    } catch (error) {
      setOverviewError(formatApiError(error, 'National regional overview could not be loaded.'));
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadCreationOptions = useCallback(async () => {
    try {
      const response = await apiClient.get('/superadmin/accounts/creation-options/');
      const data = response.data || {};
      setAvailableFeatures((data.available_dashboard_features || []) as FeatureKey[]);
      const roles = new Set<AdminRole>((data.creatable_roles || []) as AdminRole[]);
      setCreatableRoles(ADMIN_ROLES.filter((role) => roles.has(role.value)).map((role) => role.value));
      setCanManageAdminFeatures(Boolean(data.can_manage_admin_features));
      setCurrentScope(data.current_scope || 'Assigned area');
      setCurrentScopeLevel(data.current_scope_level || 'NATIONWIDE');
      setScopeLocationId(data.scope_location_id || null);
      setCurrentFlag(data.current_flag || '');
      setCurrentFlagImage(data.current_flag_image || '');
      setCanSetLocationFlag(Boolean(data.can_set_location_flag));
    } catch {
      setAvailableFeatures([]);
      setCreatableRoles([]);
      setCanManageAdminFeatures(false);
      setCurrentScope('Assigned area');
      setScopeLocationId(null);
    }
  }, []);

  const loadAdmins = useCallback(async () => {
    setAdminsLoading(true);
    setAdminsError('');
    try {
      const roles = ['REGIONAL_ADMIN', 'ZONAL_ADMIN', 'WEREDA_ADMIN', 'USER_ADMIN'];
      const responses = await Promise.all(roles.map((role) => apiClient.get('/superadmin/accounts/', { params: { role, page_size: 100 } })));
      const merged = responses.flatMap((response) => listFrom<AdminRecord>(response.data));
      const unique = [...new Map(merged.map((row) => [row.id, row])).values()];
      setAdmins(unique);
      setSelectedAdminId((current) => current && unique.some((row) => row.id === current) ? current : unique[0]?.id || '');
    } catch (error) {
      setAdminsError(formatApiError(error, 'Administrative accounts could not be loaded.'));
    } finally {
      setAdminsLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    if (activeTab !== 'products') return;
    setProductsLoading(true);
    setProductsError('');
    try {
      const params: Record<string, string | number> = { page: productPage, page_size: 50 };
      if (productLocation?.id) params.region = productLocation.id;
      if (productSearch.trim()) params.search = productSearch.trim();
      if (productStatus !== 'ALL') params.status = productStatus;
      const response = await apiClient.get('/admin/products/', { params });
      const payload = response.data || {};
      setProducts(Array.isArray(payload.products) ? payload.products : []);
      setProductTotal(Number(payload.summary?.total || 0));
      setProductPages(Number(payload.pagination?.pages || 1));
    } catch (error) {
      setProductsError(formatApiError(error, 'Product listings could not be loaded.'));
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, [activeTab, productLocation, productPage, productSearch, productStatus]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadCreationOptions(); }, [loadCreationOptions]);
  useEffect(() => { if (activeTab === 'administrators') void loadAdmins(); }, [activeTab, loadAdmins]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const totals = useMemo(() => regions.reduce((sum, row) => ({
    users: sum.users + Number(row.total || 0),
    farmers: sum.farmers + Number(row.farmer || 0),
    buyers: sum.buyers + Number(row.wholesaler || 0) + Number(row.retailer || 0),
    staff: sum.staff + Number(row.staff || 0),
    pending: sum.pending + Number(row.pending || 0),
    suspended: sum.suspended + Number(row.suspended || 0),
    drivers: sum.drivers + Number(row.driver || 0),
  }), { users: 0, farmers: 0, buyers: 0, staff: 0, pending: 0, suspended: 0, drivers: 0 }), [regions]);

  const selectedAdmin = admins.find((row) => row.id === selectedAdminId) || null;
  useEffect(() => {
    setCreateFeatures(availableFeatures);
    setCreateRole((current) => creatableRoles.includes(current) ? current : (creatableRoles[0] || 'WEREDA_ADMIN'));
  }, [availableFeatures, creatableRoles]);
  useEffect(() => {
    setStagedFeatures((selectedAdmin?.dashboard_features || FEATURE_OPTIONS.map((item) => item.id)) as FeatureKey[]);
    setFeatureMessage('');
  }, [selectedAdminId, selectedAdmin?.dashboard_features]);

  const saveFeatures = async () => {
    if (!selectedAdmin) return;
    setFeatureSaving(true);
    setFeatureMessage('');
    try {
      const response = await apiClient.patch(`/superadmin/accounts/${selectedAdmin.id}/dashboard-features/`, { features: stagedFeatures });
      setAdmins((current) => current.map((row) => row.id === selectedAdmin.id ? { ...row, dashboard_features: response.data.features } : row));
      setFeatureMessage('Dashboard access saved and enforced by the API.');
    } catch (error) {
      setFeatureMessage(formatApiError(error, 'Dashboard access could not be saved.'));
    } finally {
      setFeatureSaving(false);
    }
  };

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError('');
    setCreateMessage('');
    const roleDefinition = ADMIN_ROLES.find((item) => item.value === createRole)!;
    if (!createName.trim() || !createEmail.trim() || createPassword.length < 8) {
      setCreateError('Enter the administrator’s name, email, and a temporary password of at least 8 characters.');
      return;
    }
    if (!createLocation || createLocation.level !== roleDefinition.level) {
      setCreateError(`Select a ${roleDefinition.level.toLowerCase()} location for this role.`);
      return;
    }
    setCreateBusy(true);
    try {
      await apiClient.post('/superadmin/accounts/', {
        full_name: createName.trim(),
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
        dashboard_features: createFeatures,
        location: createLocation.name,
        scope_level: 'LOCATION',
        scope_location: createLocation.id,
        scope_type: roleDefinition.scopeType,
        ...(createSalary || createCommission
          ? { base_monthly_salary: createSalary || '0', monthly_commission: createCommission || '0' }
          : {}),
      });
      // Flag pictures ride a second call so the JSON payload stays intact:
      // a browsed file goes as multipart, a pasted path/link as JSON.
      if (canSetLocationFlag && createLocation) {
        try {
          if (createFlagFile) {
            const form = new FormData();
            form.append('flag_image', createFlagFile);
            await apiClient.patch(`/superadmin/locations/${createLocation.id}/flag/`, form, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
          } else if (createFlagPath.trim()) {
            const value = createFlagPath.trim();
            const body = value.toLowerCase().startsWith('http') ? { flag_url: value } : { flag_path: value };
            await apiClient.patch(`/superadmin/locations/${createLocation.id}/flag/`, body);
          }
        } catch (flagError) {
          setCreateMessage(`Administrator created, but the flag picture could not be saved: ${formatApiError(flagError, 'upload failed')}`);
        }
      }
      setCreateMessage(`${createRole.replace(/_/g, ' ')} created for ${createLocation.name} with ${createFeatures.length} dashboard feature(s).`);
      setCreateOpen(false);
      setCreateName(''); setCreateEmail(''); setCreatePassword(''); setCreateLocation(null); setCreateFlagFile(null); setCreateFlagPath('');
      setCreateSalary(''); setCreateCommission('');
      await loadAdmins();
      await loadCreationOptions();
    } catch (error) {
      setCreateError(formatApiError(error, 'Administrator account could not be created.'));
    } finally {
      setCreateBusy(false);
    }
  };

  const uploadFlagForLocation = async (locationId: string, file: File) => {
    const form = new FormData();
    form.append('flag_image', file);
    await apiClient.patch(`/superadmin/locations/${locationId}/flag/`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  const uploadFlagForAdmin = async (admin: AdminRecord, file: File) => {
    try {
      if (!admin.location_id) {
        setNotification?.(`${admin.full_name} has no assigned location to flag.`);
        return;
      }
      await uploadFlagForLocation(admin.location_id, file);
      await loadAdmins();
      await loadCreationOptions();
      setNotification?.(`Flag picture updated for ${admin.location_name}.`);
    } catch (error) {
      setNotification?.(formatApiError(error, 'The flag picture could not be uploaded.'));
    }
  };

  const allTabs: { id: TabId; label: string; icon: React.ElementType; feature: FeatureKey }[] = [
    { id: 'overview', label: currentScope === 'Nationwide' ? 'National overview' : 'Area overview', icon: BarChart3, feature: 'regional_reports' },
    { id: 'reports', label: 'Regional reports', icon: Activity, feature: 'regional_reports' },
    { id: 'administrators', label: 'Admin hierarchy', icon: ShieldCheck, feature: 'admin_management' },
    { id: 'products', label: 'Products', icon: Package, feature: 'product_oversight' },
  ];
  const tabs = allTabs.filter((tab) => availableFeatures.includes(tab.feature)).filter((tab) => (
    tab.id !== 'reports' || currentScopeLevel === 'REGION' || currentScopeLevel === 'CITY' || currentScopeLevel === 'NATIONWIDE'
  ));
  useEffect(() => {
    if (tabs.length && !tabs.some((tab) => tab.id === activeTab)) setActiveTab(tabs[0].id);
  }, [availableFeatures, currentScope]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-800 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-10 -top-16 h-64 w-64 rounded-full bg-emerald-400/10 blur-2xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-emerald-100">
              <ShieldCheck className="h-4 w-4" /> {currentScope.toUpperCase()} ADMINISTRATION
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Administrative command center</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-100/85">
              Review users and products within {currentScope}, drill through the location hierarchy, and delegate dashboard capabilities to administrators in your area.
            </p>
            <p className="mt-4 flex items-center gap-2 text-xs text-emerald-100/70">
              <MapPin className="h-3.5 w-3.5" /> Signed in as {currentUser?.name || currentUser?.email || 'Top User Admin'}
              {generatedAt && <>· Data refreshed {new Date(generatedAt).toLocaleString()}</>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {(currentFlagImage || currentFlag) && (
                <span
                  data-testid="region-flag"
                  title="Regional flag — zones and weredas inherit their region's flag; pictures are managed by the Super Admin or Top User Admin"
                  className="inline-flex items-center gap-2.5 rounded-xl border border-white/25 bg-white/10 px-3 py-2 leading-none"
                >
                  {currentFlagImage ? (
                    <img src={currentFlagImage} alt={`${currentScope} flag`} className="h-14 w-[5.5rem] rounded-lg object-cover shadow-md ring-1 ring-white/30" />
                  ) : (
                    <span aria-hidden="true" className="text-3xl leading-none">{currentFlag}</span>
                  )}
                  <span className="text-[11px] font-bold uppercase tracking-wide">{currentScope.split(' (')[0]}</span>
                </span>
              )}
              <button type="button" onClick={() => { void loadOverview(); if (activeTab === 'administrators') void loadAdmins(); }} className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold hover:bg-white/15">
                <RefreshCw className="h-4 w-4" /> Refresh data
              </button>
              {creatableRoles.length > 0 && <button type="button" onClick={() => { setActiveTab('administrators'); setCreateOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-emerald-950 shadow-sm hover:bg-emerald-50">
                <Plus className="h-4 w-4" /> Create administrator
              </button>}
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Top User Admin sections" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined}
            className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${activeTab === id ? 'bg-emerald-700 text-white shadow' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
            <Icon className="h-4 w-4" /> {label}
            {id === 'overview' && regions.length > 0 && <span className={activeTab === id ? 'rounded-full bg-white/20 px-2 py-0.5 text-[10px]' : 'rounded-full bg-slate-100 px-2 py-0.5 text-[10px] dark:bg-slate-700'}>{regions.length}</span>}
          </button>
        ))}
      </nav>

      {overviewError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{overviewError}</div>}
      {createMessage && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{createMessage}</div>}
      {!tabs.length && <section role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><h2 className="font-bold">No dashboard features are assigned</h2><p className="mt-1 text-xs leading-5">A parent administrator must grant reports, user management, product oversight, or another dashboard capability for your geographic scope.</p></section>}

      {activeTab === 'overview' && availableFeatures.includes('regional_reports') && (
        <div className="space-y-6">
          {overviewLoading ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading national reports…</div> : <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={currentScope === 'Nationwide' ? 'Accounts across regions' : `Accounts in ${currentScope}`} value={totals.users.toLocaleString()} note={`${regions.length} location group(s) in this report`} icon={Users} />
              <StatCard label="Producers" value={totals.farmers.toLocaleString()} note="Farmer and cooperative accounts" icon={Package} tone="blue" />
              <StatCard label="Drivers" value={totals.drivers.toLocaleString()} note="Accredited carrier accounts in scope" icon={Truck} tone="amber" />
              <StatCard label="Buyers" value={totals.buyers.toLocaleString()} note="Wholesalers and retailers" icon={ArrowDownRight} tone="violet" />
              <StatCard label="Awaiting review" value={totals.pending.toLocaleString()} note={`${totals.suspended.toLocaleString()} suspended accounts in regional data`} icon={ClipboardCheck} tone="amber" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                  <div><h2 className="text-sm font-bold text-slate-900 dark:text-white">Regional coverage</h2><p className="mt-1 text-xs text-slate-500">Live account counts from the geographic registration hierarchy.</p></div>
                  <button type="button" onClick={() => setActiveTab('reports')} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400">Open reports <ArrowRight className="h-3.5 w-3.5" /></button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70 dark:text-slate-400"><tr><th className="px-5 py-3">Region</th><th className="px-3 py-3 text-right">Accounts</th><th className="px-3 py-3 text-right">Farmers</th><th className="px-3 py-3 text-right">Buyers</th><th className="px-3 py-3 text-right">Drivers</th><th className="px-5 py-3 text-right">Pending</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {regions.map((region) => <tr key={region.location_id} className="hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20">
                        <td className="px-5 py-3 font-semibold text-slate-800 dark:text-slate-100"><MapPin className="mr-2 inline h-3.5 w-3.5 text-emerald-700" />{region.name}</td>
                        <td className="px-3 py-3 text-right font-mono">{region.total.toLocaleString()}</td>
                        <td className="px-3 py-3 text-right font-mono">{region.farmer.toLocaleString()}</td>
                        <td className="px-3 py-3 text-right font-mono">{(region.wholesaler + region.retailer).toLocaleString()}</td>
                        <td className="px-3 py-3 text-right font-mono">{region.driver.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right"><span className={region.pending ? 'rounded-full bg-amber-100 px-2 py-1 font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'font-mono text-slate-500'}>{region.pending.toLocaleString()}</span></td>
                      </tr>)}
                      {!regions.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">No regional activity was returned by the reports API.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {unclassified?.total > 0 && <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">{unclassified.total} account(s) have no regional registration location assigned.</div>}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold text-slate-900 dark:text-white">Administration health</h2><p className="mt-1 text-xs text-slate-500">Scope-level review and account status.</p></div><ShieldCheck className="h-5 w-5 text-emerald-700" /></div>
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-slate-800"><span className="text-xs text-slate-600 dark:text-slate-300">Regional administrators</span><strong className="font-mono text-sm">{regions.reduce((sum, row) => sum + Number(row.staff || 0), 0)}</strong></div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-slate-800"><span className="text-xs text-slate-600 dark:text-slate-300">Suspended accounts</span><strong className="font-mono text-sm">{totals.suspended}</strong></div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3 dark:bg-slate-800"><span className="text-xs text-slate-600 dark:text-slate-300">Unassigned accounts</span><strong className="font-mono text-sm">{Number(unclassified?.total || 0)}</strong></div>
                </div>
                <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                  <p className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200"><Flag className="h-4 w-4" /> Capability flags are API-enforced</p>
                  <p className="mt-1 text-[11px] leading-5 text-emerald-800/80 dark:text-emerald-300/80">Assign report, user, review, product, and audit access per administrator. Geographic scope limits every record they can reach.</p>
                </div>
                <button type="button" onClick={() => setActiveTab('administrators')} className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-400">Manage regional teams <ArrowRight className="h-3.5 w-3.5" /></button>
              </section>
            </div>
          </>}
        </div>
      )}

      {activeTab === 'reports' && availableFeatures.includes('regional_reports') && <RegionalFinancialReportsView />}

      {activeTab === 'administrators' && canManageAdminFeatures && (
        <div className="space-y-5">
          <section className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center">
            <div><h2 className="text-base font-bold text-slate-900 dark:text-white">Administration inside {currentScope}</h2><p className="mt-1 text-xs text-slate-500">Create only the child admin levels permitted for your scope. Their data access stops at their assigned location and descendants.</p></div>
            {creatableRoles.length > 0 && <button type="button" onClick={() => setCreateOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800"><Plus className="h-4 w-4" /> Create scoped admin</button>}
          </section>
          {adminsError && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{adminsError}</div>}
          {createMessage && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{createMessage}</div>}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800"><div><h3 className="text-sm font-bold">Assigned administrators</h3><p className="mt-1 text-xs text-slate-500">Select an administrator to configure dashboard capabilities.</p></div><button type="button" onClick={() => void loadAdmins()} aria-label="Refresh administrators" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><RefreshCw className={`h-4 w-4 ${adminsLoading ? 'animate-spin' : ''}`} /></button></div>
              {adminsLoading ? <div className="p-10 text-center text-sm text-slate-500">Loading scoped administrators…</div> : <div className="overflow-x-auto"><table className="w-full min-w-[590px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70"><tr><th className="px-4 py-3">Administrator</th><th className="px-3 py-3">Role</th><th className="px-3 py-3">Assigned location</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{admins.map((admin) => <tr key={admin.id} onClick={() => setSelectedAdminId(admin.id)} className={`cursor-pointer ${selectedAdminId === admin.id ? 'bg-emerald-50 dark:bg-emerald-950/25' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}><td className="px-4 py-3"><div className="flex items-center gap-2">{admin.location_flag_image && <img src={admin.location_flag_image} alt="" className="h-5 w-7 rounded-md object-cover shadow-sm" aria-hidden="true" />}<div><div className="font-semibold">{admin.full_name}</div><div className="mt-0.5 text-[11px] text-slate-500">{admin.email}</div></div></div></td><td className="px-3 py-3">{admin.role_display || admin.role.replace(/_/g, ' ')}</td><td className="px-3 py-3">{admin.location_name || 'Unassigned'}{canSetLocationFlag && (admin.location_level === 'REGION' || admin.location_level === 'CITY') && <label className="ml-2 inline-flex cursor-pointer items-center rounded-md border border-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-500 hover:border-emerald-300 hover:text-emerald-700 dark:border-slate-700 dark:text-slate-400" onClick={(event) => event.stopPropagation()}><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file && admin.location_name) void uploadFlagForAdmin(admin, file); event.target.value = ''; }} />Set flag</label>}</td><td className="px-4 py-3"><StatusBadge status={admin.status} /></td></tr>)}{!admins.length && <tr><td colSpan={4} className="p-8 text-center text-slate-500">No scoped administrators are assigned yet.</td></tr>}</tbody></table></div>}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start gap-3"><div className="rounded-xl bg-violet-100 p-2 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"><Flag className="h-4 w-4" /></div><div><h3 className="text-sm font-bold">Dashboard capability flags</h3><p className="mt-1 text-xs text-slate-500">{selectedAdmin ? `${selectedAdmin.full_name} · ${selectedAdmin.location_name || 'No location'}` : 'Choose an administrator from the list.'}</p></div></div>
              <div className="mt-5 space-y-2.5">{FEATURE_OPTIONS.map((feature) => { const enabled = stagedFeatures.includes(feature.id); return <label key={feature.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${enabled ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700'}`}><input type="checkbox" checked={enabled} disabled={!selectedAdmin || featureSaving} onChange={(event) => setStagedFeatures((current) => event.target.checked ? [...current, feature.id] : current.filter((item) => item !== feature.id))} className="mt-0.5 h-4 w-4 accent-emerald-700" /><span className="min-w-0"><span className="block text-xs font-bold">{feature.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{feature.detail}</span></span></label>; })}</div>
              {featureMessage && <p role="status" className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">{featureMessage}</p>}
              <button type="button" onClick={() => void saveFeatures()} disabled={!selectedAdmin || featureSaving} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{featureSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save access flags</button>
              <p className="mt-2 text-[10px] leading-4 text-slate-500">Changes are audited. Disabled capabilities return HTTP 403 from their protected API endpoints.</p>
            </section>
          </div>
        </div>
      )}

      {activeTab === 'products' && availableFeatures.includes('product_oversight') && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-4 border-b border-slate-100 p-5 dark:border-slate-800 lg:flex-row lg:items-end lg:justify-between">
            <div><h2 className="text-base font-bold">Products across the administrative hierarchy</h2><p className="mt-1 max-w-2xl text-xs text-slate-500">Inspect listings nationwide or select a region, zone, or wereda. Location filters include every descendant area.</p></div>
            <div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><input value={productSearch} onChange={(event) => { setProductPage(1); setProductSearch(event.target.value); }} placeholder="Search products or sellers" className="w-56 rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs dark:border-slate-700 dark:bg-slate-900" /></div><select value={productStatus} onChange={(event) => { setProductPage(1); setProductStatus(event.target.value); }} aria-label="Filter product status" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="SOLD">Sold</option><option value="DRAFT">Draft</option><option value="DELETED">Deleted</option></select></div>
          </div>
          <div className="grid gap-5 border-b border-slate-100 p-5 dark:border-slate-800 lg:grid-cols-[minmax(0,1fr)_auto]"><LocationPicker value={productLocation?.id || null} onChange={setProductLocation} startParentId={scopeLocationId} scopeLabel={scopeLocationId ? currentScope : ''} allowClear label="Filter by geographic scope" /><div className="flex items-end text-xs text-slate-500"><strong className="mr-1 text-slate-900 dark:text-slate-100">{productTotal.toLocaleString()}</strong> matching listings</div></div>
          {productsError && <div role="alert" className="m-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{productsError}</div>}
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70"><tr><th className="px-5 py-3">Listing</th><th className="px-3 py-3">Seller</th><th className="px-3 py-3">Category</th><th className="px-3 py-3 text-right">Available</th><th className="px-3 py-3 text-right">Price / unit</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{productsLoading ? <tr><td colSpan={6} className="p-10 text-center text-slate-500">Loading product listings…</td></tr> : products.map((product) => <tr key={product.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40"><td className="px-5 py-3"><div className="font-semibold text-slate-900 dark:text-white">{product.title}</div><div className="mt-0.5 text-[10px] text-slate-500">{product.id}</div></td><td className="px-3 py-3">{product.seller}<div className="text-[10px] text-slate-500">{product.seller_role.replace(/_/g, ' ')}</div></td><td className="px-3 py-3">{product.category || '—'}</td><td className="px-3 py-3 text-right font-mono">{Number(product.quantity).toLocaleString()} {product.unit}</td><td className="px-3 py-3 text-right font-mono">{Number(product.price_per_unit).toLocaleString()} ETB</td><td className="px-5 py-3"><StatusBadge status={product.status} /></td></tr>)}{!productsLoading && products.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-500">No listings match this location and filter.</td></tr>}</tbody></table></div>
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 dark:border-slate-800"><span className="text-xs text-slate-500">Page {productPage} of {productPages} · 50 listings per page</span><div className="flex gap-2"><button type="button" disabled={productPage <= 1 || productsLoading} onClick={() => setProductPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-slate-700">Previous</button><button type="button" disabled={productPage >= productPages || productsLoading} onClick={() => setProductPage((page) => Math.min(productPages, page + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold disabled:opacity-40 dark:border-slate-700">Next</button></div></div>
        </section>
      )}

      {createOpen && <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}>
        <form onSubmit={createAdmin} className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800"><div><h2 className="text-base font-bold">Create a geographic administrator</h2><p className="mt-1 text-xs text-slate-500">The account is approved and scoped to the selected region, zone, or wereda.</p></div><button type="button" onClick={() => setCreateOpen(false)} aria-label="Close" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button></div>
          <div className="space-y-4 p-5">
            <label className="block text-xs font-semibold">Administrator level<select value={createRole} onChange={(event) => { setCreateRole(event.target.value as AdminRole); setCreateLocation(null); }} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">{ADMIN_ROLES.filter((role) => creatableRoles.includes(role.value)).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold">Full name<input value={createName} onChange={(event) => setCreateName(event.target.value)} autoComplete="name" required className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label><label className="block text-xs font-semibold">Work email<input type="email" value={createEmail} onChange={(event) => setCreateEmail(event.target.value)} autoComplete="email" required className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label></div>
            <label className="block text-xs font-semibold">Temporary password<input type="password" value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} autoComplete="new-password" minLength={8} required className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /><span className="mt-1 block text-[10px] font-normal text-slate-500">Set a unique temporary password; the new administrator should change it after signing in.</span></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold">Monthly base salary (ETB)<input type="number" min="0" step="0.01" value={createSalary} onChange={(event) => setCreateSalary(event.target.value)} placeholder="e.g. 12000" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /><span className="mt-1 block text-[10px] font-normal text-slate-500">Enters the Financial Manager's payroll as a monthly salary invoice paid into their wallet.</span></label>
              <label className="block text-xs font-semibold">Monthly commission (ETB)<input type="number" min="0" step="0.01" value={createCommission} onChange={(event) => setCreateCommission(event.target.value)} placeholder="0 if none" className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" /></label>
            </div>
            <LocationPicker value={createLocation?.id || null} onChange={setCreateLocation} startParentId={scopeLocationId} scopeLabel={scopeLocationId ? currentScope : ''} label="Assigned administrative location" />
            {createLocation && canSetLocationFlag && (createLocation.level === 'REGION' || createLocation.level === 'CITY') && (
              <div>
                <label className="block text-xs font-semibold">Regional flag picture for {createLocation.name}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={(event) => { setCreateFlagFile(event.target.files?.[0] || null); setCreateFlagPath(''); }}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <input
                  value={createFlagPath}
                  onChange={(event) => { setCreateFlagPath(event.target.value); if (event.target.value) setCreateFlagFile(null); }}
                  placeholder="…or paste a file path (C:\Users\…\flag.png) or an image link"
                  aria-label="Flag picture file path or image link"
                  className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                />
                <span className="mt-1 block text-[10px] text-slate-500">PNG, JPEG, WebP or SVG up to 2 MB. The path can point at a file you just downloaded — zones and weredas inherit their region's flag.</span>
              </div>
            )}
            {createLocation && (createLocation.level === 'ZONE' || createLocation.level === 'WOREDA') && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                No flag needed here — this administrator automatically displays the flag of their region.
              </p>
            )}
            <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="mb-3"><h3 className="text-xs font-bold">Dashboard flags for this administrator</h3><p className="mt-1 text-[10px] text-slate-500">Select their reports, user approvals, product access, and ability to delegate child administrators. Flags are enforced by the API within this location scope.</p></div><div className="grid gap-2 sm:grid-cols-2">{FEATURE_OPTIONS.filter((feature) => availableFeatures.includes(feature.id)).map((feature) => <label key={feature.id} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800"><input type="checkbox" checked={createFeatures.includes(feature.id)} onChange={(event) => setCreateFeatures((current) => event.target.checked ? [...current, feature.id] : current.filter((item) => item !== feature.id))} className="mt-0.5 accent-emerald-700" /><span><strong className="block">{feature.label}</strong><span className="text-[10px] text-slate-500">{feature.detail}</span></span></label>)}</div></section>
            {createLocation && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">Selected: <strong>{createLocation.name}</strong> · {createLocation.level}. The backend validates the role and location level.</p>}
            {createError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{createError}</p>}
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row"><button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold dark:border-slate-700">Cancel</button><button type="submit" disabled={createBusy} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{createBusy && <LoaderCircle className="h-4 w-4 animate-spin" />} Create administrator</button></div>
        </form>
      </div>}
    </div>
  );
};
