"use client";

import { useMemo } from "react";
import { create } from "zustand";
import type {
  BlockedReason,
  GapFinding,
  RejectReason,
  ShelfAnalysis,
  SyncItem,
  Task,
} from "@/types";
import { SYNC_ITEMS } from "@/lib/mock/data";
import { revokePhoto, type CapturedPhoto } from "@/lib/capture";
import type { AnalysisResult } from "@/lib/api/captures";
import { verifyFinding } from "@/lib/api/findings";
import { fetchTasks, updateTask } from "@/lib/api/tasks";
import { checkOut, type CheckoutSummary } from "@/lib/api/visits";

/* Demo-only state. When the API lands, everything under `visit` becomes
   server state (React Query) and this store keeps only UI concerns. */

interface DemoState {
  online: boolean;
  setOnline: (v: boolean) => void;

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
  replenishmentRequests: string[];

  sync: SyncItem[];

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
  /** closes the visit and keeps the server's own before/after OSA */
  closeOutVisit: () => Promise<CheckoutSummary | null>;
  checkout: CheckoutSummary | null;
  markAfterCaptured: () => void;
  resetVisit: () => void;
  syncAll: () => void;
  retrySync: (id: string) => void;
}

const PRIORITY_ORDER = { 1: 0, 2: 1, 3: 2 } as const;

export const useDemo = create<DemoState>((set, get) => ({
  online: true,
  setOnline: (online) => set({ online }),

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
  photoLog: [],

  captureId: null,
  analysis: null,
  justCaptured: false,
  findings: [],
  tasks: [],
  afterCaptured: false,
  replenishmentRequests: [],
  checkout: null,

  sync: SYNC_ITEMS,

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

  stageCapture: (photo) =>
    set((s) => ({
      photo: photo ?? s.photo,
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
    const updated = await updateTask(taskId, status, reason);
    set((s) => {
      const requests = [...s.replenishmentRequests];
      // Mirrors what the API just did: OUT_OF_BACKSTOCK raises a
      // replenishment request server-side, and the summary screen says so.
      if (status === "BLOCKED" && reason === "OUT_OF_BACKSTOCK" && !requests.includes(updated.skuCode)) {
        requests.push(updated.skuCode);
      }
      return {
        tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
        replenishmentRequests: requests,
      };
    });
  },

  closeOutVisit: async () => {
    const { visitId, checkout } = get();
    if (!visitId) return null;
    if (checkout) return checkout;
    const summary = await checkOut(visitId);
    set({ checkout: summary, checkedOutAt: Date.now() });
    return summary;
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
      captureId: null,
      analysis: null,
      justCaptured: false,
      findings: [],
      tasks: [],
      afterCaptured: false,
      replenishmentRequests: [],
      checkout: null,
    }),

  syncAll: () => {
    const pending = get().sync.filter((i) => i.status !== "DONE");
    set((s) => ({
      sync: s.sync.map((i) =>
        i.status === "DONE" ? i : { ...i, status: "UPLOADING" as const },
      ),
    }));
    pending.forEach((item, i) => {
      setTimeout(
        () =>
          set((s) => ({
            sync: s.sync.map((x) =>
              x.id === item.id
                ? { ...x, status: "DONE" as const, attempts: x.attempts + 1 }
                : x,
            ),
          })),
        500 + i * 700,
      );
    });
  },

  retrySync: (id) => {
    set((s) => ({
      sync: s.sync.map((i) => (i.id === id ? { ...i, status: "UPLOADING" as const } : i)),
    }));
    setTimeout(
      () =>
        set((s) => ({
          sync: s.sync.map((i) =>
            i.id === id ? { ...i, status: "DONE" as const, attempts: i.attempts + 1 } : i,
          ),
        })),
      1400,
    );
  },
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
