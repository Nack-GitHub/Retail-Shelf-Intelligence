/* The field-rep flow, written down once.
 *
 * Before this existed, every screen decided for itself whether to push or
 * replace, and every back control called router.back() — the browser's history,
 * which answers "where did you come from", not "where does this step go back
 * to". The two are the same only by accident, and the accidents were the bug
 * reports: going back to a check-in that had already happened, to a result for
 * a photo that had been retaken, to a summary for a visit that had closed.
 *
 * Nothing here imports React or the router. It is the map; useFlow drives.
 * The order it describes is the one in docs/ui.md §1.3. */

export type StepId =
  | "LOGIN"
  | "ROUTE"
  | "CHECKIN"
  | "CATEGORY"
  | "CAPTURE"
  | "PROCESSING"
  | "RESULT"
  | "VERIFY"
  | "TASKS"
  | "CHECKOUT"
  | "COMPARE";

/** Just enough of the visit for a step to say whether it can be entered. A
 *  narrow view on purpose: the map should not need to know what an analysis
 *  or a photograph actually contains. */
export interface VisitSnapshot {
  visitId: string | null;
  categoryId: string | null;
  hasPhoto: boolean;
  hasAnalysis: boolean;
  findingCount: number;
}

/** What to say when a step cannot be entered. Every one of these is a screen a
 *  rep can genuinely reach — by reloading in the shop, by a back press after
 *  the visit closed, by a pasted link — and each needs to say what happened
 *  and what to do next, never nothing at all. */
export interface BlockedCopy {
  title: string;
  body: string;
  action: string;
}

export interface Step {
  id: StepId;
  /** null storeId means the step is not reachable and the flow falls back */
  path: (storeId: string | null) => string | null;
  canEnter: (visit: VisitSnapshot) => boolean;
  /** where to send someone who cannot enter */
  fallback: StepId;
  /** where the back control goes — not necessarily where history came from */
  back: StepId | null;
  /** how this step is normally arrived at */
  arriveWith: "push" | "replace";
  blocked: BlockedCopy;
  /** the flow ends here; going back means starting the day's list again */
  terminal?: boolean;
}

const storePath = (segment: string) => (storeId: string | null) =>
  storeId ? `/m/store/${storeId}/${segment}` : null;

const NO_VISIT: BlockedCopy = {
  title: "ยังไม่ได้เริ่มการเข้าร้านนี้",
  body: "เลือกร้านจากเส้นทางวันนี้แล้วเช็คอินก่อน จึงจะทำขั้นตอนนี้ได้",
  action: "ไปหน้าเส้นทางวันนี้",
};

export const STEPS: Record<StepId, Step> = {
  LOGIN: {
    id: "LOGIN",
    path: () => "/m/login",
    canEnter: () => true,
    fallback: "LOGIN",
    back: null,
    arriveWith: "replace",
    blocked: NO_VISIT,
  },

  ROUTE: {
    id: "ROUTE",
    path: () => "/m",
    canEnter: () => true,
    fallback: "ROUTE",
    back: null,
    // Arriving at the day's route list always ends whatever came before it —
    // a sign-in, or a closed visit. Neither is somewhere to go back to.
    arriveWith: "replace",
    blocked: NO_VISIT,
  },

  CHECKIN: {
    id: "CHECKIN",
    path: storePath("checkin"),
    canEnter: () => true,
    fallback: "ROUTE",
    back: "ROUTE",
    arriveWith: "push",
    blocked: NO_VISIT,
  },

  CATEGORY: {
    id: "CATEGORY",
    path: storePath("category"),
    canEnter: (v) => v.visitId !== null,
    fallback: "CHECKIN",
    // Not CHECKIN: the visit is already open, and offering to open it again is
    // how one shop trip becomes two rows in the database.
    back: "ROUTE",
    arriveWith: "replace",
    blocked: NO_VISIT,
  },

  CAPTURE: {
    id: "CAPTURE",
    path: storePath("capture"),
    canEnter: (v) => v.visitId !== null && v.categoryId !== null,
    fallback: "CATEGORY",
    back: "CATEGORY",
    arriveWith: "push",
    blocked: {
      title: "ยังไม่ได้เลือกชั้นวาง",
      body: "เลือกหมวดสินค้าและชั้นวางที่จะตรวจก่อน กล้องจึงจะรู้ว่ากำลังถ่ายชั้นไหน",
      action: "เลือกชั้นวาง",
    },
  },

  PROCESSING: {
    id: "PROCESSING",
    path: storePath("processing"),
    canEnter: (v) => v.visitId !== null && v.hasPhoto,
    fallback: "CAPTURE",
    back: "CATEGORY",
    // Waiting is not a place. Replacing keeps it out of history entirely, so a
    // back press during an upload cannot land the rep back inside it.
    arriveWith: "replace",
    blocked: {
      title: "ไม่มีภาพที่รอวิเคราะห์",
      body: "ภาพที่ส่งไปวิเคราะห์อยู่ในหน่วยความจำของเครื่องเท่านั้น เมื่อโหลดหน้าใหม่จึงหายไป",
      action: "เปิดกล้องถ่ายใหม่",
    },
  },

  RESULT: {
    id: "RESULT",
    path: storePath("result"),
    canEnter: (v) => v.hasAnalysis,
    fallback: "CAPTURE",
    back: "CATEGORY",
    arriveWith: "replace",
    blocked: {
      title: "ยังไม่มีผลการตรวจ",
      body: "ผลการตรวจจะแสดงที่นี่หลังถ่ายภาพชั้นวางและวิเคราะห์เสร็จ",
      action: "เปิดกล้องถ่ายใหม่",
    },
  },

  VERIFY: {
    id: "VERIFY",
    path: storePath("verify"),
    canEnter: (v) => v.hasAnalysis && v.findingCount > 0,
    fallback: "RESULT",
    back: "RESULT",
    arriveWith: "push",
    blocked: {
      title: "ไม่มีจุดให้ตรวจสอบ",
      body: "หน้านี้จะแสดงช่องว่างที่ตรวจพบทีละจุด เมื่อมีผลการตรวจของชั้นวางแล้ว",
      action: "ดูผลการตรวจ",
    },
  },

  TASKS: {
    id: "TASKS",
    path: storePath("tasks"),
    canEnter: (v) => v.visitId !== null,
    fallback: "ROUTE",
    back: "VERIFY",
    arriveWith: "push",
    blocked: NO_VISIT,
  },

  COMPARE: {
    id: "COMPARE",
    path: storePath("compare"),
    canEnter: (v) => v.visitId !== null,
    fallback: "ROUTE",
    back: "TASKS",
    arriveWith: "push",
    blocked: NO_VISIT,
  },

  CHECKOUT: {
    id: "CHECKOUT",
    path: storePath("checkout"),
    canEnter: (v) => v.visitId !== null,
    fallback: "ROUTE",
    back: "ROUTE",
    arriveWith: "push",
    terminal: true,
    blocked: {
      title: "การเข้าร้านนี้ปิดแล้ว",
      body: "สรุปของการเข้าร้านที่ปิดไปแล้ว ดูย้อนหลังได้จากหน้าเว็บของผู้จัดการพื้นที่",
      action: "ไปหน้าเส้นทางวันนี้",
    },
  },
};

/** Depth in the flow, used to decide which way a screen transition slides.
 *  Anything not on the map — the capture log, the sync queue — is a detour
 *  rather than a step, and reads as coming from the side rather than deeper. */
const ORDER: StepId[] = [
  "LOGIN",
  "ROUTE",
  "CHECKIN",
  "CATEGORY",
  "CAPTURE",
  "PROCESSING",
  "RESULT",
  "VERIFY",
  "TASKS",
  "COMPARE",
  "CHECKOUT",
];

export function depthOf(step: StepId | null): number {
  return step === null ? -1 : ORDER.indexOf(step);
}

/** Which step a path belongs to, or null for a detour. */
export function stepOfPath(pathname: string): StepId | null {
  if (pathname === "/m") return "ROUTE";
  if (pathname === "/m/login") return "LOGIN";

  const match = /^\/m\/store\/[^/]+\/([^/]+)$/.exec(pathname);
  if (!match) return null;

  const bySegment: Record<string, StepId> = {
    checkin: "CHECKIN",
    category: "CATEGORY",
    capture: "CAPTURE",
    processing: "PROCESSING",
    result: "RESULT",
    verify: "VERIFY",
    tasks: "TASKS",
    compare: "COMPARE",
    checkout: "CHECKOUT",
  };
  return bySegment[match[1]] ?? null;
}
