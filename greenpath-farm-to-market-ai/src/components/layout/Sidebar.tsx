import React from 'react';
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
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { currentRole, activeView, setActiveView, currentUser, setAiModalOpen, logout } = useApp();
  const { unreadTotal } = useMessaging();
  const { theme } = useTheme();

  // Navigation defined strictly per role
  const getNavItems = () => {
    switch (currentRole) {
      case 'farmer':
        return [
          { id: 'farmer_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'farmer_products', label: 'My Products & Listings', icon: Package },
          { id: 'orders', label: 'Incoming Orders', icon: ShoppingBag, badge: '2' },
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
          { id: 'orders', label: 'My Orders', icon: Package, badge: '2' },
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
          { id: 'orders', label: 'My Restock Orders', icon: Package, badge: '1' },
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
          { id: 'support_management', label: 'Customer Support', icon: LifeBuoy },
          { id: '_hdr_workspace', label: 'Workspace', header: true },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'customer_support':
        return [
          { id: 'support_management', label: 'Support Inbox', icon: LifeBuoy },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'financial_manager':
        return [
          { id: '_hdr_overview', label: 'Overview', header: true },
          { id: 'financial_dashboard', label: 'Financial Overview', icon: LayoutDashboard },
          { id: 'reports_regional', label: 'Regional Financial Reports', icon: BarChart3, highlight: true },
          { id: '_hdr_operations', label: 'Daily Operations', header: true },
          { id: 'financial_controls', label: 'Financial Controls', icon: Sliders },
          { id: 'payment_verification', label: 'Payment Verification', icon: DollarSign, badge: '3' },
          { id: 'wallet_management', label: 'Wallet Vault & Escrow', icon: Shield },
          { id: 'funding_requests', label: 'Funding Requests', icon: Layers },
          { id: 'bank_accounts', label: 'Bank Accounts Review', icon: FileCheck2 },
          { id: 'discount_management', label: 'Discounts & Promotions', icon: BadgePercent },
          { id: 'logistics_dashboard', label: 'Logistics & Tracking', icon: Truck },
          { id: 'freight_bids', label: 'Freight Bidding', icon: Gavel },
          { id: 'support_management', label: 'Customer Support', icon: LifeBuoy },
          { id: '_hdr_workspace', label: 'Compliance & Workspace', header: true },
          { id: 'audit_logs', label: 'Audit & Compliance Logs', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Financial Settings', icon: Settings },
        ];
      case 'user_admin':
        return [
          { id: 'user_admin_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'pending_registrations', label: 'Pending Registrations', icon: FileCheck2, badge: '3' },
          { id: 'all_users', label: 'All Registered Users', icon: Users },
          { id: 'admin_products', label: 'Product Listings', icon: Package },
          { id: 'staff_management', label: 'Staff Management', icon: UserCog },
          { id: 'audit_logs', label: 'Verification Audit', icon: Shield },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Admin Settings', icon: Settings },
        ];
      case 'top_user_admin':
        return [
          { id: 'top_user_dashboard', label: 'National Agro Overview', icon: LayoutDashboard },
          { id: 'regional_hierarchy', label: 'Administrative Hierarchy', icon: MapPin },
          { id: 'staff_management', label: 'Administrative Users', icon: UserCog },
          { id: 'reports_regional', label: 'Regional Financial Reports', icon: BarChart3, highlight: true },
          { id: 'all_users', label: 'All Regional Users', icon: Users },
          { id: 'audit_logs', label: 'Administrative Audit', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
        ];
      case 'super_admin':
        return [
          { id: '_hdr_overview', label: 'Overview', header: true },
          { id: 'super_admin_dashboard', label: 'Platform Overview', icon: LayoutDashboard },
          { id: 'system_admin', label: 'Platform Operations', icon: Settings },
          { id: 'reports_regional', label: 'Regional & Financial Reports', icon: BarChart3 },
          { id: '_hdr_users', label: 'Users & Access', header: true },
          { id: 'all_users', label: 'Platform Users & Staff', icon: Users },
          { id: 'staff_management', label: 'Staff Management', icon: UserCog },
          { id: 'account_control', label: 'Account & System Controls', icon: ShieldAlert },
          { id: '_hdr_marketplace', label: 'Marketplace', header: true },
          { id: 'admin_products', label: 'Products & Listings', icon: ShoppingBag },
          { id: 'sa_categories', label: 'Product Categories', icon: Layers },
          { id: 'discount_management', label: 'Discounts & Promotions', icon: BadgePercent },
          { id: '_hdr_logistics', label: 'Logistics', header: true },
          { id: 'logistics_dashboard', label: 'Logistics & Tracking', icon: Truck },
          { id: 'freight_bids', label: 'Freight Bidding', icon: Gavel },
          { id: '_hdr_support', label: 'Support & Communication', header: true },
          { id: 'support_management', label: 'Customer Support', icon: LifeBuoy },
          { id: 'messaging_oversight', label: 'Messaging Oversight', icon: Eye },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: '_hdr_content', label: 'Content', header: true },
          { id: 'sa_content', label: 'Website Content & CMS', icon: Sliders },
          { id: 'banner_management', label: 'Banners & Announcements', icon: ImageIcon },
          { id: '_hdr_governance', label: 'Governance & Security', header: true },
          { id: 'sa_security', label: 'Security & Lockout Rules', icon: Shield },
          { id: 'sa_finance', label: 'Financial Controls & Pricing', icon: TrendingUp },
          { id: 'audit_logs', label: 'Master Audit Logs', icon: FileText },
          { id: '_hdr_workspace', label: 'Workspace', header: true },
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

  const navItems = getNavItems();

  const handleNavClick = (viewId: string) => {
    setActiveView(viewId);
    onClose();
  };

  // Exact brand colors specified:
  // Light mode sidebar: Green-700 (#15803D), text white
  // Dark mode sidebar: Slate-900 (#0F172A), text white/slate
  const sidebarBgClass = theme === 'dark' ? 'bg-[#0F172A]' : 'bg-[#15803D]';
  const sidebarBorderClass = theme === 'dark' ? 'border-slate-800' : 'border-[#166534]';
  const activeBgClass = theme === 'dark' ? 'bg-slate-800 text-emerald-400 font-semibold' : 'bg-[#16A34A] text-white font-semibold';
  const hoverClass = theme === 'dark' ? 'hover:bg-slate-800/60 text-slate-300 hover:text-white' : 'hover:bg-[#166534] text-white/90 hover:text-white';

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
            {navItems.map((item) => {
              if ((item as any).header) {
                return (
                  <div
                    key={item.id}
                    className="pt-3 pb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400/70 dark:text-slate-500 select-none"
                  >
                    {item.label}
                  </div>
                );
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

          {/* Single Global AI Assistant Trigger */}
          <div className="mt-6 pt-5 border-t border-white/15">
            <button
              onClick={() => {
                setAiModalOpen(true);
                onClose();
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-semibold bg-white/10 text-white hover:bg-white/20 transition-all border border-white/20 group"
            >
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-emerald-300 group-hover:scale-110 transition-transform" />
                <span>AI Agro Advisor</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-white/70" />
            </button>
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
