import { apiRequest } from "@/lib/logistics-api";

export type ConversationParticipant = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  role_label: string;
};

export type ConversationSummary = {
  shipment_id: number;
  kind: "delivery" | "offer";
  reference: string | null;
  status: string;
  currency: string;
  product_summary: string;
  pickup_region: string;
  destination_region: string;
  participants: ConversationParticipant[];
  last_message: {
    id: number;
    sender_username: string;
    body: string;
    created_at: string;
  } | null;
  unread_count: number;
  can_post: boolean;
  last_read_at: string | null;
  updated_at: string;
};

export type ConversationInbox = {
  count: number;
  conversations: ConversationSummary[];
};

export type ShipmentMessage = {
  id: number;
  sender_username: string;
  body: string;
  created_at: string;
  offer_id: number | null;
};

export type MessagePage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: ShipmentMessage[];
};

export type MarketplaceWallet = {
  id?: string;
  currency: string;
  available_balance: string;
  held_balance: string;
  incoming_total?: number | string;
  outgoing_total?: number | string;
  updated_at?: string;
};

export type WalletSummary = {
  currency: string;
  available_balance: string;
  pending_balance: string;
  withdrawable_balance: string;
  total_earnings: string;
  total_withdrawn: string;
  pending_withdrawals: string;
  pending_withdrawal_count: number;
};

export type WalletTransaction = {
  id?: string | number;
  transaction_type?: string;
  amount: string;
  available_delta?: string;
  held_delta?: string;
  currency?: string;
  reference: string;
  external_reference?: string;
  description?: string;
  order?: string | number | null;
  order_reference?: string | null;
  created_at?: string;
  status?: string;
};

export type WalletPayout = {
  id?: string | number;
  amount: string;
  currency?: string;
  destination: string;
  status: string;
  submitted_at?: string;
  review_notes?: string;
  payout_account?: string | null;
  payout_account_bank?: string;
  payout_account_masked?: string;
  payout_account_status?: string | null;
  external_reference?: string;
};

export type PayoutBank = {
  id: number;
  code: string;
  name: string;
  source_url: string;
};

export type BankAccount = {
  id: string;
  bank: number;
  bank_name: string;
  account_holder_name: string;
  masked_account_number: string;
  branch?: string;
  branch_code?: string;
  account_type?: string;
  nickname?: string;
  status: "NOT_VERIFIED" | "REQUIRES_REVIEW" | string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DriverProfile = {
  full_name: string;
  email: string;
  phone: string;
  location?: string;
  profile_photo?: string | null;
  role?: string;
  status?: string;
  approval?: string;
  [key: string]: unknown;
};

export type DriverProfileResponse = {
  linked: boolean;
  profile: DriverProfile;
  editable: { full_name: boolean; phone: boolean; photo: boolean };
  detail: string;
};

export type DriverWalletResponse = {
  linked: boolean;
  wallet: MarketplaceWallet | null;
  summary?: WalletSummary | null;
  transactions: WalletTransaction[];
  payouts: WalletPayout[];
  detail: string;
};

export type FeeAgreement = {
  shipment_id: number;
  reference: string | null;
  amount: string;
  currency: string;
  status: string;
  buyer_accepted_at: string | null;
  driver_accepted_at: string | null;
  review_decision: string | null;
  review_message: string;
  reviewed_at: string | null;
};

export type FeeAgreementResponse = {
  count: number;
  agreements: FeeAgreement[];
};

export type AssistantConversation = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AssistantMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AssistantReply = {
  user_message: AssistantMessage;
  assistant_message: AssistantMessage;
};

export function loadConversationInbox() {
  return apiRequest<ConversationInbox>("/conversations/");
}

export function loadUnreadCount() {
  return apiRequest<{ unread_count: number }>("/conversations/unread/");
}

export function loadConversationMessages(shipmentId: number) {
  return apiRequest<MessagePage>(`/conversations/${shipmentId}/messages/?limit=50`);
}

export function markConversationRead(shipmentId: number) {
  return apiRequest<{ shipment_id: number; last_read_at: string }>(
    `/conversations/${shipmentId}/read/`,
    { method: "POST", body: "{}" },
  );
}

export function sendShipmentMessage(shipmentId: number, body: string) {
  return apiRequest<ShipmentMessage>(`/shipments/${shipmentId}/messages/`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function loadDriverWallet() {
  return apiRequest<DriverWalletResponse>("/wallet/");
}

export function loadFeeAgreements() {
  return apiRequest<FeeAgreementResponse>("/wallet/fee-agreements/");
}

export function requestPayout(
  amount: string,
  destination: string,
  options: { payoutAccount?: string; idempotencyKey?: string } = {},
) {
  return apiRequest<WalletPayout>("/wallet/payouts/", {
    method: "POST",
    headers: options.idempotencyKey
      ? { "Idempotency-Key": options.idempotencyKey }
      : undefined,
    body: JSON.stringify({
      amount,
      destination,
      ...(options.payoutAccount ? { payout_account: options.payoutAccount } : {}),
    }),
  });
}

export function loadDriverProfile() {
  return apiRequest<DriverProfileResponse>("/auth/profile/");
}

export function updateDriverProfile(fields: { full_name?: string; phone?: string }) {
  return apiRequest<{ success: boolean; profile: DriverProfile }>("/auth/profile/", {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export function uploadDriverProfilePhoto(file: File) {
  const form = new FormData();
  form.append("profile_photo", file);
  return apiRequest<{ success: boolean; profile: DriverProfile }>("/auth/profile/photo/", {
    method: "POST",
    body: form,
  });
}

export function deleteDriverProfilePhoto() {
  return apiRequest<{ success: boolean }>("/auth/profile/photo/", { method: "DELETE" });
}

export function loadPayoutBanks() {
  return apiRequest<{ count: number; results: PayoutBank[] }>("/wallet/banks/");
}

export function loadBankAccounts() {
  return apiRequest<{ linked?: boolean; count: number; results: BankAccount[] }>(
    "/wallet/bank-accounts/",
  );
}

export type BankAccountInput = {
  bank: number;
  account_holder_name: string;
  account_number?: string;
  confirm_account_number?: string;
  branch?: string;
  branch_code?: string;
  account_type?: string;
  nickname?: string;
  is_default?: boolean;
};

export function createBankAccount(payload: BankAccountInput) {
  return apiRequest<BankAccount>("/wallet/bank-accounts/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateBankAccount(id: string, payload: Partial<BankAccountInput>) {
  return apiRequest<BankAccount>(`/wallet/bank-accounts/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteBankAccount(id: string) {
  return apiRequest<null>(`/wallet/bank-accounts/${id}/`, { method: "DELETE" });
}

export function loadAssistantConversations() {
  return apiRequest<AssistantConversation[]>("/assistant/conversations/");
}

export function createAssistantConversation() {
  return apiRequest<AssistantConversation>("/assistant/conversations/", {
    method: "POST",
    body: "{}",
  });
}

export function loadAssistantMessages(conversationId: number) {
  return apiRequest<AssistantMessage[]>(
    `/assistant/conversations/${conversationId}/messages/`,
  );
}

export function sendAssistantMessage(
  conversationId: number,
  content: string,
  language: string,
) {
  return apiRequest<AssistantReply>(
    `/assistant/conversations/${conversationId}/messages/`,
    {
      method: "POST",
      body: JSON.stringify({ content, language }),
    },
  );
}

export function transcribeAssistantAudio(audio: File, language: string) {
  const form = new FormData();
  form.append("audio", audio);
  form.append("language", language);
  return apiRequest<{ text: string }>("/assistant/transcribe/", {
    method: "POST",
    body: form,
  });
}
