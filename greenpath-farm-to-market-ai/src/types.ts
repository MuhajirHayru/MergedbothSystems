export type UserRole =
  | 'public'
  | 'farmer'
  | 'wholesaler'
  | 'retailer'
  | 'driver'
  | 'financial_manager'
  | 'user_admin'
  | 'top_user_admin'
  | 'super_admin' | 'logistics_manager' | 'customer_support';

export type Language = 'en' | 'am' | 'om';

// Mirrors payments.OrderStatus on the Django backend. The legacy labels below
// are kept for older local state; every transition now uses these values.
export type OrderStatus =
  | 'Pending seller approval'
  | 'Accepted'
  | 'Confirmed'
  | 'Awaiting quality confirmation'
  | 'Awaiting payment release'
  | 'Ordered'
  | 'Seller Approval'
  | 'Processing'
  | 'Shipped'
  | 'Delivered'
  | 'Quality Confirmation'
  | 'Payment Release'
  | 'Completed'
  | 'Rejected'
  | 'Disputed'
  | 'Cancelled';

export interface DocumentRecord {
  id: string;
  name: string;
  type: 'farmer_license' | 'business_license' | 'driver_license' | 'vehicle_reg' | 'tax_certificate' | 'land_deed';
  fileUrl: string;
  uploadDate: string;
  expiryDate?: string;
  status: 'verified' | 'pending' | 'rejected';
  reviewerNotes?: string;
  verifiedBy?: string;
  fileSize?: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  maskedAccountNumber: string;
  accountType: 'Checking' | 'Savings' | 'Business Escrow';
  isPrimary: boolean;
  verificationStatus: 'verified' | 'pending' | 'rejected';
  addedDate: string;
  // FM review fields
  ownerName?: string;
  ownerRole?: string;
  status?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  legalFullName?: string;
  email: string;
  phone: string;
  age?: number;
  sex?: 'Male' | 'Female' | 'Other';
  role: UserRole;
  region: string;
  zone: string;
  wereda: string;
  kebele?: string;
  subCity?: string;
  registeredAddress?: string;
  verificationStatus: 'verified' | 'pending' | 'unverified' | 'suspended';
  avatarUrl?: string;
  businessName?: string;
  tinNumber?: string;
  licenseNumber?: string;
  licenseExpiryDate?: string;
  landCertificateId?: string;
  truckPlateNumber?: string;
  truckCapacityTons?: number;
  registrationDate: string;
  lastActivity?: string;
  documents: DocumentRecord[];
  bankAccounts?: BankAccount[];
}

export interface Product {
  id: string;
  title: string;
  amharicTitle: string;
  oromoTitle?: string;
  // Category names are database-driven (product_catalog_categories), so the
  // type stays open rather than freezing a hardcoded set in the frontend.
  category: string;
  variety: string;
  grade: 'Grade 1 Export' | 'Grade 1 Domestic' | 'Grade 2 Commercial';
  unit: 'kg' | 'quintal (100kg)' | 'crate (25kg)' | 'ton';
  minOrder: number;
  availableQuantity: number;
  pricePerUnitETB: number;
  farmerId: string;
  farmerName: string;
  farmerPhone?: string; // Private, not shown in public browsing
  // Public location: General regional context ONLY - no exact coordinates or address!
  location: {
    region: string;
    zone: string;
    wereda?: string;
    hubCorridor: string;
  };
  harvestDate: string;
  expiryDays: number;
  images: string[];
  status: 'available' | 'low_stock' | 'sold_out';
  description: string;
  isOrganicCertified?: boolean;
  rating: number;
  reviewCount: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  buyerId: string;
  buyerName: string;
  buyerRole: 'wholesaler' | 'retailer';
  sellerId: string;
  sellerName: string;
  sellerRole: 'farmer' | 'wholesaler';
  productId: string;
  productTitle: string;
  quantity: number;
  unit: string;
  agreedPricePerUnitETB: number;
  totalAmountETB: number;
  status: OrderStatus;
  allowedTransitions?: string[];
  createdAt: string;
  deliveryCorridor: string;
  driverId?: string;
  driverName?: string;
  chapaReference?: string;
  escrowStatus: 'held_in_escrow' | 'released' | 'refunded' | 'pending_payment';
  timeline: Array<{
    stage: string;
    timestamp: string;
    note: string;
  }>;
}

export interface TransactionRecord {
  id: string;
  date: string;
  type: 'deposit' | 'escrow_lock' | 'escrow_release' | 'payout' | 'fee' | 'delivery_payment';
  amountETB: number;
  feeETB: number;
  reference: string;
  counterparty: string;
  status: 'verified' | 'pending' | 'flagged' | 'completed';
  description: string;
}

export interface DepositRecord {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  amountETB: number;
  method: 'Chapa' | 'Telebirr' | 'CBE Birr' | 'Bank Transfer';
  reference: string;
  timestamp: string;
  status: 'Pending' | 'Approved' | 'Flagged' | 'Rejected';
  receiptUrl?: string;
  bankAccount?: string;
}

export interface PayoutRequest {
  id: string;
  userId: string;
  userName: string;
  role: UserRole;
  amountETB: number;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  payoutAccount?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  processedAt?: string;
}

export interface WalletState {
  availableBalanceETB: number;
  heldBalanceETB: number;
  totalVolumeETB: number;
  currency: string;
  transactions: TransactionRecord[];
  deposits: DepositRecord[];
  payouts: PayoutRequest[];
}

export interface RegistrationApplication {
  id: string;
  trackingNumber?: string;
  fullName: string;
  age?: number;
  sex?: 'Male' | 'Female' | 'Other';
  email: string;
  phone: string;
  faydaId?: string;
  role: 'farmer' | 'wholesaler' | 'retailer' | 'driver';
  region: string;
  zone: string;
  wereda: string;
  kebele?: string;
  subCity?: string;
  businessName?: string;
  licenseNumber?: string;
  licenseExpiryDate?: string;
  // Farmer specific
  landSizeHectares?: number;
  irrigationType?: string;
  cooperativeAffiliation?: string;
  // Wholesaler specific
  warehouseCapacityQuintals?: number;
  coldStorageAvailable?: boolean;
  // Retailer specific
  retailLocationType?: string;
  // Driver specific
  driverLicenseGrade?: string;
  vehicleModel?: string;
  vehiclePlate?: string;
  vehicleCapacityTons?: number;
  insurancePolicyNumber?: string;
  productFocus?: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  currentStage?: number; // 1 to 5
  documents: DocumentRecord[];
  reviewerNotes?: string;
}

export interface WeredaFinancialMetric {
  weredaName: string;
  totalTransactions: number;
  totalValueETB: number;
}

export interface ZoneFinancialMetric {
  zoneName: string;
  totalTransactions: number;
  totalValueETB: number;
  weredas: WeredaFinancialMetric[];
}

export interface RegionalFinancialMetric {
  region: string;
  totalUsers: number;
  farmersCount: number;
  wholesalersCount: number;
  retailersCount: number;
  driversCount: number;
  totalTransactions: number;
  totalTransactionValueETB: number;
  verifiedPaymentValueETB: number;
  pendingPaymentValueETB: number;
  payoutValueETB: number;
  availableWalletETB: number;
  heldWalletETB: number;
  zones: ZoneFinancialMetric[];
}

export interface AuditLog {
  id: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetUser: string;
  category: 'Authentication' | 'Financial' | 'Verification' | 'Marketplace' | 'Security' | 'System';
  timestamp: string;
  scope: string;
  result: 'Success' | 'Failed' | 'Warning';
  reference: string;
}

export interface WebsiteContent {
  platformTitle: string;
  amharicTitle: string;
  oromoTitle: string;
  heroHeadline: string;
  heroSubtitle: string;
  aboutDescription: string;
  contactEmail: string;
  contactPhone: string;
  contactOffice: string;
  faqItems: Array<{ q: string; a: string }>;
}

export interface SecuritySettings {
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  sessionTimeoutMinutes: number;
  twoFactorRequiredForFinancial: boolean;
}

export interface PlatformConfig {
  platformTitle: string;
  amharicTitle: string;
  oromoTitle: string;
  categories: string[];
  supportedRegions: string[];
  security: SecuritySettings;
  websiteContent: WebsiteContent;
}

export interface ConversationMessage {
  id: string;
  senderId: string;
  senderName: string;
  timestamp: string;
  text: string;
  isAudio?: boolean;
  audioDuration?: string;
  audioUrl?: string;
  read: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  participantId: string;
  participantName: string;
  participantRole: string;
  participantRegion: string;
  orderReference?: string;
  category: 'Orders' | 'Logistics' | 'Negotiations' | 'General';
  unreadCount: number;
  messages: ConversationMessage[];
}

export interface DigitalWaybill {
  id: string;
  waybillNumber: string;
  orderId: string;
  orderNumber: string;
  cropName: string;
  quantityQuintals: number;
  driverId: string;
  driverName: string;
  truckPlate: string;
  corridor: string;
  pickupPin: string;
  deliveryPin: string;
  pickupVerified: boolean;
  deliveryVerified: boolean;
  status: 'Dispatched' | 'At Pickup' | 'In Transit' | 'Arrived at Destination' | 'Completed';
  freightFeeETB: number;
  feeStatus: 'Agreed' | 'Pending Review' | 'Released';
  lastTelemetry: {
    speedKmH: number;
    locationName: string;
    updatedAt: string;
  };
}
