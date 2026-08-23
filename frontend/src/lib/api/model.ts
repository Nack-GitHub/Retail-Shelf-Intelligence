import { request } from "@/lib/api/client";
import type { BBox } from "@/types";

/* The data team's two screens.
 *
 * ⛔ Nothing here carries who verified a finding. The relabel queue shows
 * WHAT was rejected and WHY — a queue that named the rejecting rep would be a
 * per-rep accuracy metric by another route, and reps who know their
 * rejections are counted stop rejecting things. */

export interface ModelGate {
  passed: boolean;
  /** e.g. "0.4113 vs >= 0.9" */
  detail: string;
  /** why this gate exists at all */
  rationale: string;
}

export interface ModelMetrics {
  split: string;
  imgsz: number;
  overall: { map50: number; map50_95: number; precision: number; recall: number };
  gap_class: { name: string; precision: number; recall: number; map50: number };
  gates: Record<string, ModelGate>;
  all_gates_passed: boolean;
}

export interface ModelVersion {
  version: string;
  sha: string;
  sourceDataset: string;
  datasetVersion: string;
  isActive: boolean;
  promotedAt: string | null;
  modelCardUri: string | null;
  /** null for the deterministic mock, which has no dataset to score against */
  metrics: ModelMetrics | null;
}

export interface OverrideRatePoint {
  bucket: string;
  /** 0..1 — the share of reviewed findings a rep overruled that week */
  rate: number;
  reviewed: number;
}

export interface ModelHealth {
  activeVersion: string | null;
  /** "mock" or "http" — which inference path is actually serving */
  mlClient: string;
  versions: ModelVersion[];
  overrideRate: OverrideRatePoint[];
}

export function fetchModelHealth(weeks = 12): Promise<ModelHealth> {
  return request<ModelHealth>(`/v1/model/health?weeks=${weeks}`);
}

export interface RelabelItem {
  findingId: string;
  captureId: string;
  reason: "REP_REJECTED" | "LOW_CONFIDENCE";
  rejectedReason: string | null;
  confidence: number;
  isLowConfidence: boolean;
  storeName: string;
  category: string;
  capturedAt: string | null;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  bbox: BBox | null;
  modelVersion: string | null;
}

export async function fetchRelabelQueue(limit = 50): Promise<RelabelItem[]> {
  const payload = await request<{ items: RelabelItem[] }>(
    `/v1/model/relabel-queue?limit=${limit}`,
  );
  return payload.items;
}

/** Thai labels for the reasons a rep gives when rejecting a finding. */
export const REJECT_REASON_LABELS: Record<string, string> = {
  OCCLUDED: "มีของแต่ถูกบัง",
  NOT_OUR_SKU: "ไม่ใช่สินค้าของเรา",
  NORMAL_EMPTY: "เป็นพื้นที่ว่างปกติ",
  OTHER: "อื่น ๆ",
};
