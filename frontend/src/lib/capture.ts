"use client";

/* ------------------------------------------------------------------
   Photo intake — the single door every image enters through, whether it
   came from the device camera or from a file the rep picked.

   Nothing is uploaded yet. Each photo is decoded, resized to the size the
   API will eventually receive, given the idempotency key the commit
   endpoint requires, and logged. When the backend lands, the only change
   here is that `intakePhoto` also POSTs the blob.
   ------------------------------------------------------------------ */

export type PhotoSource = "CAMERA" | "UPLOAD";
export type CapturePhase = "BEFORE" | "AFTER";

export interface CapturedPhoto {
  id: string;
  source: PhotoSource;
  phase: CapturePhase;
  /** blob: URL for rendering — revoke it when the photo is discarded */
  objectUrl: string;
  blob: Blob;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  original: { width: number; height: number; bytes: number; mimeType: string };
  capturedAt: string;
  /** the API requires this on POST /v1/captures/{id}/commit */
  idempotencyKey: string;
  device: {
    userAgent: string;
    viewport: string;
    pixelRatio: number;
  };
  /* On-device face blur is not wired up yet — there is no detector in the
     browser we can rely on. The flag is recorded honestly so nothing
     downstream can mistake a demo capture for a redacted one. */
  faceBlur: { applied: boolean; count: number; method: "NOT_WIRED" };
  processingMs: number;
}

/** The longest edge the API will accept. Matches the inference contract. */
export const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.86;

function uid(prefix: string) {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rnd}`;
}

async function decode(blob: Blob): Promise<{ bitmap: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return { bitmap, width: bitmap.width, height: bitmap.height };
  }
  // Safari fallback
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class PhotoIntakeError extends Error {
  constructor(
    message: string,
    readonly code: "DECODE_FAILED" | "ENCODE_FAILED" | "TOO_LARGE" | "NOT_AN_IMAGE",
  ) {
    super(message);
    this.name = "PhotoIntakeError";
  }
}

/**
 * Accepts a photo from any source, normalises it, and logs it.
 * Throws PhotoIntakeError with a code the UI can turn into Thai copy.
 */
export async function intakePhoto(
  input: Blob | File,
  source: PhotoSource,
  phase: CapturePhase = "BEFORE",
): Promise<CapturedPhoto> {
  const startedAt = performance.now();

  if (input.type && !input.type.startsWith("image/")) {
    throw new PhotoIntakeError("ไฟล์ที่เลือกไม่ใช่รูปภาพ", "NOT_AN_IMAGE");
  }
  if (input.size > 40 * 1024 * 1024) {
    throw new PhotoIntakeError("ไฟล์ใหญ่เกิน 40 MB", "TOO_LARGE");
  }

  let decoded;
  try {
    decoded = await decode(input);
  } catch {
    throw new PhotoIntakeError("อ่านไฟล์รูปไม่สำเร็จ", "DECODE_FAILED");
  }

  const { bitmap, width: ow, height: oh } = decoded;
  const scale = Math.min(1, MAX_EDGE / Math.max(ow, oh));
  const width = Math.round(ow * scale);
  const height = Math.round(oh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoIntakeError("เบราว์เซอร์ไม่รองรับการประมวลผลภาพ", "ENCODE_FAILED");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  /* This is the stage where on-device face blur will run, before the blob
     is ever handed to anything else. */

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new PhotoIntakeError("แปลงไฟล์รูปไม่สำเร็จ", "ENCODE_FAILED");

  const photo: CapturedPhoto = {
    id: uid("cap"),
    source,
    phase,
    objectUrl: URL.createObjectURL(blob),
    blob,
    mimeType: blob.type,
    bytes: blob.size,
    width,
    height,
    original: {
      width: ow,
      height: oh,
      bytes: input.size,
      mimeType: input.type || "unknown",
    },
    capturedAt: new Date().toISOString(),
    idempotencyKey: uid("idem"),
    device: {
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      pixelRatio: window.devicePixelRatio,
    },
    faceBlur: { applied: false, count: 0, method: "NOT_WIRED" },
    processingMs: Math.round(performance.now() - startedAt),
  };

  logPhoto(photo);
  return photo;
}

/** Structured console record — stands in for the upload until the API exists. */
function logPhoto(p: CapturedPhoto) {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.groupCollapsed(
    `%c[ShelfEye] รับภาพแล้ว%c ${p.source} · ${p.width}×${p.height} · ${kb(p.bytes)}`,
    "background:#1b6fe8;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600",
    "color:#667085",
  );
  console.table({
    id: p.id,
    source: p.source,
    phase: p.phase,
    capturedAt: p.capturedAt,
    idempotencyKey: p.idempotencyKey,
    processed: `${p.width}x${p.height} (${kb(p.bytes)})`,
    original: `${p.original.width}x${p.original.height} (${kb(p.original.bytes)}, ${p.original.mimeType})`,
    faceBlurApplied: p.faceBlur.applied,
    faceBlurMethod: p.faceBlur.method,
    processingMs: p.processingMs,
  });
  console.info("device", p.device);
  console.info("blob", p.blob);
  console.info(
    "ยังไม่ส่งขึ้นเซิร์ฟเวอร์ — เมื่อต่อ API แล้ว จุดนี้จะเรียก POST /v1/captures/presign แล้ว PUT blob ตรงไปที่ object storage",
  );
  console.groupEnd();
}

export function revokePhoto(p: CapturedPhoto | null | undefined) {
  if (p) URL.revokeObjectURL(p.objectUrl);
}

export function formatBytes(n: number) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}
