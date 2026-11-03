/**
 * Part 22 — Super Admin account & emergency system controls.
 *
 * Bulk account actions (activate / deactivate / suspend / reinstate) with a
 * mandatory reason, and the platform emergency switches. Every action is
 * enforced and audited server-side; this screen only drives the APIs.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Search, PowerCircle } from 'lucide-react';
import { api, apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  SUSPENDED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  DEACTIVATED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  REJECTED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
}

export const AccountControlPanel: React.FC = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  const loadUsers = useCallback(async () => {
    setError('');
    try {
      const params: Record<string, unknown> = { page_size: 200 };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      const res = await api.admin.users(params);
      const rows = res.data?.results ?? res.data ?? [];
      setUsers(
        (Array.isArray(rows) ? rows : []).map((u: any) => ({
          id: String(u.id ?? u.pk),
          full_name: u.full_name ?? u.name ?? '',
          email: u.email ?? '',
          role: u.role ?? '',
          status: u.status ?? '',
        })),
      );
    } catch (err) {
      setError(formatApiError(err, 'User list could not be loaded.'));
    }
  }, [search, roleFilter]);

  const loadFlags = useCallback(async () => {
    try {
      const res = await api.superadmin.settings();
      setFlags({
        registration_open: !!res.data?.registration_open,
        orders_disabled: !!res.data?.orders_disabled,
        discount_campaigns_disabled: !!res.data?.discount_campaigns_disabled,
        maintenance_mode: !!res.data?.maintenance_mode,
      });
    } catch {
      /* toggles stay hidden on failure; the list still works */
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);
  useEffect(() => { void loadFlags(); }, [loadFlags]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const applyAction = async (action: string) => {
    if (selected.length === 0) { setError('Select at least one account.'); return; }
    if (!reason.trim()) { setError('A reason is required for every account action.'); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = (
        await apiClient.post('/superadmin/accounts/bulk-status/', {
          user_ids: selected, action, reason: reason.trim(),
        })
      ).data;
      setNotice(
        `${res.processed.length} account(s) ${action}d` +
        (res.skipped.length ? `; ${res.skipped.length} skipped (${res.skipped[0].reason})` : '') +
        '. Every change is recorded in the audit trail.',
      );
      setSelected([]);
      setReason('');
      await loadUsers();
    } catch (err) {
      setError(formatApiError(err, 'The account action failed.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleFlag = async (field: string, value: boolean) => {
    setBusy(true);
    try {
      await api.superadmin.updateSettings({ [field]: value, reason: 'Super Admin emergency control panel' });
      setFlags((f) => ({ ...f, [field]: value }));
      setNotice(`Platform switch updated: ${field} = ${value}.`);
    } catch (err) {
      setError(formatApiError(err, 'Could not update the platform switch.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4" />
          <span>Platform governance</span>
        </div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
          Account &amp; Emergency System Controls
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Every account action requires a reason and is written to the immutable audit trail.
          The last active Super Admin account can never be disabled here.
        </p>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}

      {/* Emergency switches */}
      {Object.keys(flags).length > 0 && (
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-1.5">
            <PowerCircle className="w-3.5 h-3.5 text-rose-600" /> Platform switches (server-enforced)
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {[
              ['registration_open', 'New registrations open', 'When off, public sign-ups are rejected'],
              ['orders_disabled', 'Order creation disabled', 'Emergency stop on new marketplace orders'],
              ['discount_campaigns_disabled', 'Discount campaigns paused', 'All coupons stop applying immediately'],
              ['maintenance_mode', 'Maintenance mode', 'Platform-wide maintenance banner'],
            ].map(([field, label, hint]) => (
              <label key={field} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100 block">{label}</span>
                  <span className="text-[11px] text-slate-500">{hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={!!flags[field]}
                  onChange={(e) => void toggleFlag(field, e.target.checked)}
                  disabled={busy}
                  className="mt-1"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Account bulk control */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5"
          >
            <option value="">All roles</option>
            {['FARMER', 'WHOLESALER', 'RETAILER', 'DRIVER', 'USER_ADMIN', 'FINANCIAL_MANAGER', 'SUPER_ADMIN', 'CUSTOMER_SUPPORT'].map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
              <tr className="text-left text-slate-500">
                <th className="py-2 px-3"></th>
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Email</th>
                <th className="py-2 px-3">Role</th>
                <th className="py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="py-1.5 px-3">
                    <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                  </td>
                  <td className="py-1.5 px-3 font-semibold text-slate-800 dark:text-slate-100">{u.full_name}</td>
                  <td className="py-1.5 px-3 text-slate-500">{u.email}</td>
                  <td className="py-1.5 px-3">{u.role.replace(/_/g, ' ')}</td>
                  <td className="py-1.5 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[u.status] || ''}`}>{u.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, recorded in the audit trail)…"
            className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
          />
          <div className="flex gap-2">
            {[['suspend', 'Suspend'], ['reinstate', 'Reinstate'], ['deactivate', 'Deactivate'], ['activate', 'Activate']].map(([action, label]) => (
              <button
                key={action}
                onClick={() => void applyAction(action)}
                disabled={busy || selected.length === 0}
                className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {selected.length > 0 && (
          <div className="text-[11px] text-slate-500">{selected.length} account(s) selected.</div>
        )}
      </div>
    </div>
  );
};
