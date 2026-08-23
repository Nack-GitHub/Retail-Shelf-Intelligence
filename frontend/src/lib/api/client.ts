/* The only file in the frontend that knows the API's address or the token.
 *
 * This mirrors backend/app/adapters/ml_client.py being the only file that
 * knows the ML service exists. The value is the same in both directions: when
 * the base URL moves, or auth changes shape, there is exactly one place to
 * look — and a component can never quietly acquire its own opinion about
 * either by calling fetch itself. */

import { ApiError } from "@/lib/api/errors";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "shelfeye.token";
const EXPIRY_KEY = "shelfeye.token.expiresAt";

/* sessionStorage, not localStorage: a token that outlives the browser tab is
 * a token nobody remembers is there. The expiry is stored alongside and
 * checked on every read, so a stale token is never attached to a request —
 * the server would reject it anyway, but failing here saves a round trip and
 * a confusing flash of an empty screen. */

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = window.sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(window.sessionStorage.getItem(EXPIRY_KEY) ?? 0);
  if (!token) return null;
  if (!expiresAt || Date.now() >= expiresAt) {
    clearToken();
    return null;
  }
  return token;
}

export function setToken(token: string, expiresInSeconds: number): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, token);
  window.sessionStorage.setItem(
    EXPIRY_KEY,
    String(Date.now() + expiresInSeconds * 1000),
  );
  // NOTE: the token is never logged, here or anywhere. A console.log of a
  // bearer token survives in a screen recording of a demo.
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(EXPIRY_KEY);
}

export function hasValidToken(): boolean {
  return getToken() !== null;
}

/** Fired when a request comes back 401. The layout guard listens and sends
 *  the user to the login screen; the api layer stays free of routing. */
export const SESSION_EXPIRED_EVENT = "shelfeye:session-expired";

function announceSessionExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** attach the bearer token — true everywhere except login */
  auth?: boolean;
  /** serialised as JSON; use `rawBody` for anything else */
  body?: unknown;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, body, timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;

  const headers = new Headers(init.headers);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  if (auth) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: init.signal ?? controller.signal,
    });
  } catch (err) {
    // fetch rejects for network failure and for abort, and the two mean very
    // different things to a rep standing in a shop with no signal.
    if (err instanceof DOMException && err.name === "AbortError") throw ApiError.timeout();
    throw ApiError.offline();
  } finally {
    clearTimeout(timer);
  }

  // A 401 means two different things depending on who asked. On an
  // authenticated request the session died — clear it and send the user to
  // login. On the login request itself it means the credentials were wrong,
  // and telling that user their "session expired" would be nonsense.
  if (res.status === 401 && auth) {
    clearToken();
    announceSessionExpired();
    throw new ApiError("UNAUTHORIZED", "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", 401);
  }

  if (!res.ok) throw await ApiError.fromResponse(res);

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Percent for display, from the ratio the API speaks.
 *
 *  The API returns OSA and risk as 0..1; every screen in this app renders
 *  0..100. Converting once here, at the boundary, is what keeps a stray
 *  `0.875` from reaching a component and rendering as "OSA 1%". Null passes
 *  through untouched — "never measured" is not "zero". */
export function toPercent(ratio: number | null | undefined, digits = 0): number | null {
  if (ratio === null || ratio === undefined) return null;
  const scaled = ratio * 100;
  return digits === 0 ? Math.round(scaled) : Number(scaled.toFixed(digits));
}
