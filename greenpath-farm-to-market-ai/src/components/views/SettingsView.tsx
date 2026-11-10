import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { apiClient } from '../../services/apiClient';
import { formatApiError } from '../../lib/apiErrors';
import { useTheme } from '../../context/ThemeContext';
import { Language } from '../../types';
import {
  User,
  Lock,
  Bell,
  Globe,
  Sun,
  Moon,
  Shield,
  CreditCard,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Save,
  LogOut,
  Smartphone,
  Eye,
  EyeOff,
  Wallet,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    currentUser,
    updateCurrentUser,
    language,
    setLanguage,
    platformConfig,
    logout,
    setActiveView,
    setNotification,
  } = useApp();

  const { theme, setTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<
    'profile' | 'bank_accounts' | 'security' | 'notifications' | 'language' | 'appearance' | 'privacy' | 'account'
  >('profile');

  // Profile Form State
  const [name, setName] = useState(currentUser.name);
  const [bio, setBio] = useState<string>((currentUser as any).bio || '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string>((currentUser as any).avatarUrl || '');
  const [legalFullName, setLegalFullName] = useState(currentUser.legalFullName || currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone);

  // Add Bank Account Modal / State

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Administrative account card (staff roles only): scope, insignia, creatable roles.
  const STAFF_ROLES_FOR_SETTINGS = ['USER_ADMIN', 'REGIONAL_ADMIN', 'ZONAL_ADMIN', 'WEREDA_ADMIN', 'TOP_USER_ADMIN', 'SUPER_ADMIN'];
  const isAdminAccount = STAFF_ROLES_FOR_SETTINGS.includes(String(currentUser.role || '').toUpperCase());
  const [adminScope, setAdminScope] = useState<{ scope: string; flag: string; flagImage: string; locationId: string; canEdit: boolean; creatable: string[] } | null>(null);
  const [flagFile, setFlagFile] = useState<File | null>(null);
  const [flagPath, setFlagPath] = useState('');
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagError, setFlagError] = useState('');
  // Bank accounts (payout accounts) — listed, added and removed in Settings.
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [banks, setBanks] = useState<{ code: string; name: string }[]>([]);
  const [bankForm, setBankForm] = useState({ bank: '', account_holder_name: '', account_number: '', branch: '', account_type: 'checking', nickname: '' });
  const [bankBusy, setBankBusy] = useState(false);
  const [bankError, setBankError] = useState('');

  const loadBankAccounts = useCallback(() => {
    apiClient.get('/payments/bank-accounts/')
      .then((res: any) => setBankAccounts(res?.data?.accounts || []))
      .catch(() => setBankAccounts([]));
  }, []);
  useEffect(() => { loadBankAccounts(); }, [loadBankAccounts]);
  useEffect(() => {
    apiClient.get('/payments/banks/')
      .then((res: any) => setBanks(res?.data?.banks || []))
      .catch(() => setBanks([]));
  }, []);

  const addBankAccount = async () => {
    setBankBusy(true); setBankError('');
    try {
      await apiClient.post('/payments/bank-accounts/', bankForm);
      setBankForm({ bank: '', account_holder_name: '', account_number: '', branch: '', account_type: 'checking', nickname: '' });
      loadBankAccounts();
      setNotification('Bank account added — it will be verified before payouts use it.');
    } catch (err: any) {
      setBankError(formatApiError(err, 'The bank account could not be added.'));
    } finally {
      setBankBusy(false);
    }
  };

  const removeBankAccount = async (id: string) => {
    try {
      await apiClient.delete(`/payments/bank-accounts/${id}/`);
      loadBankAccounts();
      setNotification('Bank account removed.');
    } catch (err: any) {
      setBankError(formatApiError(err, 'The bank account could not be removed.'));
    }
  };

  const loadAdminScope = useCallback(() => {
    if (!isAdminAccount) return;
    let alive = true;
    apiClient.get('/superadmin/accounts/creation-options/')
      .then((res: any) => {
        if (!alive) return;
        setAdminScope({
          scope: res?.data?.current_scope || '',
          flag: res?.data?.current_flag || '',
          flagImage: res?.data?.current_flag_image || '',
          locationId: res?.data?.scope_location_id || '',
          canEdit: Boolean(res?.data?.can_set_location_flag),
          creatable: (res?.data?.creatable_roles || []) as string[],
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isAdminAccount]);
  useEffect(() => { loadAdminScope(); }, [loadAdminScope]);

  const saveFlagPicture = async () => {
    if (!flagFile && !flagPath.trim()) { setFlagError('Browse a picture or paste a file path / image link first.'); return; }
    setFlagBusy(true); setFlagError('');
    try {
      const endpoint = adminScope?.locationId
        ? `/superadmin/locations/${adminScope.locationId}/flag/`
        : '/superadmin/national-flag/';
      if (flagFile) {
        const form = new FormData();
        form.append(adminScope?.locationId ? 'flag_image' : 'national_flag', flagFile);
        await apiClient.patch(endpoint, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        const value = flagPath.trim();
        const body = value.toLowerCase().startsWith('http') ? { flag_url: value } : { flag_path: value };
        await apiClient.patch(endpoint, body);
      }
      setFlagFile(null); setFlagPath('');
      loadAdminScope();
      setNotification('Flag picture updated.');
    } catch (err: any) {
      setFlagError(formatApiError(err, 'The flag picture could not be set — check the file, path or link.'));
    } finally {
      setFlagBusy(false);
    }
  };

  // Notification toggles
  const [notifOrders, setNotifOrders] = useState(() => localStorage.getItem('gp_pref_notif_orders') !== '0');
  const [notifPayments, setNotifPayments] = useState(() => localStorage.getItem('gp_pref_notif_payments') !== '0');
  const [notifMessages, setNotifMessages] = useState(() => localStorage.getItem('gp_pref_notif_messages') !== '0');
  const [notifSms, setNotifSms] = useState(() => localStorage.getItem('gp_pref_notif_sms') !== '0');

  // Notification preferences persist on this device so they survive reloads.
  useEffect(() => { localStorage.setItem('gp_pref_notif_orders', notifOrders ? '1' : '0'); }, [notifOrders]);
  useEffect(() => { localStorage.setItem('gp_pref_notif_payments', notifPayments ? '1' : '0'); }, [notifPayments]);
  useEffect(() => { localStorage.setItem('gp_pref_notif_messages', notifMessages ? '1' : '0'); }, [notifMessages]);
  useEffect(() => { localStorage.setItem('gp_pref_notif_sms', notifSms ? '1' : '0'); }, [notifSms]);

  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSaved, setPwSaved] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Only send the business fields the user actually edited: the backend
      // rejects a field an administrator has locked after approval.
      const payload: Record<string, unknown> = {
        full_name: legalFullName || name,
        phone,
        bio,
      };
      if (email && email !== currentUser.email) payload.email = email;


      const res = await api.auth.updateProfile(payload);
      if (res?.data?.user) updateCurrentUser(res.data.user);
      setNotification?.('Profile updated.');
    } catch (err: any) {
      const data = err?.response?.data;
      const message =
        data?.error ||
        (data && typeof data === 'object'
          ? Object.entries(data)
              .map(([field, detail]) => `${field}: ${Array.isArray(detail) ? detail[0] : detail}`)
              .join(' ')
          : null);
      setNotification?.(message || 'Profile update failed');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Account Settings & Preferences
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Manage your verified profile details, security settings, and display theme.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left: Settings Tab Navigation */}
        <div className="md:col-span-4 lg:col-span-3 space-y-1 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          {[
            { id: 'profile', label: 'Profile Information', icon: User },
            { id: 'bank_accounts', label: 'Bank Accounts', icon: Wallet },

            { id: 'security', label: 'Security & Sessions', icon: Lock },
            { id: 'notifications', label: 'Notification Preferences', icon: Bell },
            { id: 'language', label: 'Language & Locale', icon: Globe },
            { id: 'appearance', label: 'Theme (Light / Dark)', icon: Sun },
            { id: 'privacy', label: 'Privacy & Data Protection', icon: Shield },
            { id: 'account', label: 'Account Governance', icon: CreditCard },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold text-left transition-colors ${
                  isActive
                    ? 'bg-[#15803D] text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Tab Content */}
        <div className="md:col-span-8 lg:col-span-9 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          {/* TAB 1: Profile Information */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
                Personal & Business Identification
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Display Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Full Legal Name</label>
                  <input
                    type="text"
                    value={legalFullName}
                    onChange={(e) => setLegalFullName(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Phone Number (Ethio Telecom)</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Profile picture</label>
                  <div className="flex items-center gap-3">
                    {photoPreview ? (
                      <img src={photoPreview} alt="" className="w-14 h-14 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center">{(name || '?').slice(0, 2).toUpperCase()}</div>
                    )}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setPhotoBusy(true);
                        try {
                          const form = new FormData();
                          form.append('profile_photo', file);
                          const res: any = await apiClient.post('/auth/profile/photo/', form, { headers: { 'Content-Type': 'multipart/form-data' } });
                          const url = res?.data?.user?.profile_photo;
                          setPhotoPreview(url ? `http://127.0.0.1:8000${url.startsWith('/') ? url : '/' + url}` : photoPreview);
                          setNotification('Profile picture updated.');
                        } catch (err: any) {
                          setNotification(formatApiError(err, 'The profile picture could not be uploaded.'));
                        } finally {
                          setPhotoBusy(false);
                          e.target.value = '';
                        }
                      }}
                      disabled={photoBusy}
                      className="text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-[#15803D] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
                    />
                    {photoBusy && <span className="text-[11px] text-slate-400">Uploading…</span>}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Shown beside your messages when you chat with buyers and sellers.</p>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Bio</label>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    maxLength={280}
                    placeholder="A short introduction buyers and sellers see when you chat."
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{bio.length}/280 · visible in your chat identity.</p>
                </div>

              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'bank_accounts' && (
            <div className="space-y-4 text-xs">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-1">Bank Accounts</h3>
                <p className="text-slate-500 dark:text-slate-400">
                  Payout accounts for salary invoices and marketplace settlements. Account numbers are stored
                  encrypted and shown masked; each account is verified before payouts use it.
                </p>
              </div>

              <div className="space-y-2">
                {bankAccounts.length === 0 && (
                  <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400">
                    No bank accounts registered yet.
                  </div>
                )}
                {bankAccounts.map((acc: any) => (
                  <div key={acc.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        {acc.bank}
                        {acc.is_default && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">DEFAULT</span>}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {acc.account_holder_name} · <span className="font-mono">{acc.account_number_masked}</span>
                        {acc.branch ? ` · ${acc.branch}` : ''}
                        <span className="ml-2 capitalize">{String(acc.status || '').toLowerCase().replace(/_/g, ' ')}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeBankAccount(acc.id)}
                      className="px-2.5 py-1 rounded-lg border border-red-200 text-red-700 dark:border-red-900 dark:text-red-300 font-semibold hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 space-y-3">
                <div className="font-bold text-slate-800 dark:text-slate-100">Add a bank account</div>
                {bankError && <div role="alert" className="text-[11px] text-rose-700 dark:text-rose-300">{bankError}</div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Bank
                    <select
                      value={bankForm.bank}
                      onChange={(e) => setBankForm({ ...bankForm, bank: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="">Choose a bank…</option>
                      {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                  </label>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Account holder name
                    <input value={bankForm.account_holder_name} onChange={(e) => setBankForm({ ...bankForm, account_holder_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100" />
                  </label>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Account number
                    <input value={bankForm.account_number} onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })} inputMode="numeric" className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100" />
                  </label>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Branch (optional)
                    <input value={bankForm.branch} onChange={(e) => setBankForm({ ...bankForm, branch: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100" />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={bankBusy || !bankForm.bank || !bankForm.account_holder_name || !bankForm.account_number}
                  onClick={() => void addBankAccount()}
                  className="rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {bankBusy ? 'Adding…' : 'Add bank account'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: Bank Accounts Management (Masked, Verified, Primary) */}
          {activeTab === 'security' && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-1">
                  Security & Authentication Guard
                </h3>
                <p className="text-slate-500 dark:text-slate-400">
                  Account protected under GreenPath 3-failed-attempt lockout policy.
                </p>
              </div>

              {isAdminAccount && (
                <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-3">
                  <div className="flex items-center gap-3">
                    {adminScope?.flagImage ? (
                      <img src={adminScope.flagImage} alt="Regional flag" className="h-16 w-24 rounded-lg object-cover shadow-md ring-1 ring-emerald-200 dark:ring-emerald-800" />
                    ) : adminScope?.flag ? (
                      <span aria-hidden="true" className="text-3xl leading-none">{adminScope.flag}</span>
                    ) : (
                      <Shield className="w-5 h-5 text-emerald-600" />
                    )}
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-200">Administrative account</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {currentUser.name} · {String(currentUser.role || '').replace(/_/g, ' ')}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    Geographic scope: <strong>{adminScope?.scope || 'Nationwide'}</strong>
                    {adminScope && adminScope.creatable.length > 0 && (
                      <> · can create: {adminScope.creatable.map((r) => r.replace(/_/g, ' ').toLowerCase()).join(', ')}</>
                    )}
                  </div>
                  {adminScope?.canEdit && (
                    <div className="border-t border-emerald-200/70 dark:border-emerald-900/70 pt-3 space-y-2">
                      <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        Flag picture {adminScope.locationId ? `for ${adminScope.scope}` : '(national flag — shown on nationwide dashboards; Addis Ababa inherits it as the federal flag)'}
                      </div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={(event) => { setFlagFile(event.target.files?.[0] || null); setFlagPath(''); setFlagError(''); }}
                        className="w-full text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-[#15803D] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
                      />
                      <input
                        value={flagPath}
                        onChange={(event) => { setFlagPath(event.target.value); if (event.target.value) setFlagFile(null); setFlagError(''); }}
                        placeholder="…or paste a file path (C:\Users\…\flag.png) or an image link"
                        aria-label="Flag picture file path or image link"
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                      />
                      {flagError && <div role="alert" className="text-[11px] text-rose-700 dark:text-rose-300">{flagError}</div>}
                      <button
                        type="button"
                        disabled={flagBusy || (!flagFile && !flagPath.trim())}
                        onClick={() => void saveFlagPicture()}
                        className="rounded-lg bg-[#15803D] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {flagBusy ? 'Saving…' : 'Save flag picture'}
                      </button>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        PNG, JPEG, WebP or SVG up to 2 MB. A pasted path can point at a file you just downloaded into your Downloads folder.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <span>Current Active Session</span>
                </div>
                <div className="text-slate-500">
                  This account is protected by the platform lockout policy ({platformConfig.security.maxFailedAttempts} failed attempts → {platformConfig.security.lockoutDurationMinutes} minute lockout) and an idle session timeout of {platformConfig.security.sessionTimeoutMinutes} minutes.
                </div>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setPwError(''); setPwSaved(false);
                  if (newPassword.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
                  if (confirmPassword !== newPassword) { setPwError('New password and confirmation do not match.'); return; }
                  setPwBusy(true);
                  try {
                    await api.auth.changePassword({
                      current_password: currentPassword,
                      new_password: newPassword,
                      confirm_password: confirmPassword,
                    });
                    setPwSaved(true);
                    setNotification('Password updated successfully.');
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  } catch (err: any) {
                    setPwError(err?.response?.data?.error || err?.response?.data?.new_password?.[0] || 'Password could not be changed — check your current password.');
                  } finally {
                    setPwBusy(false);
                  }
                }}
                className="space-y-3 max-w-md pt-2"
              >
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  Update Account Password
                </div>
                {pwError && (
                  <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> {pwError}
                  </div>
                )}
                {pwSaved && (
                  <div className="p-2.5 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Password changed — use it at your next sign-in.
                  </div>
                )}
                <div>
                  <label className="block font-semibold mb-1">Current Password</label>
                  <input
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">New Strong Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <button
                  type="submit"
                  disabled={pwBusy}
                  className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white font-bold rounded-lg shadow-xs disabled:opacity-60"
                >
                  {pwBusy ? 'Saving…' : 'Save New Password'}
                </button>
              </form>
            </div>
          )}

          {/* TAB 4: Notifications */}
          {activeTab === 'notifications' && (
            <div className="space-y-4 text-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
                Notification Channels & Alerts
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Preferences are saved on this device and applied the next time you sign in here.</p>
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      Escrow Order Milestone Updates
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Alert when order status moves to Shipped, Delivered, or Payment Release
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifOrders}
                    onChange={(e) => setNotifOrders(e.target.checked)}
                    className="rounded text-[#15803D]"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      Chapa Financial Payment Releases
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Instant notifications on deposit approvals and wallet settlements
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifPayments}
                    onChange={(e) => setNotifPayments(e.target.checked)}
                    className="rounded text-[#15803D]"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      Ethio Telecom SMS Dispatch Alerts
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Receive automated SMS alerts when freight drivers dock at farm gate
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifSms}
                    onChange={(e) => setNotifSms(e.target.checked)}
                    className="rounded text-[#15803D]"
                  />
                </label>
              </div>
            </div>
          )}

          {/* TAB 5: Language */}
          {activeTab === 'language' && (
            <div className="space-y-4 text-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
                Platform Language Preference
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { id: 'en' as const, label: 'English', desc: 'Default international language' },
                  { id: 'am' as const, label: 'አማርኛ (Amharic)', desc: 'የኢትዮጵያ የስራ ቋንቋ' },
                  { id: 'om' as const, label: 'Afaan Oromoo', desc: 'Afaan Oromoo gabaa qonnaa' },
                ].map((l) => (
                  <button
                    key={l.id}
                    onClick={() => {
                      setLanguage(l.id);
                      setNotification(`Language set to: ${l.label}`);
                    }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      language === l.id
                        ? 'border-[#15803D] bg-emerald-50/50 dark:bg-emerald-950/20 ring-2 ring-[#15803D]'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {l.label}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">{l.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: Appearance (Light / Dark) */}
          {activeTab === 'appearance' && (
            <div className="space-y-4 text-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
                Global Theme Preference
              </h3>
              <p className="text-slate-500 dark:text-slate-400">
                Light mode utilizes Green-700 (#15803D) sidebar; Dark mode utilizes Slate-900 (#0F172A).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => setTheme('light')}
                  className={`p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${
                    theme === 'light'
                      ? 'border-[#15803D] bg-emerald-50/50 ring-2 ring-[#15803D]'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-[#15803D] text-white flex items-center justify-center">
                    <Sun className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-900">Light Mode</div>
                    <div className="text-slate-500 text-[11px]">
                      Green-700 sidebar · Clean white & slate surfaces
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setTheme('dark')}
                  className={`p-4 rounded-xl border text-left transition-all flex items-center gap-4 ${
                    theme === 'dark'
                      ? 'border-[#15803D] bg-slate-800 ring-2 ring-[#15803D]'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="w-10 h-10 rounded-lg bg-[#0F172A] text-white flex items-center justify-center border border-slate-700">
                    <Moon className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-100">Dark Mode</div>
                    <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Slate-900 sidebar · Deep contrast nocturnal styling
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* TAB 7: Privacy */}
          {activeTab === 'privacy' && (
            <div className="space-y-4 text-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
                Marketplace Privacy & Data Governance
              </h3>
              <div className="space-y-3 text-slate-600 dark:text-slate-400 leading-relaxed">
                <p>
                  <strong>Location Privacy:</strong> In compliance with GreenPath agricultural security policies, your exact farm GPS coordinates and physical plot boundary are never exposed in public marketplace search feeds or produce cards. Only generalized administrative zones are displayed.
                </p>
                <p>
                  <strong>Regulatory Visibility:</strong> Authorized User Administrators and Financial Managers inspect physical addresses and licenses exclusively within closed accredited consoles.
                </p>
              </div>
            </div>
          )}

          {/* TAB 8: Account Governance */}
          {activeTab === 'account' && (
            <div className="space-y-4 text-xs">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
                Account Status & Sign Out
              </h3>
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">Accreditation Status</div>
                  <div className="text-slate-500 dark:text-slate-400 text-[11px]">Verified Agricultural Trade Participant</div>
                </div>
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950 px-2.5 py-1 rounded-full capitalize">
                  {currentUser.verificationStatus}
                </span>
              </div>

              <div className="pt-2">
                <button
                  onClick={async () => {
                    await logout();
                    setActiveView('landing');
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg flex items-center gap-2 shadow-xs"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out of GreenPath</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
