import { request, toPercent } from "@/lib/api/client";
import type { RiskBand } from "@/types";

/* Manager reporting.
 *
 * ⛔ Nothing in this file may hold, request or display a per-individual
 * figure. Aggregation is at store and area level only — a labour-rights
 * constraint agreed at design stage, enforced by tests on the backend. */

export interface Kpi {
  id: string;
  label: string;
  value: number;
  unit: string;
  /** change against the preceding window of equal length; null when there is
   *  no earlier window — which is not the same as "no change" */
  delta: number | null;
  deltaLabel: string;
  /** which direction counts as improvement */
  good: "up" | "down";
  /** null when the metric has no agreed target */
  target: number | null;
}

/** The headline cards.
 *
 *  The API returns only the KPIs it can compute, so the caller renders the
 *  array as it arrives. There is no fixed set of four: a card with no data
 *  behind it is absent, not zero and not estimated. */
export async function fetchKpis(areaId?: string, days = 28): Promise<Kpi[]> {
  const query = new URLSearchParams({ days: String(days) });
  if (areaId) query.set("areaId", areaId);
  const payload = await request<{ kpis: Kpi[] }>(`/v1/analytics/kpis?${query}`);
  return payload.kpis;
}

export interface Area {
  id: string;
  name: string;
  storeCount: number;
}

export function fetchAreas(): Promise<Area[]> {
  return request<Area[]>("/v1/areas");
}

export interface OsaPoint {
  /** ISO date of the week bucket */
  bucket: string;
  /** percent 0-100 */
  osa: number;
  visits: number;
}

export async function fetchOsaTrend(options: {
  areaId?: string;
  storeId?: string;
  days?: number;
} = {}): Promise<OsaPoint[]> {
  const query = new URLSearchParams({ days: String(options.days ?? 84) });
  if (options.storeId) {
    query.set("scope", "store");
    query.set("storeId", options.storeId);
  } else if (options.areaId) {
    query.set("areaId", options.areaId);
  }
  const payload = await request<{ points: { bucket: string; osa: number; visits: number }[] }>(
    `/v1/analytics/osa?${query}`,
  );
  return payload.points.map((p) => ({ ...p, osa: toPercent(p.osa, 1) ?? 0 }));
}

export interface RiskRow {
  storeId: string;
  storeName: string;
  chain: string;
  storeFormat: string;
  areaId: string;
  lastOsa: number | null;
  daysSinceLastVisit: number | null;
  repeatGapSkus: number;
  riskScore: number;
  riskBand: RiskBand;
}

export async function fetchRiskRanking(areaId?: string, limit = 20): Promise<RiskRow[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (areaId) query.set("areaId", areaId);
  const payload = await request<{ rows: RiskRow[] }>(`/v1/analytics/risk-ranking?${query}`);
  return payload.rows.map((r) => ({
    ...r,
    lastOsa: toPercent(r.lastOsa),
    riskScore: toPercent(r.riskScore) ?? 0,
  }));
}

export interface PlannedStop extends Omit<RiskRow, "storeFormat"> {
  /** measured from this store's closed visits; null when it has none */
  avgVisitMinutes: number | null;
}

export async function fetchRoutePlan(areaId?: string): Promise<PlannedStop[]> {
  const query = areaId ? `?areaId=${encodeURIComponent(areaId)}` : "";
  const payload = await request<{ stops: PlannedStop[] }>(`/v1/analytics/route-plan${query}`);
  return payload.stops.map((s) => ({
    ...s,
    lastOsa: toPercent(s.lastOsa),
    riskScore: toPercent(s.riskScore) ?? 0,
  }));
}

export interface VisitCapture {
  captureId: string;
  category: string;
  shelfBayLabel: string;
  phase: "BEFORE" | "AFTER";
  capturedAt: string | null;
  /** percent 0-100, or null when the analysis has not landed yet */
  osaScore: number | null;
  modelVersion: string | null;
}

export interface StoreVisit {
  visitId: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  osaBefore: number | null;
  osaAfter: number | null;
  gapsFound: number;
  gapsFixed: number;
  gpsMatch: boolean;
  status: string;
  /** the photographs behind this row — every number must be openable */
  captures: VisitCapture[];
}

/** One store's visit timeline. ⛔ Carries no identity — who visited is not
 *  part of what a manager reviews. */
export async function fetchStoreHistory(storeId: string, limit = 30): Promise<StoreVisit[]> {
  const payload = await request<{ visits: StoreVisit[] }>(
    `/v1/stores/${encodeURIComponent(storeId)}/history?limit=${limit}`,
  );
  return payload.visits.map((v) => ({
    ...v,
    osaBefore: toPercent(v.osaBefore),
    osaAfter: toPercent(v.osaAfter),
    captures: v.captures.map((c) => ({ ...c, osaScore: toPercent(c.osaScore) })),
  }));
}
