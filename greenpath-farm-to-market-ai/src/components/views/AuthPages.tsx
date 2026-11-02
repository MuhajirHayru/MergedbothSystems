import React, { useState, useMemo } from 'react';
import { api } from '../../services/apiClient';
import { useApp } from '../../context/AppContext';
import { UserRole, RegistrationApplication } from '../../types';
import {
  ETHIOPIAN_REGIONS_HIERARCHY,
  getZonesForRegion,
  getWeredasForZone,
  getKebelesForWereda,
} from '../../data/ethiopianLocations';
import {
  Lock,
  Mail,
  User,
  Phone,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Upload,
  FileText,
  ShieldCheck,
  Building,
  Truck,
  MapPin,
  Clock,
  Search,
  Check,
  ChevronRight,
  Camera,
  X,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

// ==========================================
// 1. LOGIN PAGE WITH 3-ATTEMPT LOCKOUT & DEMO ROLES
// ==========================================

export const LoginPage: React.FC = () => {
  const {
    setCurrentRole,
    setActiveView,
    failedLoginAttempts,
    isLockedOut,
    recordFailedLogin,
    resetLoginAttempts,
    markAuthenticated,
    syncAuthUser,
    platformConfig,
    applications,
  } = useApp();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);

  // Status tracker state inside login
  const [searchQuery, setSearchQuery] = useState('');
  const [trackedApplication, setTrackedApplication] = useState<RegistrationApplication | null>(null);
  const [trackSearched, setTrackSearched] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLockedOut) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Never let a previous session's tokens ride along with a new sign-in.
      localStorage.removeItem('greenpath_auth_token');
      localStorage.removeItem('greenpath_registration_token');
      const res = await api.auth.login({ email: identifier, password });
      const data = res.data;
      if (!data?.success || !data?.access) {
        throw new Error(data?.error || 'Login failed');
      }
      localStorage.setItem('greenpath_auth_token', data.access);
      resetLoginAttempts();
      markAuthenticated(true);
      syncAuthUser(data.user);
      const backendRole = String(data.user?.role || '').toUpperCase();
      const roleMap: Record<string, UserRole> = {
        FARMER: 'farmer',
        WHOLESALER: 'wholesaler',
        RETAILER: 'retailer',
        DRIVER: 'driver',
        FINANCIAL_MANAGER: 'financial_manager',
        USER_ADMIN: 'user_admin',
        TOP_USER_ADMIN: 'top_user_admin',
        SUPER_ADMIN: 'super_admin',
      };
      const role = roleMap[backendRole] || (backendRole.toLowerCase() as UserRole);
      setCurrentRole(role);
      const viewMap: Record<string, string> = {
        farmer: 'farmer_dashboard',
        wholesaler: 'wholesaler_dashboard',
        retailer: 'retailer_dashboard',
        driver: 'driver_dashboard',
        financial_manager: 'financial_dashboard',
        user_admin: 'user_admin_dashboard',
        top_user_admin: 'top_user_admin_dashboard',
        super_admin: 'super_admin_dashboard',
      };
      setActiveView(viewMap[role] || 'marketplace');
    } catch (err: any) {
      recordFailedLogin();
      setErrorMsg(err?.response?.data?.error || err?.message || 'Invalid credentials. Please verify your email/phone and password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLookupApplication = (e: React.FormEvent) => {
    e.preventDefault();
    setTrackSearched(true);
    const q = searchQuery.trim().toLowerCase();
    const found = applications.find(
      (a) =>
        a.trackingNumber?.toLowerCase() === q ||
        a.phone.replace(/\s+/g, '').includes(q.replace(/\s+/g, '')) ||
        a.email.toLowerCase() === q ||
        a.id.toLowerCase() === q
    );
    setTrackedApplication(found || null);
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-7 bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800">
        <div className="text-center">
          <div className="w-12 h-12 bg-[#15803D] text-white rounded-xl mx-auto flex items-center justify-center font-bold text-xl shadow-sm">
            GP
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Sign In to GreenPath
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Access Ethiopian agricultural marketplace & escrow trading systems
          </p>
        </div>

        {/* 3-attempt Lockout Warning */}
        {isLockedOut ? (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-900 text-red-800 dark:text-red-300 text-xs flex items-start gap-3 animate-in fade-in">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Security Lockout Triggered</div>
              <p className="mt-1">
                You have reached the maximum {platformConfig.security.maxFailedAttempts} failed login attempts.
                To protect national escrow and agricultural trader accounts, your session is temporarily locked out for{' '}
                {platformConfig.security.lockoutDurationMinutes} minutes.
              </p>
            </div>
          </div>
        ) : failedLoginAttempts > 0 ? (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Failed attempt {failedLoginAttempts} of {platformConfig.security.maxFailedAttempts}. 3 consecutive failed attempts trigger account lockout.
            </span>
          </div>
        ) : null}

        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Email, Phone or Fayda ID
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={isLockedOut}
                required
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
                placeholder="name@greenpath.et or +251 91 142 8820"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLockedOut}
                required
                className="w-full pl-9 pr-10 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#15803D]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-slate-300 text-[#15803D] focus:ring-[#15803D]"
              />
              <span>Remember session</span>
            </label>
            <button
              type="button"
              onClick={() => setActiveView('forgot_password')}
              className="text-[#15803D] dark:text-emerald-400 font-semibold hover:underline"
            >
              Forgot Password?
            </button>
          </div>

          <button
            type="submit"
            disabled={isLockedOut || isLoading}
            className="w-full py-2.5 px-4 bg-[#15803D] hover:bg-[#166534] disabled:bg-slate-400 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <span>Verifying credentials...</span>
            ) : (
              <>
                <span>Sign In to Platform</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Track Application Status Action */}
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-[#15803D] dark:text-emerald-400" />
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Applied for Accreditation?
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Track regulatory review progress
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTrackingModalOpen(true)}
            className="px-3 py-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-[11px] font-bold rounded-lg transition-colors"
          >
            Track Status
          </button>
        </div>

        {/* Demo quick-login disabled: authentication must use real backend accounts. */}

        <div className="text-center text-xs text-slate-500 dark:text-slate-400">
          New producer, trader, or freight carrier?{' '}
          <button
            onClick={() => setActiveView('register')}
            className="text-[#15803D] dark:text-emerald-400 font-bold hover:underline"
          >
            Start Registration Here
          </button>
        </div>
      </div>

      {/* TRACKING MODAL */}
      {trackingModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#15803D]" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Track Registration & Accreditation Status
                </h3>
              </div>
              <button
                onClick={() => setTrackingModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleLookupApplication} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Enter Tracking #, Phone, or Email (e.g. GP-ETH-2026-9842)"
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search</span>
              </button>
            </form>

            {trackSearched && !trackedApplication && (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-300 text-xs text-center">
                No application found matching <strong className="font-mono">"{searchQuery}"</strong>. Try checking the phone number used during registration.
              </div>
            )}

            {trackedApplication && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-slate-400">Tracking Reference</span>
                    <div className="font-mono font-bold text-sm text-[#15803D] dark:text-emerald-400">
                      {trackedApplication.trackingNumber || trackedApplication.id}
                    </div>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold capitalize ${
                      trackedApplication.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : trackedApplication.status === 'rejected'
                        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {trackedApplication.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <div>Applicant: <strong className="text-slate-900 dark:text-slate-100">{trackedApplication.fullName}</strong></div>
                  <div>Role: <strong className="capitalize text-slate-900 dark:text-slate-100">{trackedApplication.role}</strong></div>
                  <div>Region: {trackedApplication.region} ({trackedApplication.zone})</div>
                  <div>Submitted: {trackedApplication.submittedAt}</div>
                </div>

                {/* 5-Stage Verification Roadmap */}
                <div className="pt-2">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-2">
                    Accreditation Verification Milestones:
                  </div>
                  <div className="space-y-2">
                    {[
                      { stage: 1, label: 'Application Submitted & Logged', desc: 'Received in national accreditation queue' },
                      { stage: 2, label: 'Document Screening & Validity Check', desc: 'MoA / MoTRI trade license cross-checked' },
                      { stage: 3, label: 'Regional Bureau Verification', desc: `${trackedApplication.region} agricultural bureau sign-off` },
                      { stage: 4, label: 'Accreditation Committee Review', desc: 'User Administrator final approval' },
                      { stage: 5, label: 'Active Trading Credentials Issued', desc: 'Escrow wallet & role dashboard unlocked' },
                    ].map((m) => {
                      const cur = trackedApplication.currentStage || (trackedApplication.status === 'approved' ? 5 : 2);
                      const isComplete = cur >= m.stage;
                      const isCurrent = cur === m.stage;

                      return (
                        <div key={m.stage} className="flex items-center gap-3 text-xs">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                              isComplete
                                ? 'bg-emerald-600 text-white'
                                : isCurrent
                                ? 'bg-amber-500 text-white ring-2 ring-amber-300 animate-pulse'
                                : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                            }`}
                          >
                            {isComplete ? <Check className="w-3.5 h-3.5" /> : m.stage}
                          </span>
                          <div>
                            <div className={`font-semibold ${isComplete ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500'}`}>
                              {m.label}
                            </div>
                            <div className="text-[10px] text-slate-400">{m.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {trackedApplication.status === 'pending' && (
                  <p className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500 dark:text-slate-400">
                    Your application is still under review. You will be able to sign in
                    only after a User Administrator approves it.
                  </p>
                )}

                {trackedApplication.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => {
                      setTrackingModalOpen(false);
                      setActiveView('login');
                    }}
                    className="w-full py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 shadow-sm"
                  >
                    <span>Return to Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 2. COMPLETE MULTI-STEP REGISTRATION JOURNEY
// ==========================================

export const RegisterPage: React.FC = () => {
  const { submitRegistration, setActiveView } = useApp();

  // 7 Explicit Steps:
  // Step 1: Account Type Selection
  // Step 2: Personal Information
  // Step 3: Role-Specific Operational Details
  // Step 4: Ethiopian Administrative Location Hierarchy
  // Step 5: License & Document Uploads
  // Step 6: Review Summary & Regulatory Declaration
  // Step 7: Submission & Real-time Verification Progress
  const [step, setStep] = useState<number>(1);
  const [selectedRole, setSelectedRole] = useState<'farmer' | 'wholesaler' | 'retailer' | 'driver'>('farmer');

  // STEP 2: Personal Info
  const [fullName, setFullName] = useState('');
  const [faydaId, setFaydaId] = useState('');
  const [age, setAge] = useState<number>(36);
  const [sex, setSex] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+251 ');
  // The applicant chooses their own password: the account is created with it
  // and it is the credential used to sign in once approved.
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');

  // STEP 3: Role-Specific Details
  // Common / Business
  const [businessName, setBusinessName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiryDate, setLicenseExpiryDate] = useState('2027-12-31');
  const [productFocus, setProductFocus] = useState('Tomatoes, Shallot Onions, Avocados');

  // Farmer specific
  const [landSizeHectares, setLandSizeHectares] = useState(4.5);
  const [irrigationType, setIrrigationType] = useState('River Gravity & Motor Pump');
  const [cooperativeAffiliation, setCooperativeAffiliation] = useState('Meki Batu Vegetable Growers Cooperative');

  // Wholesaler specific
  const [warehouseCapacityQuintals, setWarehouseCapacityQuintals] = useState(1200);
  const [coldStorageAvailable, setColdStorageAvailable] = useState(true);

  // Retailer specific
  const [retailLocationType, setRetailLocationType] = useState('Central Fresh Produce Supermarket');

  // Driver specific
  const [driverLicenseGrade, setDriverLicenseGrade] = useState('Commercial Grade 3 (Heavy Freight)');
  const [vehicleModel, setVehicleModel] = useState('Isuzu FSR Cargo Truck (10 Quintal)');
  const [vehiclePlate, setVehiclePlate] = useState('3-B-89210 ET');
  const [vehicleCapacityTons, setVehicleCapacityTons] = useState(7.5);
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('NIC-CARGO-2026-8819');

  // STEP 4: Ethiopian Location Cascading Selectors
  const [selectedRegionId, setSelectedRegionId] = useState<string>('oromia');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('east_shewa');
  const [selectedWeredaId, setSelectedWeredaId] = useState<string>('meki');
  const [selectedKebele, setSelectedKebele] = useState<string>('04 Werji Agro-Center');
  const [houseOrFarmPlot, setHouseOrFarmPlot] = useState<string>('Holding #14, Sector C');

  // STEP 5: Document Uploads — real files uploaded to the Django API.
  const [uploadedDocs, setUploadedDocs] = useState<
    Array<{
      name: string;
      type: string;
      size: string;
      file: File;
      status: 'ready' | 'attached';
    }>
  >([]);
  const docFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingDocType = React.useRef<string>('');

  // STEP 6: Agreement Checkbox
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // STEP 7: Completed Application tracking state
  const [submittedApp, setSubmittedApp] = useState<RegistrationApplication | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Profile-completion fields the backend requires before a dossier can be
  // submitted: date of birth (not "age") and the products the user trades.
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [productTypeOptions, setProductTypeOptions] = useState<
    Array<{ id: string; name: string; category: string }>
  >([]);
  const [selectedProductTypes, setSelectedProductTypes] = useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    api.registration
      .productTypes()
      .then((res: any) => {
        const rows = Array.isArray(res?.data) ? res.data : res?.data?.results || [];
        if (!cancelled) setProductTypeOptions(rows);
      })
      .catch(() => {
        /* the picker stays empty; submission reports the missing selection */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cascading derivations
  const availableRegions = ETHIOPIAN_REGIONS_HIERARCHY;
  const currentRegion = useMemo(
    () => availableRegions.find((r) => r.id === selectedRegionId) || availableRegions[0],
    [selectedRegionId, availableRegions]
  );

  const availableZones = useMemo(() => currentRegion.zones, [currentRegion]);

  const currentZone = useMemo(
    () => availableZones.find((z) => z.id === selectedZoneId) || availableZones[0],
    [selectedZoneId, availableZones]
  );

  const availableWeredas = useMemo(() => currentZone?.weredas || [], [currentZone]);

  const currentWereda = useMemo(
    () => availableWeredas.find((w) => w.id === selectedWeredaId) || availableWeredas[0],
    [selectedWeredaId, availableWeredas]
  );

  const availableKebeles = useMemo(() => currentWereda?.kebeles || [], [currentWereda]);

  // Handle cascading region change
  const handleRegionChange = (newRegId: string) => {
    setSelectedRegionId(newRegId);
    const reg = availableRegions.find((r) => r.id === newRegId);
    if (reg && reg.zones.length > 0) {
      setSelectedZoneId(reg.zones[0].id);
      if (reg.zones[0].weredas.length > 0) {
        setSelectedWeredaId(reg.zones[0].weredas[0].id);
        if (reg.zones[0].weredas[0].kebeles.length > 0) {
          setSelectedKebele(reg.zones[0].weredas[0].kebeles[0]);
        }
      }
    }
  };

  // Handle cascading zone change
  const handleZoneChange = (newZoneId: string) => {
    setSelectedZoneId(newZoneId);
    const z = availableZones.find((zn) => zn.id === newZoneId);
    if (z && z.weredas.length > 0) {
      setSelectedWeredaId(z.weredas[0].id);
      if (z.weredas[0].kebeles.length > 0) {
        setSelectedKebele(z.weredas[0].kebeles[0]);
      }
    }
  };

  // Handle cascading wereda change
  const handleWeredaChange = (newWeredaId: string) => {
    setSelectedWeredaId(newWeredaId);
    const w = availableWeredas.find((wr) => wr.id === newWeredaId);
    if (w && w.kebeles.length > 0) {
      setSelectedKebele(w.kebeles[0]);
    }
  };

  const handleDocAdd = (docType: string, _docLabel?: string) => {
    pendingDocType.current = docType;
    docFileInputRef.current?.click();
  };

  const handleDocFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    setUploadedDocs((prev) => [
      ...prev.filter((doc) => doc.type !== pendingDocType.current),
      {
        name: file.name,
        type: pendingDocType.current,
        size: `${sizeMb} MB`,
        file,
        status: 'attached',
      },
    ]);
  };

  // Maps the wizard's document slots onto the backend's document types.
  const backendDocumentType = (uiType: string): string => {
    const map: Record<string, string> = {
      farmer_license: 'FARMER_LICENSE',
      business_license:
        selectedRole === 'wholesaler' ? 'WHOLESALER_LICENSE' : 'RETAILER_LICENSE',
      driver_license: 'DRIVING_LICENSE',
      vehicle_title: 'VEHICLE_REGISTRATION',
      tax_clearance: 'IDENTITY_DOCUMENT',
      premises_proof: 'IDENTITY_DOCUMENT',
      land_deed: 'FARMER_LICENSE',
      national_id: 'IDENTITY_DOCUMENT',
    };
    return map[uiType] || 'IDENTITY_DOCUMENT';
  };

  const handleDocRemove = (index: number) => {
    setUploadedDocs((prev) => prev.filter((_, i) => i !== index));
  };

  const handleFinalSubmit = async () => {
    setSubmitError(null);
    if (!email.trim()) {
      setSubmitError('Enter the email address you will use to sign in.');
      return;
    }
    if (regPassword.length < 8) {
      setSubmitError('Choose a password of at least 8 characters.');
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      setSubmitError('The two passwords do not match.');
      return;
    }
    if (!dateOfBirth) {
      setSubmitError('Enter your date of birth.');
      return;
    }
    if (selectedRole !== 'driver' && selectedProductTypes.length === 0) {
      setSubmitError('Select at least one product you trade.');
      return;
    }
    const computedAge = Math.max(
      18,
      Math.floor((Date.now() - new Date(dateOfBirth).getTime()) / 31557600000)
    );

    try {
      const app = await submitRegistration(
        {
      fullName: fullName.trim(),
      faydaId,
      age: computedAge,
      sex,
      email: email.trim(),
      phone: phone.trim(),
      role: selectedRole,
      region: currentRegion.nameEn,
      zone: currentZone?.nameEn || 'East Shewa',
      wereda: currentWereda?.nameEn || 'Meki',
      kebele: selectedKebele,
      subCity: currentRegion.isCharterCity ? currentZone?.nameEn : undefined,
      businessName,
      licenseNumber,
      licenseExpiryDate,
      landSizeHectares: selectedRole === 'farmer' ? landSizeHectares : undefined,
      irrigationType: selectedRole === 'farmer' ? irrigationType : undefined,
      cooperativeAffiliation: selectedRole === 'farmer' ? cooperativeAffiliation : undefined,
      warehouseCapacityQuintals: selectedRole === 'wholesaler' ? warehouseCapacityQuintals : undefined,
      coldStorageAvailable: selectedRole === 'wholesaler' ? coldStorageAvailable : undefined,
      retailLocationType: selectedRole === 'retailer' ? retailLocationType : undefined,
      driverLicenseGrade: selectedRole === 'driver' ? driverLicenseGrade : undefined,
      vehicleModel: selectedRole === 'driver' ? vehicleModel : undefined,
      vehiclePlate: selectedRole === 'driver' ? vehiclePlate : undefined,
      vehicleCapacityTons: selectedRole === 'driver' ? vehicleCapacityTons : undefined,
      insurancePolicyNumber: selectedRole === 'driver' ? insurancePolicyNumber : undefined,
      productFocus,
      documents: uploadedDocs.map((d, idx) => ({
        id: `doc_reg_${Date.now()}_${idx}`,
        name: d.name,
        type: d.type as any,
        fileUrl: '',
        uploadDate: new Date().toISOString().split('T')[0],
        status: 'pending',
        fileSize: d.size,
      })),
        },
        regPassword,
        uploadedDocs.map((doc) => ({
          file: doc.file,
          documentType: backendDocumentType(doc.type),
        })),
        {
          dateOfBirth,
          sex: sex === 'Male' ? 'MALE' : sex === 'Female' ? 'FEMALE' : 'OTHER',
          productTypeIds: selectedProductTypes,
        }
      );

      setSubmittedApp(app);
      setStep(7); // Advance to Step 10 & 11 verification progress screen
    } catch {
      /* submitRegistration already surfaces the failure notification */
    }
  };

  // STEP 7 / STEP 10 IN PROMPT: Verification Progress Screen
  if (step === 7 && submittedApp) {
    return (
      <div className="min-h-[85vh] flex items-center justify-center p-4">
        <div className="max-w-xl w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950 text-[#15803D] dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Registration Successfully Logged!
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Your application has been assigned tracking reference{' '}
              <strong className="font-mono text-[#15803D] dark:text-emerald-400">
                {submittedApp.trackingNumber}
              </strong>
            </p>
          </div>

          {/* Regulatory Accreditation Notice */}
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs leading-relaxed space-y-1">
            <div className="font-bold flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-400" />
              <span>Federal Agricultural Trade Accreditation Protocol</span>
            </div>
            <p>
              In compliance with Federal Ministry of Agriculture guidelines, your account is currently{' '}
              <strong>PENDING REVIEW</strong>. Certified registration documents have been routed to the{' '}
              <strong>{submittedApp.region} Regional Agricultural Accreditation Desk</strong>.
            </p>
          </div>

          {/* 5-Stage Live Verification Progress Stepper */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
            <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
              <span>Verification Milestone Progress</span>
              <span className="text-[11px] font-mono text-[#15803D]">Stage 2 of 5</span>
            </div>

            <div className="space-y-3">
              {[
                { stage: 1, title: 'Application Submitted', desc: 'Timestamped and encrypted in national registry' },
                { stage: 2, title: 'Document & License Screening', desc: 'MoA / MoTRI registry verification active' },
                { stage: 3, title: 'Regional Bureau Accreditation', desc: `${submittedApp.region} regional bureau inspection` },
                { stage: 4, title: 'User Administrator Final Review', desc: 'Federal oversight accreditation' },
                { stage: 5, title: 'Trading Credentials & Wallet Activated', desc: 'Full access to role dashboard unlocked' },
              ].map((m) => (
                <div key={m.stage} className="flex items-start gap-3">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5 shrink-0 ${
                      m.stage === 1
                        ? 'bg-emerald-600 text-white'
                        : m.stage === 2
                        ? 'bg-amber-500 text-white ring-2 ring-amber-300 animate-pulse'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-400'
                    }`}
                  >
                    {m.stage === 1 ? <Check className="w-3.5 h-3.5" /> : m.stage}
                  </div>
                  <div>
                    <div
                      className={`text-xs font-semibold ${
                        m.stage <= 2 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500'
                      }`}
                    >
                      {m.title}
                    </div>
                    <div className="text-[11px] text-slate-400">{m.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 11: After Approval & Successful Login -> Role Dashboard */}
          <div className="space-y-3 pt-2">
            <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
              You will receive your credentials after the User Administrator completes
              accreditation. Sign in becomes available only after approval.
            </p>

            <button
              onClick={() => setActiveView('login')}
              className="w-full py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg transition-colors"
            >
              Return to Login Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-6">
        {/* Header & Step Tracker */}
        <div>
          <div className="text-center">
            <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#15803D] dark:text-emerald-400">
              National Agricultural Regulatory Onboarding
            </span>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
              GreenPath Agribusiness & Producer Registration
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Multi-step verified accreditation for Ethiopian farmers, wholesalers, retailers, and drivers
            </p>
          </div>

          {/* Step Progress Bar (Steps 1 to 6) */}
          <div className="flex items-center justify-between max-w-2xl mx-auto mt-6 px-2">
            {[
              { num: 1, label: 'Account Type' },
              { num: 2, label: 'Personal Info' },
              { num: 3, label: 'Role Details' },
              { num: 4, label: 'Ethiopian Address' },
              { num: 5, label: 'Documents' },
              { num: 6, label: 'Review & Submit' },
            ].map((s, idx) => (
              <div key={s.num} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <span
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                      step === s.num
                        ? 'bg-[#15803D] text-white shadow-xs ring-4 ring-emerald-100 dark:ring-emerald-950'
                        : step > s.num
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
                    }`}
                  >
                    {step > s.num ? <Check className="w-3.5 h-3.5" /> : s.num}
                  </span>
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mt-1 hidden sm:block">
                    {s.label}
                  </span>
                </div>
                {idx < 5 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 transition-colors ${
                      step > idx + 1 ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-800'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* STEP 1: Select Account Type */}
        {step === 1 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Step 1: Select Your Agricultural Market Role
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Each trade role features tailored accreditation criteria, escrow permissions, and logistics tools.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  role: 'farmer' as const,
                  title: 'Farmer / Producer (ገበሬ)',
                  badge: 'Direct Producer',
                  desc: 'Highland and Rift Valley crop growers, smallholders, commercial estates, and primary agricultural unions.',
                  requirements: 'MoA Farmer License or Certified Land Deed (Usufruct)',
                },
                {
                  role: 'wholesaler' as const,
                  title: 'Agricultural Wholesaler (ጅምላ ሻጭ)',
                  badge: 'Bulk Buyer',
                  desc: 'Bulk terminal aggregators, grain merchants, and central distribution hubs trading at volume.',
                  requirements: 'MoTI Commercial Trade License & Active TIN Certificate',
                },
                {
                  role: 'retailer' as const,
                  title: 'Grocer & Retailer (ቸርቻሪ)',
                  badge: 'Fresh Retail',
                  desc: 'Urban supermarket chains, municipal fresh market stalls, fresh fruit vendors, and neighborhood grocers.',
                  requirements: 'Retail Business License & Municipal Trade Registration',
                },
                {
                  role: 'driver' as const,
                  title: 'Commercial Haulage Driver (አሽከርካሪ)',
                  badge: 'Freight Carrier',
                  desc: 'Accredited freight trucks with Isuzu, Sino, or refrigerated fleets operating via DriverApp.',
                  requirements: 'Federal Commercial Driver License Grade 3/2 & Vehicle Libre',
                },
              ].map((r) => (
                <button
                  key={r.role}
                  type="button"
                  onClick={() => setSelectedRole(r.role)}
                  className={`p-5 rounded-2xl border text-left transition-all relative ${
                    selectedRole === r.role
                      ? 'border-[#15803D] bg-emerald-50/60 dark:bg-emerald-950/20 ring-2 ring-[#15803D] shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                      {r.badge}
                    </span>
                    {selectedRole === r.role && (
                      <span className="w-5 h-5 rounded-full bg-[#15803D] text-white flex items-center justify-center text-xs">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    {r.title}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {r.desc}
                  </p>
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400">
                    <strong className="text-slate-800 dark:text-slate-200">Required:</strong> {r.requirements}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-6 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-2"
              >
                <span>Continue to Personal Information</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Personal Information */}
        {step === 2 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Step 2: Personal & Contact Information
              </h3>
              <p className="text-xs text-slate-500">
                Legal identity verification matching your Ethiopian National ID or Kebele Resident Card
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">
                  Full Legal Name (as on Kebele / National ID) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g., Bekele Desta Mamo"
                  required
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Ethiopian National ID (Fayda / ፋይዳ) or Resident ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={faydaId}
                  onChange={(e) => setFaydaId(e.target.value)}
                  placeholder="e.g., ET-FAYDA-9821-4901"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Primary Mobile Phone (Ethio Telecom / Safaricom) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+251 91 142 8820"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Alternate Phone / WhatsApp</label>
                <input
                  type="text"
                  value={alternatePhone}
                  onChange={(e) => setAlternatePhone(e.target.value)}
                  placeholder="+251 92 234 5678 (Optional)"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="bekele.desta@meki-agro.et"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">
                    Create Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={regPasswordConfirm}
                    onChange={(e) => setRegPasswordConfirm(e.target.value)}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
              {regPasswordConfirm.length > 0 && regPassword !== regPasswordConfirm && (
                <div className="text-[11px] text-red-600 dark:text-red-400">
                  Passwords do not match.
                </div>
              )}
              {regPassword.length > 0 && regPassword.length < 8 && (
                <div className="text-[11px] text-red-600 dark:text-red-400">
                  Password must be at least 8 characters.
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold mb-1">
                    Date of Birth <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Sex</label>
                  <select
                    value={sex}
                    onChange={(e) => setSex(e.target.value as any)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="Male">Male (ወንድ)</option>
                    <option value="Female">Female (ሴት)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center gap-2"
              >
                <span>Continue to Role Information</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Role-Specific Operational Details */}
        {step === 3 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#15803D] text-white">
                  {selectedRole}
                </span>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Step 3: {selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)} Operational Details
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Specific regulatory and operational information required exclusively for {selectedRole} accreditation.
              </p>
            </div>

            {/* FARMER SPECIFIC FIELDS */}
            {selectedRole === 'farmer' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Farm / Cooperative Business Title</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g., Meki Rift Valley Agro Holdings"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Land Holding Size (Hectares)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={landSizeHectares}
                    onChange={(e) => setLandSizeHectares(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Irrigation System & Water Source</label>
                  <select
                    value={irrigationType}
                    onChange={(e) => setIrrigationType(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="River Gravity & Motor Pump">River Gravity & Motor Pump (Awash / Rift)</option>
                    <option value="Deep Borehole Ground Water">Deep Borehole Ground Water</option>
                    <option value="Rainfed Highland">Rainfed Highland (Meher / Belg)</option>
                    <option value="Drip Commercial Irrigation">Commercial Drip Irrigation</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Primary Produce Specialty</label>
                  <input
                    type="text"
                    value={productFocus}
                    onChange={(e) => setProductFocus(e.target.value)}
                    placeholder="Tomatoes, Shallot Onions, Avocados"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Agricultural Cooperative / Union Affiliation</label>
                  <input
                    type="text"
                    value={cooperativeAffiliation}
                    onChange={(e) => setCooperativeAffiliation(e.target.value)}
                    placeholder="e.g., Meki Batu Vegetable Growers Cooperative Union"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
            )}

            {/* WHOLESALER SPECIFIC FIELDS */}
            {selectedRole === 'wholesaler' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Commercial Enterprise / PLC Name</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g., GreenSource Ethiopia Trading Plc"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Commercial Trade License TIN</label>
                  <input
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="TIN 0049281729"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Warehouse Storage Capacity (Quintals)</label>
                  <input
                    type="number"
                    value={warehouseCapacityQuintals}
                    onChange={(e) => setWarehouseCapacityQuintals(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Cold Storage Available</label>
                  <select
                    value={coldStorageAvailable ? 'yes' : 'no'}
                    onChange={(e) => setColdStorageAvailable(e.target.value === 'yes')}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="yes">Yes - Active Cold Storage Available</option>
                    <option value="no">No - Dry Storage Only</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Primary Procurement Corridors</label>
                  <input
                    type="text"
                    value={productFocus}
                    onChange={(e) => setProductFocus(e.target.value)}
                    placeholder="East Shewa Corridor, Hawassa Corridor, Gojjam Grain Hub"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
            )}

            {/* RETAILER SPECIFIC FIELDS */}
            {selectedRole === 'retailer' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Retail Enterprise / Grocer Name</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g., Abyssinia Fresh Greens Supermarket"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Trade Registration / TIN</label>
                  <input
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="TIN 0072819024"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Retail Venue Type</label>
                  <select
                    value={retailLocationType}
                    onChange={(e) => setRetailLocationType(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="Central Fresh Produce Supermarket">Central Fresh Produce Supermarket</option>
                    <option value="Municipal Fresh Market Stall">Municipal Fresh Market Stall (አትክልት ተራ)</option>
                    <option value="Neighborhood Fresh Grocer">Neighborhood Fresh Grocer (ጉሊት / ግሮሰሪ)</option>
                    <option value="Hospitality / Restaurant Bulk Buyer">Hospitality / Hotel Bulk Purchaser</option>
                  </select>
                </div>
              </div>
            )}

            {/* DRIVER SPECIFIC FIELDS */}
            {selectedRole === 'driver' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Commercial Driver License Grade</label>
                  <select
                    value={driverLicenseGrade}
                    onChange={(e) => setDriverLicenseGrade(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    <option value="Commercial Grade 3 (Heavy Freight)">Commercial Grade 3 (Heavy Freight & Truck)</option>
                    <option value="Commercial Grade 2 (Medium Cargo)">Commercial Grade 2 (Medium Cargo & Pickups)</option>
                    <option value="Dry Cargo Heavy Combinations">Dry Cargo Heavy Combinations (Sino / Trailer)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold mb-1">Driver License Number</label>
                  <input
                    type="text"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="DL-ETH-2024-88192"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">License Expiry Date</label>
                  <input
                    type="date"
                    value={licenseExpiryDate}
                    onChange={(e) => setLicenseExpiryDate(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Vehicle Make & Model</label>
                  <input
                    type="text"
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    placeholder="e.g., Isuzu FSR 10-Ton Truck"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Commercial Plate Number</label>
                  <input
                    type="text"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value)}
                    placeholder="3-B-89210 ET"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold mb-1">Payload Capacity (Metric Tons)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={vehicleCapacityTons}
                    onChange={(e) => setVehicleCapacityTons(Number(e.target.value))}
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Cargo Transit Insurance Policy Number</label>
                  <input
                    type="text"
                    value={insurancePolicyNumber}
                    onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                    placeholder="NIC-CARGO-2026-8819"
                    className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                  />
                </div>
              </div>
            )}

            {/* Product interests — required on the backend dossier (PRODUCES /
                BUYS / SELLS), loaded from the catalogue rather than hardcoded. */}
            {selectedRole !== 'driver' && (
              <div>
                <label className="block font-semibold mb-2">
                  Products you {selectedRole === 'farmer' ? 'produce' : 'trade'}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <div className="max-h-56 overflow-y-auto scrollbar-thin p-2 rounded-xl border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {productTypeOptions.map((option) => {
                    const checked = selectedProductTypes.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setSelectedProductTypes((prev) =>
                              e.target.checked
                                ? [...prev, option.id]
                                : prev.filter((id) => id !== option.id)
                            )
                          }
                          className="rounded border-slate-300 text-[#15803D] focus:ring-[#15803D]"
                        />
                        <span className="text-slate-700 dark:text-slate-300">
                          {option.name}
                          <span className="text-[10px] text-slate-400"> · {option.category}</span>
                        </span>
                      </label>
                    );
                  })}
                  {productTypeOptions.length === 0 && (
                    <div className="text-[11px] text-slate-400 col-span-2 p-2">
                      Loading the product catalogue…
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {selectedProductTypes.length} selected
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(4)}
                className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center gap-2"
              >
                <span>Continue to Ethiopian Address</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Complete Ethiopian Location Hierarchy */}
        {step === 4 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#15803D]" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Step 4: Cascading Ethiopian Administrative Location
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Standard structure: <strong>Region → Zone / Sub-City → Wereda / Kifle Ketema → Kebele</strong> with bilingual English and Amharic labels.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Region Selector */}
              <div>
                <label className="block font-semibold mb-1">
                  Region / Charter City (ክልል / ከተማ አስተዳደር) <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedRegionId}
                  onChange={(e) => handleRegionChange(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  {availableRegions.map((reg) => (
                    <option key={reg.id} value={reg.id}>
                      {reg.nameEn} ({reg.nameAm}) {reg.isCharterCity ? '— Charter City' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Zone / Sub-City Selector */}
              <div>
                <label className="block font-semibold mb-1">
                  {currentRegion.subdivisionType} (ዞን / ክፍለ ከተማ) <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedZoneId}
                  onChange={(e) => handleZoneChange(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  {availableZones.map((zn) => (
                    <option key={zn.id} value={zn.id}>
                      {zn.nameEn} ({zn.nameAm})
                    </option>
                  ))}
                </select>
              </div>

              {/* Wereda / Kifle Ketema Selector */}
              <div>
                <label className="block font-semibold mb-1">
                  {currentRegion.weredaType} / District (ወረዳ) <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedWeredaId}
                  onChange={(e) => handleWeredaChange(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  {availableWeredas.map((wr) => (
                    <option key={wr.id} value={wr.id}>
                      {wr.nameEn} ({wr.nameAm})
                    </option>
                  ))}
                </select>
              </div>

              {/* Kebele / Sector Selector */}
              <div>
                <label className="block font-semibold mb-1">
                  Kebele / Local Sector (ቀበሌ) <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedKebele}
                  onChange={(e) => setSelectedKebele(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium"
                >
                  {availableKebeles.map((kb) => (
                    <option key={kb} value={kb}>
                      {kb}
                    </option>
                  ))}
                </select>
              </div>

              {/* Farm Plot or House / Facility Address */}
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">
                  Plot Reference / Warehouse Street Landmark (መለያ ወይም አድራሻ)
                </label>
                <input
                  type="text"
                  value={houseOrFarmPlot}
                  onChange={(e) => setHouseOrFarmPlot(e.target.value)}
                  placeholder="e.g., Holding #14, Sector C, Near Meki River Pump Station"
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            {/* Live Structured Address Preview */}
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                <span>Structured Administrative Address Preview:</span>
              </span>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {houseOrFarmPlot ? `${houseOrFarmPlot}, ` : ''}
                {selectedKebele}, {currentWereda?.nameEn}, {currentZone?.nameEn}, {currentRegion.nameEn}, Ethiopia
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Amharic: {selectedKebele}፣ {currentWereda?.nameAm}፣ {currentZone?.nameAm}፣ {currentRegion.nameAm}፣ ኢትዮጵያ
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center gap-2"
              >
                <span>Continue to License Uploads</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: Required License & Document Uploads */}
        {step === 5 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#15803D]" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Step 5: {selectedRole.toUpperCase()} Certification Document Uploads
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Attach certified regulatory scans. Only official Ministry, Municipal, or Regional authority stamps are accepted.
              </p>
            </div>

            {/* Role-Specific Document Upload Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {selectedRole === 'farmer' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDocAdd('farmer_license', 'Ministry Certified Farmer License')}
                    className="p-4 border-2 border-dashed border-[#15803D] rounded-xl hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-[#15803D]" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload MoA Farmer License
                      </div>
                      <div className="text-[10px] text-slate-400">PDF, JPG up to 10MB</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDocAdd('land_deed', 'Kebele Agricultural Land Holding Deed (Usufruct)')}
                    className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Land Holding Certificate
                      </div>
                      <div className="text-[10px] text-slate-400">Rural Land Administration Deed</div>
                    </div>
                  </button>
                </>
              )}

              {selectedRole === 'wholesaler' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDocAdd('business_license', 'MoTI Commercial Wholesale Trade License')}
                    className="p-4 border-2 border-dashed border-[#15803D] rounded-xl hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-[#15803D]" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Trade License (TIN Stamped)
                      </div>
                      <div className="text-[10px] text-slate-400">Ministry of Trade and Regional Integration</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDocAdd('tax_clearance', 'Tax Clearance Certificate (TIN Verification)')}
                    className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Tax Clearance (TIN)
                      </div>
                      <div className="text-[10px] text-slate-400">Ethiopian Revenues Authority</div>
                    </div>
                  </button>
                </>
              )}

              {selectedRole === 'retailer' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDocAdd('business_license', 'Municipal Retail Business License')}
                    className="p-4 border-2 border-dashed border-[#15803D] rounded-xl hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-[#15803D]" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Retail Business License
                      </div>
                      <div className="text-[10px] text-slate-400">Municipal Trade Bureau</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDocAdd('premises_proof', 'Business Premises Lease or Kebele Proof')}
                    className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Premises Lease / Kebele Proof
                      </div>
                      <div className="text-[10px] text-slate-400">Commercial stall verification</div>
                    </div>
                  </button>
                </>
              )}

              {selectedRole === 'driver' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDocAdd('driver_license', 'Commercial Driver License Grade 3')}
                    className="p-4 border-2 border-dashed border-[#15803D] rounded-xl hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-[#15803D]" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Commercial Driver License
                      </div>
                      <div className="text-[10px] text-slate-400">Federal Transport Authority Grade 3/2</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDocAdd('vehicle_title', 'Vehicle Libre & Roadworthiness Inspection')}
                    className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload Vehicle Libre & Inspection (ቦሎ)
                      </div>
                      <div className="text-[10px] text-slate-400">Active annual inspection pass</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDocAdd('national_id', 'National ID / Fayda Certificate')}
                    className="p-4 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-left flex items-center gap-3 transition-colors"
                  >
                    <Upload className="w-5 h-5 text-slate-500" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        Upload National ID / Fayda (ፋይዳ)
                      </div>
                      <div className="text-[10px] text-slate-400">Required for driver identity verification</div>
                    </div>
                  </button>
                </>
              )}
            </div>

            <input
              ref={docFileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleDocFileSelected}
              className="hidden"
            />

            {/* List of Attached Documents */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Attached Verification Documents ({uploadedDocs.length}):
              </div>
              {uploadedDocs.map((doc, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs flex items-center justify-between bg-slate-50 dark:bg-slate-800"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-[#15803D] flex items-center justify-center">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100">{doc.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {doc.size} • Verified Format
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDocRemove(idx)}
                    className="text-slate-400 hover:text-red-500 p-1 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(6)}
                className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg flex items-center gap-2"
              >
                <span>Continue to Final Review</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: Review All Submitted Information & Submit */}
        {step === 6 && (
          <div className="space-y-5 animate-in fade-in">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#15803D]" />
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                  Step 6: Review Registration & Regulatory Declaration
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Please verify all entered credentials before dispatching your dossier to the User Administrator accreditation desk.
              </p>
            </div>

            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Account Classification</span>
                  <div className="font-bold text-sm text-[#15803D] dark:text-emerald-400 capitalize">
                    {selectedRole} Accreditation
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Full Legal Name</span>
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {fullName || 'Bekele Desta Mamo'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Phone & Fayda ID</span>
                  <div className="text-slate-800 dark:text-slate-200 font-mono">
                    {phone} | {faydaId || 'ET-FAYDA-982109'}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Email Address</span>
                  <div className="text-slate-800 dark:text-slate-200">
                    {email || `${selectedRole}.registration@greenpath.et`}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400">Administrative Hierarchy Location</span>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {houseOrFarmPlot ? `${houseOrFarmPlot}, ` : ''}
                    {selectedKebele}, {currentWereda?.nameEn}, {currentZone?.nameEn}, {currentRegion.nameEn}, Ethiopia
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Business / Trade Focus</span>
                  <div className="text-slate-800 dark:text-slate-200">
                    {businessName || 'Meki Rift Valley Agro Holdings'} ({productFocus})
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Verification Documents Attached</span>
                  <div className="font-bold text-emerald-700 dark:text-emerald-400">
                    {uploadedDocs.length} Certified Files Attached
                  </div>
                </div>
              </div>
            </div>

            {/* Regulatory Declaration */}
            <label className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-[#15803D] focus:ring-[#15803D]"
              />
              <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                I solemnly certify that all submitted business licenses, land holding usufruct certificates, and driver credentials are authentic and comply with the Federal Ministry of Agriculture and Ethiopian trade regulations. I understand that false documentation results in immediate disqualification and civil trade lockout.
              </span>
            </label>

            {submitError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <button
                type="button"
                onClick={() => setStep(5)}
                className="px-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <button
                type="button"
                disabled={!agreedToTerms}
                onClick={handleFinalSubmit}
                className="px-6 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:bg-slate-400 text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Submit Application to Accreditation Bureau</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 3. FORGOT PASSWORD & RECOVERY PAGE
// ==========================================

export const ForgotPasswordPage: React.FC = () => {
  const { setActiveView } = useApp();
  const [identifier, setIdentifier] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 space-y-4">
        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950 text-[#15803D] rounded-xl flex items-center justify-center font-bold text-xl">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          Reset Your Platform Credentials
        </h2>
        <p className="text-xs text-slate-500">
          Enter your registered email address or Ethio Telecom / Safaricom phone number to receive a secure recovery OTP.
        </p>

        {!submitted ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
            className="space-y-4 text-xs"
          >
            <div>
              <label className="block font-semibold mb-1">Registered Phone or Email</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                placeholder="+251 91 142 8820 or name@greenpath.et"
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold rounded-lg shadow-sm"
            >
              Send 6-Digit Recovery SMS
            </button>
          </form>
        ) : !otpVerified ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOtpVerified(true);
            }}
            className="space-y-4 text-xs"
          >
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">
              One-Time Passcode (OTP) sent to <strong>{identifier || '+251 91 142 8820'}</strong>.
            </div>
            <div>
              <label className="block font-semibold mb-1">Enter 6-Digit OTP</label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="491028"
                required
                className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-center tracking-widest text-base"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-[#15803D] hover:bg-[#166534] text-white font-bold rounded-lg"
            >
              Verify Code & Reset Password
            </button>
          </form>
        ) : (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs space-y-3">
            <div className="font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>Password Reset Approved</span>
            </div>
            <p>
              Your security session has been validated. You may now sign in using your new credentials.
            </p>
            <button
              onClick={() => setActiveView('login')}
              className="w-full py-2 bg-[#15803D] text-white font-bold rounded-lg"
            >
              Back to Sign In
            </button>
          </div>
        )}

        <div className="text-center pt-2">
          <button
            onClick={() => setActiveView('login')}
            className="text-xs text-[#15803D] dark:text-emerald-400 font-bold hover:underline"
          >
            Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
};
