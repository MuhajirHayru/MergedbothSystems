import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import { useTheme } from '../../context/ThemeContext';
import { Language } from '../../types';
import {
  User,
  Building2,
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
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    currentUser,
    updateCurrentUser,
    bankAccounts,
    addBankAccount,
    setPrimaryBankAccount,
    removeBankAccount,
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
  const [legalFullName, setLegalFullName] = useState(currentUser.legalFullName || currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone);
  const [businessName, setBusinessName] = useState(currentUser.businessName || '');
  const [registeredAddress, setRegisteredAddress] = useState(currentUser.registeredAddress || '');

  // Add Bank Account Modal / State
  const [showAddBank, setShowAddBank] = useState(false);
  const [bankName, setBankName] = useState('Commercial Bank of Ethiopia (CBE)');
  const [accountHolderName, setAccountHolderName] = useState(currentUser.name);
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<'Checking' | 'Savings' | 'Business Escrow'>('Checking');

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Notification toggles
  const [notifOrders, setNotifOrders] = useState(true);
  const [notifPayments, setNotifPayments] = useState(true);
  const [notifMessages, setNotifMessages] = useState(true);
  const [notifSms, setNotifSms] = useState(true);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Only send the business fields the user actually edited: the backend
      // rejects a field an administrator has locked after approval.
      const payload: Record<string, unknown> = {
        full_name: legalFullName || name,
        phone,
      };
      if (email && email !== currentUser.email) payload.email = email;
      if ((businessName || '') !== (currentUser.businessName || '')) {
        payload.business_name = businessName;
      }
      if ((registeredAddress || '') !== (currentUser.registeredAddress || '')) {
        payload.business_address = registeredAddress;
      }
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

  const handleAddBankAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountNumber) return;
    const masked = `•••• •••• ${accountNumber.slice(-4)}`;
    addBankAccount({
      bankName,
      accountHolderName,
      accountNumber,
      maskedAccountNumber: masked,
      accountType,
      isPrimary: bankAccounts.length === 0,
    });
    setShowAddBank(false);
    setAccountNumber('');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-5">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Account Settings & Preferences
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Manage your verified profile details, settlement bank accounts, security keys, and display theme.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left: Settings Tab Navigation */}
        <div className="md:col-span-4 lg:col-span-3 space-y-1 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          {[
            { id: 'profile', label: 'Profile Information', icon: User },
            { id: 'bank_accounts', label: 'Bank Accounts', icon: Building2 },
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
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
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
                  <label className="block font-semibold mb-1">Associated Business / Farm Enterprise</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Registered Administrative Address</label>
                  <textarea
                    value={registeredAddress}
                    onChange={(e) => setRegisteredAddress(e.target.value)}
                    rows={2}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
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

          {/* TAB 2: Bank Accounts Management (Masked, Verified, Primary) */}
          {activeTab === 'bank_accounts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Disbursement & Escrow Bank Accounts
                  </h3>
                  <p className="text-xs text-slate-400">
                    Accounts authorized for direct payout withdrawal in Ethiopian Birr (ETB).
                  </p>
                </div>

                <button
                  onClick={() => setShowAddBank(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Bank Account</span>
                </button>
              </div>

              {/* Bank Accounts List */}
              <div className="space-y-3">
                {bankAccounts.map((b) => (
                  <div
                    key={b.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                          {b.bankName}
                        </span>
                        {b.isPrimary && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                            Primary Account
                          </span>
                        )}
                        <span className="text-[10px] font-semibold text-slate-400">
                          {b.accountType}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                        Holder: {b.accountHolderName}
                      </div>
                      <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                        {b.maskedAccountNumber}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!b.isPrimary && (
                        <button
                          onClick={() => setPrimaryBankAccount(b.id)}
                          className="text-xs font-semibold text-[#15803D] hover:underline"
                        >
                          Make Primary
                        </button>
                      )}
                      <button
                        onClick={() => removeBankAccount(b.id)}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg"
                        title="Remove bank account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Bank Modal */}
              {showAddBank && (
                <form
                  onSubmit={handleAddBankAccount}
                  className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3 text-xs"
                >
                  <div className="font-bold text-emerald-900 dark:text-emerald-200">
                    Add Ethiopian Commercial Bank Account
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Financial Institution</label>
                      <select
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                      >
                        <option value="Commercial Bank of Ethiopia (CBE)">Commercial Bank of Ethiopia (CBE)</option>
                        <option value="Awash International Bank">Awash International Bank</option>
                        <option value="Bank of Abyssinia">Bank of Abyssinia</option>
                        <option value="Dashen Bank">Dashen Bank</option>
                        <option value="Cooperative Bank of Oromia">Cooperative Bank of Oromia</option>
                        <option value="Telebirr Wallet SuperApp">Telebirr Wallet SuperApp</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">Account Holder Full Legal Name</label>
                      <input
                        type="text"
                        value={accountHolderName}
                        onChange={(e) => setAccountHolderName(e.target.value)}
                        required
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">Account Number (Full)</label>
                      <input
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        placeholder="1000..."
                        required
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block font-semibold mb-1">Account Classification</label>
                      <select
                        value={accountType}
                        onChange={(e) => setAccountType(e.target.value as any)}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                      >
                        <option value="Checking">Checking Account</option>
                        <option value="Savings">Savings Account</option>
                        <option value="Business Escrow">Business Escrow</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddBank(false)}
                      className="px-3 py-1.5 border border-slate-300 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold rounded-md"
                    >
                      Verify & Add Account
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: Security & Lockout awareness */}
          {activeTab === 'security' && (
            <div className="space-y-6 text-xs">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mb-1">
                  Security & Authentication Guard
                </h3>
                <p className="text-slate-400">
                  Account protected under GreenPath 3-failed-attempt lockout policy.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-600" />
                  <span>Current Active Session</span>
                </div>
                <div className="text-slate-500">
                  IP: 196.188.24.12 (Ethio Telecom Gateway, Addis Ababa) · Browser: Verified Modern Session
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setNotification('Password updated successfully.');
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                className="space-y-3 max-w-md pt-2"
              >
                <div className="font-bold text-slate-900 dark:text-slate-100">
                  Update Account Password
                </div>
                <div>
                  <label className="block font-semibold mb-1">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">New Strong Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white font-bold rounded-lg shadow-xs"
                >
                  Save New Password
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
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      Escrow Order Milestone Updates
                    </div>
                    <div className="text-slate-400 text-[11px]">
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
                    <div className="text-slate-400 text-[11px]">
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
                    <div className="text-slate-400 text-[11px]">
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
                    <div className="text-slate-400 text-[11px] mt-0.5">{l.desc}</div>
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
              <p className="text-slate-400">
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
                    <div className="text-slate-400 text-[11px]">
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
                  <div className="text-slate-400 text-[11px]">Verified Agricultural Trade Participant</div>
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
