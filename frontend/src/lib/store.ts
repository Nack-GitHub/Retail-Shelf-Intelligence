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
import { buildAnalysis } from "@/lib/mock/shelf";
import { SYNC_ITEMS } from "@/lib/mock/data";
import { revokePhoto, type CapturedPhoto } from "@/lib/capture";

/* Demo-only state. When the API lands, everything under `visit` becomes
   server state (React Query) and this store keeps only UI concerns. */

interface DemoState {
  online: boolean;
  setOnline: (v: boolean) => void;

  storeId: string | null;
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

  analysis: ShelfAnalysis | null;
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
  checkIn: () => void;
  closeVisit: () => void;
  selectShelf: (categoryId: string, bay: string) => void;
  /** records a photo the moment intake finishes, before the rep decides
   *  whether to keep it — a discarded shot still happened */
  logPhoto: (photo: CapturedPhoto) => void;
  finishCapture: (photo?: CapturedPhoto | null) => void;
  setAfterPhoto: (photo: CapturedPhoto | null) => void;
  clearPhotoLog: () => void;
  consumeCapture: () => void;
  verify: (findingId: string, verdict: "CONFIRMED" | "REJECTED", reason?: RejectReason) => void;
  buildTasks: () => void;
  setTask: (taskId: string, status: "FIXED" | "BLOCKED", reason?: BlockedReason) => void;
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
  consent: false,
  gpsMatch: true,
  checkedInAt: null,
  checkedOutAt: null,
  categoryId: null,
  bay: null,

  photo: null,
  afterPhoto: null,
  photoLog: [],

  analysis: null,
  justCaptured: false,
  findings: [],
  tasks: [],
  afterCaptured: false,
  replenishmentRequests: [],

  sync: SYNC_ITEMS,

  beginVisit: (storeId) =>
    set((s) => {
      // the log keeps its own references; only the per-visit slots are released
      if (s.photo && !s.photoLog.includes(s.photo)) revokePhoto(s.photo);
      if (s.afterPhoto && !s.photoLog.includes(s.afterPhoto)) revokePhoto(s.afterPhoto);
      return {
      storeId,
      consent: false,
      checkedInAt: null,
      checkedOutAt: null,
      categoryId: null,
      bay: null,
      photo: null,
      afterPhoto: null,
      analysis: null,
      justCaptured: false,
      findings: [],
      tasks: [],
      afterCaptured: false,
      replenishmentRequests: [],
      };
    }),

  setConsent: (consent) => set({ consent }),
  setGpsMatch: (gpsMatch) => set({ gpsMatch }),
  checkIn: () => set({ checkedInAt: Date.now(), checkedOutAt: null }),
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

  finishCapture: (photo) => {
    const analysis = buildAnalysis(
      photo ? { width: photo.width, height: photo.height } : undefined,
    );
    set((s) => ({
      photo: photo ?? s.photo,
      analysis,
      findings: analysis.gapFindings,
      justCaptured: true,
    }));
  },

  setAfterPhoto: (photo) => set({ afterPhoto: photo }),

  clearPhotoLog: () =>
    set((s) => {
      s.photoLog.forEach((p) => {
        if (p !== s.photo && p !== s.afterPhoto) revokePhoto(p);
      });
      return { photoLog: s.photo || s.afterPhoto ? s.photoLog.filter((p) => p === s.photo || p === s.afterPhoto) : [] };
    }),

  consumeCapture: () => set({ justCaptured: false }),

  verify: (findingId, verdict, reason) =>
    set((s) => ({
      findings: s.findings.map((f) =>
        f.id === findingId
          ? { ...f, verificationStatus: verdict, rejectedReason: reason }
          : f,
      ),
    })),

  buildTasks: () => {
    const { findings, tasks } = get();
    const confirmed = findings.filter((f) => f.verificationStatus === "CONFIRMED");
    const existing = new Map(tasks.map((t) => [t.findingId, t]));
    const next: Task[] = confirmed
      .map(
        (f) =>
          existing.get(f.id) ?? {
            id: `task-${f.id}`,
            findingId: f.id,
            skuCode: f.skuCode,
            skuName: f.skuName,
            skuBrand: f.skuBrand,
            positionLabel: f.positionLabel,
            priority: f.priority,
            facings: f.facings,
            status: "OPEN" as const,
          },
      )
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    set({ tasks: next });
  },

  setTask: (taskId, status, reason) =>
    set((s) => {
      const task = s.tasks.find((t) => t.id === taskId);
      const requests = [...s.replenishmentRequests];
      if (task && status === "BLOCKED" && reason === "OUT_OF_BACKSTOCK") {
        if (!requests.includes(task.skuCode)) requests.push(task.skuCode);
      }
      return {
        tasks: s.tasks.map((t) =>
          t.id === taskId ? { ...t, status, blockedReason: reason } : t,
        ),
        replenishmentRequests: requests,
      };
    }),

  markAfterCaptured: () => set({ afterCaptured: true }),

  resetVisit: () =>
    set({
      storeId: null,
      consent: false,
      checkedInAt: null,
      checkedOutAt: null,
      categoryId: null,
      bay: null,
      photo: null,
      afterPhoto: null,
      analysis: null,
      justCaptured: false,
      findings: [],
      tasks: [],
      afterCaptured: false,
      replenishmentRequests: [],
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

/** OSA after restock — recomputed from the gaps the rep actually closed.
 *  Returns a primitive, so it is safe to derive inside the selector. */
export function useOsaAfter() {
  return useDemo((s) => {
    const before = s.analysis?.osaScore ?? 78;
    if (!s.findings.length) return before;
    const closed = s.tasks.filter((t) => t.status === "FIXED").length;
    const rejected = s.findings.filter((f) => f.verificationStatus === "REJECTED").length;
    const perGap = (100 - before) / s.findings.length;
    return Math.min(100, Math.round(before + perGap * (closed + rejected)));
  });
}
