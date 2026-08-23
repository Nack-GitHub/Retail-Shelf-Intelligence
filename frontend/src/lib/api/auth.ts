import { clearToken, request, setToken } from "@/lib/api/client";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: "REP" | "MANAGER" | "ADMIN" | "DATA";
  areaId: string | null;
}

interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

/** Exchanges credentials for a token and stores it.
 *
 *  `auth: false` because there is nothing to attach yet — and attaching a
 *  stale token to the login call is how a user who has just been logged out
 *  gets a 401 while trying to log back in. */
export async function login(email: string, password: string): Promise<CurrentUser> {
  const token = await request<TokenResponse>("/v1/auth/login", {
    method: "POST",
    auth: false,
    body: { email: email.trim().toLowerCase(), password },
  });
  setToken(token.accessToken, token.expiresIn);
  return me();
}

export function me(): Promise<CurrentUser> {
  return request<CurrentUser>("/v1/me");
}

export function logout(): void {
  clearToken();
}

/** Thai label for the seeded area ids.
 *
 *  Areas are a string column on `stores`, not a table — see the plan's "no new
 *  tables" decision. The backend serves the ids; the display name for an
 *  unknown one falls back to the id itself rather than an empty chip. */
const AREA_NAMES: Record<string, string> = {
  "area-bke": "กรุงเทพฯ ตะวันออก",
  "area-bkn": "กรุงเทพฯ เหนือ",
  "area-bkw": "กรุงเทพฯ ตะวันตก",
  "area-est": "ภาคตะวันออก",
};

export function areaName(areaId: string | null | undefined): string {
  if (!areaId) return "ยังไม่ระบุพื้นที่";
  return AREA_NAMES[areaId] ?? areaId;
}
