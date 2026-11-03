import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logistics-api", () => ({ apiBaseUrl: () => "http://localhost:8001/api" }));

import { signInWithMarketplace } from "./marketplace-auth";

const fetchMock = vi.fn<typeof fetch>();

describe("Marketplace driver sign-in", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("logs in through Marketplace and exchanges the access token for a DriverApp session", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_API_BASE_URL", "http://localhost:8000");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        access: "temporary-access-token",
        user: { id: "canonical-id", role: "DRIVER", status: "APPROVED" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await signInWithMarketplace("driver@example.test", "test-password");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:8000/api/v1/auth/login/");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      email: "driver@example.test",
      password: "test-password",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:8001/api/integrations/v2/driver/session/");
    expect(fetchMock.mock.calls[1][1]?.credentials).toBe("include");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      marketplace_access_token: "temporary-access-token",
    });
  });

  it("does not request a DriverApp session for a pending or non-driver Marketplace account", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_API_BASE_URL", "http://localhost:8000");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      access: "temporary-access-token",
      user: { id: "canonical-id", role: "DRIVER", status: "PENDING" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signInWithMarketplace("driver@example.test", "test-password"))
      .rejects.toThrow("An approved Marketplace driver account is required.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when the Marketplace API URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_API_BASE_URL", "");
    vi.stubGlobal("fetch", fetchMock);

    await expect(signInWithMarketplace("driver@example.test", "test-password"))
      .rejects.toThrow("Marketplace sign-in is not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
