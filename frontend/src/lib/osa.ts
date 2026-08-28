/* The one place in the app that turns an OSA percentage into a band or a colour.
 *
 * The bands themselves are a trade-marketing decision that lives in
 * `backend/app/core/config.py`, and the API stamps the status it computed onto
 * every analysis it returns — a screen holding a server-computed `status` must
 * render that one rather than recompute it here. What this module is for is the
 * figures that arrive as a bare percentage with no status attached: a store's
 * last OSA, a shelf category's, the after-restock average on the check-out
 * screen.
 *
 * Keeping the numbers below in step with the backend is not left to memory:
 * backend/tests/unit/test_osa_thresholds_contract.py reads this file and fails
 * when the two disagree. They did disagree once — this side said 70 while the
 * backend said 75 — which is how one shelf came to read CRITICAL on the result
 * screen and LOW on the check-out screen of the same visit.
 */

import type { OsaStatus } from "@/types";

/** Percentages, mirroring `critical_threshold` and `low_threshold` (0..1). */
export const OSA_THRESHOLDS = {
  critical: 75,
  low: 90,
} as const;

export type OsaTone = "ok" | "warn" | "danger";

/** Shared by the status pill and every bar, so colour and wording never split. */
export const OSA_TONE: Record<OsaStatus, OsaTone> = {
  OK: "ok",
  LOW: "warn",
  CRITICAL: "danger",
};

/** The band for a percentage the server did not classify for us. */
export function osaStatusOf(osa: number): OsaStatus {
  if (osa >= OSA_THRESHOLDS.low) return "OK";
  return osa >= OSA_THRESHOLDS.critical ? "LOW" : "CRITICAL";
}

export function osaTone(osa: number): OsaTone {
  return OSA_TONE[osaStatusOf(osa)];
}
