import React, { Suspense, lazy, useState, useEffect } from 'react';
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { MessagingProvider } from './context/MessagingContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { LandingPage } from './components/views/LandingPage';
import { LoginPage, RegisterPage, ForgotPasswordPage } from './components/views/AuthPages';
import { MarketplaceView } from './components/views/MarketplaceView';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AiAssistantModal } from './components/common/AiAssistantModal';
import { canAccessView, defaultViewForRole, VIEW_PATHS } from './lib/viewAccess';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Route-level code splitting: dashboards and admin panels are the heaviest
// modules (charts, tables). They load on demand; landing/auth/marketplace stay
// eager so the first public paint is unaffected. Views are state-driven, so
// lazy chunks resolve transparently on navigation, deep links included.
const FarmerDashboard = lazy(() => import('./components/views/FarmerDashboard').then(m => ({ default: m.FarmerDashboard })));
const WholesalerDashboard = lazy(() => import('./components/views/WholesalerDashboard').then(m => ({ default: m.WholesalerDashboard })));
const RetailerDashboard = lazy(() => import('./components/views/WholesalerDashboard').then(m => ({ default: m.RetailerDashboard })));
const DriverDashboard = lazy(() => import('./components/views/DriverDashboard').then(m => ({ default: m.DriverDashboard })));
const FinancialManagerDashboard = lazy(() => import('./components/views/FinancialManagerDashboard').then(m => ({ default: m.FinancialManagerDashboard })));
const DiscountManagementView = lazy(() => import('./components/views/DiscountManagementView').then(m => ({ default: m.DiscountManagementView })));
const SupportManagementView = lazy(() => import('./components/views/SupportManagementView').then(m => ({ default: m.SupportManagementView })));
const AccountControlPanel = lazy(() => import('./components/views/AccountControlPanel').then(m => ({ default: m.AccountControlPanel })));
const BannerManagementView = lazy(() => import('./components/views/BannerManagementView').then(m => ({ default: m.BannerManagementView })));
const SystemAdminPanel = lazy(() => import('./components/views/SystemAdminPanel').then(m => ({ default: m.SystemAdminPanel })));
const WishlistPanel = lazy(() => import('./components/views/SupportPanels').then(m => ({ default: m.WishlistPanel })));
const AdminProductsPanel = lazy(() => import('./components/views/SupportPanels').then(m => ({ default: m.AdminProductsPanel })));
const MessagingOversightPanel = lazy(() => import('./components/views/SupportPanels').then(m => ({ default: m.MessagingOversightPanel })));
const LogisticsDashboard = lazy(() => import('./components/views/LogisticsDashboard').then(m => ({ default: m.LogisticsDashboard })));
const FreightBidsPanel = lazy(() => import('./components/views/FreightBiddingPanels').then(m => ({ default: m.FreightBidsPanel })));
const DriverFreightBoard = lazy(() => import('./components/views/FreightBiddingPanels').then(m => ({ default: m.DriverFreightBoard })));
const DriverAssignmentsPanel = lazy(() => import('./components/views/FreightBiddingPanels').then(m => ({ default: m.DriverAssignmentsPanel })));
const UserAdminDashboard = lazy(() => import('./components/views/UserAdminDashboard').then(m => ({ default: m.UserAdminDashboard })));
const TopUserAdminDashboard = lazy(() => import('./components/views/TopUserAdminDashboard').then(m => ({ default: m.TopUserAdminDashboard })));
const SuperAdminDashboard = lazy(() => import('./components/views/SuperAdminDashboard').then(m => ({ default: m.SuperAdminDashboard })));
const RegionalFinancialReportsView = lazy(() => import('./components/views/RegionalFinancialReportsView').then(m => ({ default: m.RegionalFinancialReportsView })));
const OrdersView = lazy(() => import('./components/views/OrdersView').then(m => ({ default: m.OrdersView })));
const OrderDetailView = lazy(() => import('./components/orders/OrderDetailView').then(m => ({ default: m.OrderDetailView })));
const MessagingView = lazy(() => import('./components/views/MessagingView').then(m => ({ default: m.MessagingView })));
const StaffManagementView = lazy(() => import('./components/views/StaffManagementView').then(m => ({ default: m.StaffManagementView })));
const NotificationsView = lazy(() => import('./components/views/NotificationsView').then(m => ({ default: m.NotificationsView })));
const WalletView = lazy(() => import('./components/views/WalletView').then(m => ({ default: m.WalletView })));
const SettingsView = lazy(() => import('./components/views/SettingsView').then(m => ({ default: m.SettingsView })));
const AuditLogsView = lazy(() => import('./components/views/AuditLogsView').then(m => ({ default: m.AuditLogsView })));
const ScarcityMonitor = lazy(() => import('./components/views/ScarcityMonitor').then(m => ({ default: m.ScarcityMonitor })));

const ViewFallback: React.FC = () => (
  <div className="p-8 max-w-7xl mx-auto" role="status" aria-live="polite">
    <div className="h-8 w-72 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse mb-4" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
    </div>
  </div>
);

// Single source of truth for the guard and the render gate. This list used to
// be declared twice in this file (`PUBLIC_VIEWS_FOR_GUARD` and `PUBLIC_VIEWS`),
// so adding a public screen could pass one check and fail the other.
const PUBLIC_VIEWS = ['landing', 'login', 'register', 'forgot_password', 'marketplace'];

const AccessDeniedView: React.FC<{ onHome: () => void }> = ({ onHome }) => (
  <div className="p-8 max-w-2xl mx-auto text-center mt-16" role="alert">
    <p className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">403 — Not available</p>
    <h1 className="mt-2 text-2xl font-bold">This workspace is not available for your role</h1>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
      Your account is signed in, but this screen belongs to a different role. Use the menu to open your own workspace.
    </p>
    <button
      type="button"
      onClick={onHome}
      className="mt-6 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
    >
      Go to my workspace
    </button>
  </div>
);

const NotFoundView: React.FC<{ onHome: () => void }> = ({ onHome }) => (
  <div className="p-8 max-w-2xl mx-auto text-center mt-16" role="alert">
    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">404 — Not found</p>
    <h1 className="mt-2 text-2xl font-bold">This page does not exist</h1>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
      The link may be out of date. Everything you can access is still available from the menu.
    </p>
    <button
      type="button"
      onClick={onHome}
      className="mt-6 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
    >
      Back to marketplace
    </button>
  </div>
);

const AppContent: React.FC = () => {
  const {
    activeView,
    setActiveView,
    notification,
    notificationType,
    dismissNotification,
    currentRole,
    setCurrentRole,
    authLoading,
    isAuthenticated,
    logout,
  } = useApp();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Route guard: redirect unauthenticated users away from protected views and
  // keep signed-in users inside the workspaces their role actually owns.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      if (!PUBLIC_VIEWS.includes(activeView)) {
        setActiveView('login');
        navigate('/login', { replace: true });
      }
      return;
    }
    if (!canAccessView(activeView, currentRole)) {
      const fallback = defaultViewForRole(currentRole);
      setActiveView(fallback);
      navigate(VIEW_PATHS[fallback] || '/', { replace: true });
    }
  }, [authLoading, isAuthenticated, activeView, currentRole, setActiveView, navigate]);

  // Route map for syncing URL path with internal state
  const pathToViewMap: Record<string, string> = {
    '/': 'landing',
    '/login': 'login',
    '/register': 'register',
    '/forgot-password': 'forgot_password',
    '/marketplace': 'marketplace',
    '/farmer': 'farmer_dashboard',
    '/wholesaler': 'wholesaler_dashboard',
    '/retailer': 'retailer_dashboard',
    '/driver': 'driver_dashboard',
    '/financial-manager': 'financial_dashboard',
    '/financial-manager/statement': 'financial_statement',
    '/financial-manager/controls': 'financial_controls',
    '/financial-manager/verification': 'payment_verification',
    '/financial-manager/wallets': 'wallet_management',
    '/financial-manager/funding': 'funding_requests',
    '/financial-manager/bank-accounts': 'bank_accounts',
    '/financial-manager/delivery-fees': 'financial_delivery_fees',
    '/financial-manager/expenses': 'financial_expenses',
    '/financial-manager/payroll': 'financial_payroll',
    '/financial-manager/ledger': 'financial_ledger',
    '/discounts': 'discount_management',
    '/support': 'support_management',
    '/controls': 'account_control',
    '/system-admin': 'system_admin',
    '/banners': 'banner_management',
    '/wishlist': 'wishlist',
    '/product-visibility': 'admin_products',
    '/messaging-oversight': 'messaging_oversight',
    '/logistics-dashboard': 'logistics_dashboard',
    '/freight-bids': 'freight_bids',
    '/admin': 'user_admin_dashboard',
    '/top-user-admin': 'top_user_dashboard',
    '/super-admin': 'super_admin_dashboard',
    '/reports/regional': 'reports_regional',
    '/orders': 'orders',
    '/messaging': 'messaging',
    '/staff': 'staff_management',
    '/notifications': 'notifications',
    '/wallet': 'wallet',
    '/settings': 'settings',
    '/audit-logs': 'audit_logs',
  };

  const viewToPathMap: Record<string, string> = {
    landing: '/',
    login: '/login',
    register: '/register',
    forgot_password: '/forgot-password',
    marketplace: '/marketplace',
    recommendations: '/marketplace',
    farmer_dashboard: '/farmer',
    farmer_products: '/farmer',
    wholesaler_dashboard: '/wholesaler',
    wholesaler_inventory: '/wholesaler',
    retailer_dashboard: '/retailer',
    driver_dashboard: '/driver',
    driver_shipments: '/driver',
    driver_waybills: '/driver',
    financial_dashboard: '/financial-manager',
    discount_management: '/discounts',
    support_management: '/support',
    account_control: '/controls',
    system_admin: '/system-admin',
    banner_management: '/banners',
    wishlist: '/wishlist',
    admin_products: '/product-visibility',
    messaging_oversight: '/messaging-oversight',
    logistics_dashboard: '/logistics-dashboard',
    freight_bids: '/freight-bids',
    financial_statement: '/financial-manager/statement',
    financial_controls: '/financial-manager/controls',
    payment_verification: '/financial-manager/verification',
    wallet_management: '/financial-manager/wallets',
    funding_requests: '/financial-manager/funding',
    bank_accounts: '/financial-manager/bank-accounts',
    financial_delivery_fees: '/financial-manager/delivery-fees',
    financial_expenses: '/financial-manager/expenses',
    financial_payroll: '/financial-manager/payroll',
    financial_ledger: '/financial-manager/ledger',
    user_admin_dashboard: '/admin',
    pending_registrations: '/admin',
    all_users: '/admin',
    top_user_dashboard: '/top-user-admin',
    regional_hierarchy: '/top-user-admin',
    super_admin_dashboard: '/super-admin',
    sa_categories: '/super-admin',
    sa_content: '/super-admin',
    sa_security: '/super-admin',
    sa_finance: '/super-admin',
    sa_revenue: '/super-admin',
    scarcity_monitoring: '/super-admin',
    regional_analytics: '/reports/regional',
    all_users_wholesalers: '/admin',
    reports_regional: '/reports/regional',
    orders: '/orders',
    order_history: '/orders',
    messaging: '/messaging',
    staff_management: '/staff',
    notifications: '/notifications',
    wallet: '/wallet',
    settings: '/settings',
    audit_logs: '/audit-logs',
  };

  // /orders/<id> is a first-class route: a reload on an order detail URL must
  // render that order rather than falling back to a blank screen.
  const orderDetailMatch = location.pathname.match(/^\/orders\/([^/]+)\/?$/);

  // All Super Admin dashboard tab views share the /super-admin path; a tab
  // view must not be clobbered back to the overview by the URL sync below.
  const SA_DASHBOARD_VIEWS = ['super_admin_dashboard', 'sa_categories', 'sa_content', 'sa_security', 'sa_finance', 'sa_revenue', 'scarcity_monitoring'];
  const SHARED_PATH_VIEWS: Record<string, string[]> = {
    '/super-admin': SA_DASHBOARD_VIEWS,
    '/reports/regional': ['reports_regional', 'regional_analytics'],
    '/admin': ['user_admin_dashboard', 'pending_registrations', 'all_users', 'all_users_wholesalers', 'regional_hierarchy'],
    '/top-user-admin': ['top_user_dashboard', 'regional_hierarchy'],
  };

  // A trailing slash must not turn a real deep link into a 404.
  const normalizedPath = location.pathname.length > 1
    ? location.pathname.replace(/\/+$/, '')
    : location.pathname;
  const unknownPath = !orderDetailMatch
    && !(normalizedPath in pathToViewMap)
    && !(normalizedPath in SHARED_PATH_VIEWS);

  // Sync route change with activeView
  useEffect(() => {
    const matchedView = orderDetailMatch
      ? 'orders'
      : pathToViewMap[normalizedPath];
    if (matchedView && matchedView !== activeView) {
      const equivalents = SHARED_PATH_VIEWS[normalizedPath];
      if (equivalents && equivalents.includes(activeView)) return;
      if (matchedView === 'super_admin_dashboard' && SA_DASHBOARD_VIEWS.includes(activeView)) return;
      setActiveView(matchedView);
    }
  }, [location.pathname]);

  // Sync activeView with browser URL history without reload.
  // The first render only records the state it was mounted with so a direct
  // link (e.g. /messaging or /staff) is not immediately rewritten to '/' by the
  // initial 'landing' state before the path → view sync above has run.
  const lastSyncedViewRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (lastSyncedViewRef.current === null) {
      lastSyncedViewRef.current = activeView;
      return;
    }
    if (lastSyncedViewRef.current === activeView) return;
    lastSyncedViewRef.current = activeView;
    // Keep the deep-linked order detail URL instead of rewriting it to the
    // orders list as soon as activeView becomes 'orders'.
    if (orderDetailMatch) return;
    const targetPath = viewToPathMap[activeView];
    if (targetPath && targetPath !== `${location.pathname}${location.hash}`) {
      navigate(targetPath, { replace: false });
    }
  }, [activeView]);

  const renderCurrentView = () => {
    // Never mount a dashboard before the restored session is confirmed: those
    // screens assume an authenticated profile, and rendering them mid-restore
    // used to blank the whole app (e.g. with an expired token).
    if (!isAuthenticated && !PUBLIC_VIEWS.includes(activeView)) {
      return <LoginPage />;
    }

    // Known URLs render a view; anything else gets an explicit not-found
    // instead of silently showing the landing page under a broken link.
    if (unknownPath) {
      return <NotFoundView onHome={() => setActiveView('marketplace')} />;
    }

    if (isAuthenticated && !canAccessView(activeView, currentRole)) {
      return <AccessDeniedView onHome={() => setActiveView(defaultViewForRole(currentRole))} />;
    }

    switch (activeView) {
      case 'landing':
        return <LandingPage />;
      case 'login':
        return <LoginPage />;
      case 'register':
        return <RegisterPage />;
      case 'forgot_password':
        return <ForgotPasswordPage />;
      case 'marketplace':
      case 'recommendations':
        return <MarketplaceView />;
      case 'farmer_dashboard':
      case 'farmer_products':
        return <FarmerDashboard />;
      case 'wholesaler_dashboard':
      case 'wholesaler_inventory':
        return <WholesalerDashboard />;
      case 'retailer_dashboard':
        return <RetailerDashboard />;
      case 'driver_dashboard':
      case 'driver_shipments':
      case 'driver_waybills':
        return <DriverDashboard />;
      case 'financial_dashboard':
        return <FinancialManagerDashboard initialTab="financial_overview" />;
      case 'financial_statement':
        return <FinancialManagerDashboard initialTab="statement" />;
      case 'financial_controls':
        return <FinancialManagerDashboard initialTab="financial_controls" />;
      case 'payment_verification':
      case 'funding_requests':
        return <FinancialManagerDashboard initialTab="verification" />;
      case 'wallet_management':
        return <FinancialManagerDashboard initialTab="wallet_mgmt" />;
      case 'bank_accounts':
        return <FinancialManagerDashboard initialTab="bank_accounts" />;
      case 'financial_delivery_fees':
        return <FinancialManagerDashboard initialTab="delivery_fees" />;
      case 'financial_expenses':
        return <FinancialManagerDashboard initialTab="expenses" />;
      case 'financial_payroll':
        return <FinancialManagerDashboard initialTab="payroll" />;
      case 'financial_ledger':
        return <FinancialManagerDashboard initialTab="ledger" />;
      case 'discount_management':
        return <DiscountManagementView />;
      case 'support_management':
        return <SupportManagementView staffView={['financial_manager', 'super_admin', 'user_admin'].includes(currentRole)} />;
      case 'account_control':
        return <AccountControlPanel />;
      case 'banner_management':
        return <BannerManagementView />;
      case 'wishlist':
        return <WishlistPanel />;
      case 'admin_products':
        return <AdminProductsPanel />;
      case 'messaging_oversight':
        return <MessagingOversightPanel />;
      case 'logistics_dashboard':
      case 'logistics_manager':
        return <LogisticsDashboard />;
      case 'freight_bids':
        return <FreightBidsPanel />;
      case 'driver_freight':
        return <DriverFreightBoard />;
      case 'driver_assignments':
        return <DriverAssignmentsPanel />;
      case 'system_admin':
        return <SystemAdminPanel />;
      case 'user_admin_dashboard':
      case 'pending_registrations':
      case 'all_users':
        return <UserAdminDashboard />;
      case 'all_users_wholesalers':
        return <UserAdminDashboard initialTab="directory" initialRole="wholesaler" />;
      case 'top_user_dashboard':
      case 'regional_hierarchy':
        return <TopUserAdminDashboard />;
      case 'super_admin_dashboard':
      case 'admin_overview':
      case 'website_content':
      case 'system_security':
      case 'marketplace_mgmt':
        return <SuperAdminDashboard initialTab="overview" />;
      case 'sa_categories':
        return <SuperAdminDashboard initialTab="categories" />;
      case 'sa_content':
        return <SuperAdminDashboard initialTab="content" />;
      case 'sa_security':
        return <SuperAdminDashboard initialTab="security" />;
      case 'sa_finance':
        return <SuperAdminDashboard initialTab="finance" />;
      case 'sa_revenue':
        return <SuperAdminDashboard initialTab="revenue" />;
      case 'scarcity_monitoring':
        return <ScarcityMonitor />;
      case 'regional_analytics':
        return <RegionalFinancialReportsView initialTab="analytics" />;
      case 'reports_regional':
        return <RegionalFinancialReportsView />;
      case 'orders':
      case 'order_history':
        return orderDetailMatch ? (
          <OrderDetailView orderId={decodeURIComponent(orderDetailMatch[1])} />
        ) : (
          <OrdersView />
        );
      case 'messaging':
        return <MessagingView />;
      case 'staff_management':
        return <StaffManagementView />;
      case 'notifications':
        return <NotificationsView />;
      case 'wallet':
        return <WalletView />;
      case 'settings':
        return <SettingsView />;
      case 'audit_logs':
        return <AuditLogsView />;
      default:
        return <MarketplaceView />;
    }
  };

  const isPublicStandalone =
    (activeView === 'landing' && currentRole === 'public') ||
    activeView === 'login' ||
    activeView === 'register' ||
    activeView === 'forgot_password';

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col text-slate-900 dark:text-slate-100 font-sans transition-colors duration-150">
      {/* Toast Notification */}
      {notification && (
        <div
          role={notificationType === 'error' ? 'alert' : 'status'}
          aria-live={notificationType === 'error' ? 'assertive' : 'polite'}
          className={`fixed top-4 right-4 z-50 max-w-md px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2.5 border animate-in fade-in slide-in-from-top-2 duration-150 ${
            notificationType === 'error'
              ? 'bg-rose-950 text-rose-50 border-rose-700'
              : notificationType === 'info'
                ? 'bg-sky-950 text-sky-50 border-sky-700'
                : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-700 dark:border-slate-300'
          }`}
        >
          {notificationType === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-300 shrink-0" />
          ) : notificationType === 'info' ? (
            <Info className="w-4 h-4 text-sky-300 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          )}
          <span className="flex-1">{notification}</span>
          <button
            type="button"
            onClick={dismissNotification}
            aria-label="Dismiss notification"
            className="p-1 rounded hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Header */}
      <Header
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarOpen={sidebarOpen}
      />

      {/* Main Container */}
      <div className="flex-1 flex w-full">
        {/* Sidebar: displayed when user is in authenticated workspace */}
        {!isPublicStandalone && isAuthenticated && (
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden min-w-0">
          <ErrorBoundary key={location.pathname} label="This screen could not be displayed">
            <Suspense fallback={<ViewFallback />}>
              {renderCurrentView()}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Exactly ONE Global Multilingual AI Assistant across the entire platform */}
      <AiAssistantModal />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <MessagingProvider>
        <AppContent />
      </MessagingProvider>
    </BrowserRouter>
  );
};

export default App;
