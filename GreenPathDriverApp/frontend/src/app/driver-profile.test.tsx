import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/logistics-api";
import DriverBankAccounts from "./driver-bank-accounts";
import DriverProfile from "./driver-profile";

vi.mock("@/lib/logistics-api", () => ({
  apiBaseUrl: () => "http://localhost:8000/api",
  apiRequest: vi.fn(),
}));

const requestMock = vi.mocked(apiRequest);

const application = {
  status: "approved",
  legal_full_name: "Aster Bekele",
  license_number: "LIC-14",
  license_expiry: "2027-10-16",
  vehicle_type: "Small truck",
  vehicle_registration: "REG-14",
  cargo_capacity_kg: "1200.00",
  service_region: "North",
  service_zone: "Highland",
  service_wereda: "Market Wereda",
};

const user = {
  username: "aster",
  email: "aster@example.com",
  first_name: "Aster",
  last_name: "Bekele",
};

afterEach(() => {
  cleanup();
});

describe("Driver profile", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  function mockProfile(overrides: Record<string, unknown> = {}) {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/auth/profile/") {
        return {
          linked: true,
          profile: {
            full_name: "Aster Bekele",
            email: "aster@example.com",
            phone: "+251900000001",
            location: "Addis Ababa",
            profile_photo: null,
            status: "APPROVED",
            approval: "approved",
            ...overrides,
          },
          editable: { full_name: true, phone: true, photo: true },
          detail: "",
        } as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  }

  it("shows the canonical profile and saves contact details", async () => {
    mockProfile();
    const onProfileSaved = vi.fn();
    render(
      <DriverProfile
        user={user}
        application={application}
        availability={{ available: true, eligible: true }}
        onProfileSaved={onProfileSaved}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Aster Bekele" }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText("+251900000001")).length).toBeGreaterThan(0);
    expect(screen.getByText("LIC-14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Aster T. Bekele" },
    });
    requestMock.mockImplementationOnce(async <T,>(): Promise<T> => {
      return { success: true, profile: { full_name: "Aster T. Bekele", phone: "+251900000001" } } as T;
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith("/auth/profile/", {
      method: "PATCH",
      body: JSON.stringify({ full_name: "Aster T. Bekele" }),
    });
    expect(onProfileSaved).toHaveBeenCalledWith("Aster T. Bekele", "+251900000001");
  });

  it("rejects a picture that is not an allowed image type", async () => {
    mockProfile();
    render(
      <DriverProfile
        user={user}
        application={application}
        availability={null}
        onProfileSaved={() => undefined}
      />,
    );

    await screen.findByRole("heading", { name: "Aster Bekele" });
    const file = new File(["gif"], "avatar.gif", { type: "image/gif" });
    fireEvent.change(screen.getByLabelText("Profile picture file"), {
      target: { files: [file] },
    });

    expect(
      screen.getByText("Choose a JPEG, PNG, or WebP image."),
    ).toBeInTheDocument();
  });

  it("previews and uploads a valid picture", async () => {
    mockProfile();
    render(
      <DriverProfile
        user={user}
        application={application}
        availability={null}
        onProfileSaved={() => undefined}
      />,
    );

    await screen.findByRole("heading", { name: "Aster Bekele" });
    const file = new File(["png"], "avatar.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Profile picture file"), {
      target: { files: [file] },
    });
    expect(screen.getByText("avatar.png")).toBeInTheDocument();

    requestMock.mockImplementationOnce(async <T,>(): Promise<T> => {
      return { success: true, profile: { full_name: "Aster Bekele" } } as T;
    });
    fireEvent.click(screen.getByRole("button", { name: "Save picture" }));

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/auth/profile/photo/",
        expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
      ),
    );
  });
});

describe("Driver bank accounts", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  function mockAccounts() {
    requestMock.mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/wallet/banks/") {
        return {
          count: 1,
          results: [
            {
              id: 7,
              code: "cbe",
              name: "Commercial Bank of Ethiopia",
              source_url: "https://example.test",
            },
          ],
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
      throw new Error(`Unexpected request: ${path}`);
    });
  }

  it("shows masked accounts and their verification state", async () => {
    mockAccounts();
    render(<DriverBankAccounts />);

    expect(await screen.findByText("****0400")).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.queryByText(/100200300400/)).not.toBeInTheDocument();
  });

  it("registers a new account without ever sending a full number to display", async () => {
    mockAccounts();
    render(<DriverBankAccounts />);
    await screen.findByText("****0400");

    fireEvent.click(screen.getByRole("button", { name: /Add account/ }));
    fireEvent.change(screen.getByLabelText("Account holder name"), {
      target: { value: "Aster Bekele" },
    });
    fireEvent.change(screen.getByLabelText(/^Account number/), {
      target: { value: "100200300400" },
    });
    fireEvent.change(screen.getByLabelText("Confirm account number"), {
      target: { value: "100200300400" },
    });

    requestMock.mockImplementationOnce(
      async <T,>(): Promise<T> =>
        ({
          id: "account-2",
          bank_name: "Commercial Bank of Ethiopia",
          masked_account_number: "****0400",
          account_holder_name: "Aster Bekele",
          status: "NOT_VERIFIED",
          is_default: false,
        }) as T,
    );
    fireEvent.click(screen.getByRole("button", { name: "Register account" }));

    await waitFor(() => {
      const call = requestMock.mock.calls.find(
        ([path, options]) =>
          path === "/wallet/bank-accounts/" && (options as RequestInit)?.method === "POST",
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call![1] as RequestInit).body));
      expect(body.account_number).toBe("100200300400");
      expect(body.bank).toBe(7);
      expect(body.account_holder_name).toBe("Aster Bekele");
    });
  });
});
