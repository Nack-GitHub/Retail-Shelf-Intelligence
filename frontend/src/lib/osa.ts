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

import type { OsaPhase, OsaStatus } from "@/types";

/** Percentages, mirroring `critical_threshold` and `low_threshold` (0..1). */
export const OSA_THRESHOLDS = {
  critical: 75,
  low: 90,
} as const;

const PHASE_LABEL: Record<OsaPhase, string> = {
  BEFORE: "ก่อนเติมของ",
  AFTER: "หลังเติมของ",
};

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

/** Which photograph a store's `lastOsa` came from, in the words a rep uses.
 *
 *  The figure is the store's most recent analysis — any shelf, either side of
 *  a restock, any visit — which is the right number for ranking risk and an
 *  ambiguous one to print on a card. A rep who photographs a shelf, restocks
 *  it and comes back to the route list is looking at the before-figure, and
 *  the card used to call it "OSA ครั้งก่อน" either way.
 *
 *  Returns null when there is nothing to describe, so callers can drop the
 *  line entirely rather than render an empty one. */
export function osaSourceNote(
  store: {
    lastOsa: number | null;
    lastOsaPhase: OsaPhase | null;
    lastOsaAt: string | null;
    daysSinceLastVisit: number | null;
  },
  categoryName?: string | null,
): string | null {
  if (store.lastOsa === null || store.lastOsaPhase === null) return null;

  // A phase the app does not recognise is a phase it cannot describe. Saying
  // nothing beats printing "undefined" under a percentage on a rep's screen.
  const phase = PHASE_LABEL[store.lastOsaPhase];
  if (!phase) return null;

  const parts = [phase];
  if (categoryName) parts.push(categoryName);

  // Only worth saying when the reading is older than the last time anyone was
  // in the shop — otherwise "เข้าล่าสุด N วันก่อน" on the same card says it.
  const measuredDaysAgo = daysSince(store.lastOsaAt);
  if (
    measuredDaysAgo !== null &&
    store.daysSinceLastVisit !== null &&
    measuredDaysAgo > store.daysSinceLastVisit
  ) {
    parts.push(`วัดเมื่อ ${measuredDaysAgo} วันก่อน`);
  }

  return parts.join(" · ");
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.floor((Date.now() - at) / 86_400_000);
}
