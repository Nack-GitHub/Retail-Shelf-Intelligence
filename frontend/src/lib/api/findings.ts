import { request } from "@/lib/api/client";
import type { RejectReason, VerificationStatus } from "@/types";

export interface VerifyResult {
  findingId: string;
  verdict: Exclude<VerificationStatus, "PENDING">;
  /** the replenishment task a CONFIRMED verdict created, if any */
  taskId: string | null;
  /** true when this verdict was already recorded — a retry, not a new decision */
  idempotent: boolean;
}

/** The rep's verdict on one gap. The rep is the ground truth, not the model.
 *
 *  Idempotent server-side: a phone retrying on a flaky connection must not
 *  create two replenishment tasks for one gap. A REJECTED verdict is training
 *  signal for the next model, not noise — which is why the reason travels
 *  with it. */
export function verifyFinding(
  findingId: string,
  verdict: "CONFIRMED" | "REJECTED",
  reason?: RejectReason,
): Promise<VerifyResult> {
  return request<VerifyResult>(`/v1/findings/${encodeURIComponent(findingId)}/verify`, {
    method: "POST",
    body: { verdict, reason: reason ?? null },
  });
}

export interface Evidence {
  findingId: string;
  captureId: string;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  capturedAt: string | null;
  positionLabel: string;
  confidence: number;
  isLowConfidence: boolean;
  verificationStatus: VerificationStatus;
  modelVersion: string | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
}

/** The photograph and the box behind one finding.
 *
 *  ⛔ Deliberately carries no identity: who verified it is not part of the
 *  evidence a manager reviews. */
export function fetchEvidence(findingId: string): Promise<Evidence> {
  return request<Evidence>(`/v1/evidence/${encodeURIComponent(findingId)}`);
}
