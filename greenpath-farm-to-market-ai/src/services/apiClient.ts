import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Base API configuration referencing the existing Django REST Framework backend
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';
const LOGISTICS_API_BASE_URL = import.meta.env.VITE_LOGISTICS_API_URL || '/api';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
  withCredentials: true,
});

export const logisticsClient = axios.create({
  baseURL: LOGISTICS_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
  withCredentials: true,
});

// The refresh call must go out WITHOUT the (possibly expired) Authorization
// header: DRF's JWT authentication rejects an invalid Bearer token before the
// AllowAny refresh view runs, which would turn every silent refresh into a 401.
const NO_AUTH_PATHS = ['/auth/token/refresh/', '/auth/login/'];

// Attach JWT Bearer token if present
const attachToken = (client: typeof apiClient) =>
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const url = String(config.url || '');
      if (NO_AUTH_PATHS.some((path) => url.includes(path))) return config;
      // Registration dossier endpoints accept the purpose-limited completion
      // token issued by /auth/register/ before the account can log in.
      const registrationToken = localStorage.getItem('greenpath_registration_token');
      const isRegistrationCall = url.startsWith('/registration/');
      const token = isRegistrationCall
        ? registrationToken || localStorage.getItem('greenpath_auth_token')
        : localStorage.getItem('greenpath_auth_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error: AxiosError) => Promise.reject(error)
  );

attachToken(apiClient);
attachToken(logisticsClient);

// Response interceptor for session expiry handling + silent refresh
let refreshing = false;
let refreshPromise: Promise<any> | null = null;

// The refresh call and the login call must never trigger the refresh flow
// themselves: awaiting a refresh promise from inside its own 401 handler
// deadlocks and leaves the app waiting forever (blank screen).
const NON_REFRESHABLE = ['/auth/token/refresh/', '/auth/login/'];

const handleRefresh = (client: typeof apiClient) =>
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as any;
      const url = String(original?.url || '');
      const refreshable =
        error.response?.status === 401 &&
        !original?._retry &&
        !NON_REFRESHABLE.some((path) => url.includes(path));

      if (!refreshable) {
        if (error.response?.status === 401 && NON_REFRESHABLE.some((path) => url.includes(path))) {
          localStorage.removeItem('greenpath_auth_token');
          localStorage.removeItem('greenpath_refresh_token');
        }
        return Promise.reject(error);
      }

      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = true;
          refreshPromise = api.auth.refresh().finally(() => {
            refreshing = false;
            refreshPromise = null;
          });
        }
        const res = await refreshPromise;
        const newAccess = res?.data?.access;
        if (newAccess) {
          localStorage.setItem('greenpath_auth_token', newAccess);
          if (res?.data?.refresh) localStorage.setItem('greenpath_refresh_token', res.data.refresh);
          if (original.headers) original.headers.Authorization = `Bearer ${newAccess}`;
        }
        return client(original);
      } catch (e) {
        localStorage.removeItem('greenpath_auth_token');
        localStorage.removeItem('greenpath_refresh_token');
        return Promise.reject(error);
      }
    }
  );

handleRefresh(apiClient);
handleRefresh(logisticsClient);

// Multipart content type for uploads (JSON default must be overridden per-call)
const MULTIPART = { 'Content-Type': 'multipart/form-data' };

// API Endpoints mapped to Django backend routes
export const api = {
  products: {
    categories: () => apiClient.get('/products/catalog/categories/'),
    search: (params?: any) => apiClient.get('/products/catalog/search/', { params }),
    varieties: (catalogProductId: string) => apiClient.get(`/products/catalog/products/${catalogProductId}/varieties/`),
    suggestions: (data: any) => apiClient.post('/products/catalog/suggestions/', data),
    farmerListings: (params?: any) => apiClient.get('/products/farmer-listings/', { params }),
    myFarmerListings: (params?: any) => apiClient.get('/products/farmer-listings/my/', { params }),
    wholesalerListings: (params?: any) => apiClient.get('/products/wholesaler-listings/', { params }),
    myWholesalerListings: (params?: any) => apiClient.get('/products/wholesaler-listings/my/', { params }),
    listingDetail: (kind: 'farmer' | 'wholesaler', id: string) => apiClient.get(`/products/${kind}-listings/${id}/`),
    createFarmerListing: (data: any) => apiClient.post('/products/farmer-listings/', data),
    updateFarmerListing: (id: string, data: any) => apiClient.patch(`/products/farmer-listings/${id}/`, data),
    deleteFarmerListing: (id: string) => apiClient.delete(`/products/farmer-listings/${id}/`),
    activateFarmerListing: (id: string) => apiClient.post(`/products/farmer-listings/${id}/activate/`),
    deactivateFarmerListing: (id: string) => apiClient.post(`/products/farmer-listings/${id}/deactivate/`),
    markSoldFarmerListing: (id: string) => apiClient.post(`/products/farmer-listings/${id}/mark-sold/`),
    createWholesalerListing: (data: any) => apiClient.post('/products/wholesaler-listings/', data),
    updateWholesalerListing: (id: string, data: any) => apiClient.patch(`/products/wholesaler-listings/${id}/`, data),
    deleteWholesalerListing: (id: string) => apiClient.delete(`/products/wholesaler-listings/${id}/`),
    activateWholesalerListing: (id: string) => apiClient.post(`/products/wholesaler-listings/${id}/activate/`),
    deactivateWholesalerListing: (id: string) => apiClient.post(`/products/wholesaler-listings/${id}/deactivate/`),
    markSoldWholesalerListing: (id: string) => apiClient.post(`/products/wholesaler-listings/${id}/mark-sold/`),
    uploadListingImage: (kind: 'farmer' | 'wholesaler', id: string, file: File) => {
      const form = new FormData();
      form.append('image', file);
      return apiClient.post(`/products/${kind}-listings/${id}/images/`, form, { headers: MULTIPART });
    },
  },
  orders: {
    list: (params?: any) => apiClient.get('/orders/', { params }),
    detail: (id: string) => apiClient.get(`/orders/${id}/`),
    create: (data: any) => apiClient.post('/orders/', data, { headers: { 'Idempotency-Key': `ord-${Date.now()}-${Math.random().toString(36).slice(2)}` } }),
    updateStatus: (id: string, data: any) => apiClient.patch(`/orders/${id}/status/`, data),
    confirmQuality: (id: string, data?: any) => apiClient.post(`/orders/${id}/confirm-quality/`, data || {}),
    dispute: (id: string, data?: any) => apiClient.post(`/orders/${id}/dispute/`, data || {}),
    release: (id: string, data?: any) => apiClient.post(`/orders/${id}/release/`, data || {}),
    resolveDispute: (id: string, data?: any) => apiClient.post(`/orders/${id}/resolve-dispute/`, data || {}),
    discloseContact: (id: string, data?: any) => apiClient.post(`/orders/${id}/disclose-contact/`, data || {}),
    shipmentDetails: (id: string) => apiClient.get(`/orders/${id}/shipment-details/`),
    // The backend's shipment-details action accepts GET, PUT and PATCH (no POST).
    createShipmentDetails: (id: string, data: any) => apiClient.put(`/orders/${id}/shipment-details/`, data),
    updateShipmentDetails: (id: string, data: any) => apiClient.patch(`/orders/${id}/shipment-details/`, data),
    confirmShipmentDetails: (id: string, data?: any) => apiClient.post(`/orders/${id}/shipment-details/confirm/`, data || {}),
  },
  payments: {
    list: (params?: any) => apiClient.get('/payments/', { params }),
    detail: (id: string) => apiClient.get(`/payments/${id}/`),
    verify: (id: string) => apiClient.patch(`/payments/${id}/verify/`),
    flag: (id: string, data?: any) => apiClient.patch(`/payments/${id}/flag/`, data || {}),
    dispute: (id: string, data?: any) => apiClient.patch(`/payments/${id}/dispute/`, data || {}),
    receipt: (id: string) => apiClient.get(`/payments/${id}/receipt/`),
    shipments: (params?: any) => apiClient.get('/payments/shipments/', { params }),
    shipmentDetail: (id: string) => apiClient.get(`/payments/shipments/${id}/`),
    deliveryFeeAgreements: (params?: any) => apiClient.get('/payments/delivery-fee-agreements/', { params }),
    reviewDeliveryFeeAgreement: (id: number, data: any) => apiClient.post(`/payments/delivery-fee-agreements/${id}/review/`, data),
  },
  wallet: {
    summary: () => apiClient.get('/wallet/'),
    transactions: (params?: any) => apiClient.get('/wallet/transactions/', { params }),
    funding: (params?: any) => apiClient.get('/wallet/funding/', { params }),
    payouts: (params?: any) => apiClient.get('/wallet/payouts/', { params }),
    payoutDetail: (id: string) => apiClient.get(`/wallet/payouts/${id}/`),
    banks: () => apiClient.get('/wallet/banks/'),
    bankAccounts: (params?: any) => apiClient.get('/wallet/bank-accounts/', { params }),
    bankAccountDetail: (id: string) => apiClient.get(`/wallet/bank-accounts/${id}/`),
    addBankAccount: (data: any) => apiClient.post('/wallet/bank-accounts/', data),
    updateBankAccount: (id: string, data: any) => apiClient.patch(`/wallet/bank-accounts/${id}/`, data),
    deleteBankAccount: (id: string) => apiClient.delete(`/wallet/bank-accounts/${id}/`),
    bankAccountFullDetails: (id: string) => apiClient.get(`/wallet/bank-accounts/${id}/full-details/`),
    requireBankAccountReview: (id: string, data: { notes: string }) =>
      apiClient.post(`/wallet/bank-accounts/${id}/require-review/`, data),
    createPayout: (data: any) => apiClient.post('/wallet/payouts/', data),
    reviewPayout: (id: string, data: any) => apiClient.post(`/wallet/payouts/${id}/review/`, data),
    createFunding: (data: any) => apiClient.post('/wallet/funding/', data),
    chapaInitialize: (data: any) => apiClient.post('/wallet/funding/chapa/', data),
    reviewFunding: (id: string, data: any) => apiClient.post(`/wallet/funding/${id}/review/`, data),
    flagFunding: (id: string, data: { reason: string }) => apiClient.post(`/wallet/funding/${id}/flag/`, data),
    verifyFunding: (id: string, data?: any) => apiClient.post(`/wallet/funding/${id}/verify/`, data || {}),
    agreements: (params?: any) => apiClient.get('/wallet/agreements/', { params }),
    reviews: (params?: any) => apiClient.get('/wallet/reviews/', { params }),
    createReview: (data: any) => apiClient.post('/wallet/reviews/', data),
  },
  chat: {
    channels: (params?: any) => apiClient.get('/chat/channels/', { params }),
    createChannel: (data: any) => apiClient.post('/chat/channels/', data),
    channelDetail: (id: string) => apiClient.get(`/chat/channels/${id}/`),
    messages: (channelId: string, params?: any) => apiClient.get(`/chat/channels/${channelId}/messages/`, { params }),
    sendMessage: (channelId: string, data: any) =>
      apiClient.post(`/chat/channels/${channelId}/messages/`, data, data instanceof FormData ? { headers: MULTIPART } : undefined),
    markRead: (channelId: string) => apiClient.post(`/chat/channels/${channelId}/mark-read/`, {}),
    recipients: (search?: string) =>
      apiClient.get('/chat/recipients/', { params: search ? { search } : undefined }),
    staffRecipients: (search?: string) =>
      apiClient.get('/chat/staff-recipients/', { params: search ? { search } : undefined }),
    voiceMessageAudio: (channelId: string, messageId: string) =>
      apiClient.get(`/chat/channels/${channelId}/messages/${messageId}/audio/`, { responseType: 'blob' }),
    voiceModeration: (params?: any) => apiClient.get('/chat/voice-moderation/', { params }),
    reviewVoiceMessage: (id: string, data: any) => apiClient.post(`/chat/voice-moderation/${id}/review/`, data),
  },
  assistant: {
    conversations: () => apiClient.get('/assistant/conversations/'),
    conversationDetail: (id: string) => apiClient.get(`/assistant/conversations/${id}/`),
    conversationMessages: (id: string) => apiClient.get(`/assistant/conversations/${id}/messages/`),
    transcribe: (file: File) => {
      const form = new FormData();
      form.append('audio', file);
      return apiClient.post('/assistant/transcribe/', form, { headers: MULTIPART });
    },
  },
  registration: {
    locations: (params?: any) => apiClient.get('/registration/locations/', { params }),
    productTypes: () => apiClient.get('/registration/product-types/'),
    formFields: (params?: any) => apiClient.get('/registration/form-fields/', { params }),
    me: () => apiClient.get('/registration/me/'),
    updateMe: (data: any) => apiClient.patch('/registration/me/', data),
    submit: (data?: any) => apiClient.post('/registration/me/submit/', data || {}),
    uploadDocument: (file: File, docType?: string) => {
      const form = new FormData();
      form.append('file', file);
      if (docType) form.append('document_type', docType);
      return apiClient.post('/registration/me/documents/', form, { headers: MULTIPART });
    },
    deleteDocument: (id: string) => apiClient.delete(`/registration/me/documents/${id}/`),
    resume: (data: any) => apiClient.post('/auth/registration/resume/', data),
  },
  notifications: {
    list: (params?: any) => apiClient.get('/notifications/', { params }),
    unreadCount: () => apiClient.get('/notifications/unread-count/'),
    markRead: (id: string) => apiClient.post(`/notifications/${id}/mark-read/`, {}),
    markAllRead: () => apiClient.post('/notifications/mark-all-read/', {}),
  },
  dashboard: {
    farmer: () => apiClient.get('/dashboard/farmer/'),
    wholesaler: () => apiClient.get('/dashboard/wholesaler/'),
    retailer: () => apiClient.get('/dashboard/retailer/'),
    admin: () => apiClient.get('/dashboard/admin/'),
    payments: () => apiClient.get('/dashboard/payments/'),
    financialAnalytics: (params?: any) =>
      apiClient.get('/dashboard/financial-analytics/', { params }),
    financialOperations: (params?: any) =>
      apiClient.get('/dashboard/financial-operations/', { params }),
    walletActivity: (params?: any) => apiClient.get('/dashboard/wallet-activity/', { params }),
    walletActivityExport: (params?: any) =>
      apiClient.get('/dashboard/wallet-activity/export/', { params, responseType: 'blob' }),
  },
  support: {
    myTickets: () => apiClient.get('/support/tickets/'),
    submitTicket: (data: { subject: string; body: string; category?: string; related_order_reference?: string }) =>
      apiClient.post('/support/tickets/', data),
    reply: (id: string, data: { body: string; reopen?: boolean }) =>
      apiClient.post(`/support/tickets/${id}/reply/`, data),
    inbox: (params?: Record<string, unknown>) => apiClient.get('/support/inbox/', { params }),
    action: (id: string, data: Record<string, unknown>) => apiClient.post(`/support/inbox/${id}/action/`, data),
    bulk: (data: Record<string, unknown>) => apiClient.post('/support/inbox/bulk/', data),
  },
  banners: {
    public: () => apiClient.get('/auth/banners/'),
    adminList: () => apiClient.get('/superadmin/banners/'),
    create: (data: FormData) => apiClient.post('/superadmin/banners/', data),
    update: (id: number, data: FormData) => apiClient.patch(`/superadmin/banners/${id}/`, data),
    remove: (id: number) => apiClient.delete(`/superadmin/banners/${id}/`),
    reorder: (order: number[]) => apiClient.post('/superadmin/banners/reorder/', { order }),
  },
  wishlist: {
    list: () => apiClient.get('/payments/wishlist/'),
    add: (product: string, note?: string) => apiClient.post('/payments/wishlist/', { product, note }),
    remove: (product: string) => apiClient.delete('/payments/wishlist/', { data: { product } }),
  },
  freight: {
    staffJobs: (params?: Record<string, unknown>) => apiClient.get('/payments/financial/freight-jobs/', { params }),
    assignBid: (jobId: string, bidId: string) => apiClient.post(`/payments/financial/freight-jobs/${jobId}/assign/`, { bid_id: bidId }),
    cancelJob: (jobId: string, reason: string) => apiClient.post(`/payments/financial/freight-jobs/${jobId}/cancel/`, { reason }),
    driverJobs: () => logisticsClient.get('/logistics/freight-jobs/'),
    placeBid: (jobId: string, data: { amount: string; estimated_hours: number; message?: string }) =>
      logisticsClient.post(`/logistics/freight-jobs/${jobId}/bid/`, data),
    myBids: () => logisticsClient.get('/logistics/freight-jobs/my-bids/'),
    myAssignments: () => logisticsClient.get('/logistics/freight-jobs/my-assignments/'),
    advanceDelivery: (jobId: string) => logisticsClient.post(`/logistics/freight-jobs/${jobId}/advance/`),
    availability: () => logisticsClient.get('/drivers/me/availability/'),
    setAvailability: (available: boolean) => logisticsClient.patch('/drivers/me/availability/', { available }),
    board: (params?: Record<string, unknown>) => apiClient.get('/payments/financial/freight-board/', { params }),
    tracking: (orderRef: string) => apiClient.get(`/payments/financial/freight-board/${orderRef}/tracking/`),
  },
  oversight: {
    adminProducts: (params?: Record<string, unknown>) => apiClient.get('/admin/products/', { params }),
    conversations: () => apiClient.get('/superadmin/conversations/'),
    conversationMessages: (id: string, reason: string) => apiClient.get(`/superadmin/conversations/${id}/messages/`, { params: { reason } }),
  },
  adminOverview: () => apiClient.get('/auth/admin-overview/'),
  ordersOversight: (params?: Record<string, unknown>) => apiClient.get('/superadmin/orders-oversight/', { params }),
  walletsOversight: () => apiClient.get('/superadmin/wallets-oversight/'),
  broadcast: (message: string) => apiClient.post('/superadmin/broadcast/', { message }),
  healthDetailed: () => apiClient.get('/superadmin/health-detailed/'),
  auditCenter: {
    summary: (days: number) => apiClient.get('/superadmin/audit/summary/', { params: { days } }),
    exportCsv: (days: number) => apiClient.get('/superadmin/audit/export/', { params: { days }, responseType: 'blob' }),
    userActivity: (userId: string) => apiClient.get(`/superadmin/audit/user-activity/${userId}/`),
  },
  discounts: {
    campaigns: (params?: any) => apiClient.get('/payments/financial/discount-campaigns/', { params }),
    createCampaign: (data: any) => apiClient.post('/payments/financial/discount-campaigns/', data),
    updateCampaign: (id: string, data: any) => apiClient.patch(`/payments/financial/discount-campaigns/${id}/update/`, data),
    campaignAction: (id: string, data: any) => apiClient.post(`/payments/financial/discount-campaigns/${id}/action/`, data),
    redemptions: (params?: any) => apiClient.get('/payments/financial/discount-redemptions/', { params }),
  },
  financialControls: {
    configurations: (params?: any) => apiClient.get('/payments/financial/configurations/', { params }),
    createConfiguration: (data: any) => apiClient.post('/payments/financial/configurations/', data),
    approveConfiguration: (id: string) => apiClient.post(`/payments/financial/configurations/${id}/approve/`, {}),
    expenses: () => apiClient.get('/payments/financial/expenses/'),
    createExpense: (data: any) => apiClient.post('/payments/financial/expenses/', data),
    reviewExpense: (id: string, data: any) => apiClient.post(`/payments/financial/expenses/${id}/review/`, data),
    payroll: () => apiClient.get('/payments/financial/payroll/'),
    createPayroll: (data: any) => apiClient.post('/payments/financial/payroll/', data),
    payrollAction: (id: string, data: any) => apiClient.post(`/payments/financial/payroll/${id}/action/`, data),
    accounts: () => apiClient.get('/payments/financial/accounts/'),
    ledger: (params?: any) => apiClient.get('/payments/financial/ledger/', { params }),
    summary: () => apiClient.get('/payments/financial/summary/'),
    report: (params?: any) => apiClient.get('/payments/financial/report/', { params }),
    deliveryPricing: () => apiClient.get('/payments/financial/delivery-pricing/'),
    createDeliveryPricing: (data: any) => apiClient.post('/payments/financial/delivery-pricing/', data),
    deliveryPricingAction: (id: string, data: any) => apiClient.post(`/payments/financial/delivery-pricing/${id}/action/`, data),
    refunds: () => apiClient.get('/payments/financial/refunds/'),
    createRefund: (data: any) => apiClient.post('/payments/financial/refunds/', data),
    refundAction: (id: string, data: any) => apiClient.post(`/payments/financial/refunds/${id}/action/`, data),
    reconciliation: () => apiClient.get('/payments/financial/reconciliation/'),
    regionalReport: (params?: any) => apiClient.get('/payments/financial/regional-report/', { params }),
  },
  auth: {
    login: (data: { email: string; password: string }) => apiClient.post('/auth/login/', data),
    register: (data: any) => apiClient.post('/auth/register/', data),
    me: () => apiClient.get('/auth/me/'),
    profile: () => apiClient.get('/auth/profile/'),
    updateProfile: (data: any) => apiClient.patch('/auth/profile/', data),
    uploadProfilePhoto: (file: File) => {
      const form = new FormData();
      form.append('profile_photo', file);
      return apiClient.post('/auth/profile/photo/', form, { headers: MULTIPART });
    },
    removeProfilePhoto: () => apiClient.delete('/auth/profile/photo/'),
    websiteContent: () => apiClient.get('/auth/website-content/'),
    announcement: () => apiClient.get('/auth/announcement/'),
    changePassword: (data: any) => apiClient.post('/auth/password/change/', data),
    forgotPassword: (email: string) => apiClient.post('/auth/password-reset/request/', { email }),
    resetPassword: (data: any) => apiClient.post('/auth/password-reset/confirm/', data),
    refresh: () => apiClient.post('/auth/token/refresh/', { refresh: localStorage.getItem('greenpath_refresh_token') }),
    logout: () => apiClient.post('/auth/logout/', {}),
    driverToken: () => apiClient.post('/auth/driver-token/', {}),
  },
  admin: {
    pendingUsers: (params?: any) => apiClient.get('/admin/pending-users/', { params }),
    users: (params?: any) => apiClient.get('/admin/users/', { params }),
    registrations: (params?: any) => apiClient.get('/admin/registrations/', { params }),
    registrationDetail: (id: string) => apiClient.get(`/admin/registrations/${id}/`),
    registrationDecision: (id: string, data: any) => apiClient.post(`/admin/registrations/${id}/decision/`, data),
    registrationDocumentFile: (id: string) => apiClient.get(`/admin/registration-documents/${id}/file/`, { responseType: 'blob' }),
    verifyRegistrationDocument: (id: string, data: any) => apiClient.post(`/admin/registration-documents/${id}/verification/`, data),
    registrationReports: () => apiClient.get('/admin/registration-reports/'),
    approveUser: (userId: string) => apiClient.post(`/admin/users/${userId}/approve/`, {}),
    rejectUser: (userId: string, notes?: string) => apiClient.post(`/admin/users/${userId}/reject/`, { reason: notes }),
    suspendUser: (userId: string, notes?: string) => apiClient.post(`/admin/users/${userId}/suspend/`, { reason: notes }),
    broadcast: (data: any) => apiClient.post('/admin/messages/', data),
  },
  reports: {
    financialSummary: (params?: any) => apiClient.get('/reports/financial-summary/', { params }),
    financialExport: (params?: any) =>
      apiClient.get('/reports/financial-summary/export/', { params, responseType: 'blob' }),
    transactionVolume: (params?: any) => apiClient.get('/reports/transaction-volume/', { params }),
    walletActivity: (params?: any) => apiClient.get('/dashboard/wallet-activity/', { params }),
  },
  superadmin: {
    health: () => apiClient.get('/superadmin/health/'),
    data: () => apiClient.get('/superadmin/data/'),
    users: (params?: any) => apiClient.get('/superadmin/users/', { params }),
    overrideUser: (id: string, data: any) => apiClient.post(`/superadmin/users/${id}/override/`, data),
    unlockLogin: (id: string) => apiClient.post(`/superadmin/users/${id}/unlock-login/`, {}),
    settings: () => apiClient.get('/superadmin/settings/'),
    updateSettings: (data: any) => apiClient.patch('/superadmin/settings/', data),
    websiteContent: () => apiClient.get('/superadmin/website-content/'),
    updateWebsiteContent: (data: any) => apiClient.patch('/superadmin/website-content/', data),
    announcement: () => apiClient.get('/superadmin/announcement/'),
    updateAnnouncement: (data: any) => apiClient.patch('/superadmin/announcement/', data),
    accounts: (params?: any) => apiClient.get('/superadmin/accounts/', { params }),
    creationOptions: () => apiClient.get('/superadmin/accounts/creation-options/'),
    account: (id: string) => apiClient.get(`/superadmin/accounts/${id}/`),
    createAccount: (data: any) => apiClient.post('/superadmin/accounts/', data),
    updateAccount: (id: string, data: any) => apiClient.patch(`/superadmin/accounts/${id}/`, data),
    deleteAccount: (id: string) => apiClient.delete(`/superadmin/accounts/${id}/`),
    accountActivity: (id: string) => apiClient.get(`/superadmin/accounts/${id}/activity/`),
    audit: (params?: any) => apiClient.get('/superadmin/audit/', { params }),
    locations: (params?: any) => apiClient.get('/superadmin/locations/', { params }),
    productTypes: (params?: any) => apiClient.get('/superadmin/product-types/', { params }),
    catalogCategories: (params?: any) => apiClient.get('/superadmin/catalog-categories/', { params }),
    createCatalogCategory: (data: any) => apiClient.post('/superadmin/catalog-categories/', data),
    updateCatalogCategory: (id: string, data: any) =>
      apiClient.patch(`/superadmin/catalog-categories/${id}/`, data),
    deleteCatalogCategory: (id: string) =>
      apiClient.delete(`/superadmin/catalog-categories/${id}/`),
    registrationFields: (params?: any) => apiClient.get('/superadmin/registration-fields/', { params }),
    adminScopes: (params?: any) => apiClient.get('/superadmin/admin-scopes/', { params }),
  },
  // Logistics (merged DriverApp backend, mounted at bare /api)
  logistics: {
    session: (data: { marketplace_token: string }) => logisticsClient.post('/integrations/v2/driver/session/', data),
    marketplaceToken: (data?: any) => logisticsClient.post('/integrations/v2/driver/marketplace-token/', data || {}),
    me: () => logisticsClient.get('/auth/me/'),
    shipments: (params?: any) => logisticsClient.get('/shipments/', { params }),
    shipmentDetail: (id: number) => logisticsClient.get(`/shipments/${id}/`),
    shipmentOffers: () => logisticsClient.get('/drivers/me/shipment-offers/'),
    wallet: () => logisticsClient.get('/wallet/'),
    driverApplication: () => logisticsClient.get('/drivers/me/application/'),
    availability: (data: any) => logisticsClient.patch('/drivers/me/availability/', data),
    notifications: () => logisticsClient.get('/shipments/notifications/'),
  },
};
