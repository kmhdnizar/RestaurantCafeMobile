import { API_BASE_URL, VERCEL_BYPASS_SECRET } from "@/lib/config";
import { getStoredToken } from "@/auth/token-storage";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown specifically on 401, so callers (the session store) can tell
 * "the token is no longer valid, force logout" apart from any other
 * failure (network error, 4xx validation, 5xx server error). */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Skip attaching the stored bearer token — only the login call needs this. */
  skipAuth?: boolean;
}

// Registered once by the root layout (session-store's forceLogout) rather
// than imported directly here, to avoid a client.ts <-> session-store.ts
// circular import.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * Our own API routes send `{ error: "some string" }`. Vercel's Deployment
 * Protection wall (when a request isn't recognized as coming through the
 * bypass) sends a differently-shaped `{ error: { message, code }, ... }`
 * instead — handle both so a blocked-by-Vercel response shows something
 * useful ("Protected deployment") rather than "[object Object]".
 */
function extractErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const err = (data as { error: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return null;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!options.skipAuth) {
    const token = await getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // Only relevant until the target deployment's Vercel Deployment
  // Protection is scoped to exclude production (see mobile app README) —
  // harmless no-op once that's fixed since the header is simply unused.
  if (VERCEL_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = VERCEL_BYPASS_SECRET;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "Network request failed");
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message = extractErrorMessage(data) ?? `Request failed with status ${res.status}`;
    if (res.status === 401) {
      if (!options.skipAuth) unauthorizedHandler?.();
      throw new UnauthorizedError(message);
    }
    throw new ApiError(res.status, message);
  }

  return data as T;
}
