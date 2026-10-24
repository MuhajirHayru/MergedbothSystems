import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/logistics-api";
import PhaseTwo, { resolveMarketplaceRegisterUrl } from "./phase-two";

vi.mock("@/lib/logistics-api", () => ({
  apiBaseUrl: () => "http://localhost:8000/api",
  apiRequest: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

const draftApplication = {
  id: 14,
  status: "draft",
  legal_full_name: "Aster Farmer",
  identity_document_type: "",
  identity_reference: "",
  license_number: "LIC-14",
  license_expiry: "2027-10-16",
  vehicle_type: "Small truck",
  vehicle_registration: "REG-14",
  cargo_capacity_kg: "1200.00",
  service_region: "North",
  service_zone: "Highland",
  service_wereda: "Market Wereda",
  submitted_at: null,
  reviewed_at: null,
  review_reason: "",
  created_at: "2026-10-16T10:00:00Z",
  updated_at: "2026-10-16T10:00:00Z",
  profile: { phone_number: "+251900000001", preferred_language: "en" },
  documents: [],
  review_history: [],
};

function currentUser(role: string) {
  return {
    id: 8,
    username: "greenpath-user",
    email: "user@example.test",
    first_name: "",
    last_name: "",
    role,
    is_active: true,
  };
}

describe("Phase 2 role-aware workspace", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows sign-in errors without hiding the form", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/auth/me/") throw new Error("Not signed in");
      throw new Error("Invalid credentials or inactive account.");
    });

    render(<PhaseTwo />);
    fireEvent.change(await screen.findByLabelText("Username or email"), {
      target: { value: "driver-one" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials or inactive account.",
    );
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows only the role-limited workspace for a farmer", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/auth/me/") return currentUser("farmer") as T;
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseTwo />);

    expect(
      await screen.findByRole("heading", { name: "Account workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No workspace is assigned to this role yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Driver review/ })).not.toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("loads the driver's own application and status", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/auth/me/") return currentUser("driver") as T;
      if (path === "/drivers/me/application/") return draftApplication as T;
      if (path === "/shipments/" || path === "/drivers/me/shipment-offers/") {
        return [] as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseTwo />);

    expect(
      await screen.findByRole("heading", { name: "Driver dashboard" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Legal full name")).toHaveValue("Aster Farmer");
    expect(screen.getAllByText("Draft", { selector: ".status-pill" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeInTheDocument();
  });

  it("saves the availability switch and reflects the backend state", async () => {
    requestMock.mockImplementation(
      async <T,>(path: string, options?: RequestInit): Promise<T> => {
        if (path === "/auth/me/") return currentUser("driver") as T;
        if (path === "/drivers/me/application/") return draftApplication as T;
        if (path === "/drivers/me/availability/") {
          return (options?.method === "PATCH"
            ? { available: true, eligible: true }
            : { available: false, eligible: true }) as T;
        }
        if (path === "/conversations/unread/") return { unread_count: 0 } as T;
        if (path === "/conversations/") return { count: 0, conversations: [] } as T;
        if (path === "/assistant/conversations/") return [] as T;
        if (path === "/wallet/") {
          return {
            linked: false,
            wallet: null,
            transactions: [],
            payouts: [],
            detail: "Open DriverApp from your Marketplace driver account.",
          } as T;
        }
        if (path === "/shipments/" || path === "/drivers/me/shipment-offers/") {
          return [] as T;
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );

    render(<PhaseTwo />);

    const toggle = await screen.findByRole("switch", {
      name: "Available for new delivery offers",
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(requestMock).toHaveBeenCalledWith("/drivers/me/availability/", {
      method: "PATCH",
      body: JSON.stringify({ available: true }),
    });
    expect(await screen.findByText("ACTIVE")).toBeInTheDocument();
  });

  it("loads the reviewer queue without exposing financial tools", async () => {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/auth/me/") return currentUser("regional_admin") as T;
      if (path.startsWith("/admin/driver-applications/")) {
        return { count: 0, next: null, previous: null, results: [] } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<PhaseTwo />);

    expect(await screen.findByRole("heading", { name: "Application queue" })).toBeInTheDocument();
    expect(await screen.findByText("No applications match this view.")).toBeInTheDocument();
    expect(screen.queryByText("Finance")).not.toBeInTheDocument();
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
  });
});

describe("Marketplace driver registration destination", () => {
  it("adds the driver role to the configured Marketplace registration URL", () => {
    expect(resolveMarketplaceRegisterUrl("http://localhost:3000/register")).toBe(
      "http://localhost:3000/register?role=DRIVER",
    );
  });

  it("preserves other query parameters while selecting the driver role", () => {
    expect(resolveMarketplaceRegisterUrl("https://market.example/register?source=driverapp")).toBe(
      "https://market.example/register?source=driverapp&role=DRIVER",
    );
  });

  it("returns an empty destination when configuration is missing or unsafe", () => {
    expect(resolveMarketplaceRegisterUrl()).toBe("");
    expect(resolveMarketplaceRegisterUrl("javascript:alert(1)")).toBe("");
  });
});
