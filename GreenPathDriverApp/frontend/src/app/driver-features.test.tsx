import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/logistics-api";
import DriverChatbot from "./driver-chatbot";
import DriverMessages from "./driver-messages";
import DriverSettings from "./driver-settings";
import DriverWallet from "./driver-wallet";

vi.mock("@/lib/logistics-api", () => ({
  apiBaseUrl: () => "http://localhost:8000/api",
  apiRequest: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

afterEach(() => {
  cleanup();
});

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    shipment_id: 31,
    kind: "delivery",
    reference: "ORDER-31",
    status: "in_transit",
    currency: "ETB",
    product_summary: "Two crates of tomatoes",
    pickup_region: "North",
    destination_region: "North",
    participants: [
      { id: 3, username: "buyer-one", display_name: "Buyer One", role: "wholesaler", role_label: "Wholesaler" },
    ],
    last_message: {
      id: 5,
      sender_username: "buyer-one",
      body: "Where are you now?",
      created_at: "2026-10-21T09:00:00Z",
    },
    unread_count: 2,
    can_post: true,
    last_read_at: null,
    updated_at: "2026-10-21T09:00:00Z",
    ...overrides,
  };
}

describe("Driver messages inbox", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("lists conversations, shows unread counts, and opens a thread", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/conversations/") {
        return { count: 1, conversations: [conversation()] } as T;
      }
      if (path.startsWith("/conversations/31/messages/")) {
        return {
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 5,
              sender_username: "buyer-one",
              body: "Where are you now?",
              created_at: "2026-10-21T09:00:00Z",
              offer_id: null,
            },
          ],
        } as T;
      }
      if (path === "/conversations/31/read/") {
        return { shipment_id: 31, last_read_at: "2026-10-21T10:00:00Z" } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverMessages />);

    expect(await screen.findByRole("heading", { name: "Conversations" })).toBeInTheDocument();
    expect(await screen.findByText("Shipment #31")).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/Where are you now\?/)).length,
    ).toBeGreaterThan(0);
    expect(await screen.findByLabelText("Message")).toBeInTheDocument();
  });

  it("keeps pending offer conversations read only", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/conversations/") {
        return {
          count: 1,
          conversations: [conversation({ kind: "offer", can_post: false, unread_count: 0 })],
        } as T;
      }
      if (path.startsWith("/conversations/31/messages/")) {
        return { count: 0, next: null, previous: null, results: [] } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverMessages />);

    expect(
      await screen.findByText(
        "This offer conversation is read-only until the shipment is assigned to you.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
  });

  it("sends a message through the shipment endpoint and reloads the thread", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/conversations/") {
        return { count: 1, conversations: [conversation({ unread_count: 0 })] } as T;
      }
      if (path.startsWith("/conversations/31/messages/")) {
        return { count: 0, next: null, previous: null, results: [] } as T;
      }
      if (path === "/shipments/31/messages/") {
        return {
          id: 9,
          sender_username: "driver-one",
          body: "On my way.",
          created_at: "2026-10-21T10:05:00Z",
          offer_id: null,
        } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverMessages />);

    const field = await screen.findByLabelText("Message");
    fireEvent.change(field, { target: { value: "On my way." } });
    fireEvent.click(screen.getByRole("button", { name: /Send message/ }));

    expect(await screen.findByText("Message sent.")).toBeInTheDocument();
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/shipments/31/messages/", {
        method: "POST",
        body: JSON.stringify({ body: "On my way." }),
      }),
    );
  });
});

describe("Driver wallet", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("explains that the wallet is not linked without a Marketplace credential", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/wallet/") {
        return {
          linked: false,
          wallet: null,
          transactions: [],
          payouts: [],
          detail: "Open DriverApp from your Marketplace driver account to see your earnings and payout status.",
        } as T;
      }
      if (path === "/wallet/fee-agreements/") {
        return { count: 0, agreements: [] } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverWallet />);

    expect(await screen.findByRole("heading", { name: "Earnings and payouts" })).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Open DriverApp from your Marketplace driver account to see your earnings and payout status.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Payout amount/)).not.toBeInTheDocument();
  });

  it("shows the approved Marketplace balance and the payout request form", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/wallet/") {
        return {
          linked: true,
          wallet: { currency: "ETB", available_balance: "1250.00", held_balance: "100.00" },
          transactions: [
            {
              reference: "DRIVER-FEE-7",
              amount: "1250.00",
              description: "Approved delivery fee",
              created_at: "2026-10-21T08:00:00Z",
            },
          ],
          payouts: [
            {
              id: "payout-1",
              amount: "100.00",
              destination: "Commercial Bank 1234",
              status: "pending",
              submitted_at: "2026-10-21T09:00:00Z",
            },
          ],
          detail: "",
        } as T;
      }
      if (path === "/wallet/bank-accounts/") {
        return {
          linked: true,
          count: 1,
          results: [
            {
              id: "account-1",
              bank: 7,
              bank_name: "Commercial Bank of Ethiopia",
              account_holder_name: "Aster Bekele",
              masked_account_number: "****0400",
              status: "NOT_VERIFIED",
              is_default: true,
            },
          ],
        } as T;
      }
      if (path === "/wallet/fee-agreements/") {
        return {
          count: 1,
          agreements: [
            {
              shipment_id: 31,
              reference: "ORDER-31",
              amount: "1250.00",
              currency: "ETB",
              status: "agreed",
              buyer_accepted_at: "2026-10-20T08:00:00Z",
              driver_accepted_at: "2026-10-20T08:05:00Z",
              review_decision: "approved",
              review_message: "",
              reviewed_at: "2026-10-21T08:00:00Z",
            },
          ],
        } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverWallet />);

    expect((await screen.findAllByText("1250.00 ETB")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/DRIVER-FEE-7/)).length).toBeGreaterThan(0);
    expect(await screen.findByText("Commercial Bank 1234")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Payout amount/)).toBeInTheDocument();
  });

  it("requests a payout with the amount and destination", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/wallet/") {
        return {
          linked: true,
          wallet: { currency: "ETB", available_balance: "1250.00", held_balance: "0.00" },
          transactions: [],
          payouts: [],
          detail: "",
        } as T;
      }
      if (path === "/wallet/fee-agreements/") {
        return { count: 0, agreements: [] } as T;
      }
      if (path === "/wallet/bank-accounts/") {
        return {
          linked: true,
          count: 1,
          results: [
            {
              id: "account-1",
              bank: 7,
              bank_name: "Commercial Bank of Ethiopia",
              account_holder_name: "Aster Bekele",
              masked_account_number: "****0400",
              status: "NOT_VERIFIED",
              is_default: true,
            },
          ],
        } as T;
      }
      if (path === "/wallet/payouts/") {
        return {
          id: "payout-2",
          amount: "250.00",
          destination: "Commercial Bank of Ethiopia ****0400",
          payout_account_bank: "Commercial Bank of Ethiopia",
          payout_account_masked: "****0400",
          status: "PENDING",
          external_reference: "WDR-250",
        } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverWallet />);

    fireEvent.change(await screen.findByLabelText(/Payout amount/), {
      target: { value: "250.00" },
    });
    await screen.findByRole("option", { name: /Commercial Bank of Ethiopia/ });
    fireEvent.change(screen.getByLabelText("Payout destination"), {
      target: { value: "account-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Request withdrawal/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Submit request" }));

    expect(await screen.findByText(/WDR-250/)).toBeInTheDocument();
    await waitFor(() => {
      const call = requestMock.mock.calls.find(([path]) => path === "/wallet/payouts/");
      expect(call).toBeTruthy();
      const [path, options] = call!;
      expect(path).toBe("/wallet/payouts/");
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toEqual({
        amount: "250.00",
        destination: "Commercial Bank of Ethiopia ****0400",
        payout_account: "account-1",
      });
      expect(options?.headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
    });
  });
});

describe("Driver chatbot", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("opens from the floating launcher and shows the Chatbot heading", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/assistant/conversations/") {
        return [
          { id: 4, title: "Where is my pickup?", created_at: "2026-10-21T08:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
        ] as T;
      }
      if (path === "/assistant/conversations/4/messages/") return [] as T;
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverChatbot />);

    fireEvent.click(screen.getByRole("button", { name: "Open Chatbot" }));

    expect(await screen.findByRole("heading", { name: "Chatbot" })).toBeInTheDocument();
    expect(
      await screen.findByText(/Ask about driver approval, availability, delivery offers/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
  });

  it("shows the grounded answer returned by the backend", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/assistant/conversations/") {
        return [
          { id: 4, title: "Where is my pickup?", created_at: "2026-10-21T08:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
        ] as T;
      }
      if (path === "/assistant/conversations/4/messages/") {
        if (requestMock.mock.calls.some((call) => call[1] !== undefined)) {
          return {
            user_message: {
              id: 1,
              role: "user",
              content: "Where is my pickup?",
              created_at: "2026-10-21T09:00:00Z",
            },
            assistant_message: {
              id: 2,
              role: "assistant",
              content: "Your pickup is in Market Wereda.",
              created_at: "2026-10-21T09:00:01Z",
            },
          } as T;
        }
        return [] as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverChatbot />);

    fireEvent.click(screen.getByRole("button", { name: "Open Chatbot" }));
    await screen.findByText(/Answers use your own authorized records/);
    const field = await screen.findByLabelText("Chatbot message");
    fireEvent.change(field, { target: { value: "Where is my pickup?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(
      (await screen.findAllByText(/Your pickup is in Market Wereda\./)).length,
    ).toBeGreaterThan(0);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/assistant/conversations/4/messages/",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

describe("Driver settings", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  const user = {
    username: "driver-one",
    email: "driver@example.com",
    first_name: "Aster",
    last_name: "Bekele",
    role: "driver",
    is_active: true,
  };

  it("changes the password only when the confirmation matches", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/auth/password/change/") {
        return {
          success: true,
          detail: "Your password was updated. Use the new password the next time you sign in.",
        } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<DriverSettings user={user} onSignOut={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "existing-password" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText(/Your password was updated\./),
    ).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith("/auth/password/change/", {
      method: "POST",
      body: JSON.stringify({
        current_password: "existing-password",
        new_password: "new-password-123",
        confirm_password: "new-password-123",
      }),
    });
  });

  it("blocks submission when the new passwords do not match", () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/wallet/bank-accounts/") {
        return { linked: true, count: 0, results: [] } as T;
      }
      if (path === "/wallet/banks/") {
        return { count: 0, results: [] } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<DriverSettings user={user} onSignOut={() => undefined} />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "existing-password" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(screen.getByRole("alert")).toHaveTextContent("The new passwords do not match.");
    expect(
      requestMock.mock.calls.some(([path]) => path === "/auth/password/change/"),
    ).toBe(false);
  });
});
