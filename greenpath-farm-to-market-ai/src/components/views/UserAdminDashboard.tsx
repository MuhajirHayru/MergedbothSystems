import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { apiClient } from '../../services/apiClient';
import { UserProfile, RegistrationApplication } from '../../types';
import { UserDetailReviewModal } from './UserDetailReviewModal';
import {
  Users,
  FileCheck2,
  ShieldCheck,
  AlertTriangle,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Eye,
  MapPin,
  Building,
  UserPlus,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';

export const UserAdminDashboard: React.FC = () => {
  const {
    applications,
    updateApplicationStatus,
    allUsers,
    adminDataStatus,
    updateUserVerification,
    setNotification,
    setActiveView,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'pending' | 'directory' | 'suspended'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [selectedReviewUser, setSelectedReviewUser] = useState<UserProfile | null>(null);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);

  // Region filter options come from the administrative reference data, with a
  // static fallback when the endpoint is unavailable for this role.
  useEffect(() => {
    apiClient.get('/superadmin/locations/')
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : res.data?.results || [];
        const names = [...new Set<string>(rows.filter((l: any) => l.level === 'REGION').map((l: any) => String(l.name)))];
        if (names.length) setRegionOptions(names);
      })
      .catch(() => undefined);
  }, []);

  const pendingApps = applications.filter((a) => a.status === 'pending');

  const filteredUsers = allUsers.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.region.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.businessName && u.businessName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesRegion = regionFilter === 'all' || u.region === regionFilter;
    const matchesTab =
      activeTab === 'directory'
        ? true
        : activeTab === 'suspended'
        ? u.verificationStatus === 'suspended'
        : true;

    return matchesSearch && matchesRole && matchesRegion && matchesTab;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>National Accreditation & User Identity Bureau</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            User Administrator Console
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            KYC / KYB Credential verification, agricultural land deeds, commercial licenses, and account governance.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
            {pendingApps.length} Applications Pending
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Pending Accreditation</span>
            <FileCheck2 className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-600 mt-2">
            {pendingApps.length} Applications
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Awaiting MoA & trade validation</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Verified Agribusinesses</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-2">
            {allUsers.filter((u) => u.verificationStatus === 'verified').length} Active
          </div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">Accredited to trade</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Producer Farmers</span>
            <Users className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold font-mono text-blue-600 mt-2">
            {allUsers.filter((u) => u.role === 'farmer').length} Verified
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Rift Valley & Highland Growers</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Suspended Accounts</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div className="text-xl font-bold font-mono text-red-600 mt-2">
            {allUsers.filter((u) => u.verificationStatus === 'suspended').length} Flagged
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Restricted from escrow trading</div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('pending')}
          className={`py-2.5 px-3 border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'pending'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Pending Registrations Queue</span>
          {pendingApps.length > 0 && (
            <span className="w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center font-bold">
              {pendingApps.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('directory')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'directory'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          All Registered Users & Directory ({allUsers.length})
        </button>
        <button
          onClick={() => setActiveTab('suspended')}
          className={`py-2.5 px-3 border-b-2 transition-colors ${
            activeTab === 'suspended'
              ? 'border-[#15803D] text-[#15803D] dark:text-emerald-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Suspensions & Compliance Flags
        </button>
      </div>

      {/* TAB 1: Pending Registrations Queue */}
      {adminDataStatus === 'error' && (
        <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
          User records could not be loaded from the server. Refresh the page to retry.
        </div>
      )}

      {adminDataStatus === 'loading' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {activeTab === 'pending' && adminDataStatus !== 'loading' && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Incoming User Registration Applications
              </h3>
              <p className="text-xs text-slate-400">
                New farmers, wholesalers, retailers, and drivers awaiting credential review before platform access.
              </p>
            </div>
          </div>

          {pendingApps.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-slate-400 text-xs">
              All registration applications have been reviewed and verified.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {pendingApps.map((app) => (
                <div
                  key={app.id}
                  className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {app.fullName}
                      </span>
                      {app.trackingNumber && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {app.trackingNumber}
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 capitalize font-mono">
                        {app.role}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        Submitted: {app.submittedAt}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-3">
                      <span>Email: {app.email}</span>
                      <span>Phone: {app.phone}</span>
                      <span>
                        Location: {app.region} ({app.zone}, {app.wereda})
                      </span>
                    </div>
                    {app.businessName && (
                      <div className="text-xs text-slate-500 font-medium">
                        Entity: {app.businessName} · License: {app.licenseNumber || 'Under Review'}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400 pt-1">
                      Attached Documents: {app.documents.map((d) => d.name).join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        // Open review modal
                        const mockUserFromApp: UserProfile = {
                          id: app.id,
                          name: app.fullName,
                          legalFullName: app.fullName,
                          email: app.email,
                          phone: app.phone,
                          age: app.age,
                          sex: app.sex,
                          role: app.role,
                          region: app.region,
                          zone: app.zone,
                          wereda: app.wereda,
                          registeredAddress: `${app.wereda}, ${app.zone}, ${app.region}`,
                          verificationStatus: 'pending',
                          registrationDate: app.submittedAt || '—',
                          businessName: app.businessName,
                          licenseNumber: app.licenseNumber,
                          documents: app.documents,
                        };
                        setSelectedReviewUser(mockUserFromApp);
                      }}
                      className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect 6-Tab Profile</span>
                    </button>

                    <button
                      onClick={() => updateApplicationStatus(app.id, 'approved', 'Verified credentials')}
                      className="px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>

                    <button
                      onClick={() => updateApplicationStatus(app.id, 'rejected', 'Missing valid tax or lease documentation')}
                      className="px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2 & 3: All Registered Directory & Suspended */}
      {(activeTab === 'directory' || activeTab === 'suspended') && (
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search user name, email, TIN, business..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="text-xs p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Roles</option>
                <option value="farmer">Farmers</option>
                <option value="wholesaler">Wholesalers</option>
                <option value="retailer">Retailers</option>
                <option value="driver">Drivers</option>
              </select>

              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="text-xs p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              >
                <option value="all">All Regions</option>
                {(regionOptions.length
                  ? regionOptions
                  : ['Oromia', 'Addis Ababa', 'Amhara', 'Sidama', 'Central Ethiopia', 'Tigray', 'Somali']
                ).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>

          {/* User Table */}
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                  <th className="py-3 px-3">User & Entity</th>
                  <th className="py-3 px-2">Role</th>
                  <th className="py-3 px-3">Contact Email & Phone</th>
                  <th className="py-3 px-3">Administrative Location</th>
                  <th className="py-3 px-2">Registered</th>
                  <th className="py-3 px-2">Verification Status</th>
                  <th className="py-3 px-3 text-center">Inspect Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedReviewUser(u)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {u.name}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate max-w-xs">
                        {u.businessName || 'Individual Agribusiness'}
                      </div>
                    </td>
                    <td className="py-3 px-2 capitalize font-medium text-slate-700 dark:text-slate-300">
                      {u.role.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-400">
                      <div>{u.email}</div>
                      <div className="text-[10px] text-slate-400">{u.phone}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{u.region}</div>
                      <div className="text-[10px] text-slate-400">{u.zone} · {u.wereda}</div>
                    </td>
                    <td className="py-3 px-2 text-slate-400 font-mono text-[11px]">
                      {u.registrationDate}
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                          u.verificationStatus === 'verified'
                            ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                            : u.verificationStatus === 'suspended'
                            ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                            : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {u.verificationStatus}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-[11px] font-bold text-[#15803D] dark:text-emerald-400 hover:underline">
                        Review 6 Tabs →
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                      No accounts match the current search and filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Individual User Review Modal */}
      {selectedReviewUser && (
        <UserDetailReviewModal
          user={selectedReviewUser}
          onClose={() => setSelectedReviewUser(null)}
        />
      )}
    </div>
  );
};
