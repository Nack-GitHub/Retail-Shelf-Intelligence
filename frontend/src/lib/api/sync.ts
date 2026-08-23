import { request } from "@/lib/api/client";
import { commit, presign, uploadToStorage } from "@/lib/api/captures";
import { verifyFinding } from "@/lib/api/findings";
import { updateTask } from "@/lib/api/tasks";
import { checkOut } from "@/lib/api/visits";
import * as queue from "@/lib/offline/queue";
import type { QueuedOperation } from "@/lib/offline/queue";
import type { BlockedReason, RejectReason } from "@/types";

/* Draining the offline queue.
 *
 * The queue replays the REAL endpoints rather than a special offline API.
 * Every one of them is idempotent by key, so a drain interrupted halfway and
 * restarted cannot create a second capture, a second task, or a second
 * checkout — which is the only reason replaying is safe at all.
 *
 * `POST /v1/sync/batch` is then called as the acknowledgement ledger, which
 * is exactly what its own docstring says it is for. */

interface SyncItemResult {
  idempotencyKey: string;
  ok: boolean;
  error: string | null;
  result: Record<string, unknown> | null;
}

async function acknowledge(operations: QueuedOperation[]): Promise<SyncItemResult[]> {
  if (operations.length === 0) return [];
  const payload = await request<{ results: SyncItemResult[] }>("/v1/sync/batch", {
    method: "POST",
    body: {
      operations: operations.map((o) => ({
        idempotencyKey: o.id,
        kind: o.kind,
        payload: o.payload,
      })),
    },
  });
  return payload.results;
}

/** Replays one queued operation against the endpoint it came from. */
async function replay(operation: QueuedOperation): Promise<void> {
  const p = operation.payload;

  switch (operation.kind) {
    case "CAPTURE": {
      if (!operation.blob) throw new Error("queued capture has no image");
      const grant = await presign({
        visitId: String(p.visitId),
        category: String(p.category),
        shelfBayLabel: String(p.shelfBayLabel ?? ""),
        phase: p.phase === "AFTER" ? "AFTER" : "BEFORE",
        contentType: String(p.contentType ?? "image/jpeg"),
      });
      await uploadToStorage(
        grant.uploadUrl,
        operation.blob,
        String(p.contentType ?? "image/jpeg"),
      );
      // The queue id IS the Idempotency-Key, so a redelivered batch resolves
      // to the job already created rather than starting a second analysis.
      await commit(grant.captureId, {
        idempotencyKey: operation.id,
        width: Number(p.imageWidth),
        height: Number(p.imageHeight),
        capturedAt: String(p.capturedAt),
        device: p.device as { userAgent: string; viewport: string; pixelRatio: number },
        faceBlurApplied: false,
        faceBlurCount: 0,
      });
      return;
    }
    case "VERIFY":
      await verifyFinding(
        String(p.findingId),
        p.verdict === "REJECTED" ? "REJECTED" : "CONFIRMED",
        p.reason as RejectReason | undefined,
      );
      return;
    case "TASK":
      await updateTask(
        String(p.taskId),
        p.status as "OPEN" | "FIXED" | "BLOCKED",
        p.blockedReason as BlockedReason | undefined,
      );
      return;
    case "CHECKOUT":
      await checkOut(String(p.visitId));
      return;
  }
}

export interface DrainReport {
  attempted: number;
  succeeded: number;
  failed: number;
}

/* One drain at a time.
 *
 * Reconnecting fires an automatic drain, and the rep can tap "ส่งทั้งหมด" at
 * the same moment. Both passes would read the same PENDING rows and replay
 * them: the server's Idempotency-Keys keep the database correct, but the
 * phone would upload every photo twice over a connection that just came back
 * — which is exactly when bandwidth is scarcest. */
let inFlight: Promise<DrainReport> | null = null;

/** Sends everything the queue is holding, oldest first.
 *
 *  One bad operation must not block the rest: the rep's other seven captures
 *  should still land. Failures stay queued with their attempt count bumped. */
export function drain(
  onProgress?: (operation: QueuedOperation) => void,
): Promise<DrainReport> {
  // A second caller joins the drain already running rather than starting one.
  if (inFlight) return inFlight;
  inFlight = runDrain(onProgress).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runDrain(
  onProgress?: (operation: QueuedOperation) => void,
): Promise<DrainReport> {
  const pending = (await queue.list()).filter((o) => o.status !== "DONE");
  const report: DrainReport = { attempted: pending.length, succeeded: 0, failed: 0 };
  const succeeded: QueuedOperation[] = [];

  for (const operation of pending) {
    await queue.update(operation.id, { status: "UPLOADING" });
    onProgress?.({ ...operation, status: "UPLOADING" });

    try {
      await replay(operation);
      await queue.update(operation.id, {
        status: "DONE",
        attempts: operation.attempts + 1,
        errorCode: undefined,
      });
      succeeded.push(operation);
      report.succeeded += 1;
      onProgress?.({ ...operation, status: "DONE" });
    } catch (err) {
      await queue.update(operation.id, {
        status: "FAILED",
        attempts: operation.attempts + 1,
        errorCode: err instanceof Error ? err.name : "UNKNOWN",
      });
      report.failed += 1;
      onProgress?.({ ...operation, status: "FAILED" });
    }
  }

  // Acknowledge as a batch. Failing here is not fatal — the work already
  // landed, and the ledger catches up on the next drain.
  try {
    await acknowledge(succeeded);
  } catch {
    /* ignore: the operations themselves succeeded */
  }

  // Release the photo bytes the server now holds, and retire rows old enough
  // that nobody is still looking at them.
  await queue.purgeCompleted();

  return report;
}

/** Retries one failed item without touching the rest. */
export async function retry(id: string): Promise<boolean> {
  const operation = (await queue.list()).find((o) => o.id === id);
  if (!operation) return false;

  await queue.update(id, { status: "UPLOADING" });
  try {
    await replay(operation);
    await queue.update(id, { status: "DONE", attempts: operation.attempts + 1 });
    await acknowledge([operation]).catch(() => {});
    await queue.purgeCompleted();
    return true;
  } catch (err) {
    await queue.update(id, {
      status: "FAILED",
      attempts: operation.attempts + 1,
      errorCode: err instanceof Error ? err.name : "UNKNOWN",
    });
    return false;
  }
}
