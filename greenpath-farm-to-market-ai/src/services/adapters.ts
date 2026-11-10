// Adapters mapping Django REST Framework payloads to the frontend's view types.
import type {
  Product,
  Order,
  OrderStatus,
  Conversation,
  DepositRecord,
  PayoutRequest,
  TransactionRecord,
  BankAccount,
  RegistrationApplication,
  AuditLog,
  UserProfile,
  UserRole,
  RegionalFinancialMetric,
  DigitalWaybill,
  DocumentRecord,
} from '../types';

// Django serves media from its own origin; resolve relative "/media/..." paths.
const BACKEND_ORIGIN = (import.meta.env.VITE_MEDIA_URL || 'http://localhost:8000').replace(/\/$/, '');

export const mediaUrl = (path?: string | null): string => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  return `${BACKEND_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
};

export const num = (v: any, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export const fmtDate = (v?: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

const UNIT_MAP: Record<string, Product['unit']> = {
  KG: 'kg',
  kg: 'kg',
  QUINTAL: 'quintal (100kg)',
  'quintal (100kg)': 'quintal (100kg)',
  CRATE: 'crate (25kg)',
  'crate (25kg)': 'crate (25kg)',
  TON: 'ton',
  ton: 'ton',
};

const CATEGORY_MAP: Record<string, Product['category']> = {
  VEGETABLES: 'Vegetables',
  FRUITS: 'Fruits',
  LEGUMES: 'Legumes & Pulses',
  'LEGUMES & PULSES': 'Legumes & Pulses',
  SPICES: 'Spices & Herbs',
  'SPICES & HERBS': 'Spices & Herbs',
  GRAINS: 'Grains',
};

export function mapProduct(raw: any): Product {
  const qty = num(raw.quantity);
  const status: Product['status'] =
    raw.status === 'SOLD' ? 'sold_out' : qty > 0 && qty <= 10 ? 'low_stock' : 'available';
  const region = raw.owner_location || '';
  return {
    id: String(raw.id),
    title: raw.title || '',
    amharicTitle: raw.name_am || raw.catalog_product_am || '',
    oromoTitle: raw.name_om || '',
    category:
      raw.category ||
      CATEGORY_MAP[raw.category_display || ''] ||
      raw.category_display ||
      '',
    variety: raw.catalog_variety_name || raw.catalog_product_name || '',
    grade: 'Grade 1 Domestic',
    unit: UNIT_MAP[raw.unit_of_measure] || UNIT_MAP[raw.unit_display] || 'kg',
    minOrder: 1,
    availableQuantity: qty,
    pricePerUnitETB: num(raw.price_per_unit ?? raw.pricePerUnitETB),
    farmerId: String(raw.owner ?? ''),
    farmerName: raw.owner_name || 'GreenPath Seller',
    farmerPhone: undefined,
    location: {
      region,
      zone: region,
      hubCorridor: region ? `${region} Corridor` : '',
    },
    harvestDate: fmtDate(raw.created_at).split(',')[0],
    expiryDays: 14,
    images: (raw.images || []).map(mediaUrl),
    status,
    description: raw.description || '',
    rating: raw.owner_average_rating ?? 5,
    reviewCount: raw.owner_review_count ?? 0,
  };
}

const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  'Pending seller approval': 'Ordered',
  Accepted: 'Seller Approval',
  Processing: 'Processing',
  Confirmed: 'Processing',
  Shipped: 'Shipped',
  Delivered: 'Delivered',
  'Awaiting quality confirmation': 'Quality Confirmation',
  'Awaiting payment release': 'Payment Release',
  Completed: 'Completed',
  Rejected: 'Rejected',
  Disputed: 'Disputed',
  Cancelled: 'Cancelled',
};

const ESCROW_MAP: Record<string, Order['escrowStatus']> = {
  RESERVED: 'held_in_escrow',
  HELD: 'held_in_escrow',
  RELEASE_PENDING: 'held_in_escrow',
  RELEASED: 'released',
  REFUNDED: 'refunded',
  DISPUTED: 'held_in_escrow',
};

export function mapOrder(raw: any): Order {
  const status = ORDER_STATUS_MAP[raw.status] || 'Ordered';
  return {
    id: String(raw.id),
    orderNumber: raw.reference || `ORD-${String(raw.id).slice(0, 8)}`,
    buyerId: String(raw.wholesaler ?? raw.retailailer ?? raw.buyer ?? ''),
    buyerName: raw.buyer_name || raw.wholesaler_name || '',
    buyerRole: raw.retailer ? 'retailer' : 'wholesaler',
    sellerId: String(raw.farmer ?? ''),
    sellerName: raw.seller_name || raw.farmer_name || '',
    sellerRole: 'farmer',
    productId: String(raw.product ?? ''),
    productTitle: raw.product_title || '',
    quantity: num(raw.quantity),
    unit: 'kg',
    agreedPricePerUnitETB: num(raw.quantity) ? num(raw.total_amount) / num(raw.quantity) : 0,
    totalAmountETB: num(raw.total_amount),
    status,
    createdAt: fmtDate(raw.created_at) || raw.date || '',
    deliveryCorridor: raw.delivery_information || '',
    escrowStatus: ESCROW_MAP[raw.payment_status] || 'pending_payment',
    timeline: [
      {
        stage: raw.status_display || raw.status || 'Created',
        timestamp: fmtDate(raw.updated_at || raw.created_at),
        note: raw.delivery_information || `Order ${raw.status_display || 'recorded'}`,
      },
    ],
    chapaReference: raw.payment_reference,
  };
}

const TX_TYPE_MAP: Record<string, TransactionRecord['type']> = {
  FUNDING: 'deposit',
  ORDER_RESERVATION: 'escrow_lock',
  RESERVATION_RELEASE: 'escrow_release',
  ESCROW_RELEASE: 'escrow_release',
  PAYOUT_RESERVATION: 'payout',
  PAYOUT: 'payout',
  FEE: 'fee',
  DELIVERY_PAYMENT: 'delivery_payment',
};

export function mapTransaction(raw: any): TransactionRecord {
  return {
    id: String(raw.id),
    date: fmtDate(raw.created_at),
    type: TX_TYPE_MAP[raw.transaction_type] || 'fee',
    amountETB: num(raw.amount),
    feeETB: 0,
    reference: raw.reference || raw.external_reference || '',
    counterparty: raw.order_reference || raw.description || '',
    status: 'verified',
    description: raw.description || raw.transaction_type || '',
  };
}

const DEPOSIT_STATUS_MAP: Record<string, DepositRecord['status']> = {
  PENDING: 'Pending',
  AWAITING_PAYMENT: 'Pending',
  PAYMENT_VERIFICATION_PENDING: 'Pending',
  AWAITING_APPROVAL: 'Pending',
  VERIFIED: 'Approved',
  APPROVED: 'Approved',
  FLAGGED: 'Flagged',
  REJECTED: 'Rejected',
  FAILED: 'Rejected',
  CANCELLED: 'Rejected',
};

const ROLE_MAP: Record<string, UserRole> = {
  FARMER: 'farmer',
  WHOLESALER: 'wholesaler',
  RETAILER: 'retailer',
  DRIVER: 'driver',
  FINANCIAL_MANAGER: 'financial_manager',
  USER_ADMIN: 'user_admin',
  TOP_USER_ADMIN: 'top_user_admin',
  SUPER_ADMIN: 'super_admin',
};

export function mapDeposit(raw: any): DepositRecord {
  return {
    id: String(raw.id),
    userId: String(raw.wallet ?? ''),
    userName: raw.wallet_owner || '',
    userRole: ROLE_MAP[raw.wallet_owner_role] || 'farmer',
    amountETB: num(raw.amount),
    method: (raw.payment_method as DepositRecord['method']) || 'Bank Transfer',
    reference: raw.external_reference || '',
    timestamp: fmtDate(raw.submitted_at),
    status: DEPOSIT_STATUS_MAP[raw.status] || 'Pending',
  };
}

const PAYOUT_STATUS_MAP: Record<string, PayoutRequest['status']> = {
  PENDING: 'pending',
  AWAITING_APPROVAL: 'pending',
  APPROVED: 'approved',
  PAID: 'approved',
  REJECTED: 'rejected',
};

export function mapPayout(raw: any): PayoutRequest {
  return {
    id: String(raw.id),
    userId: String(raw.wallet_owner_id ?? raw.wallet ?? ''),
    userName: raw.wallet_owner || '',
    role: ROLE_MAP[raw.wallet_owner_role] || 'farmer',
    amountETB: num(raw.amount),
    bankName: raw.payout_account_bank || 'Bank',
    accountNumber: raw.payout_account_masked || raw.destination || '-',
    accountHolderName: raw.wallet_owner || '',
    payoutAccount: raw.payout_account ? String(raw.payout_account) : null,
    status: PAYOUT_STATUS_MAP[raw.status] || 'pending',
    requestedAt: fmtDate(raw.submitted_at),
    processedAt: fmtDate(raw.reviewed_at) || undefined,
  };
}

export function mapBankAccount(raw: any): BankAccount {
  return {
    id: String(raw.id),
    bankName: raw.bank_name || raw.bank?.name || 'Bank',
    accountHolderName: raw.account_holder_name || raw.account_holder || raw.holder_name || '',
    accountNumber: raw.account_number || raw.masked_account_number || '',
    maskedAccountNumber: raw.masked_account_number || `**** ${String(raw.account_number || '').slice(-4)}`,
    accountType: 'Checking',
    isPrimary: !!raw.is_default,
    verificationStatus:
      raw.status === 'VERIFIED' ? 'verified' : raw.status === 'REQUIRES_REVIEW' ? 'pending' : 'pending',
    addedDate: fmtDate(raw.created_at).split(',')[0],
    // FM review fields
    ownerName: raw.user_name || raw.user_full_name || raw.user?.full_name || '',
    ownerRole: raw.user_role || raw.user?.role || '',
    status: raw.status || '',
  };
}

export function mapConversation(raw: any, messages: any[] = []): Conversation {
  return {
    id: String(raw.id),
    title: raw.title || raw.listing_title || raw.product_title || 'Conversation',
    participantId: String(raw.other_participant?.id ?? raw.counterparty?.id ?? ''),
    participantName: raw.other_participant?.full_name || raw.counterparty_name || 'GreenPath Member',
    participantRole: (raw.other_participant?.role_display || raw.counterparty_role || 'member').toLowerCase(),
    participantRegion: raw.other_participant?.location || '',
    orderReference: raw.order_reference || raw.listing_title,
    category: 'Orders',
    unreadCount: num(raw.unread_count, 0),
    messages: messages.map(mapMessage),
  };
}

export function mapMessage(raw: any) {
  return {
    id: String(raw.id),
    senderId: String(raw.sender ?? ''),
    senderName: raw.sender_name || 'Member',
    timestamp: fmtDate(raw.sent_at || raw.created_at),
    text: raw.content || '',
    isAudio: raw.kind === 'voice',
    audioDuration: undefined,
    audioUrl: raw.audio_url ? mediaUrl(raw.audio_url) : undefined,
    read: !!raw.is_read,
  };
}

export function mapAuditLog(raw: any): AuditLog {
  const category: AuditLog['category'] = (() => {
    const a = String(raw.action || '').toLowerCase();
    if (a.includes('login') || a.includes('auth')) return 'Authentication';
    if (a.includes('payment') || a.includes('payout') || a.includes('wallet') || a.includes('funding')) return 'Financial';
    if (a.includes('regist') || a.includes('verif') || a.includes('approv')) return 'Verification';
    if (a.includes('product') || a.includes('listing')) return 'Marketplace';
    if (a.includes('security') || a.includes('lock')) return 'Security';
    return 'System';
  })();
  return {
    id: String(raw.id),
    actorName: raw.actor_name || raw.actor || 'System',
    actorRole: raw.actor_role || 'system',
    action: (raw.action || '').replace(/_/g, ' '),
    targetUser: raw.target || '—',
    category,
    timestamp: fmtDate(raw.created_at),
    scope: 'Platform',
    result: /fail|reject|denied/i.test(raw.detail || '') ? 'Failed' : 'Success',
    reference: String(raw.id),
  };
}

export function mapPendingUser(raw: any): RegistrationApplication {
  return {
    id: String(raw.id),
    trackingNumber: raw.email,
    fullName: raw.full_name || '',
    email: raw.email || '',
    phone: raw.phone || '',
    role: (raw.role || 'farmer').toLowerCase() as RegistrationApplication['role'],
    region: raw.location || '',
    zone: '',
    wereda: '',
    submittedAt: fmtDate(raw.created_at),
    submittedAtRaw: raw.created_at || undefined,
    status: raw.status === 'PENDING' ? 'pending' : raw.status === 'REJECTED' ? 'rejected' : 'approved',
    currentStage: 3,
    documents: [],
    reviewerNotes: raw.rejection_reason || '',
  };
}

export function mapRegistration(raw: any): RegistrationApplication {
  return {
    id: String(raw.id),
    trackingNumber: raw.tracking_number || raw.email,
    fullName: raw.full_name || '',
    email: raw.email || '',
    phone: raw.phone || '',
    role: (raw.role || 'farmer').toLowerCase() as RegistrationApplication['role'],
    region: raw.location_name || (raw.location_path && raw.location_path[0]) || '',
    zone: (raw.location_path && raw.location_path[1]) || '',
    wereda: (raw.location_path && raw.location_path[2]) || '',
    businessName: raw.business_name || '',
    licenseNumber: raw.driving_license_number || '',
    submittedAt: fmtDate(raw.submitted_at || raw.created_at),
    submittedAtRaw: raw.submitted_at || raw.created_at || undefined,
    status: raw.status === 'SUBMITTED' ? 'pending' : raw.status === 'APPROVED' ? 'approved' : 'rejected',
    currentStage: 3,
    documents: (raw.documents || []).map((d: any) => ({
      id: String(d.id),
      name: d.original_filename || 'document.pdf',
      type: 'business_license',
      fileUrl: mediaUrl(d.file),
      uploadDate: fmtDate(d.created_at),
      status: 'pending',
    })),
    reviewerNotes: raw.review_notes || '',
  };
}

export function mapAdminUser(raw: any): UserProfile {
  const roleMap: Record<string, UserRole> = {
    FARMER: 'farmer',
    WHOLESALER: 'wholesaler',
    RETAILER: 'retailer',
    DRIVER: 'driver',
    FINANCIAL_MANAGER: 'financial_manager',
    USER_ADMIN: 'user_admin',
    REGIONAL_ADMIN: 'regional_admin',
    ZONAL_ADMIN: 'zonal_admin',
    WEREDA_ADMIN: 'wereda_admin',
    TOP_USER_ADMIN: 'top_user_admin',
    SUPER_ADMIN: 'super_admin',
    LOGISTICS_MANAGER: 'logistics_manager',
    CUSTOMER_SUPPORT: 'customer_support',
  };
  // Documents ride along from the registration summary so the paperwork stays
  // visible after approval (directory + approved lists, not just pending review).
  const summary = raw.registration_summary || null;
  const documents: DocumentRecord[] = (summary?.documents || []).map((doc: any) => ({
    id: String(doc.id),
    name: doc.original_filename || String(doc.document_type || '').replace(/_/g, ' ').toLowerCase(),
    type: String(doc.document_type || 'business_license').toLowerCase() as DocumentRecord['type'],
    fileUrl: doc.file_url ? mediaUrl(doc.file_url) : '',
    uploadDate: fmtDate(raw.created_at).split(',')[0],
    status: doc.status === 'VERIFIED' ? 'verified' : doc.status === 'REJECTED' ? 'rejected' : 'pending',
  }));
  return {
    id: String(raw.id),
    name: raw.full_name || raw.email,
    email: raw.email || '',
    phone: raw.phone || '',
    role: roleMap[raw.role] || 'farmer',
    region: summary?.location_name || raw.location || '',
    zone: '',
    wereda: '',
    verificationStatus:
      raw.status === 'APPROVED' ? 'verified' : raw.status === 'PENDING' ? 'pending' : raw.status === 'SUSPENDED' ? 'suspended' : 'unverified',
    avatarUrl: raw.profile_photo ? mediaUrl(raw.profile_photo) : undefined,
    registrationDate: fmtDate(raw.created_at).split(',')[0],
    registeredAt: raw.created_at || undefined,
    lastActivity: fmtDate(raw.updated_at),
    documents,
  };
}

// Derive regional metrics from the live platform user list (counts by region).
export function deriveRegionalMetrics(users: UserProfile[], payments: any[]): RegionalFinancialMetric[] {
  const byRegion = new Map<string, UserProfile[]>();
  users.forEach((u) => {
    const region = u.region || 'Unspecified';
    byRegion.set(region, [...(byRegion.get(region) || []), u]);
  });
  const totalTxValue = payments.reduce((acc, p) => acc + num(p.amount), 0);
  const verifiedValue = payments
    .filter((p) => p.status === 'VERIFIED')
    .reduce((acc, p) => acc + num(p.amount), 0);
  return Array.from(byRegion.entries()).map(([region, list]) => ({
    region,
    totalUsers: list.length,
    farmersCount: list.filter((u) => u.role === 'farmer').length,
    wholesalersCount: list.filter((u) => u.role === 'wholesaler').length,
    retailersCount: list.filter((u) => u.role === 'retailer').length,
    driversCount: list.filter((u) => u.role === 'driver').length,
    totalTransactions: payments.length,
    totalTransactionValueETB: totalTxValue,
    verifiedPaymentValueETB: verifiedValue,
    pendingPaymentValueETB: totalTxValue - verifiedValue,
    payoutValueETB: 0,
    availableWalletETB: 0,
    heldWalletETB: 0,
    // The client-side fallback has no location hierarchy, so every participant
    // counts as lacking zone-level detail.
    usersWithoutZoneDetail: list.length,
    zones: [],
  }));
}

export function mapShipmentToWaybill(raw: any): DigitalWaybill {
  return {
    id: String(raw.id),
    waybillNumber: raw.reference || raw.waybill_number || `WB-${raw.id}`,
    orderId: String(raw.order || raw.marketplace_order || ''),
    orderNumber: raw.order_reference || raw.order_number || '',
    cropName: raw.product_title || raw.crop || 'Produce',
    quantityQuintals: num(raw.quantity_kg) / 100 || num(raw.quantity),
    driverId: String(raw.driver || ''),
    driverName: raw.driver_name || 'Assigned Driver',
    truckPlate: raw.vehicle_plate || '—',
    corridor: `${raw.origin_name || ''} → ${raw.destination_name || ''}`,
    pickupPin: '••••',
    deliveryPin: '••••',
    pickupVerified: !!raw.pickup_confirmed_at,
    deliveryVerified: !!raw.delivered_at,
    status: 'In Transit',
    freightFeeETB: num(raw.delivery_fee_amount ?? raw.agreed_fee),
    feeStatus: raw.delivery_fee_amount || raw.agreed_fee ? 'Agreed' : 'Pending Review',
    lastTelemetry: {
      speedKmH: 0,
      locationName: raw.last_location_name || '—',
      updatedAt: fmtDate(raw.updated_at),
    },
  };
}
