export function apiBaseUrl() {
  const fallbackHost =
    typeof window === "undefined" ? "localhost" : window.location.hostname;
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ?? `http://${fallbackHost}:8000/api`
  ).replace(/\/$/, "");
}

function errorMessage(payload: unknown) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    const messages = Object.entries(record).map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(" ") : String(value);
      return `${key}: ${text}`;
    });
    if (messages.length) return messages.join(" · ");
  }
  return "The request could not be completed. Please try again.";
}

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  const safeMethod = ["GET", "HEAD", "OPTIONS", "TRACE"].includes(method);

  if (!safeMethod) {
    const csrfResponse = await fetch(`${apiBaseUrl()}/auth/csrf/`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!csrfResponse.ok) throw new Error("Could not initialize secure request.");
    const csrfBody = (await csrfResponse.json()) as { csrf_token: string };
    headers.set("X-CSRFToken", csrfBody.csrf_token);
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 204) return null as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiRequestError(errorMessage(payload), response.status);
  return payload as T;
}