import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { api } from '../services/apiClient';
import { formatApiError } from '../lib/apiErrors';
import {
  mapProduct,
  mapOrder,
  mapTransaction,
  mapDeposit,
  mapPayout,
  mapBankAccount,
  mapConversation,
  mapMessage,
  mapAuditLog,
  mapPendingUser,
  mapRegistration,
  mapAdminUser,
  mapShipmentToWaybill,
  deriveRegionalMetrics,
  num,
  fmtDate,
} from '../services/adapters';
import {
  UserRole,
  Language,
  Product,
  Order,
  OrderStatus,
  Conversation,
  DepositRecord,
  WalletState,
  RegistrationApplication,
  PlatformConfig,
  UserProfile,
  DigitalWaybill,
  RegionalFinancialMetric,
  AuditLog,
  BankAccount,
  PayoutRequest,
} from '../types';

const LIST = (res: any): any[] =>
  Array.isArray(res?.data?.results) ? res.data.results : Array.isArray(res?.data) ? res.data : [];

const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  platformTitle: 'GreenPath Farm to Market AI',
  amharicTitle: 'ግሪንፓዝ የግብርና ገበያ AI',
  oromoTitle: 'GreenPath Gabaa Qonnaa AI',
  categories: ['Vegetables', 'Fruits', 'Grains', 'Pulses', 'Spices', 'Root Crops'],
  supportedRegions: [],
  security: {
    maxFailedAttempts: 3,
    lockoutDurationMinutes: 30,
    sessionTimeoutMinutes: 60,
    twoFactorRequiredForFinancial: false,
  },
  websiteContent: {
    platformTitle: 'GreenPath Farm to Market AI',
    amharicTitle: 'ግሪንፓዝ የግብርና ገበያ AI',
    oromoTitle: 'GreenPath Gabaa Qonnaa AI',
    heroHeadline: 'GreenPath Farm to Market AI',
    heroSubtitle: 'Intelligent agricultural marketplace connecting Ethiopian farmers, wholesalers, retailers, and drivers.',
    aboutDescription: '',
    contactEmail: 'support@greenpath.et',
    contactPhone: '+251 900 000 000',
    contactOffice: 'Addis Ababa, Ethiopia',
    faqItems: [],
  },
} as unknown as PlatformConfig;

export interface ReviewOutcome {
  ok: boolean;
  id?: string;
  status?: string;
  reference?: string;
  message: string;
}

interface AppContextType {
  currentRole: UserRole;
  setCurrentRole: (role: UserRole) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  currentUser: UserProfile;
  updateCurrentUser: (updates: Partial<UserProfile>) => void;
  syncAuthUser: (user: any) => void;
  activeView: string;
  setActiveView: (view: string) => void;

  // Products
  products: Product[];
  addProduct: (product: Omit<Product, 'id' | 'rating' | 'reviewCount'>) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;

  // Orders
  orders: Order[];
  updateOrderStatus: (orderId: string, status: OrderStatus, note?: string) => Promise<void>;
  createOrder: (productId: string, quantity: number, agreedPrice: number, corridor: string) => Promise<Order>;

  // Wallet & Financial
  wallet: WalletState;
  depositViaChapa: (amountETB: number, method: 'Chapa' | 'Telebirr' | 'CBE Birr' | 'Bank Transfer', reference: string) => Promise<void>;
  approveDeposit: (depositId: string) => Promise<ReviewOutcome>;
  flagDeposit: (depositId: string, reason: string) => Promise<ReviewOutcome>;
  rejectDeposit: (depositId: string, reason: string) => Promise<ReviewOutcome>;
  requestPayout: (amountETB: number, bankName: string, accountNumber: string, accountHolderName: string) => Promise<void>;
  approvePayout: (payoutId: string, externalReference?: string, notes?: string) => Promise<ReviewOutcome>;
  bankAccounts: BankAccount[];
  addBankAccount: (acc: Omit<BankAccount, 'id' | 'addedDate' | 'verificationStatus'>) => Promise<void>;
  setPrimaryBankAccount: (id: string) => Promise<void>;
  removeBankAccount: (id: string) => Promise<void>;

  // Applications & Users
  applications: RegistrationApplication[];
  updateApplicationStatus: (appId: string, status: 'approved' | 'rejected', notes?: string) => Promise<void>;
  submitRegistration: (
    application: Omit<RegistrationApplication, 'id' | 'submittedAt' | 'status'>,
    password: string,
    documents?: Array<{ file: File; documentType?: string }>,
    profile?: { dateOfBirth?: string; sex?: string; productTypeIds?: string[] }
  ) => Promise<RegistrationApplication>;
  allUsers: UserProfile[];
  updateUserVerification: (userId: string, status: UserProfile['verificationStatus'], note?: string) => Promise<void>;

  // Regional & Audit
  regionalMetrics: RegionalFinancialMetric[];
  auditLogs: AuditLog[];
  addAuditLog: (entry: Omit<AuditLog, 'id' | 'timestamp'>) => void;

  // Governance
  platformConfig: PlatformConfig;
  updatePlatformConfig: (newConfig: Partial<PlatformConfig>) => Promise<void>;

  // Messaging
  conversations: Conversation[];
  sendMessage: (conversationId: string, text: string, isAudio?: boolean, audioDuration?: string) => Promise<void>;

  // Logistics Waybills (Respecting DriverApp integration)
  waybills: DigitalWaybill[];

  // Notifications & Modals
  notification: string | null;
  setNotification: (msg: string | null) => void;
  aiModalOpen: boolean;
  setAiModalOpen: (open: boolean) => void;

  // Auth & Lockout
  failedLoginAttempts: number;
  isLockedOut: boolean;
  recordFailedLogin: () => void;
  resetLoginAttempts: () => void;
  authLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  markAuthenticated: (value: boolean) => void;
}

const EMPTY_WALLET: WalletState = {
  availableBalanceETB: 0,
  heldBalanceETB: 0,
  totalVolumeETB: 0,
  currency: 'ETB',
  transactions: [],
  deposits: [],
  payouts: [],
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentRole, setCurrentRoleState] = useState<UserRole>('public');
  const [language, setLanguage] = useState<Language>('en');
  const [activeView, setActiveView] = useState<string>('landing');
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [applications, setApplications] = useState<RegistrationApplication[]>([]);
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig>(DEFAULT_PLATFORM_CONFIG);
  const [regionalMetrics, setRegionalMetrics] = useState<RegionalFinancialMetric[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [waybills, setWaybills] = useState<DigitalWaybill[]>([]);

  // User profiles list
  const [userProfiles, setUserProfiles] = useState<Record<string, UserProfile>>({});
  const [allUsersList, setAllUsersList] = useState<UserProfile[]>([]);

  // Global Notification & AI Assistant
  const [notification, setNotification] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState<boolean>(false);

  // Lockout State
  const [failedLoginAttempts, setFailedLoginAttempts] = useState<number>(0);
  const [isLockedOut, setIsLockedOut] = useState<boolean>(false);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  const currentUser = (userProfiles[currentRole] || userProfiles.farmer || {}) as UserProfile;
  const loadedRoleRef = useRef<string | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);

  // The backend wraps DRF errors as {success: false, error: <string | object>},
  // so a serializer error reaches us as an object. Rendering that object directly
  // crashes React outside the ErrorBoundary and blanks the app. Normalise every
  // notification to a string before it enters state.
  const notificationText = (msg: unknown): string | null => {
    if (msg === null || msg === undefined) return null;
    if (typeof msg === 'string') return msg.trim() ? msg : null;
    const text = formatApiError({ response: { data: msg } }, 'Something went wrong.');
    return text || 'Something went wrong.';
  };

  const showNotification = (msg: unknown) => {
    const text = notificationText(msg);
    setNotification(text);
    if (text) {
      setTimeout(() => {
        setNotification(null);
      }, 4500);
    }
  };

  const recordFailedLogin = () => {
    const nextAttempts = failedLoginAttempts + 1;
    setFailedLoginAttempts(nextAttempts);
    if (nextAttempts >= platformConfig.security.maxFailedAttempts) {
      setIsLockedOut(true);
      setTimeout(() => {
        setIsLockedOut(false);
        setFailedLoginAttempts(0);
      }, platformConfig.security.lockoutDurationMinutes * 60 * 1000);
    }
  };

  const resetLoginAttempts = () => {
    setFailedLoginAttempts(0);
    setIsLockedOut(false);
  };

  const markAuthenticated = (value: boolean) => setIsAuthenticated(value);

  const logout = async () => {
    try {
      await api.auth.logout();
    } catch (e) {
      // ignore
    }
    localStorage.removeItem('greenpath_auth_token');
    localStorage.removeItem('greenpath_registration_token');
    // Forget every trace of the previous account so the next sign-in starts clean.
    sessionUserIdRef.current = null;
    loadedRoleRef.current = null;
    setIsAuthenticated(false);
    setAuthLoading(false);
    setCurrentRoleState('public' as UserRole);
    setUserProfiles({});
    setAllUsersList([]);
    setProducts([]);
    setOrders([]);
    setConversations([]);
    setWallet(EMPTY_WALLET);
    setApplications([]);
    setAuditLogs([]);
    setRegionalMetrics([]);
    setBankAccounts([]);
    setWaybills([]);
    setActiveView('landing');
  };

  // ---- Data loaders (all dynamic, from the Django backend) ------------------

  const loadWalletData = useCallback(async () => {
    // Load each view independently: a failure in the summary must not prevent
    // the Financial Manager's deposit and payout queues from refreshing.
    const [summaryRes, txRes, fundingRes, payoutsRes, banksRes] = await Promise.allSettled([
      api.wallet.summary(),
      api.wallet.transactions({ page_size: 100 }),
      api.wallet.funding({ page_size: 100 }),
      api.wallet.payouts({ page_size: 100 }),
      api.wallet.bankAccounts({ page_size: 100 }),
    ]);
    const s = summaryRes.status === 'fulfilled' ? summaryRes.value.data || {} : {};
    const transactions = txRes.status === 'fulfilled' ? LIST(txRes.value).map(mapTransaction) : [];
    const deposits = fundingRes.status === 'fulfilled' ? LIST(fundingRes.value).map(mapDeposit) : [];
    const payouts = payoutsRes.status === 'fulfilled' ? LIST(payoutsRes.value).map(mapPayout) : [];
    const bankAccs = banksRes.status === 'fulfilled' ? LIST(banksRes.value).map(mapBankAccount) : [];
    if (banksRes.status === 'fulfilled') setBankAccounts(bankAccs);
    setWallet((previous) => ({
      availableBalanceETB:
        summaryRes.status === 'fulfilled' ? num(s.available_balance) : previous.availableBalanceETB,
      heldBalanceETB:
        summaryRes.status === 'fulfilled' ? num(s.held_balance) : previous.heldBalanceETB,
      totalVolumeETB:
        summaryRes.status === 'fulfilled'
          ? num(s.incoming_total) + num(s.outgoing_total)
          : previous.totalVolumeETB,
      currency: s.currency || previous.currency || 'ETB',
      transactions: txRes.status === 'fulfilled' ? transactions : previous.transactions,
      deposits: fundingRes.status === 'fulfilled' ? deposits : previous.deposits,
      payouts: payoutsRes.status === 'fulfilled' ? payouts : previous.payouts,
    }));
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const res = await api.orders.list({ page_size: 100 });
      setOrders(LIST(res).map(mapOrder));
    } catch {
      setOrders([]);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.chat.channels({ page_size: 50 });
      const channels = LIST(res);
      const withMessages = await Promise.all(
        channels.slice(0, 20).map(async (ch: any) => {
          try {
            const msgRes = await api.chat.messages(ch.id, { page_size: 50 });
            return mapConversation(ch, LIST(msgRes));
          } catch {
            return mapConversation(ch, []);
          }
        })
      );
      setConversations(withMessages);
    } catch {
      setConversations([]);
    }
  }, []);

  const loadWaybills = useCallback(async () => {
    try {
      const res = await api.payments.shipments({ page_size: 100 });
      setWaybills(LIST(res).map(mapShipmentToWaybill));
    } catch {
      setWaybills([]);
    }
  }, []);

  const loadAdminData = useCallback(async () => {
    const results = await Promise.allSettled([
      api.admin.pendingUsers({ page_size: 100 }),
      api.admin.registrations({ page_size: 100 }),
      api.admin.users({ page_size: 200 }),
      api.superadmin.audit({ page_size: 100 }),
    ]);
    const [pending, registrations, users, audit] = results;
    const apps: RegistrationApplication[] = [];
    if (pending.status === 'fulfilled') apps.push(...LIST(pending.value).map(mapPendingUser));
    if (registrations.status === 'fulfilled')
      apps.push(...LIST(registrations.value).map(mapRegistration).filter((a: RegistrationApplication) => a.status === 'pending'));
    setApplications(apps);
    if (users.status === 'fulfilled') {
      const mapped = LIST(users.value).map(mapAdminUser);
      setAllUsersList(mapped);
    }
    if (audit.status === 'fulfilled') setAuditLogs(LIST(audit.value).map(mapAuditLog));
  }, []);

  const loadRegionalMetrics = useCallback(async () => {
    try {
      const res = await api.admin.users({ page_size: 200 });
      const users = LIST(res).map(mapAdminUser);
      let payments: any[] = [];
      try {
        const payRes = await api.payments.list({ page_size: 100 });
        payments = LIST(payRes);
      } catch {
        /* non-finance roles cannot list payments */
      }
      setRegionalMetrics(deriveRegionalMetrics(users, payments));
    } catch {
      setRegionalMetrics([]);
    }
  }, []);

  const loadProductsForRole = useCallback(async (role: UserRole) => {
    const attempts: Array<() => Promise<any[]>> = [];
    if (role === 'farmer') {
      attempts.push(async () => LIST(await api.products.myFarmerListings({ page_size: 100 })));
    } else if (role === 'wholesaler') {
      attempts.push(
        async () => LIST(await api.products.farmerListings({ page_size: 100 })),
        async () => LIST(await api.products.myWholesalerListings({ page_size: 100 }))
      );
    } else if (role === 'retailer') {
      attempts.push(async () => LIST(await api.products.wholesalerListings({ page_size: 100 })));
    } else {
      attempts.push(
        async () => LIST(await api.products.farmerListings({ page_size: 100 })),
        async () => LIST(await api.products.wholesalerListings({ page_size: 100 }))
      );
    }
    for (const load of attempts) {
      try {
        const rows = await load();
        if (rows.length) {
          setProducts(rows.map(mapProduct));
          return;
        }
      } catch {
        /* try next source */
      }
    }
    setProducts([]);
  }, []);

  const loadPlatformConfig = useCallback(async (role: UserRole) => {
    try {
      if (role === 'super_admin') {
        const [settingsRes, contentRes] = await Promise.all([
          api.superadmin.settings().catch(() => null),
          api.superadmin.websiteContent().catch(() => null),
        ]);
        const settings = settingsRes?.data?.settings || {};
        const content = contentRes?.data?.content || contentRes?.data || {};
        setPlatformConfig((prev) => ({
          ...prev,
          platformTitle: contentRes?.data?.platform_name || prev.platformTitle,
          security: {
            ...prev.security,
            maxFailedAttempts: num(settings.max_failed_login_attempts, prev.security.maxFailedAttempts),
            lockoutDurationMinutes: num(settings.lockout_duration_minutes, prev.security.lockoutDurationMinutes),
          },
          websiteContent: {
            ...prev.websiteContent,
            ...(content as any),
            heroHeadline: (content as any).landing_title || prev.websiteContent.heroHeadline,
            heroSubtitle: (content as any).landing_subtitle || prev.websiteContent.heroSubtitle,
            aboutDescription: (content as any).about_description || prev.websiteContent.aboutDescription,
            contactEmail: (content as any).contact_email || prev.websiteContent.contactEmail,
            contactPhone: (content as any).contact_phone || prev.websiteContent.contactPhone,
          },
        }));
        return;
      }
    } catch {
      /* fall back to defaults */
    }
    try {
      const res = await api.auth.websiteContent();
      const content = res.data?.content || {};
      setPlatformConfig((prev) => ({
        ...prev,
        platformTitle: res.data?.platform_name || prev.platformTitle,
        websiteContent: {
          ...prev.websiteContent,
          ...(content as any),
          heroHeadline: (content as any).landing_title || prev.websiteContent.heroHeadline,
          heroSubtitle: (content as any).landing_subtitle || prev.websiteContent.heroSubtitle,
          aboutDescription: (content as any).about_description || prev.websiteContent.aboutDescription,
          contactEmail: (content as any).contact_email || prev.websiteContent.contactEmail,
          contactPhone: (content as any).contact_phone || prev.websiteContent.contactPhone,
        },
      }));
    } catch {
      /* keep defaults */
    }
  }, []);

  const loadRoleData = useCallback(
    async (role: UserRole) => {
      loadedRoleRef.current = role;
      await Promise.allSettled([
        loadProductsForRole(role),
        loadOrders(),
        loadWalletData(),
        loadConversations(),
        loadWaybills(),
        loadPlatformConfig(role),
      ]);
      const staffRoles: UserRole[] = ['user_admin', 'top_user_admin', 'super_admin', 'financial_manager'];
      if (staffRoles.includes(role)) {
        await Promise.allSettled([loadAdminData(), loadRegionalMetrics()]);
      }
    },
    [loadProductsForRole, loadOrders, loadWalletData, loadConversations, loadWaybills, loadPlatformConfig, loadAdminData, loadRegionalMetrics]
  );

  // Session restoration on app load
  useEffect(() => {
    const token = localStorage.getItem('greenpath_auth_token');
    if (!token) {
      setAuthLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.auth.me();
        const data = res.data;
        if (cancelled) return;
        if (data?.success && data?.user) {
          syncAuthUserRef.current(data.user);
        } else {
          localStorage.removeItem('greenpath_auth_token');
          setIsAuthenticated(false);
        }
      } catch (err) {
        if (!cancelled) {
          localStorage.removeItem('greenpath_auth_token');
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setCurrentRole = (role: UserRole) => {
    setCurrentRoleState(role);
    showNotification(`Active role switched to: ${role.replace('_', ' ').toUpperCase()}`);
  };

  const updateCurrentUser = async (updates: Partial<UserProfile>) => {
    setUserProfiles((prev) => ({
      ...prev,
      [currentRole]: {
        ...prev[currentRole],
        ...updates,
      },
    }));
    // Persist to backend profile
    try {
      const payload: any = {};
      if (updates.name) payload.full_name = updates.name;
      if (updates.phone !== undefined) payload.phone = updates.phone;
      if (updates.region) payload.location = updates.region;
      if (Object.keys(payload).length) await api.auth.updateProfile(payload);
      showNotification('Profile information saved successfully.');
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Profile saved locally, but the server rejected some fields.');
    }
  };

  const syncAuthUser = (u: any) => {
    if (!u) return;
    const incomingId = String(u.id ?? '');

    // A different account signed in (or the same browser was reused): drop the
    // previous account's cached role data instead of showing it under the new
    // user's name.
    if (sessionUserIdRef.current && sessionUserIdRef.current !== incomingId) {
      loadedRoleRef.current = null;
      setProducts([]);
      setOrders([]);
      setConversations([]);
      setWallet(EMPTY_WALLET);
      setApplications([]);
      setAuditLogs([]);
      setRegionalMetrics([]);
      setBankAccounts([]);
      setWaybills([]);
      setUserProfiles({});
      setAllUsersList([]);
    }
    sessionUserIdRef.current = incomingId;

    const backendRole = String(u.role || '').toUpperCase();
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
    setUserProfiles((prev) => ({
      ...prev,
      [role]: {
        ...(prev[role] || {}),
        id: String(u.id),
        name: u.full_name || u.email,
        email: u.email,
        phone: u.phone || '',
        role,
        verificationStatus: u.status === 'APPROVED' ? 'verified' : 'pending',
        avatarUrl: u.profile_photo
          ? u.profile_photo.startsWith('http')
            ? u.profile_photo
            : `${(import.meta.env.VITE_MEDIA_URL || 'http://localhost:8000').replace(/\/$/, '')}${u.profile_photo}`
          : undefined,
        region: u.location || '',
        zone: '',
        wereda: '',
        registrationDate: fmtDate(u.created_at).split(',')[0] || new Date().toISOString(),
        documents: [],
      } as UserProfile,
    }));
    setCurrentRoleState(role);
    setIsAuthenticated(true);
    if (loadedRoleRef.current !== role) {
      loadRoleData(role);
    }
  };

  // Keep a stable ref so the session-restore effect can call the latest syncAuthUser.
  const syncAuthUserRef = useRef(syncAuthUser);
  syncAuthUserRef.current = syncAuthUser;

  // ---- Products -------------------------------------------------------------

  const listingKind = currentRole === 'wholesaler' ? 'wholesaler' : 'farmer';

  const addProduct = async (newProd: Omit<Product, 'id' | 'rating' | 'reviewCount'>) => {
    const payload = {
      title: newProd.title,
      description: newProd.description,
      category: newProd.category === 'Legumes & Pulses' ? 'Pulses' : newProd.category,
      quantity: newProd.availableQuantity,
      unit_of_measure: newProd.unit.startsWith('quintal')
        ? 'quintal'
        : newProd.unit.startsWith('crate')
          ? 'crate'
          : newProd.unit === 'ton'
            ? 'ton'
            : 'kg',
      price_per_unit: newProd.pricePerUnitETB,
    };
    try {
      const res =
        listingKind === 'wholesaler'
          ? await api.products.createWholesalerListing(payload)
          : await api.products.createFarmerListing(payload);
      const created = res.data?.product || res.data;
      setProducts((prev) => [mapProduct(created), ...prev]);
      showNotification(`New produce listing "${newProd.title}" published!`);
    } catch (e: any) {
      const err = e?.response?.data?.error || e?.response?.data;
      const msg = typeof err === 'string' ? err : Object.values(err || {})[0] || 'Failed to publish listing';
      showNotification(`Listing failed: ${msg}`);
      throw e;
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    try {
      if (updates.status) {
        if (updates.status === 'sold_out') {
          await api.products.markSoldFarmerListing(id);
        } else if (updates.status === 'low_stock') {
          await api.products.deactivateFarmerListing(id);
        } else {
          await api.products.activateFarmerListing(id);
        }
      }
      const fields: any = {};
      if (updates.title) fields.title = updates.title;
      if (updates.description !== undefined) fields.description = updates.description;
      if (updates.availableQuantity !== undefined) fields.quantity = updates.availableQuantity;
      if (updates.pricePerUnitETB !== undefined) fields.price_per_unit = updates.pricePerUnitETB;
      if (Object.keys(fields).length) {
        await (listingKind === 'wholesaler'
          ? api.products.updateWholesalerListing(id, fields)
          : api.products.updateFarmerListing(id, fields));
      }
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
      showNotification('Produce listing updated successfully.');
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Failed to update listing.');
      throw e;
    }
  };

  const deleteProduct = async (id: string) => {
    try {
      await (listingKind === 'wholesaler'
        ? api.products.deleteWholesalerListing(id)
        : api.products.deleteFarmerListing(id));
      setProducts((prev) => prev.filter((p) => p.id !== id));
      showNotification('Produce listing deactivated.');
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Failed to delete listing.');
    }
  };

  // ---- Orders ----------------------------------------------------------------

  const createOrder = async (
    productId: string,
    quantity: number,
    agreedPrice: number,
    corridor: string
  ): Promise<Order> => {
    const targetProduct = products.find((p) => p.id === productId);
    try {
      const res = await api.orders.create({
        product: productId,
        quantity,
        agreed_price_per_unit: agreedPrice,
      });
      const raw = res.data?.order || res.data;
      const newOrder = mapOrder(raw);
      setOrders((prev) => [newOrder, ...prev]);
      showNotification(`Order ${newOrder.orderNumber} created!`);
      loadWalletData();
      return newOrder;
    } catch (e: any) {
      const err = e?.response?.data?.error || e?.response?.data;
      const msg = typeof err === 'string' ? err : Object.values(err || {})[0] || 'Order failed';
      showNotification(`Order failed: ${msg}`);
      throw e;
    }
  };

  const updateOrderStatus = async (orderId: string, nextStatus: OrderStatus, note?: string) => {
    const order = orders.find((o) => o.id === orderId);
    try {
      if (nextStatus === 'Quality Confirmation') {
        await api.orders.confirmQuality(orderId, { note });
      } else if (nextStatus === 'Payment Release') {
        await api.orders.release(orderId, { note });
      } else if (nextStatus === 'Completed') {
        if (order?.status === 'Payment Release') await api.orders.release(orderId, { note });
      } else if (nextStatus === 'Disputed') {
        await api.orders.dispute(orderId, { reason: note });
      } else if (nextStatus === 'Cancelled' || nextStatus === 'Rejected') {
        await api.orders.updateStatus(orderId, { status: nextStatus, note });
      } else if (nextStatus === 'Seller Approval') {
        await api.orders.updateStatus(orderId, { status: 'Accepted', note });
      } else {
        await api.orders.updateStatus(orderId, { status: nextStatus, note });
      }
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status: nextStatus,
                escrowStatus:
                  nextStatus === 'Payment Release' || nextStatus === 'Completed'
                    ? 'released'
                    : nextStatus === 'Rejected' || nextStatus === 'Cancelled'
                      ? 'refunded'
                      : o.escrowStatus,
                timeline: [
                  ...o.timeline,
                  { stage: nextStatus, timestamp: new Date().toLocaleTimeString(), note: note || `Order advanced to ${nextStatus}` },
                ],
              }
            : o
        )
      );
      showNotification(`Order status updated: ${nextStatus}`);
      loadWalletData();
    } catch (e: any) {
      showNotification(e?.response?.data?.error || `Failed to update order to ${nextStatus}.`);
      throw e;
    }
  };

  // ---- Wallet & finance --------------------------------------------------------

  const depositViaChapa = async (
    amountETB: number,
    method: 'Chapa' | 'Telebirr' | 'CBE Birr' | 'Bank Transfer',
    reference: string
  ) => {
    try {
      if (method === 'Chapa') {
        const res = await api.wallet.chapaInitialize({ amount: amountETB });
        const checkoutUrl = res.data?.checkout_url;
        if (checkoutUrl) {
          window.open(checkoutUrl, '_blank');
        }
        showNotification(`Chapa checkout initialized for ${amountETB.toLocaleString()} ETB.`);
      } else {
        await api.wallet.createFunding({
          amount: amountETB,
          payment_method: method,
          external_reference: reference,
        });
        showNotification(`Deposit request submitted (${reference}). Awaiting Financial Manager verification.`);
      }
      loadWalletData();
    } catch (e: any) {
      showNotification(`Deposit failed: ${formatApiError(e, 'The deposit request was rejected.')}`);
    }
  };

  const approveDeposit = async (depositId: string): Promise<ReviewOutcome> => {
    try {
      const response = await api.wallet.reviewFunding(depositId, {
        approve: true,
        notes: 'Deposit verified by Financial Manager.',
      });
      const funding = response?.data?.funding_request || {};
      const reference = funding.external_reference || depositId;
      const status = funding.status || 'VERIFIED';
      const message = `Deposit ${reference} ${String(status).toLowerCase()}. Wallet credited and ledger entry recorded.`;
      showNotification(message);
      await loadWalletData();
      return { ok: true, id: String(funding.id || depositId), status, reference, message };
    } catch (e) {
      const message = formatApiError(e, 'Failed to verify deposit.');
      showNotification(message);
      return { ok: false, id: depositId, message };
    }
  };

  const flagDeposit = async (depositId: string, reason: string): Promise<ReviewOutcome> => {
    try {
      // Flagging is a dedicated backend action: the deposit moves to FLAGGED and
      // no ledger entry is written, so it is never confused with a rejection.
      const response = await api.wallet.flagFunding(depositId, { reason });
      const funding = response?.data?.funding_request || {};
      const reference = funding.external_reference || depositId;
      const message = `Deposit ${reference} flagged for investigation: ${reason}`;
      showNotification(message);
      await loadWalletData();
      return {
        ok: true,
        id: String(funding.id || depositId),
        status: funding.status || 'FLAGGED',
        reference,
        message,
      };
    } catch (e) {
      const message = formatApiError(e, 'Failed to flag deposit.');
      showNotification(message);
      return { ok: false, id: depositId, message };
    }
  };

  const rejectDeposit = async (depositId: string, reason: string): Promise<ReviewOutcome> => {
    try {
      const response = await api.wallet.reviewFunding(depositId, {
        approve: false,
        notes: reason,
      });
      const funding = response?.data?.funding_request || {};
      const reference = funding.external_reference || depositId;
      const message = `Deposit ${reference} rejected: ${reason}`;
      showNotification(message);
      await loadWalletData();
      return {
        ok: true,
        id: String(funding.id || depositId),
        status: funding.status || 'REJECTED',
        reference,
        message,
      };
    } catch (e) {
      const message = formatApiError(e, 'Failed to reject deposit.');
      showNotification(message);
      return { ok: false, id: depositId, message };
    }
  };

  const requestPayout = async (
    amountETB: number,
    _bankName: string,
    _accountNumber: string,
    _accountHolderName: string
  ) => {
    if (amountETB > (wallet.availableBalanceETB || 0)) {
      showNotification('Insufficient available balance for payout.');
      return;
    }
    try {
      const primary = bankAccounts.find((b) => b.isPrimary) || bankAccounts[0];
      await api.wallet.createPayout({
        amount: amountETB,
        destination: primary ? `${primary.bankName} ${primary.maskedAccountNumber}` : _bankName,
        payout_account: primary?.id,
      });
      showNotification(`Payout request for ${amountETB.toLocaleString()} ETB submitted.`);
      loadWalletData();
    } catch (e: any) {
      showNotification(`Payout failed: ${formatApiError(e, 'The payout request was rejected.')}`);
    }
  };

  const approvePayout = async (
    payoutId: string,
    externalReference = '',
    notes = 'Approved for disbursement.'
  ): Promise<ReviewOutcome> => {
    try {
      const response = await api.wallet.reviewPayout(payoutId, {
        approve: true,
        ...(externalReference.trim()
          ? { external_reference: externalReference.trim() }
          : {}),
        notes,
      });
      const payout = response?.data?.payout_request || {};
      const reference = payout.external_reference || externalReference.trim() || payoutId;
      const status = payout.status || 'PAID';
      const message = externalReference.trim()
        ? `Payout ${reference} approved and recorded.`
        : `Payout ${reference} approved and sent through the Chapa sandbox transfer rail.`;
      showNotification(message);
      await loadWalletData();
      return { ok: true, id: String(payout.id || payoutId), status, reference, message };
    } catch (e) {
      const message = formatApiError(e, 'Failed to approve payout.');
      showNotification(message);
      return { ok: false, id: payoutId, message };
    }
  };

  const addBankAccount = async (acc: Omit<BankAccount, 'id' | 'addedDate' | 'verificationStatus'>) => {
    try {
      const banksRes = await api.wallet.banks();
      const banks = LIST(banksRes);
      const bank = banks.find((b: any) =>
        String(b.name || '').toLowerCase().includes(String(acc.bankName).toLowerCase().slice(0, 6))
      ) || banks[0];
      await api.wallet.addBankAccount({
        bank: bank?.id,
        account_holder_name: acc.accountHolderName,
        account_number: acc.accountNumber,
        confirm_account_number: acc.accountNumber,
        account_type: acc.accountType,
        is_default: acc.isPrimary,
      });
      showNotification(`Bank account ${acc.bankName} added.`);
      const refreshed = await api.wallet.bankAccounts({ page_size: 100 });
      setBankAccounts(LIST(refreshed).map(mapBankAccount));
    } catch (e: any) {
      const err = e?.response?.data?.error || e?.response?.data;
      const msg = typeof err === 'string' ? err : Object.values(err || {})[0] || 'Failed to add bank account';
      showNotification(`Bank account failed: ${msg}`);
    }
  };

  const setPrimaryBankAccount = async (id: string) => {
    try {
      await api.wallet.updateBankAccount(id, { is_default: true });
      setBankAccounts((prev) => prev.map((b) => ({ ...b, isPrimary: b.id === id })));
      showNotification('Primary disbursement account updated.');
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Failed to set primary account.');
    }
  };

  const removeBankAccount = async (id: string) => {
    try {
      await api.wallet.deleteBankAccount(id);
      setBankAccounts((prev) => prev.filter((b) => b.id !== id));
      showNotification('Bank account removed.');
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Failed to remove bank account.');
    }
  };

  // ---- Applications & users -----------------------------------------------------

  /** Resolve the region → zone → wereda names picked in the wizard to the
   *  deepest active AdministrativeLocation id the backend accepts. */
  const resolveRegistrationLocation = async (
    region: string,
    zone: string,
    wereda: string
  ): Promise<string | null> => {
    const norm = (value: string) => String(value || '').trim().toLowerCase();
    type Node = { id: string; name: string; has_children?: boolean };
    const childrenOf = async (parentId?: string) => {
      const res = await api.registration.locations(parentId ? { parent_id: parentId } : undefined);
      const rows = Array.isArray(res?.data) ? res.data : res?.data?.results || [];
      return rows as Node[];
    };
    const pick = (rows: Node[], target: string) => {
      const wanted = norm(target);
      if (!wanted) return undefined;
      return (
        rows.find((row) => norm(row.name) === wanted) ||
        rows.find((row) => norm(row.name).includes(wanted) || wanted.includes(norm(row.name)))
      );
    };

    try {
      const regionNode = pick(await childrenOf(), region);
      if (!regionNode) return null;
      let current: Node = regionNode;
      for (const target of [zone, wereda]) {
        const children = await childrenOf(current.id);
        if (children.length === 0) break;
        // Fall back to the first child when the wizard's name does not exist in
        // the administrative dataset, so a valid deepest location is still saved.
        current = pick(children, target) || children[0];
      }
      // The backend only accepts a leaf, so descend while children remain.
      for (let depth = 0; depth < 4 && current.has_children; depth += 1) {
        const children = await childrenOf(current.id);
        if (children.length === 0) break;
        current = children[0];
      }
      return current.id;
    } catch {
      return null;
    }
  };

  const submitRegistration = async (
    appData: Omit<RegistrationApplication, 'id' | 'submittedAt' | 'status'>,
    password: string,
    documents: Array<{ file: File; documentType?: string }> = [],
    profile: { dateOfBirth?: string; sex?: string; productTypeIds?: string[] } = {}
  ): Promise<RegistrationApplication> => {
    try {
      const res = await api.auth.register({
        email: appData.email.trim(),
        password,
        full_name: appData.fullName.trim(),
        phone: appData.phone.trim(),
        role: appData.role.toUpperCase(),
        location: appData.region,
        privacy_policy_accepted: true,
      });
      const user = res.data?.user || {};
      const completionToken = res.data?.completion_token;
      if (completionToken) {
        localStorage.setItem('greenpath_registration_token', completionToken);
      }

      try {
        // Persist the dossier fields the backend keeps on UserRegistration.
        const locationId = await resolveRegistrationLocation(
          appData.region,
          appData.zone,
          appData.wereda
        );
        const dossier: Record<string, any> = { phone: appData.phone.trim() };
        if (locationId) dossier.location = locationId;
        if (profile.dateOfBirth) dossier.date_of_birth = profile.dateOfBirth;
        if (profile.sex) dossier.sex = profile.sex;
        if (profile.productTypeIds?.length) {
          const intent =
            appData.role === 'farmer'
              ? 'PRODUCES'
              : appData.role === 'wholesaler'
              ? 'BUYS'
              : 'BUYS';
          dossier.product_selections = profile.productTypeIds.map((id) => ({
            product_type: id,
            intent,
          }));
        }
        if (appData.businessName?.trim()) dossier.business_name = appData.businessName.trim();
        const address = [appData.wereda, appData.zone, appData.region]
          .filter(Boolean)
          .join(', ');
        if (address) dossier.business_address = address;
        if (appData.role === 'driver') {
          if (appData.licenseNumber?.trim()) {
            dossier.driving_license_number = appData.licenseNumber.trim();
          }
          if (appData.licenseExpiryDate) dossier.license_expiry = appData.licenseExpiryDate;
          if (appData.vehicleModel?.trim()) dossier.vehicle_type = appData.vehicleModel.trim();
          if (appData.vehiclePlate?.trim()) {
            dossier.vehicle_registration = appData.vehiclePlate.trim();
          }
          const capacityKg = Number(appData.vehicleCapacityTons || 0) * 1000;
          if (capacityKg > 0) dossier.cargo_capacity_kg = capacityKg;
        }
        await api.registration.updateMe(dossier);

        for (const document of documents) {
          if (document?.file) {
            await api.registration.uploadDocument(document.file, document.documentType);
          }
        }

        await api.registration.submit({ confirm: true });
      } finally {
        localStorage.removeItem('greenpath_registration_token');
      }

      const newApp: RegistrationApplication = {
        ...appData,
        id: String(user.id),
        trackingNumber: String(user.id),
        submittedAt: new Date().toLocaleString(),
        status: 'pending',
        currentStage: 2,
      };
      setApplications((prev) => [newApp, ...prev]);
      showNotification(
        `Registration for ${appData.email} submitted. Use this email and your password to sign in once approved.`
      );
      return newApp;
    } catch (e: any) {
      const err = e?.response?.data?.error || e?.response?.data;
      const detail =
        err && typeof err === 'object' && !Array.isArray(err)
          ? Object.entries(err)
              .map(([field, message]) =>
                `${field}: ${Array.isArray(message) ? message[0] : message}`
              )
              .join(' ')
          : err;
      const msg = typeof detail === 'string' ? detail : 'Registration failed';
      showNotification(`Registration failed: ${msg}`);
      throw e;
    }
  };

  const updateApplicationStatus = async (appId: string, status: 'approved' | 'rejected', notes?: string) => {
    try {
      // Pending marketplace accounts are approved via the admin users endpoints;
      // full registration dossiers use the registrations decision endpoint.
      try {
        if (status === 'approved') await api.admin.approveUser(appId);
        else await api.admin.rejectUser(appId, notes);
      } catch {
        await api.admin.registrationDecision(appId, {
          action: status === 'approved' ? 'APPROVE' : 'REJECT',
          reason: notes || '',
        });
      }
      setApplications((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, status, reviewerNotes: notes } : a))
      );
      showNotification(`Application ${status}.`);
      loadAdminData();
    } catch (e: any) {
      showNotification(e?.response?.data?.error || `Failed to ${status} application.`);
    }
  };

  const updateUserVerification = async (
    userId: string,
    status: UserProfile['verificationStatus'],
    note?: string
  ) => {
    try {
      if (status === 'verified') await api.admin.approveUser(userId);
      else if (status === 'suspended') await api.admin.suspendUser(userId, note);
      else if (status === 'unverified') await api.admin.rejectUser(userId, note);
      setAllUsersList((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, verificationStatus: status } : u))
      );
      showNotification(`User verification status set to: ${status}`);
    } catch (e: any) {
      showNotification(e?.response?.data?.error || `Failed to update user.`);
    }
  };

  const addAuditLog = (entry: Omit<AuditLog, 'id' | 'timestamp'>) => {
    // The backend records audit events server-side; this only mirrors locally.
    setAuditLogs((prev) => [
      { ...entry, id: `aud_${Date.now()}`, timestamp: new Date().toLocaleString() },
      ...prev,
    ]);
  };

  const updatePlatformConfig = async (newConfig: Partial<PlatformConfig>) => {
    setPlatformConfig((prev) => ({ ...prev, ...newConfig }));
    try {
      if (
        currentRole === 'super_admin' &&
        (newConfig.websiteContent || newConfig.platformTitle)
      ) {
        const content = newConfig.websiteContent;
        const contentPayload: Record<string, string> = {};
        if (content?.heroHeadline) contentPayload.landing_title = content.heroHeadline;
        if (content?.heroSubtitle) contentPayload.landing_subtitle = content.heroSubtitle;
        if (content?.aboutDescription) contentPayload.about_description = content.aboutDescription;
        if (content?.contactEmail) contentPayload.contact_email = content.contactEmail;
        if (content?.contactPhone) contentPayload.contact_phone = content.contactPhone;
        await api.superadmin.updateWebsiteContent({
          ...(newConfig.platformTitle ? { platform_name: newConfig.platformTitle } : {}),
          ...(Object.keys(contentPayload).length ? { content: contentPayload } : {}),
        });
      }
      if (currentRole === 'super_admin' && newConfig.security) {
        await api.superadmin.updateSettings({
          max_failed_login_attempts: newConfig.security.maxFailedAttempts,
          lockout_duration_minutes: newConfig.security.lockoutDurationMinutes,
          reason: 'Security policy updated from the Super Admin dashboard.',
        });
      }
      showNotification('Platform governance configuration saved.');
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Saved locally; server rejected platform config update.');
    }
  };

  // ---- Messaging ----------------------------------------------------------------

  const sendMessage = async (
    conversationId: string,
    text: string,
    isAudio?: boolean,
    _audioDuration?: string
  ) => {
    try {
      const form = new FormData();
      form.append('content', text);
      if (isAudio) form.append('kind', 'voice');
      const res = await api.chat.sendMessage(conversationId, form);
      const raw = res.data?.message || res.data;
      const newMsg = mapMessage(raw);
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === conversationId ? { ...conv, messages: [...conv.messages, newMsg] } : conv
        )
      );
    } catch (e: any) {
      showNotification(e?.response?.data?.error || 'Message failed to send.');
    }
  };

  return (
    <AppContext.Provider
      value={{
        currentRole,
        setCurrentRole,
        language,
        setLanguage,
        currentUser,
        updateCurrentUser: updateCurrentUser as any,
        syncAuthUser,
        activeView,
        setActiveView,
        products,
        addProduct: addProduct as any,
        updateProduct: updateProduct as any,
        deleteProduct: deleteProduct as any,
        orders,
        updateOrderStatus: updateOrderStatus as any,
        createOrder: createOrder as any,
        wallet,
        depositViaChapa: depositViaChapa as any,
        approveDeposit: approveDeposit as any,
        flagDeposit: flagDeposit as any,
        rejectDeposit: rejectDeposit as any,
        requestPayout: requestPayout as any,
        approvePayout: approvePayout as any,
        bankAccounts,
        addBankAccount: addBankAccount as any,
        setPrimaryBankAccount: setPrimaryBankAccount as any,
        removeBankAccount: removeBankAccount as any,
        applications,
        updateApplicationStatus: updateApplicationStatus as any,
        submitRegistration: submitRegistration as any,
        allUsers: allUsersList,
        updateUserVerification: updateUserVerification as any,
        regionalMetrics,
        auditLogs,
        addAuditLog,
        platformConfig,
        updatePlatformConfig: updatePlatformConfig as any,
        conversations,
        sendMessage: sendMessage as any,
        waybills,
        notification,
        setNotification: showNotification,
        aiModalOpen,
        setAiModalOpen,
        failedLoginAttempts,
        isLockedOut,
        recordFailedLogin,
        resetLoginAttempts,
        authLoading,
        isAuthenticated,
        logout,
        markAuthenticated,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
