"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type { BlockedReason, GapFinding, RejectReason, Task } from "@/types";
import { revokePhoto, type CapturedPhoto } from "@/lib/capture";
import type { AnalysisResult } from "@/lib/api/captures";
import { verifyFinding } from "@/lib/api/findings";
import { fetchTasks, updateTask } from "@/lib/api/tasks";
import { checkOut, type CheckoutSummary } from "@/lib/api/visits";
import { ApiError } from "@/lib/api/errors";
import { removeByPrefix, tryEnqueue } from "@/lib/offline/queue";

/** Was this failure "no signal"? Those are the ones worth queueing; a 403 or
 *  a 422 will fail again just as hard in ten minutes. */
function isOffline(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "OFFLINE" || err.code === "TIMEOUT");
}

/* The state of the visit in progress. Despite the name this is not demo
   data: visitId, findings, tasks and checkout all come from the API and are
   written back to it. What lives here rather than on the server is the part a
   rep would lose by walking between screens — the shot awaiting review, the
   photo log, which shelf they picked.

   The `useDemo` / `DemoState` names are left over from the build that had no
   API. Renaming them touches 13 files and changes nothing anyone can see, so
   it is deliberately not part of this round. */

export interface DemoState {
  storeId: string | null;
  /** the server's visit id — every capture, verification and task hangs off it */
  visitId: string | null;
  consent: boolean;
  gpsMatch: boolean;
  checkedInAt: number | null;
  checkedOutAt: number | null;
  categoryId: string | null;
  bay: string | null;

  /** the photo the rep actually took/uploaded for this shelf, if any */
  photo: CapturedPhoto | null;
  /** The shot on screen awaiting "ถ่ายใหม่" or "ใช้ภาพนี้". It lives here
   *  rather than in the camera screen's own state because a rep who steps out
   *  to the capture log or the sync queue and comes back must not find their
   *  shot gone and have to photograph the shelf a second time. `photo` is null
   *  on a device with no camera, where the flow continues on a stand-in. */
  reviewShot: { photo: CapturedPhoto | null } | null;
  afterPhoto: CapturedPhoto | null;
  /** every photo taken this session, newest first — the local intake log */
  photoLog: CapturedPhoto[];

  /** the capture the server is analysing, once presign has run */
  captureId: string | null;
  analysis: AnalysisResult | null;
  /** true only between "use this photo" and the result screen, so opening
   *  /processing directly holds the screen instead of racing past it */
  justCaptured: boolean;
  findings: GapFinding[];
  tasks: Task[];
  afterCaptured: boolean;
  /** Task ids that raised a replenishment request. Keyed by TASK, not by SKU,
   *  because that is how the server dedupes them (`source_task_id`): one SKU
   *  missing in two places on the shelf is two requests, and counting it as
   *  one made the summary screen disagree with the supply-chain queue. */
  replenishmentRequests: string[];

  beginVisit: (storeId: string) => void;
  setConsent: (v: boolean) => void;
  setGpsMatch: (v: boolean) => void;
  /** records the visit the server just opened */
  checkIn: (visitId: string, gpsMatch: boolean) => void;
  closeVisit: () => void;
  selectShelf: (categoryId: string, bay: string) => void;
  /** records a photo the moment intake finishes, before the rep decides
   *  whether to keep it — a discarded shot still happened */
  logPhoto: (photo: CapturedPhoto) => void;
  setReviewShot: (shot: { photo: CapturedPhoto | null } | null) => void;
  /** the rep kept this shot — hand it to the processing screen to upload */
  stageCapture: (photo: CapturedPhoto | null) => void;
  /** the server's verdict for that photo */
  setAnalysis: (captureId: string, analysis: AnalysisResult) => void;
  setAfterPhoto: (photo: CapturedPhoto | null) => void;
  clearPhotoLog: () => void;
  consumeCapture: () => void;
  verify: (
    findingId: string,
    verdict: "CONFIRMED" | "REJECTED",
    reason?: RejectReason,
  ) => Promise<void>;
  /** reads back the tasks the SERVER created from confirmed gaps */
  loadTasks: () => Promise<void>;
  setTask: (
    taskId: string,
    status: "FIXED" | "BLOCKED",
    reason?: BlockedReason,
  ) => Promise<void>;
  /** closes the visit and keeps the server's own before/after OSA.
   *  `refresh` asks the server again for a visit that is already closed, which
   *  is how a summary picks up an analysis that finished after check-out. */
  closeOutVisit: (options?: { refresh?: boolean }) => Promise<CheckoutSummary | null>;
  checkout: CheckoutSummary | null;
  markAfterCaptured: () => void;
  resetVisit: () => void;
}

/** The check-out request in flight, if any — see closeOutVisit. Deliberately
 *  outside the store: nothing renders from it. Held with the visit it belongs
 *  to, so a rep who has already moved on to the next shop can never be handed
 *  the previous shop's answer. */
let closingRequest: { visitId: string; promise: Promise<CheckoutSummary | null> } | null = null;

const PRIORITY_ORDER = { 1: 0, 2: 1, 3: 2 } as const;

/** The one condition the server raises a replenishment request on — see
 *  `PATCH /v1/tasks/{id}` in backend/app/api/v1/tasks.py. */
function raisesRequest(status: Task["status"], reason?: BlockedReason): boolean {
  return status === "BLOCKED" && reason === "OUT_OF_BACKSTOCK";
}

/** Idempotent because the offline queue replays, and because a rep can block
 *  the same task twice. The server is idempotent per task for the same reason. */
function addRequest(requests: string[], taskId: string): string[] {
  return requests.includes(taskId) ? requests : [...requests, taskId];
}

export const useDemo = create<DemoState>((set, get) => ({
  storeId: null,
  visitId: null,
  consent: false,
  gpsMatch: true,
  checkedInAt: null,
  checkedOutAt: null,
  categoryId: null,
  bay: null,

  photo: null,
  afterPhoto: null,
  reviewShot: null,
  photoLog: [],

  captureId: null,
  analysis: null,
  justCaptured: false,
  findings: [],
  tasks: [],
  afterCaptured: false,
  replenishmentRequests: [],
  checkout: null,

  beginVisit: (storeId) =>
    set((s) => {
      // the log keeps its own references; only the per-visit slots are released
      if (s.photo && !s.photoLog.includes(s.photo)) revokePhoto(s.photo);
      if (s.afterPhoto && !s.photoLog.includes(s.afterPhoto)) revokePhoto(s.afterPhoto);
      return {
      storeId,
      visitId: null,
      consent: false,
      checkedInAt: null,
      checkedOutAt: null,
      categoryId: null,
      bay: null,
      photo: null,
      afterPhoto: null,
      reviewShot: null,
      captureId: null,
      analysis: null,
      justCaptured: false,
      findings: [],
      tasks: [],
      afterCaptured: false,
      replenishmentRequests: [],
      checkout: null,
      };
    }),

  setConsent: (consent) => set({ consent }),
  setGpsMatch: (gpsMatch) => set({ gpsMatch }),
  checkIn: (visitId, gpsMatch) =>
    set({ visitId, gpsMatch, checkedInAt: Date.now(), checkedOutAt: null }),
  /** Stamps the moment the rep reached the check-out summary. Doing this in
   *  a store action keeps the clock out of the render path. */
  closeVisit: () =>
    set((s) => (s.checkedOutAt ? {} : { checkedOutAt: Date.now() })),
  selectShelf: (categoryId, bay) => set({ categoryId, bay }),

  logPhoto: (photo) =>
    set((s) =>
      s.photoLog.some((p) => p.id === photo.id)
        ? {}
        : { photoLog: [photo, ...s.photoLog] },
    ),

  setReviewShot: (reviewShot) => set({ reviewShot }),

  stageCapture: (photo) =>
    set((s) => ({
      photo: photo ?? s.photo,
      // The shot has been accepted, so there is nothing left to review —
      // coming back to the camera should open the lens, not the old preview.
      reviewShot: null,
      // The previous verdict must not survive a new photo: showing the old
      // OSA over a fresh shot is how a rep "fixes" a shelf that never changed.
      captureId: null,
      analysis: null,
      findings: [],
      justCaptured: true,
    })),

  setAnalysis: (captureId, analysis) =>
    set({ captureId, analysis, findings: analysis.gapFindings }),

  setAfterPhoto: (photo) => set({ afterPhoto: photo }),

  clearPhotoLog: () =>
    set((s) => {
      s.photoLog.forEach((p) => {
        if (p !== s.photo && p !== s.afterPhoto) revokePhoto(p);
      });
      return { photoLog: s.photo || s.afterPhoto ? s.photoLog.filter((p) => p === s.photo || p === s.afterPhoto) : [] };
    }),

  consumeCapture: () => set({ justCaptured: false }),

  verify: async (findingId, verdict, reason) => {
    // Optimistic: the rep taps through gaps quickly and a spinner per tap
    // would make the screen feel broken. The server is authoritative, so a
    // failure rolls the row back rather than leaving a lie on screen.
    const previous = get().findings.find((f) => f.id === findingId);
    set((s) => ({
      findings: s.findings.map((f) =>
        f.id === findingId
          ? { ...f, verificationStatus: verdict, rejectedReason: reason }
          : f,
      ),
    }));

    try {
      await verifyFinding(findingId, verdict, reason);
    } catch (err) {
      // No signal: keep the optimistic row and queue the verdict. Rolling it
      // back would make the rep decide the same gap twice, and the decision
      // is theirs — the network's opinion of it is not.
      if (isOffline(err)) {
        // This verdict replaces any earlier one still waiting to be sent.
        await removeByPrefix(`verify-${findingId}-`);
        const queued = await tryEnqueue({
          id: `verify-${findingId}-${verdict}`,
          kind: "VERIFY",
          label: `ผลตรวจสอบ ${verdict === "CONFIRMED" ? "ยืนยันว่าขาด" : "ตีกลับ"}`,
          storeId: get().storeId ?? "",
          payload: { findingId, verdict, reason: reason ?? null },
        });
        if (queued) return;
      }
      if (previous) {
        set((s) => ({
          findings: s.findings.map((f) => (f.id === findingId ? previous : f)),
        }));
      }
      throw err;
    }
  },

  loadTasks: async () => {
    const { visitId } = get();
    if (!visitId) return;
    // The server creates a task when a gap is CONFIRMED. Building them here
    // too would give the rep a list that quietly disagrees with the database.
    set({ tasks: await fetchTasks(visitId) });
  },

  setTask: async (taskId, status, reason) => {
    let updated: Task;
    try {
      updated = await updateTask(taskId, status, reason);
    } catch (err) {
      if (isOffline(err)) {
        const task = get().tasks.find((t) => t.id === taskId);
        await removeByPrefix(`task-${taskId}-`);
        const queued = await tryEnqueue({
          id: `task-${taskId}-${status}`,
          kind: "TASK",
          label: `ปิดงาน ${task?.skuName ?? taskId}`,
          storeId: get().storeId ?? "",
          payload: { taskId, status, blockedReason: reason ?? null },
        });
        if (queued) {
          // Reflect the rep's decision locally; the server hears it on drain.
          // That includes the replenishment request: the server raises one
          // when this drains, so a rep who blocked a task with no signal must
          // not be shown a summary claiming nothing went to supply chain.
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === taskId ? { ...t, status, blockedReason: reason } : t,
            ),
            replenishmentRequests: raisesRequest(status, reason)
              ? addRequest(s.replenishmentRequests, taskId)
              : s.replenishmentRequests,
          }));
          return;
        }
      }
      throw err;
    }
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
      // Mirrors what the API just did: OUT_OF_BACKSTOCK raises a
      // replenishment request server-side, and the summary screen says so.
      replenishmentRequests: raisesRequest(status, reason)
        ? addRequest(s.replenishmentRequests, taskId)
        : s.replenishmentRequests,
    }));
  },

  closeOutVisit: async (options) => {
    const { visitId, checkout } = get();
    if (!visitId) return null;
    if (checkout && !options?.refresh) return checkout;
    // Two callers asking at once get one request. React invokes effects twice
    // in development, and the check-out screen asks again while it waits for
    // the model — without this, two answers race and the older one can be the
    // one that sticks.
    if (closingRequest?.visitId === visitId) return closingRequest.promise;

    const request = (async () => {
      try {
        const summary = await checkOut(visitId);
        // The first answer stamps the close, later ones do not: the screen
        // reports the visit's duration from this, and the server keeps its own
        // checked_out_at across replays. Re-stamping on every refresh would
        // stretch a finished visit by however long the model took.
        set((s) => ({ checkout: summary, checkedOutAt: s.checkedOutAt ?? Date.now() }));
        return summary;
      } catch (err) {
        if (isOffline(err)) {
          const queued = await tryEnqueue({
            id: `checkout-${visitId}`,
            kind: "CHECKOUT",
            label: "สรุปการเข้าร้าน",
            storeId: get().storeId ?? "",
            payload: { visitId },
          });
          if (queued) {
            set((s) => ({ checkedOutAt: s.checkedOutAt ?? Date.now() }));
            return null;
          }
        }
        throw err;
      }
    })();

    closingRequest = { visitId, promise: request };
    try {
      return await request;
    } finally {
      if (closingRequest?.promise === request) closingRequest = null;
    }
  },

  markAfterCaptured: () => set({ afterCaptured: true }),

  resetVisit: () =>
    set({
      storeId: null,
      visitId: null,
      consent: false,
      checkedInAt: null,
      checkedOutAt: null,
      categoryId: null,
      bay: null,
      photo: null,
      afterPhoto: null,
      reviewShot: null,
      captureId: null,
      analysis: null,
      justCaptured: false,
      findings: [],
      tasks: [],
      afterCaptured: false,
      replenishmentRequests: [],
      checkout: null,
    }),
}));

/* ---- derived selectors ----
   These must select stable references out of the store and derive in
   useMemo. Returning a freshly-built object straight from a zustand
   selector makes useSyncExternalStore see a new snapshot every render. */

export function useVisitStats() {
  const findings = useDemo((s) => s.findings);
  const tasks = useDemo((s) => s.tasks);

  return useMemo(
    () => ({
      total: findings.length,
      confirmed: findings.filter((f) => f.verificationStatus === "CONFIRMED"),
      rejected: findings.filter((f) => f.verificationStatus === "REJECTED"),
      pending: findings.filter((f) => f.verificationStatus === "PENDING"),
      fixed: tasks.filter((t) => t.status === "FIXED"),
      blocked: tasks.filter((t) => t.status === "BLOCKED"),
      openTasks: tasks.filter((t) => t.status === "OPEN"),
    }),
    [findings, tasks],
  );
}

/** OSA after restock, as the SERVER computed it from the after-photo.
 *
 *  This used to be estimated on the client from how many gaps the rep had
 *  closed. That number looked authoritative and was not: it assumed every
 *  fixed task restored its full share of the shelf, so it read high, and it
 *  disagreed with the figure the manager's dashboard showed for the same
 *  visit. `null` until checkout has run — an estimate is worse than nothing
 *  when the real one is one request away. */
export function useOsaAfter(): number | null {
  return useDemo((s) => s.checkout?.osaAfter ?? null);
}
