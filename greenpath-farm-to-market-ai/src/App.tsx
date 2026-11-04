import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './context/AppContext';
import { MessagingProvider } from './context/MessagingContext';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { LandingPage } from './components/views/LandingPage';
import { LoginPage, RegisterPage, ForgotPasswordPage } from './components/views/AuthPages';
import { MarketplaceView } from './components/views/MarketplaceView';
import { FarmerDashboard } from './components/views/FarmerDashboard';
import { WholesalerDashboard, RetailerDashboard } from './components/views/WholesalerDashboard';
import { DriverDashboard } from './components/views/DriverDashboard';
import { FinancialManagerDashboard } from './components/views/FinancialManagerDashboard';
import { DiscountManagementView } from './components/views/DiscountManagementView';
import { SupportManagementView } from './components/views/SupportManagementView';
import { AccountControlPanel } from './components/views/AccountControlPanel';
import { BannerManagementView } from './components/views/BannerManagementView';
import { SystemAdminPanel } from './components/views/SystemAdminPanel';
import { WishlistPanel, AdminProductsPanel, MessagingOversightPanel } from './components/views/SupportPanels';
import { LogisticsDashboard } from './components/views/LogisticsDashboard';
import { FreightBidsPanel, DriverFreightBoard, DriverAssignmentsPanel } from './components/views/FreightBiddingPanels';
import { UserAdminDashboard } from './components/views/UserAdminDashboard';
import { TopUserAdminDashboard } from './components/views/TopUserAdminDashboard';
import { SuperAdminDashboard } from './components/views/SuperAdminDashboard';
import { RegionalFinancialReportsView } from './components/views/RegionalFinancialReportsView';
import { OrdersView } from './components/views/OrdersView';
import { OrderDetailView } from './components/orders/OrderDetailView';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { MessagingView } from './components/views/MessagingView';
import { StaffManagementView } from './components/views/StaffManagementView';
import { NotificationsView } from './components/views/NotificationsView';
import { WalletView } from './components/views/WalletView';
import { SettingsView } from './components/views/SettingsView';
import { AuditLogsView } from './components/views/AuditLogsView';
import { AiAssistantModal } from './components/common/AiAssistantModal';
import { CheckCircle2, AlertCircle } from 'lucide-react';

const PUBLIC_VIEWS_FOR_GUARD = ['landing', 'login', 'register', 'forgot_password', 'marketplace'];

const AppContent: React.FC = () => {
  const {
    activeView,
    setActiveView,
    notification,
    currentRole,
    setCurrentRole,
    authLoading,
    isAuthenticated,
    logout,
  } = useApp();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Session restore loading gate
  useEffect(() => {
    if (authLoading) return;
  }, [authLoading]);

  // Route guard: redirect unauthenticated users away from protected views
  useEffect(() => {
    if (authLoading) return;
    const publicViews = PUBLIC_VIEWS_FOR_GUARD;
    if (!isAuthenticated && !publicViews.includes(activeView)) {
      setActiveView('login');
      navigate('/login', { replace: true });
    }
  }, [authLoading, isAuthenticated, activeView, setActiveView, navigate]);

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
    financial_controls: '/financial-manager#financial-controls',
    payment_verification: '/financial-manager',
    wallet_management: '/financial-manager',
    funding_requests: '/financial-manager',
    bank_accounts: '/financial-manager',
    user_admin_dashboard: '/admin',
    pending_registrations: '/admin',
    all_users: '/admin',
    top_user_dashboard: '/top-user-admin',
    regional_hierarchy: '/top-user-admin',
    super_admin_dashboard: '/super-admin',
    website_content: '/super-admin',
    system_security: '/super-admin',
    marketplace_mgmt: '/super-admin',
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

  // Sync route change with activeView
  useEffect(() => {
    const matchedView = orderDetailMatch
      ? 'orders'
      : pathToViewMap[location.pathname];
    if (matchedView && matchedView !== activeView) {
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

  const PUBLIC_VIEWS = ['landing', 'login', 'register', 'forgot_password', 'marketplace'];

  const renderCurrentView = () => {
    // Never mount a dashboard before the restored session is confirmed: those
    // screens assume an authenticated profile, and rendering them mid-restore
    // used to blank the whole app (e.g. with an expired token).
    if (!isAuthenticated && !PUBLIC_VIEWS.includes(activeView)) {
      return <LoginPage />;
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
      case 'financial_controls':
      case 'payment_verification':
      case 'wallet_management':
      case 'funding_requests':
      case 'bank_accounts':
        return <FinancialManagerDashboard />;
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
      case 'top_user_dashboard':
      case 'regional_hierarchy':
        return <TopUserAdminDashboard />;
      case 'super_admin_dashboard':
      case 'admin_overview':
      case 'website_content':
      case 'system_security':
      case 'marketplace_mgmt':
        return <SuperAdminDashboard />;
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
        <div className="fixed top-4 right-4 z-50 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2.5 border border-slate-700 dark:border-slate-300 animate-in fade-in slide-in-from-top-2 duration-150">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          <span>{notification}</span>
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
            {renderCurrentView()}
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
