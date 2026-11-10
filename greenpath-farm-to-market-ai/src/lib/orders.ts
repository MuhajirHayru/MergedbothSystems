/**
 * Types and helpers for the order workspace.
 *
 * Field names mirror payments.OrderSerializer exactly; nothing here invents a
 * value the Django backend does not return.
 */

export interface ApiOrderShipmentSummary {
  authorized: boolean;
  delivery_fee: string | null;
  currency: string;
  driver_shipment_id: number | null;
  driver_status: string;
}

export interface ApiOrder {
  id: string;
  reference: string;
  wholesaler: string;
  wholesaler_name?: string;
  farmer: string | null;
  farmer_name?: string | null;
  retailer: string | null;
  retailer_name?: string | null;
  buyer_id: string;
  seller_id: string;
  buyer_name: string;
  seller_name: string;
  buyer_financially_verified?: boolean;
  seller_is_online?: boolean;
  product: string;
  product_title: string;
  product_image: string | null;
  product_unit: string;
  quantity: string;
  total_amount: string;
  discount_amount?: string;
  discount_snapshot?: null | {
    code?: string;
    funding_source?: "PLATFORM" | "SELLER";
    original_amount?: string;
    discount_amount?: string;
    final_amount?: string;
    [key: string]: unknown;
  };
  total: string;
  status: string;
  status_display: string;
  payment_status: string;
  payment_status_display: string;
  delivery_information: string;
  counterparty_contact: Record<string, any> | null;
  shipment: ApiOrderShipmentSummary | null;
  delivered_at: string | null;
  quality_confirmed_at: string | null;
  dispute_reason: string;
  rejection_reason: string;
  agreement_status: string | null;
  financial_terms_snapshot?: null | {
    status?: string;
    currency?: string;
    effective_at?: string;
    gross_order_value?: string;
    commission_amount?: string;
    buyer_fee_amount?: string;
    tax_amount?: string | null;
    tax_payer_party?: string;
    issues?: string[];
    fee_lines?: Array<{
      method: string;
      payer_party: string;
      payer_name: string;
      amount: string;
    }>;
  };
  allowed_transitions: string[];
  date: string;
  created_at: string;
  updated_at: string;
}

export interface ApiShipmentDetails {
  details_revision: number;
  buyer_confirmed_revision: number;
  buyer_confirmed_at: string | null;
  seller_confirmed_revision: number;
  seller_confirmed_at: string | null;
  delivery_fee_proposal_amount: string | null;
  delivery_fee_proposal_currency: string;
  delivery_fee_proposal_version: number;
  authorized: boolean;
  pickup_region?: string;
  destination_region?: string;
  pickup_region_name?: string;
  pickup_zone_name?: string | null;
  pickup_wereda_name?: string | null;
  pickup_address_line?: string;
  destination_region_name?: string;
  destination_zone_name?: string | null;
  destination_wereda_name?: string | null;
  destination_address_line?: string;
  cargo_weight_kg?: string;
  packaging_details?: string;
  driver_shipment_id?: number | null;
  driver_shipment_status?: string;
  driver_last_event_at?: string | null;
  authorized_at?: string | null;
}

export const ORDER_LIFECYCLE = [
  'Pending seller approval',
  'Accepted',
  'Processing',
  'Confirmed',
  'Shipped',
  'Delivered',
  'Awaiting quality confirmation',
  'Awaiting payment release',
  'Completed',
] as const;

export const CURRENCY = 'ETB';

const MEDIA_BASE = (import.meta.env.VITE_MEDIA_URL || 'http://localhost:8000').replace(
  /\/$/,
  ''
);

/** Product images are stored as relative /media paths by the Django backend. */
export const mediaUrl = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  return `${MEDIA_BASE}${value.startsWith('/') ? '' : '/'}${value}`;
};

export const sellerIdOf = (order: ApiOrder): string =>
  String(order.seller_id || order.farmer || order.wholesaler || '');

export const buyerIdOf = (order: ApiOrder): string =>
  String(order.buyer_id || order.retailer || order.wholesaler || '');

export const isSeller = (order: ApiOrder, userId?: string): boolean =>
  Boolean(userId) && sellerIdOf(order) === String(userId);

export const isBuyer = (order: ApiOrder, userId?: string): boolean =>
  Boolean(userId) && buyerIdOf(order) === String(userId);

export const formatEtb = (value: string | number | null | undefined): string => {
  const amount = Number(value ?? 0);
  return `${Number.isFinite(amount) ? amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) : '0'} ${CURRENCY}`;
};

export const formatQuantity = (order: ApiOrder): string => {
  const quantity = Number(order.quantity ?? 0);
  const amount = Number.isFinite(quantity) ? quantity.toLocaleString() : '0';
  return `${amount} ${order.product_unit || 'units'}`;
};

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const statusClasses = (status: string): string => {
  switch (status) {
    case 'Pending seller approval':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
    case 'Rejected':
    case 'Cancelled':
    case 'Disputed':
      return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
    case 'Completed':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
    case 'Awaiting payment release':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
};

export const paymentClasses = (status: string): string => {
  switch (status) {
    case 'HELD':
    case 'RESERVED':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'RELEASE_PENDING':
      return 'text-sky-700 dark:text-sky-400';
    case 'RELEASED':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'REFUNDED':
    case 'DISPUTED':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-slate-500 dark:text-slate-400';
  }
};

export const ACTION_LABELS: Record<string, string> = {
  Accepted: 'Accept order',
  Rejected: 'Reject order',
  Processing: 'Start processing',
  Confirmed: 'Confirm stock ready',
  Shipped: 'Dispatch shipment',
  Delivered: 'Confirm delivery received',
  Cancelled: 'Cancel order',
};

export const shipmentStateLabel = (order: ApiOrder): string => {
  if (!order.shipment) return 'Not started';
  if (order.shipment.driver_shipment_id) {
    return order.shipment.driver_status
      ? `Driver shipment ${order.shipment.driver_shipment_id} · ${order.shipment.driver_status}`
      : `Driver shipment ${order.shipment.driver_shipment_id}`;
  }
  if (order.shipment.authorized) return 'Authorized — awaiting driver pickup';
  return 'Fee agreement in progress';
};
