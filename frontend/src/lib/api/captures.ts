import { request, toPercent } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import type { CapturedPhoto } from "@/lib/capture";
import type { Detection, GapFinding, ShelfAnalysis } from "@/types";

/* The capture path, in the order it happens:
 *
 *    presign  →  PUT straight to object storage  →  commit  →  poll  →  result
 *
 * Image bytes never pass through the API. A shelf photo is 2-5 MB and a rep
 * uploads eight per store in a burst; proxying that through a stateless
 * service would make it a bandwidth bottleneck for no benefit. */

interface PresignResponse {
  captureId: string;
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface Job {
  jobId: string;
  captureId: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  progressHint: string;
  errorCode: string | null;
  /** Thai, already written for the rep — e.g. "ภาพไม่ชัดหรือเสียหาย กรุณาถ่ายใหม่" */
  userMessage: string | null;
  resultUrl: string | null;
}

export async function presign(input: {
  visitId: string;
  category: string;
  shelfBayLabel: string;
  phase: "BEFORE" | "AFTER";
  contentType: string;
}): Promise<PresignResponse> {
  return request<PresignResponse>("/v1/captures/presign", {
    method: "POST",
    body: {
      visitId: input.visitId,
      category: input.category,
      shelfBayLabel: input.shelfBayLabel,
      phase: input.phase,
      contentType: input.contentType,
    },
  });
}

/** Resolves storage URL to relative path if pointing to localhost/127.0.0.1 MinIO port */
export function resolveStorageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/(localhost|127\.0\.0\.1):9000/, "");
}

/** PUTs the bytes to the presigned URL.
 *
 *  THE ONE SANCTIONED `fetch` OUTSIDE client.ts. It has to be: the presigned
 *  URL is signed for exactly this method, key and content type, so attaching
 *  our bearer token or forcing `Content-Type: application/json` — both of
 *  which client.ts does — would invalidate the signature and the upload would
 *  fail with a signature mismatch that looks nothing like its cause. */
export async function uploadToStorage(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const targetUrl = resolveStorageUrl(uploadUrl) ?? uploadUrl;
  let res: Response;
  try {
    res = await fetch(targetUrl, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": contentType },
    });
  } catch {
    throw ApiError.offline();
  }
  if (!res.ok) {
    throw new ApiError(
      "SERVER",
      "อัปโหลดภาพไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      res.status,
      "UPLOAD_FAILED",
    );
  }
}

/** What the commit endpoint needs to know about a photo.
 *
 *  Named separately from `CapturedPhoto` because the offline queue replays a
 *  commit from a stored record rather than a live photo object, and casting
 *  one shape into the other would hide a real difference between them. */
export interface CommitDetails {
  /** the Idempotency-Key this commit is sent with */
  idempotencyKey: string;
  width: number;
  height: number;
  capturedAt: string;
  device: { userAgent: string; viewport: string; pixelRatio: number };
  faceBlurApplied: boolean;
  faceBlurCount: number;
}

export function commitDetailsOf(photo: CapturedPhoto): CommitDetails {
  return {
    idempotencyKey: photo.idempotencyKey,
    width: photo.width,
    height: photo.height,
    capturedAt: photo.capturedAt,
    device: photo.device,
    faceBlurApplied: photo.faceBlur.applied,
    faceBlurCount: photo.faceBlur.count,
  };
}

/** Records that the upload finished and queues analysis.
 *
 *  Idempotent by header: a phone that loses signal mid-request will retry,
 *  and that must not produce two jobs — or two OSA scores — for one photo. */
export async function commit(captureId: string, photo: CommitDetails): Promise<Job> {
  const accepted = await request<{ jobId: string; captureId: string; status: string }>(
    `/v1/captures/${encodeURIComponent(captureId)}/commit`,
    {
      method: "POST",
      headers: { "Idempotency-Key": photo.idempotencyKey },
      body: {
        imageWidth: photo.width,
        imageHeight: photo.height,
        capturedAt: photo.capturedAt,
        deviceInfo: photo.device,
        // Reported honestly: no browser face detector is wired up, so nothing
        // downstream may mistake a demo capture for a redacted one.
        faceBlurApplied: photo.faceBlurApplied,
        faceBlurCount: photo.faceBlurCount,
      },
    },
  );
  return {
    jobId: accepted.jobId,
    captureId: accepted.captureId,
    status: accepted.status as Job["status"],
    progressHint: "",
    errorCode: null,
    userMessage: null,
    resultUrl: null,
  };
}

export function fetchJob(jobId: string): Promise<Job> {
  return request<Job>(`/v1/jobs/${encodeURIComponent(jobId)}`);
}

/** Polls until the job finishes, fails, or the deadline passes.
 *
 *  Returns the terminal job rather than throwing on FAILED: a failed analysis
 *  is a normal outcome with its own screen ("ถ่ายใหม่"), not an exception. */
export async function pollJob(
  jobId: string,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    onProgress?: (job: Job) => void;
    signal?: AbortSignal;
  } = {},
): Promise<Job> {
  const { intervalMs = 500, timeoutMs = 90_000, onProgress, signal } = options;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (signal?.aborted) throw ApiError.timeout();

    const job = await fetchJob(jobId);
    onProgress?.(job);
    if (job.status === "DONE" || job.status === "FAILED") return job;

    if (Date.now() >= deadline) {
      throw new ApiError(
        "TIMEOUT",
        "การวิเคราะห์ใช้เวลานานผิดปกติ ภาพถูกเก็บไว้แล้ว กรุณาลองดูผลอีกครั้งภายหลัง",
        0,
        "ANALYSIS_TIMEOUT",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

interface AnalysisWire {
  captureId: string;
  modelVersion: string;
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  rowCount: number;
  gapRatio: number;
  osaScore: number;
  status: ShelfAnalysis["status"];
  inferenceMs: number;
  lowConfidenceCount: number;
  lowConfidenceThreshold: number;
  detections: Detection[];
  gapFindings: (Omit<GapFinding, "priority"> & { priority: number })[];
}

export interface AnalysisResult extends ShelfAnalysis {
  /** presigned GET for the photograph these boxes were drawn on */
  imageUrl: string | null;
}

export async function fetchResult(captureId: string): Promise<AnalysisResult> {
  const wire = await request<AnalysisWire>(`/v1/captures/${encodeURIComponent(captureId)}/result`);
  return {
    ...wire,
    imageUrl: resolveStorageUrl(wire.imageUrl),
    // 0.875 → 88, the same conversion every other screen's numbers get.
    osaScore: toPercent(wire.osaScore) ?? 0,
    gapRatio: wire.gapRatio,
    gapFindings: wire.gapFindings.map((f) => ({
      ...f,
      priority: (f.priority === 1 || f.priority === 3 ? f.priority : 2) as 1 | 2 | 3,
    })),
  };
}

/** presign → PUT → commit, as one step.
 *
 *  Grouped because the three are meaningless apart: a presign with no upload
 *  leaves an orphan capture row, and an upload with no commit leaves bytes
 *  nothing will ever analyse. */
export async function uploadCapture(input: {
  visitId: string;
  category: string;
  shelfBayLabel: string;
  phase: "BEFORE" | "AFTER";
  photo: CapturedPhoto;
}): Promise<Job> {
  const grant = await presign({
    visitId: input.visitId,
    category: input.category,
    shelfBayLabel: input.shelfBayLabel,
    phase: input.phase,
    contentType: input.photo.mimeType || "image/jpeg",
  });

  await uploadToStorage(grant.uploadUrl, input.photo.blob, input.photo.mimeType || "image/jpeg");
  return commit(grant.captureId, commitDetailsOf(input.photo));
}
