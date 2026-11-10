import type { UserRole } from '../types';

/**
 * Single source of truth for which authenticated role may open a view.
 * The backend still enforces permissions; this only stops the client from
 * mounting a dashboard the signed-in account cannot use.
 */
export const PUBLIC_VIEWS = new Set([
  'landing',
  'login',
  'register',
  'forgot_password',
  'marketplace',
  'recommendations',
]);

const ALL_ROLES: UserRole[] = [
  'farmer',
  'wholesaler',
  'retailer',
  'driver',
  'financial_manager',
  'user_admin',
  'regional_admin',
  'zonal_admin',
  'wereda_admin',
  'top_user_admin',
  'super_admin',
  'logistics_manager',
  'customer_support',
];

const USER_ADMINS: UserRole[] = [
  'user_admin',
  'regional_admin',
  'zonal_admin',
  'wereda_admin',
  'super_admin',
  'top_user_admin',
];

const FINANCE: UserRole[] = ['financial_manager', 'super_admin'];

const VIEW_ROLES: Record<string, UserRole[]> = {
  // Public / trading roles
  farmer_dashboard: ['farmer'],
  farmer_products: ['farmer'],
  order_history: ['farmer'],
  wholesaler_dashboard: ['wholesaler'],
  wholesaler_inventory: ['wholesaler'],
  retailer_dashboard: ['retailer'],
  driver_dashboard: ['driver'],
  driver_shipments: ['driver'],
  driver_waybills: ['driver'],
  driver_freight: ['driver'],
  driver_assignments: ['driver'],
  orders: ['farmer', 'wholesaler', 'retailer'],
  wallet: ['farmer', 'wholesaler', 'retailer'],
  wishlist: ['farmer', 'wholesaler', 'retailer'],

  // Financial manager workspace
  financial_dashboard: FINANCE,
  financial_statement: FINANCE,
  financial_controls: FINANCE,
  payment_verification: FINANCE,
  funding_requests: FINANCE,
  wallet_management: FINANCE,
  bank_accounts: FINANCE,
  financial_delivery_fees: FINANCE,
  financial_expenses: FINANCE,
  financial_payroll: FINANCE,
  financial_ledger: FINANCE,
  discount_management: ['financial_manager', 'super_admin'],

  // Shared operational screens
  logistics_dashboard: ['logistics_manager', 'financial_manager', 'super_admin'],
  logistics_manager: ['logistics_manager'],
  freight_bids: ['logistics_manager', 'financial_manager', 'super_admin'],
  reports_regional: ['farmer', 'wholesaler', 'financial_manager', 'super_admin', 'top_user_admin'],
  regional_analytics: ['super_admin', 'top_user_admin', 'financial_manager'],
  audit_logs: [
    'financial_manager',
    'user_admin',
    'regional_admin',
    'zonal_admin',
    'wereda_admin',
    'top_user_admin',
    'super_admin',
  ],
  support_management: ALL_ROLES,

  // User administration
  user_admin_dashboard: USER_ADMINS,
  pending_registrations: USER_ADMINS,
  all_users: USER_ADMINS,
  admin_products: USER_ADMINS,
  staff_management: ['user_admin', 'top_user_admin', 'super_admin'],
  top_user_dashboard: ['top_user_admin'],
  regional_hierarchy: ['top_user_admin', 'regional_admin', 'zonal_admin', 'wereda_admin'],
  all_users_wholesalers: ['super_admin'],

  // Super admin
  super_admin_dashboard: ['super_admin'],
  admin_overview: ['super_admin'],
  website_content: ['super_admin'],
  system_security: ['super_admin'],
  marketplace_mgmt: ['super_admin'],
  sa_categories: ['super_admin'],
  sa_content: ['super_admin'],
  sa_security: ['super_admin'],
  sa_finance: ['super_admin'],
  sa_revenue: ['super_admin'],
  scarcity_monitoring: ['super_admin'],
  system_admin: ['super_admin'],
  account_control: ['super_admin'],
  banner_management: ['super_admin'],
  messaging_oversight: ['super_admin'],

  // Any signed-in account
  messaging: ALL_ROLES,
  notifications: ALL_ROLES,
  settings: ALL_ROLES,
};

export function canAccessView(view: string, role: UserRole): boolean {
  if (PUBLIC_VIEWS.has(view)) return true;
  if (role === 'public') return false;
  return (VIEW_ROLES[view] || []).includes(role);
}

export const VIEW_PATHS: Record<string, string> = {
  landing: '/',
  login: '/login',
  register: '/register',
  forgot_password: '/forgot-password',
  marketplace: '/marketplace',
  recommendations: '/marketplace',
  farmer_dashboard: '/farmer',
  farmer_products: '/farmer',
  order_history: '/orders',
  wholesaler_dashboard: '/wholesaler',
  wholesaler_inventory: '/wholesaler',
  retailer_dashboard: '/retailer',
  driver_dashboard: '/driver',
  driver_shipments: '/driver',
  driver_waybills: '/driver',
  driver_freight: '/driver',
  driver_assignments: '/driver',
  orders: '/orders',
  wallet: '/wallet',
  wishlist: '/wishlist',
  financial_dashboard: '/financial-manager',
  financial_statement: '/financial-manager/statement',
  financial_controls: '/financial-manager/controls',
  payment_verification: '/financial-manager/verification',
  funding_requests: '/financial-manager/funding',
  wallet_management: '/financial-manager/wallets',
  bank_accounts: '/financial-manager/bank-accounts',
  financial_delivery_fees: '/financial-manager/delivery-fees',
  financial_expenses: '/financial-manager/expenses',
  financial_payroll: '/financial-manager/payroll',
  financial_ledger: '/financial-manager/ledger',
  discount_management: '/discounts',
  logistics_dashboard: '/logistics-dashboard',
  logistics_manager: '/logistics-dashboard',
  freight_bids: '/freight-bids',
  reports_regional: '/reports/regional',
  regional_analytics: '/reports/regional',
  audit_logs: '/audit-logs',
  support_management: '/support',
  user_admin_dashboard: '/admin',
  pending_registrations: '/admin',
  all_users: '/admin',
  admin_products: '/product-visibility',
  staff_management: '/staff',
  top_user_dashboard: '/top-user-admin',
  regional_hierarchy: '/top-user-admin',
  all_users_wholesalers: '/admin',
  super_admin_dashboard: '/super-admin',
  admin_overview: '/super-admin',
  website_content: '/super-admin',
  system_security: '/super-admin',
  marketplace_mgmt: '/super-admin',
  sa_categories: '/super-admin',
  sa_content: '/super-admin',
  sa_security: '/super-admin',
  sa_finance: '/super-admin',
  sa_revenue: '/super-admin',
  scarcity_monitoring: '/super-admin',
  system_admin: '/system-admin',
  account_control: '/controls',
  banner_management: '/banners',
  messaging_oversight: '/messaging-oversight',
  messaging: '/messaging',
  notifications: '/notifications',
  settings: '/settings',
};

export function defaultViewForRole(role: UserRole): string {
  switch (role) {
    case 'farmer':
      return 'farmer_dashboard';
    case 'wholesaler':
      return 'wholesaler_dashboard';
    case 'retailer':
      return 'retailer_dashboard';
    case 'driver':
      return 'driver_dashboard';
    case 'financial_manager':
      return 'financial_dashboard';
    case 'user_admin':
      return 'user_admin_dashboard';
    case 'regional_admin':
    case 'zonal_admin':
    case 'wereda_admin':
      return 'regional_hierarchy';
    case 'top_user_admin':
      return 'top_user_dashboard';
    case 'super_admin':
      return 'super_admin_dashboard';
    case 'logistics_manager':
      return 'logistics_dashboard';
    case 'customer_support':
      return 'support_management';
    default:
      return 'marketplace';
  }
}
