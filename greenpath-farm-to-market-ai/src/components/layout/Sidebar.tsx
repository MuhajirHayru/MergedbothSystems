import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useMessaging } from '../../context/MessagingContext';
import { useTheme } from '../../context/ThemeContext';
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Truck,
  DollarSign,
  Users,
  MapPin,
  Settings,
  MessageSquare,
  FileCheck2,
  Sparkles,
  BarChart3,
  Sliders,
  Shield,
  Layers,
  TrendingUp,
  FileText,
  UserCog,
  LogOut,
  ExternalLink,
  ChevronRight,
  BadgePercent,
  LifeBuoy,
  ShieldAlert,
  Image as ImageIcon,
  Heart,
  Eye,
  Gavel,
  Wallet,
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { currentRole, activeView, setActiveView, currentUser, logout } = useApp();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('gp_sidebar_collapsed');
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  // Keep the group containing the active destination expanded.
  useEffect(() => {
    const navItems = getNavItems() as Array<{ id: string; header?: boolean; group?: boolean }>;
    const headers = navItems.filter((n) => n.header && n.group);
    const activeIndex = navItems.findIndex((n) => n.id === activeView);
    if (activeIndex === -1) return;
    let owner: string | null = null;
    for (let i = activeIndex - 1; i >= 0; i -= 1) {
      if (navItems[i].header) { owner = navItems[i].id; break; }
    }
    if (owner && collapsedGroups.has(owner)) {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        next.delete(owner!);
        try { localStorage.setItem('gp_sidebar_collapsed', JSON.stringify([...next])); } catch { /* private mode */ }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('gp_sidebar_collapsed', JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  };
  const { unreadTotal } = useMessaging();
  const { theme } = useTheme();

  // Navigation defined strictly per role
  const getNavItems = () => {
    switch (currentRole) {
      case 'farmer':
        return [
          { id: 'farmer_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'farmer_products', label: 'My Products & Listings', icon: Package },
          { id: 'orders', label: 'Incoming Orders', icon: ShoppingBag },
          { id: 'order_history', label: 'Order History', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'wallet', label: 'My Earnings & Wallet', icon: DollarSign },
          { id: 'support_management', label: 'Get Help & Support', icon: LifeBuoy },
          { id: 'wishlist', label: 'My Wishlist', icon: Heart },
          { id: 'reports_regional', label: 'Regional Prices', icon: TrendingUp },
          { id: 'settings', label: 'Profile & Settings', icon: Settings },
        ];
      case 'wholesaler':
        return [
          { id: 'wholesaler_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'marketplace', label: 'Discover Products', icon: ShoppingBag },
          { id: 'recommendations', label: 'AI Recommendations', icon: Sparkles },
          { id: 'orders', label: 'My Orders', icon: Package },
          { id: 'wholesaler_inventory', label: 'My Inventory Stock', icon: Layers },
          { id: 'wishlist', label: 'My Wishlist', icon: Heart },
          { id: 'wallet', label: 'Wallet & Escrow', icon: DollarSign },
          { id: 'support_management', label: 'Get Help & Support', icon: LifeBuoy },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'reports_regional', label: 'Regional Market Feed', icon: TrendingUp },
          { id: 'settings', label: 'Profile & Settings', icon: Settings },
        ];
      case 'retailer':
        return [
          { id: 'retailer_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'marketplace', label: 'Discover Products', icon: ShoppingBag },
          { id: 'orders', label: 'My Restock Orders', icon: Package },
          { id: 'support_management', label: 'Get Help & Support', icon: LifeBuoy },
          { id: 'wishlist', label: 'My Wishlist', icon: Heart },
          { id: 'wallet', label: 'Wallet & Chapa Pay', icon: DollarSign },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Profile & Settings', icon: Settings },
        ];
      case 'driver':
        return [
          { id: 'driver_dashboard', label: 'Driver Hub & Status', icon: LayoutDashboard },
          { id: 'driver_freight', label: 'Delivery Job Board', icon: Gavel },
          { id: 'driver_assignments', label: 'My Deliveries', icon: MapPin },
          { id: 'driver_shipments', label: 'Authorized Shipments', icon: Truck },
          { id: 'driver_waybills', label: 'Waybill Manifests', icon: MapPin },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Driver Documents & Profile', icon: Settings },
        ];
      case 'logistics_manager':
        return [
          { id: '_hdr_overview', label: 'Overview', header: true },
          { id: 'logistics_dashboard', label: 'Logistics & Tracking', icon: Truck },
          { id: 'freight_bids', label: 'Freight Bidding', icon: Gavel },
          { id: '_hdr_operations', label: 'Coordination', header: true },
          { id: 'support_management', label: 'Get Help & Support', icon: LifeBuoy },
          { id: '_hdr_workspace', label: 'Workspace', header: true },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'customer_support':
        return [
          { id: 'support_management', label: 'Support Inbox', icon: LifeBuoy },
          { id: 'logistics_dashboard', label: 'Shipment Context', icon: Truck },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'financial_manager':
        // Each destination is a real tab of the financial workspace. No entry
        // here may resolve to the same default screen as another.
        return [
          { id: '_hdr_overview', label: 'Financial Overview', header: true, group: true },
          { id: 'financial_dashboard', label: 'Financial Dashboard', icon: LayoutDashboard },
          { id: 'financial_statement', label: 'Financial Statement', icon: FileText },
          { id: 'reports_regional', label: 'Regional Money & Users', icon: BarChart3, highlight: true },
          { id: '_hdr_wallets', label: 'Wallet Operations', header: true, group: true },
          { id: 'wallet_management', label: 'Wallet Accounts & Escrow', icon: Shield },
          { id: 'payment_verification', label: 'Payment Verification', icon: DollarSign },
          { id: 'funding_requests', label: 'Funding Requests', icon: Layers },
          { id: 'bank_accounts', label: 'Bank Accounts Review', icon: FileCheck2 },
          { id: '_hdr_escrow', label: 'Escrow, Delivery & Pricing', header: true, group: true },
          { id: 'financial_delivery_fees', label: 'Delivery Fee Agreements', icon: Truck },
          { id: 'financial_controls', label: 'Pricing & Financial Controls', icon: Sliders },
          { id: 'freight_bids', label: 'Freight Bidding', icon: Gavel },
          { id: 'logistics_dashboard', label: 'Logistics & Tracking', icon: Truck },
          { id: '_hdr_expenses', label: 'Income & Expenses', header: true, group: true },
          { id: 'financial_expenses', label: 'Operating Expenses', icon: DollarSign },
          { id: 'financial_payroll', label: 'Payroll & Employees', icon: Users },
          { id: 'financial_ledger', label: 'Ledger & Profit/Loss', icon: TrendingUp },
          { id: 'discount_management', label: 'Discounts & Promotions', icon: BadgePercent },
          { id: '_hdr_compliance', label: 'Compliance & Workspace', header: true, group: true },
          { id: 'support_management', label: 'Get Help & Support', icon: LifeBuoy },
          { id: 'audit_logs', label: 'Audit & Compliance Logs', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Financial Settings', icon: Settings },
        ];
      case 'user_admin':
        return [
          { id: 'user_admin_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'pending_registrations', label: 'Pending Registrations', icon: FileCheck2 },
          { id: 'all_users', label: 'All Registered Users', icon: Users },
          { id: 'admin_products', label: 'Product Listings', icon: Package },
          { id: 'staff_management', label: 'Staff Management', icon: UserCog },
          { id: 'audit_logs', label: 'Verification Audit', icon: Shield },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Admin Settings', icon: Settings },
        ];
      // Regional, zonal and wereda administrators work inside the same scoped
      // user-administration console as a User Admin; the backend enforces the
      // geography. Without this case they fell through to the public menu.
      case 'regional_admin':
      case 'zonal_admin':
      case 'wereda_admin':
        return [
          { id: 'regional_hierarchy', label: 'My Area & Admins', icon: MapPin },
          { id: 'user_admin_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'pending_registrations', label: 'Pending Registrations', icon: FileCheck2 },
          { id: 'all_users', label: 'Scoped Users', icon: Users },
          { id: 'admin_products', label: 'Product Listings', icon: Package },
          { id: 'audit_logs', label: 'Verification Audit', icon: Shield },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'top_user_admin':
        return [
          { id: 'top_user_dashboard', label: 'National Agro Overview', icon: LayoutDashboard },
          { id: 'regional_hierarchy', label: 'Administrative Hierarchy', icon: MapPin },
          { id: 'staff_management', label: 'Administrative Users', icon: UserCog },
          { id: 'reports_regional', label: 'Regional Money & Users', icon: BarChart3, highlight: true },
          { id: 'all_users', label: 'All Regional Users', icon: Users },
          { id: 'audit_logs', label: 'Administrative Audit', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'super_admin':
        return [
          { id: '_hdr_overview', label: 'Executive Overview', header: true, group: true },
          { id: 'super_admin_dashboard', label: 'Command Centre', icon: LayoutDashboard },
          { id: 'system_admin', label: 'System Health & Operations', icon: Settings },
          { id: 'sa_revenue', label: 'Revenue Methods & Payers', icon: BarChart3 },
          { id: 'reports_regional', label: 'Money by Region', icon: BarChart3 },
          { id: '_hdr_users', label: 'Users, Staff & Access', header: true, group: true },
          { id: 'all_users', label: 'All Users & Approvals', icon: Users },
          { id: 'all_users_wholesalers', label: 'Verified Wholesalers', icon: ShoppingBag },
          { id: 'staff_management', label: 'Staff Management', icon: UserCog },
          { id: 'account_control', label: 'Account & System Controls', icon: ShieldAlert },
          { id: '_hdr_marketplace', label: 'Marketplace', header: true, group: true },
          { id: 'admin_products', label: 'Products & Listings', icon: ShoppingBag },
          { id: 'sa_categories', label: 'Product Categories', icon: Layers },
          { id: 'scarcity_monitoring', label: 'Scarcity Monitoring', icon: Package },
          { id: 'discount_management', label: 'Discounts & Promotions', icon: BadgePercent },
          { id: '_hdr_geography', label: 'Geography & Intelligence', header: true, group: true },
          { id: 'regional_analytics', label: 'Regional Analytics', icon: MapPin },
          { id: '_hdr_logistics', label: 'Orders, Logistics & Delivery', header: true, group: true },
          { id: 'logistics_dashboard', label: 'Logistics & Tracking', icon: Truck },
          { id: 'freight_bids', label: 'Freight Bidding', icon: Gavel },
          { id: '_hdr_finance', label: 'Finance & Wallet Oversight', header: true, group: true },
          { id: 'sa_finance', label: 'Financial Controls & Pricing', icon: TrendingUp },
          { id: 'financial_payroll', label: 'Payroll & Staff Invoices', icon: Wallet },
          { id: '_hdr_support', label: 'Messages & Support', header: true, group: true },
          { id: 'support_management', label: 'Customer Support', icon: LifeBuoy },
          { id: 'messaging_oversight', label: 'Message Insights & Oversight', icon: Eye },
          { id: 'messaging', label: 'Message Centre', icon: MessageSquare },
          { id: '_hdr_content', label: 'Content & Presentation', header: true, group: true },
          { id: 'sa_content', label: 'Website Content & CMS', icon: Sliders },
          { id: 'banner_management', label: 'Banners & Announcements', icon: ImageIcon },
          { id: '_hdr_governance', label: 'Governance & Security', header: true, group: true },
          { id: 'sa_security', label: 'Security & Lockout Rules', icon: Shield },
          { id: 'audit_logs', label: 'Audit & Administrative History', icon: FileText },
          { id: '_hdr_workspace', label: 'Workspace', header: true, group: true },
          { id: 'settings', label: 'System Settings', icon: Settings },
        ];
      default:
        return [
          { id: 'landing', label: 'Public Home', icon: LayoutDashboard },
          { id: 'marketplace', label: 'Browse Produce', icon: ShoppingBag },
          { id: 'login', label: 'Sign In', icon: Users },
          { id: 'register', label: 'Register Account', icon: FileCheck2 },
        ];
    }
  };

  const navItems = getNavItems() as Array<{
    id: string;
    label: string;
    icon?: React.ElementType;
    header?: boolean;
    group?: boolean;
    highlight?: boolean;
    badge?: string;
  }>;

  const handleNavClick = (viewId: string) => {
    setActiveView(viewId);
    onClose();
  };

  // Exact brand colors specified:
  // Light mode sidebar: Green-700 (#15803D), text white
  // Dark mode sidebar: Slate-900 (#0F172A), text white/slate
  const sidebarBgClass = theme === 'dark' ? 'bg-[#0F172A]' : 'bg-[#003827]';
  const sidebarBorderClass = theme === 'dark' ? 'border-slate-800' : 'border-[#00281d]';
  const activeBgClass = theme === 'dark' ? 'bg-slate-800 text-emerald-400 font-semibold' : 'bg-[#0B4A33] text-white font-semibold';
  const hoverClass = theme === 'dark' ? 'hover:bg-slate-800/60 text-slate-300 hover:text-white' : 'hover:bg-[#0B4A33] text-white/90 hover:text-white';

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed md:sticky top-16 z-40 h-[calc(100vh-4rem)] w-64 ${sidebarBgClass} text-white flex flex-col justify-between transition-all duration-200 ease-in-out shrink-0 border-r ${sidebarBorderClass} ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex-1 overflow-y-auto px-3.5 py-5 scrollbar-thin">
          {/* Active Workspace Banner */}
          <div className="mb-5 pb-4 border-b border-white/15">
            <div className="text-[10px] font-bold text-emerald-200 uppercase tracking-widest">
              Active Session
            </div>
            <div className="mt-1 font-semibold text-white text-sm truncate flex items-center justify-between">
              <span>{currentUser?.name || currentUser?.email || 'Signed-in user'}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/20 text-white font-mono uppercase">
                {String(currentUser?.role || currentRole || 'account').replace(/_/g, ' ')}
              </span>
            </div>
            <div className="text-xs text-white/80 truncate mt-0.5">
              {currentUser?.businessName || (currentUser?.region ? `${currentUser.region} Bureau` : 'GreenPath workspace')}
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold text-white/70 uppercase tracking-wider px-2.5 mb-2">
              Workspace Menu
            </div>
            {navItems.map((item, index) => {
              if ((item as any).header) {
                const isGroup = Boolean((item as any).group);
                const collapsed = collapsedGroups.has(item.id);
                const HeaderTag = isGroup ? 'button' : 'div';
                return (
                  <HeaderTag
                    key={item.id}
                    {...(isGroup
                      ? {
                          onClick: () => toggleGroup(item.id),
                          'aria-expanded': !collapsed,
                          type: 'button' as const,
                        }
                      : {})}
                    className={`pt-3 pb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400/70 dark:text-slate-500 select-none flex items-center justify-between w-full ${isGroup ? 'hover:text-slate-300 dark:hover:text-slate-300 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400/60 rounded' : ''}`}
                  >
                    <span className="flex items-center gap-1.5">
                      {item.label}
                    </span>
                    {isGroup && (
                      <ChevronRight className={`w-3 h-3 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
                    )}
                  </HeaderTag>
                );
              }
              // Hide items that belong to a collapsed group.
              const parentHeaderIndex = (() => {
                for (let i = index - 1; i >= 0; i -= 1) {
                  if ((navItems[i] as any).header) return i;
                }
                return -1;
              })();
              if (parentHeaderIndex >= 0 && (navItems[parentHeaderIndex] as any).group && collapsedGroups.has(navItems[parentHeaderIndex].id)) {
                return null;
              }
              const Icon = item.icon!;
              const isActive = activeView === item.id;
              const badge =
                item.id === 'messaging'
                  ? unreadTotal > 0
                    ? unreadTotal > 99
                      ? '99+'
                      : String(unreadTotal)
                    : undefined
                  : item.badge;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors text-left group ${
                    isActive ? activeBgClass : hoverClass
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive
                          ? theme === 'dark' ? 'text-emerald-400' : 'text-white'
                          : 'text-white/80 group-hover:text-white'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {badge && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                        isActive ? 'bg-white text-emerald-800' : 'bg-white/20 text-white'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                  {item.highlight && !isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                  )}
                </button>
              );
            })}
          </div>


          {/* DriverApp session indicator if driver */}
          {currentRole === 'driver' && (
            <div className="mt-4 p-3 rounded-md bg-white/10 border border-white/20 text-xs">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <span>DriverApp Integration</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </div>
              <p className="text-[11px] text-white/80 mt-1">
                Connected to native DriverApp fleet protocol.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar Footer with Logout & Switch Role */}
        <div className="p-3.5 border-t border-white/15 text-xs text-white/80 flex items-center justify-between">
          <div>
            <div className="font-semibold text-white text-[11px]">GreenPath AI</div>
            <div className="text-[10px] text-white/70 font-mono">Ethiopia · FY 2026/27</div>
          </div>
          <button
            onClick={async () => {
              await logout();
              setActiveView('landing');
              onClose();
            }}
            title="Sign Out"
            aria-label="Sign out"
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>
    </>
  );
};
