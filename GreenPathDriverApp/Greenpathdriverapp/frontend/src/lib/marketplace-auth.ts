import { apiBaseUrl } from "@/lib/logistics-api";

export type MarketplaceLoginResult = {
  success: boolean;
  access: string;
  user: {
    id: string;
    role: string;
    status: string;
  };
};

function marketplaceBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_MARKETPLACE_API_BASE_URL?.trim();
  if (!configured) {
    throw new Error("Marketplace sign-in is not configured. Set NEXT_PUBLIC_MARKETPLACE_API_BASE_URL.");
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Marketplace sign-in URL is invalid.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Marketplace sign-in URL must use HTTPS and contain no credentials.");
  }
  return url.toString().replace(/\/$/, "");
}

async function responsePayload(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    if (typeof body.error === "string") throw new Error(body.error);
    if (typeof body.detail === "string") throw new Error(body.detail);
    if (body.success === false) throw new Error("Marketplace sign-in was rejected.");
  }
  if (!response.ok) throw new Error("Marketplace sign-in could not be completed.");
  return payload;
}

export async function signInWithMarketplace(email: string, password: string) {
  const loginResponse = await fetch(`${marketplaceBaseUrl()}/api/v1/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  const payload = (await responsePayload(loginResponse)) as MarketplaceLoginResult;
  if (!payload?.access || payload.user?.role !== "DRIVER" || payload.user?.status !== "APPROVED") {
    throw new Error("An approved Marketplace driver account is required.");
  }

  const exchangeResponse = await fetch(`${apiBaseUrl()}/integrations/v2/driver/session/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ marketplace_access_token: payload.access }),
    credentials: "include",
    cache: "no-store",
  });
  await responsePayload(exchangeResponse);
}
