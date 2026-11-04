import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useModalA11y } from '../../hooks/useModalA11y';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { LocationPicker, AdministrativeLocation } from '../staff/LocationPicker';
import {
  AlertCircle,
  BadgeCheck,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldOff,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

interface StaffAccount {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  location: string;
  role: 'USER_ADMIN' | 'FINANCIAL_MANAGER';
  role_display: string;
  status: string;
  is_staff: boolean;
  created_at: string;
  last_login: string | null;
  scope_label: string;
  location_name: string;
}

interface CreationOptions {
  scope_types: string[];
  can_create_top_level: boolean;
  can_create_financial_manager: boolean;
  scope_location_id: string | null;
  current_scope: string;
}

const STATUS_FILTERS = ['ALL', 'APPROVED', 'PENDING', 'SUSPENDED', 'REJECTED', 'DEACTIVATED'];

const SCOPED_FILTER_OPTIONS = [
  { value: 'TOP_LEVEL', label: 'Top-level (nationwide)' },
  { value: 'REGIONAL', label: 'Regional' },
  { value: 'CITY', label: 'City administration' },
  { value: 'ZONAL', label: 'Zonal' },
  { value: 'WOREDA', label: 'Woreda' },
  { value: 'SUBCITY', label: 'Sub-city' },
  { value: 'DISTRICT', label: 'District' },
  { value: 'ADMIN_DIVISION', label: 'Administrative division' },
  { value: 'FINANCIAL_MANAGER', label: 'Financial manager' },
];

const statusStyle = (status: string) => {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
    case 'PENDING':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
    case 'SUSPENDED':
    case 'DEACTIVATED':
      return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
    case 'REJECTED':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  }
};

const prettyStatus = (status: string) =>
  status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
};

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

/**
 * Hierarchical staff management.
 *
 * Everything — the manageable account set, the creatable roles, the assignable
 * geographic scopes and the aggregate numbers — is produced by the backend
 * (`/api/v1/superadmin/accounts/…`, gated by `manageable_admins_for` and
 * `can_assign_admin_scope`). The screen adapts to the signed-in administrator
 * instead of hardcoding one dashboard's capability set.
 */
export const StaffManagementView: React.FC = () => {
  const { setNotification, currentUser } = useApp();

  const [options, setOptions] = useState<CreationOptions | null>(null);
  const [optionsError, setOptionsError] = useState('');
  const [rows, setRows] = useState<StaffAccount[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [scopeFilter, setScopeFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState<AdministrativeLocation | null>(null);

  const [stats, setStats] = useState({ total: 0, active: 0, suspended: 0, pending: 0 });
  const [roleCounts, setRoleCounts] = useState({ userAdmin: 0, financialManager: 0 });

  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<StaffAccount | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');

  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(count / pageSize));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadOptions = useCallback(async () => {
    try {
      const response = await api.superadmin.creationOptions();
      setOptions(response?.data as CreationOptions);
      setOptionsError('');
    } catch (err: any) {
      setOptions(null);
      setOptionsError(formatApiError(err, 'Unable to load your staff-management permissions.'));
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await api.superadmin.accounts({
        page,
        search: debouncedSearch || undefined,
        role: roleFilter || undefined,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        scope_type: scopeFilter || undefined,
        location_id: locationFilter?.id || undefined,
      });
      setRows(Array.isArray(response?.data?.results) ? response.data.results : []);
      setCount(Number(response?.data?.count || 0));
    } catch (err: any) {
      setRows([]);
      setCount(0);
      setListError(formatApiError(err, 'Unable to load staff accounts.'));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, roleFilter, statusFilter, scopeFilter, locationFilter?.id]);

  const loadStats = useCallback(async () => {
    const countFor = async (params: Record<string, unknown>) => {
      try {
        const response = await api.superadmin.accounts({ page: 1, ...params });
        return Number(response?.data?.count || 0);
      } catch {
        return 0;
      }
    };
    const [total, active, suspended, pending, userAdmins, financialManagers] = await Promise.all([
      countFor({ status: 'ALL' }),
      countFor({ status: 'APPROVED' }),
      countFor({ status: 'SUSPENDED' }),
      countFor({ status: 'PENDING' }),
      countFor({ status: 'ALL', role: 'USER_ADMIN' }),
      countFor({ status: 'ALL', role: 'FINANCIAL_MANAGER' }),
    ]);
    setStats({ total, active, suspended, pending });
    setRoleCounts({ userAdmin: userAdmins, financialManager: financialManagers });
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadRows();
  }, [loadRows, refreshKey]);

  useEffect(() => {
    void loadStats();
  }, [loadStats, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter, statusFilter, scopeFilter, locationFilter?.id]);

  const refreshAll = () => {
    setRefreshKey((value) => value + 1);
  };

  const statusAction = async (account: StaffAccount) => {
    const nextStatus = account.status === 'APPROVED' ? 'SUSPENDED' : 'APPROVED';
    setBusyId(account.id);
    setActionError('');
    try {
      await api.superadmin.updateAccount(account.id, { status: nextStatus });
      setNotification(
        `${account.full_name} ${nextStatus === 'APPROVED' ? 'activated' : 'suspended'} successfully.`
      );
      setDetail((current) =>
        current && current.id === account.id ? { ...current, status: nextStatus } : current
      );
      refreshAll();
    } catch (err: any) {
      setActionError(formatApiError(err, 'The account status could not be changed.'));
    } finally {
      setBusyId('');
    }
  };

  const canCreate =
    !!options && (options.can_create_top_level || (options.scope_types || []).length > 0);

  const scopeFilterOptions = useMemo(
    () =>
      SCOPED_FILTER_OPTIONS.filter(
        (option) =>
          !options ||
          option.value === 'FINANCIAL_MANAGER' ||
          option.value === 'TOP_LEVEL' ||
          (options.scope_types || []).includes(option.value)
      ),
    [options]
  );

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <UserCog className="w-3.5 h-3.5" />
            Administrative users
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Staff Management
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Create and manage the administrative accounts permitted by your role and geographic scope.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-[#15803D] dark:text-emerald-400" />
            {options?.current_scope || currentUser?.region || 'Scope from your account'}
          </span>
          <button
            type="button"
            onClick={() => {
              setActionError('');
              setCreateOpen(true);
            }}
            disabled={!canCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#15803D] text-white text-xs font-semibold hover:bg-[#166534] disabled:opacity-50 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Create staff member
          </button>
        </div>
      </div>

      {optionsError && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{optionsError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Staff in your scope', value: stats.total, icon: Users, tone: 'text-slate-900 dark:text-slate-100' },
          { label: 'Active', value: stats.active, icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Suspended', value: stats.suspended, icon: ShieldOff, tone: 'text-red-600 dark:text-red-400' },
          { label: 'Pending', value: stats.pending, icon: AlertCircle, tone: 'text-amber-600 dark:text-amber-400' },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5"
            >
              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>{card.label}</span>
                <Icon className="w-4 h-4" />
              </div>
              <div className={`text-xl font-bold font-mono mt-1.5 ${card.tone}`}>{card.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Briefcase className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
            Administrative (User Admin) accounts
          </div>
          <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
            {roleCounts.userAdmin}
          </span>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <BadgeCheck className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
            Financial Managers
          </div>
          <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
            {roleCounts.financialManager}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-2.5" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, email or phone"
                aria-label="Search staff"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                aria-label="Filter by role"
                className="px-2 py-1.5 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="">All roles</option>
                <option value="USER_ADMIN">User Admin</option>
                <option value="FINANCIAL_MANAGER">Financial Manager</option>
              </select>
              <select
                value={scopeFilter}
                onChange={(event) => setScopeFilter(event.target.value)}
                aria-label="Filter by administrator level"
                className="px-2 py-1.5 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="">All levels</option>
                {scopeFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                aria-label="Filter by account status"
                className="px-2 py-1.5 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {STATUS_FILTERS.map((status) => (
                  <option key={status} value={status}>
                    {status === 'ALL' ? 'All statuses' : prettyStatus(status)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <LocationPicker
            value={locationFilter?.id || null}
            onChange={setLocationFilter}
            label="Filter by geographic scope"
            allowClear
            startParentId={options?.scope_location_id || null}
          />
        </div>

        {actionError && (
          <div className="px-3.5 py-2 text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b border-red-100 dark:border-red-900">
            {actionError}
          </div>
        )}
        {listError && (
          <div className="px-3.5 py-2 text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-b border-red-100 dark:border-red-900">
            {listError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th scope="col" className="px-3 py-2 font-semibold">Staff member</th>
                <th scope="col" className="px-3 py-2 font-semibold">Role</th>
                <th scope="col" className="px-3 py-2 font-semibold">Geographic scope</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 font-semibold">Created</th>
                <th scope="col" className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
                    Loading staff accounts…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center">
                    <Users className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto" />
                    <p className="mt-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                      No staff accounts match these filters
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {canCreate
                        ? 'Create a staff member or adjust the filters.'
                        : 'Your role does not manage staff accounts in this scope.'}
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((account) => (
                  <tr
                    key={account.id}
                    className="border-b border-slate-100 dark:border-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-full bg-[#15803D]/10 text-[#15803D] dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {initials(account.full_name)}
                        </span>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {account.full_name}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {account.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {account.role_display}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {account.scope_label || account.role_display}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {account.location_name || account.location || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusStyle(account.status)}`}
                      >
                        {prettyStatus(account.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {formatDate(account.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setDetail(account);
                            setMode('view');
                            setActionError('');
                          }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-[#15803D] hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="View details"
                          aria-label={`View ${account.full_name}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDetail(account);
                            setMode('edit');
                            setActionError('');
                          }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-[#15803D] hover:bg-slate-100 dark:hover:bg-slate-800"
                          title="Edit staff member"
                          aria-label={`Edit ${account.full_name}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void statusAction(account)}
                          disabled={busyId === account.id}
                          className={`p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 ${
                            account.status === 'APPROVED'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                          title={account.status === 'APPROVED' ? 'Suspend account' : 'Activate account'}
                          aria-label={
                            account.status === 'APPROVED'
                              ? `Suspend ${account.full_name}`
                              : `Activate ${account.full_name}`
                          }
                        >
                          {busyId === account.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : account.status === 'APPROVED' ? (
                            <ShieldOff className="w-3.5 h-3.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800">
          <span>
            {count} account{count === 1 ? '' : 's'} · page {page} of {pages}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pages, value + 1))}
              disabled={page >= pages || loading}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {createOpen && options && (
        <CreateStaffModal
          options={options}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refreshAll();
            void loadOptions();
          }}
          onNotify={setNotification}
        />
      )}

      {detail && (
        <StaffDetailModal
          account={detail}
          mode={mode}
          setMode={setMode}
          options={options}
          onClose={() => setDetail(null)}
          onChanged={(updated) => {
            setDetail(updated);
            refreshAll();
          }}
          onNotify={setNotification}
          actionError={actionError}
          setActionError={setActionError}
          busyId={busyId}
          statusAction={statusAction}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------- */
/* Create                                                                     */
/* ------------------------------------------------------------------------- */

const CreateStaffModal: React.FC<{
  options: CreationOptions;
  onClose: () => void;
  onCreated: () => void;
  onNotify: (message: string | null) => void;
}> = ({ options, onClose, onCreated, onNotify }) => {
  const panelRef = useModalA11y<HTMLFormElement>(onClose);
  const scoped = Boolean(options.scope_location_id);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'USER_ADMIN' | 'FINANCIAL_MANAGER'>('USER_ADMIN');
  const [globalScope, setGlobalScope] = useState(false);
  const [location, setLocation] = useState<AdministrativeLocation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canPickGlobal = options.can_create_top_level && !scoped;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!fullName.trim() || !email.trim() || !password) {
      setError('Full name, email and a password of at least 8 characters are required.');
      return;
    }
    if (password.length < 8) {
      setError('The temporary password must be at least 8 characters.');
      return;
    }
    if (role === 'USER_ADMIN' && !globalScope && !location) {
      setError('Choose the administrative location this account will manage.');
      return;
    }

    setSaving(true);
    try {
      await api.superadmin.createAccount({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        role,
        location: location?.name || '',
        ...(role === 'USER_ADMIN'
          ? globalScope
            ? { scope_level: 'GLOBAL' }
            : { scope_level: 'LOCATION', scope_location: location?.id }
          : {}),
      });
      onNotify(`${fullName.trim()} was created successfully.`);
      onCreated();
    } catch (err: any) {
      setError(formatApiError(err, 'The staff account could not be created.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form
        ref={panelRef}
        onSubmit={submit}
        className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl my-4"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Create staff member</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Roles and geographic scopes are limited to what your account may assign.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name">
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                required
                className={inputClass}
                placeholder="e.g. Selam Tadesse"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className={inputClass}
                placeholder="name@greenpath.et"
              />
            </Field>
            <Field label="Phone number">
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={inputClass}
                placeholder="+2519…"
              />
            </Field>
            <Field label="Temporary password">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                className={inputClass}
                placeholder="At least 8 characters"
              />
            </Field>
          </div>

          <Field label="Staff role">
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as 'USER_ADMIN' | 'FINANCIAL_MANAGER')}
              className={inputClass}
            >
              <option value="USER_ADMIN">Administrative user (User Admin)</option>
              {options.can_create_financial_manager && (
                <option value="FINANCIAL_MANAGER">Financial Manager</option>
              )}
            </select>
          </Field>

          {role === 'USER_ADMIN' ? (
            <div className="space-y-2">
              {canPickGlobal && (
                <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={globalScope}
                    onChange={(event) => setGlobalScope(event.target.checked)}
                    className="accent-[#15803D]"
                  />
                  Top-level administrator with nationwide scope
                </label>
              )}
              {!globalScope && (
                <LocationPicker
                  value={location?.id || null}
                  onChange={(selected) => setLocation(selected)}
                  startParentId={options.scope_location_id}
                  scopeLabel={options.scope_location_id ? options.current_scope : ''}
                  label="Geographic scope (region → zone → wereda)"
                />
              )}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
              Financial Managers keep finance-only responsibilities and are not assigned an administrative
              geographic scope.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold hover:bg-[#166534] disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create account
          </button>
        </div>
      </form>
    </div>
  );
};

/* ------------------------------------------------------------------------- */
/* Detail / edit                                                              */
/* ------------------------------------------------------------------------- */

const StaffDetailModal: React.FC<{
  account: StaffAccount;
  mode: 'view' | 'edit';
  setMode: (mode: 'view' | 'edit') => void;
  options: CreationOptions | null;
  onClose: () => void;
  onChanged: (account: StaffAccount) => void;
  onNotify: (message: string | null) => void;
  actionError: string;
  setActionError: (message: string) => void;
  busyId: string;
  statusAction: (account: StaffAccount) => Promise<void>;
}> = ({
  account,
  mode,
  setMode,
  options,
  onClose,
  onChanged,
  onNotify,
  actionError,
  setActionError,
  busyId,
  statusAction,
}) => {
  const detailRef = useModalA11y<HTMLDivElement>(onClose);
  const [fullName, setFullName] = useState(account.full_name);
  const [phone, setPhone] = useState(account.phone || '');
  const [locationText, setLocationText] = useState(account.location || '');
  const [scopeLocation, setScopeLocation] = useState<AdministrativeLocation | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password && password.length < 8) {
      setError('A new password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        full_name: fullName.trim(),
        phone: phone.trim(),
        location: locationText.trim(),
      };
      if (password) payload.password = password;
      if (account.role === 'USER_ADMIN' && scopeLocation) {
        payload.scope_level = 'LOCATION';
        payload.scope_location = scopeLocation.id;
      }
      const response = await api.superadmin.updateAccount(account.id, payload);
      onNotify(`${fullName.trim() || account.full_name} was updated.`);
      setPassword('');
      setScopeLocation(null);
      onChanged((response?.data as StaffAccount) || account);
      setMode('view');
    } catch (err: any) {
      setError(formatApiError(err, 'The staff account could not be updated.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div ref={detailRef} tabIndex={-1} className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl my-4">
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-[#15803D] text-white text-[11px] font-bold flex items-center justify-center">
              {initials(account.full_name)}
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{account.full_name}</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {account.role_display} · {account.scope_label || 'No administrative scope'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
              className="p-1.5 rounded-md text-slate-500 hover:text-[#15803D] hover:bg-slate-100 dark:hover:bg-slate-800"
              title={mode === 'edit' ? 'View details' : 'Edit details'}
              aria-label={mode === 'edit' ? 'View details' : 'Edit details'}
            >
              {mode === 'edit' ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(error || actionError) && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
            {error || actionError}
          </div>
        )}

        {mode === 'view' ? (
          <div className="p-4 space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Detail icon={Mail} label="Email" value={account.email} />
              <Detail icon={Phone} label="Phone" value={account.phone || '—'} />
              <Detail icon={Briefcase} label="Role" value={account.role_display} />
              <Detail
                icon={MapPin}
                label="Geographic scope"
                value={`${account.scope_label || '—'}${account.location_name ? ` · ${account.location_name}` : ''}`}
              />
              <Detail icon={CalendarDays} label="Created" value={formatDate(account.created_at)} />
              <Detail icon={CalendarDays} label="Last sign-in" value={formatDate(account.last_login)} />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Account status</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusStyle(account.status)}`}>
                {prettyStatus(account.status)}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
              Passwords and authentication tokens are never exposed by the API.
            </p>
          </div>
        ) : (
          <form onSubmit={save} className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full name">
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Phone number">
                <input value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Location label">
                <input
                  value={locationText}
                  onChange={(event) => setLocationText(event.target.value)}
                  className={inputClass}
                  placeholder="Town / city shown on the profile"
                />
              </Field>
              <Field label="Reset password (optional)">
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                  placeholder="Leave blank to keep current"
                />
              </Field>
            </div>

            {account.role === 'USER_ADMIN' && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
                <LocationPicker
                  value={scopeLocation?.id || null}
                  onChange={setScopeLocation}
                  startParentId={options?.scope_location_id || null}
                  scopeLabel={options?.scope_location_id ? options.current_scope : ''}
                  label="Change administrative scope (leave untouched to keep it)"
                />
                {scopeLocation && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-400">
                    Saving will move this administrator's scope to {scopeLocation.name}.
                  </p>
                )}
              </div>
            )}
          </form>
        )}

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => void statusAction(account)}
            disabled={busyId === account.id}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${
              account.status === 'APPROVED'
                ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
            }`}
          >
            {busyId === account.id ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : account.status === 'APPROVED' ? (
              <ShieldOff className="w-3.5 h-3.5" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            {account.status === 'APPROVED' ? 'Suspend account' : 'Activate account'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Close
            </button>
            {mode === 'edit' && (
              <button
                type="submit"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-semibold hover:bg-[#166534] disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const inputClass =
  'w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#15803D]';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
    {children}
  </label>
);

const Detail: React.FC<{ icon: React.ElementType; label: string; value: string }> = ({
  icon: Icon,
  label,
  value,
}) => (
  <div className="flex items-start gap-2">
    <Icon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 mt-0.5 shrink-0" />
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-[11px] font-medium text-slate-800 dark:text-slate-200 break-words">{value}</div>
    </div>
  </div>
);

export default StaffManagementView;
