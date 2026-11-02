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
          { id: 'wallet', label: 'Wallet & Escrow', icon: DollarSign },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'reports_regional', label: 'Regional Market Feed', icon: TrendingUp },
          { id: 'settings', label: 'Profile & Settings', icon: Settings },
        ];
      case 'retailer':
        return [
          { id: 'retailer_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'marketplace', label: 'Discover Products', icon: ShoppingBag },
          { id: 'orders', label: 'My Restock Orders', icon: Package, badge: '1' },
          { id: 'wallet', label: 'Wallet & Chapa Pay', icon: DollarSign },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Profile & Settings', icon: Settings },
        ];
      case 'driver':
        return [
          { id: 'driver_dashboard', label: 'Driver Hub & Status', icon: LayoutDashboard },
          { id: 'driver_shipments', label: 'Authorized Shipments', icon: Truck },
          { id: 'driver_waybills', label: 'Waybill Manifests', icon: MapPin },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Driver Documents & Profile', icon: Settings },
        ];
      case 'financial_manager':
        return [
          { id: 'financial_dashboard', label: 'Financial Overview', icon: LayoutDashboard },
          { id: 'financial_controls', label: 'Financial Controls', icon: Sliders },
          { id: 'payment_verification', label: 'Payment Verification', icon: DollarSign, badge: '3' },
          { id: 'wallet_management', label: 'Wallet Vault & Escrow', icon: Shield },
          { id: 'funding_requests', label: 'Funding Requests', icon: Layers },
          { id: 'reports_regional', label: 'Regional Financial Reports', icon: BarChart3, highlight: true },
          { id: 'bank_accounts', label: 'Bank Accounts Review', icon: FileCheck2 },
          { id: 'audit_logs', label: 'Audit & Compliance Logs', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
          { id: 'settings', label: 'Financial Settings', icon: Settings },
        ];
      case 'user_admin':
        return [
          { id: 'user_admin_dashboard', label: 'Overview', icon: LayoutDashboard },
          { id: 'pending_registrations', label: 'Pending Registrations', icon: FileCheck2, badge: '3' },
          { id: 'all_users', label: 'All Registered Users', icon: Users },
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
          { id: 'super_admin_dashboard', label: 'Platform Overview', icon: LayoutDashboard },
          { id: 'all_users', label: 'Platform Users & Staff', icon: Users },
          { id: 'reports_regional', label: 'Regional Reports', icon: BarChart3 },
          { id: 'marketplace_mgmt', label: 'Product Categories', icon: Layers },
          { id: 'website_content', label: 'Website Content & CMS', icon: Sliders },
          { id: 'system_security', label: 'Security & Lockout Rules', icon: Shield },
          { id: 'staff_management', label: 'Staff Management', icon: UserCog },
          { id: 'audit_logs', label: 'Master Audit Logs', icon: FileText },
          { id: 'messaging', label: 'Messages', icon: MessageSquare },
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
              const Icon = item.icon;
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
