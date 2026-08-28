import type { Page, Route } from "@playwright/test";

/* A stand-in for the API, good enough to walk the whole field-rep flow.
 *
 * The shapes here are the wire shapes from src/lib/api/*, not the domain types:
 * OSA and risk arrive as 0..1 ratios and are converted at the api boundary, so
 * sending percentages would make every number on screen wrong by 100x. */

export const STORE_ID = "store-001";
export const NEXT_STORE_ID = "store-002";
export const VISIT_ID = "visit-001";
export const CAPTURE_ID = "capture-001";
export const FINDING_ID = "finding-001";
export const TASK_ID = "task-001";

function storeWire(id: string, name: string, distanceKm: number) {
  return {
    id,
    externalCode: id.toUpperCase(),
    name,
    chain: "ShelfMart",
    storeFormat: "SUPER",
    areaId: "area-bke",
    address: "123 ถนนทดสอบ แขวงทดสอบ กรุงเทพฯ",
    lat: 13.7563,
    lng: 100.5018,
    photoPolicy: "ALLOWED",
    visitWindow: "09:00–11:00",
    lastOsa: 0.78,
    daysSinceLastVisit: 4,
    riskBand: "HIGH",
    riskScore: 0.82,
    repeatGapSkus: 3,
    distanceKm,
  };
}

const CATEGORIES = [
  { id: "cat-coffee", name: "กาแฟ", bays: ["A1", "A2"], skuCount: 24, lastOsa: 0.71 },
  { id: "cat-milk", name: "นม", bays: ["B1"], skuCount: 18, lastOsa: 0.9 },
];

const DETECTIONS = [
  {
    detectionId: "det-1",
    classId: 0,
    className: "product",
    semanticType: "PRODUCT",
    bbox: { x: 40, y: 60, w: 120, h: 180 },
    confidence: 0.94,
    shelfRowIndex: 0,
  },
  {
    detectionId: "det-2",
    classId: 1,
    className: "gap",
    semanticType: "GAP",
    bbox: { x: 200, y: 60, w: 110, h: 180 },
    confidence: 0.81,
    shelfRowIndex: 0,
  },
];

const GAP_FINDINGS = [
  {
    id: FINDING_ID,
    detectionId: "det-2",
    shelfRowIndex: 0,
    positionLabel: "ชั้น 1 ตำแหน่ง 3",
    confidence: 0.81,
    isLowConfidence: false,
    verificationStatus: "PENDING",
    skuCode: "SKU-1001",
    skuName: "กาแฟกระป๋องทดสอบ 180ml",
    skuBrand: "TestBrand",
    priority: 1,
    facings: 2,
  },
];

function taskWire(status: "OPEN" | "FIXED" | "BLOCKED") {
  return {
    id: TASK_ID,
    findingId: FINDING_ID,
    skuCode: "SKU-1001",
    skuName: "กาแฟกระป๋องทดสอบ 180ml",
    skuBrand: "TestBrand",
    positionLabel: "ชั้น 1 ตำแหน่ง 3",
    priority: 1,
    facings: 2,
    status,
    blockedReason: null,
  };
}

/** Mutable per-test state, so a verified finding actually produces a task. */
interface StubState {
  tasks: ReturnType<typeof taskWire>[];
  jobPolls: number;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Registers stub handlers for every endpoint the mobile flow touches.
 * Call once per page, before the first navigation.
 */
export async function installApiStubs(page: Page): Promise<StubState> {
  const state: StubState = { tasks: [], jobPolls: 0 };

  // The presigned PUT goes straight to object storage, bypassing the api
  // client — it has to be stubbed separately or the upload hangs.
  await page.route("**/shelfeye-raw/**", (route) => route.fulfill({ status: 200, body: "" }));

  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path === "/v1/auth/login") {
      return json(route, { accessToken: "test-token", tokenType: "bearer", expiresIn: 3600 });
    }

    if (path === "/v1/me") {
      return json(route, {
        id: "user-001",
        email: "rep@shelfeye.demo",
        fullName: "พนักงานทดสอบ",
        role: "REP",
        areaId: "area-bke",
      });
    }

    if (path === "/v1/routes/today") {
      return json(route, [
        storeWire(STORE_ID, "ShelfMart สาขาทดสอบ 1", 1.2),
        storeWire(NEXT_STORE_ID, "ShelfMart สาขาทดสอบ 2", 3.4),
      ]);
    }

    if (path.startsWith("/v1/stores/")) {
      const id = decodeURIComponent(path.slice("/v1/stores/".length));
      return json(route, storeWire(id, `ShelfMart สาขาทดสอบ ${id.slice(-1)}`, 1.2));
    }

    if (path === "/v1/categories") return json(route, CATEGORIES);
    if (path === "/v1/areas") return json(route, [{ id: "area-bke", name: "กรุงเทพฯ ตะวันออก" }]);

    if (path === "/v1/visits" && method === "POST") {
      return json(route, {
        id: VISIT_ID,
        storeId: STORE_ID,
        userId: "user-001",
        checkedInAt: new Date().toISOString(),
        checkedOutAt: null,
        gpsMatch: true,
        photoConsentConfirmed: true,
        osaBefore: null,
        osaAfter: null,
        status: "OPEN",
      });
    }

    if (path === "/v1/captures/presign") {
      return json(route, {
        captureId: CAPTURE_ID,
        // localhost:9000 is rewritten to a same-origin path by the api layer,
        // which is what makes the shelfeye-raw route above catch the PUT.
        uploadUrl: "http://localhost:9000/shelfeye-raw/test-object.jpg",
        objectKey: "test-object.jpg",
        expiresIn: 900,
      });
    }

    if (path.endsWith("/commit")) {
      state.jobPolls = 0;
      return json(route, { jobId: "job-001", captureId: CAPTURE_ID, status: "QUEUED" });
    }

    if (path.startsWith("/v1/jobs/")) {
      state.jobPolls += 1;
      return json(route, {
        jobId: "job-001",
        captureId: CAPTURE_ID,
        status: "DONE",
        progressHint: "",
        errorCode: null,
        userMessage: null,
        resultUrl: null,
      });
    }

    if (path.endsWith("/result")) {
      return json(route, {
        captureId: CAPTURE_ID,
        modelVersion: "test-v1",
        imageUrl: null,
        imageWidth: 1920,
        imageHeight: 1080,
        rowCount: 1,
        gapRatio: 0.22,
        osaScore: 0.78,
        status: "LOW",
        inferenceMs: 820,
        lowConfidenceCount: 0,
        lowConfidenceThreshold: 0.5,
        detections: DETECTIONS,
        gapFindings: GAP_FINDINGS,
      });
    }

    if (path.endsWith("/verify") && method === "POST") {
      const body = route.request().postDataJSON() as { verdict: string };
      if (body.verdict === "CONFIRMED" && state.tasks.length === 0) {
        state.tasks = [taskWire("OPEN")];
      }
      return json(route, {
        findingId: FINDING_ID,
        verdict: body.verdict,
        taskId: state.tasks.length ? TASK_ID : null,
        idempotent: false,
      });
    }

    if (path.endsWith("/tasks") && method === "GET") return json(route, state.tasks);

    if (path.startsWith("/v1/tasks/") && method === "PATCH") {
      const body = route.request().postDataJSON() as { status: "OPEN" | "FIXED" | "BLOCKED" };
      const updated = taskWire(body.status);
      state.tasks = state.tasks.map((t) => (t.id === TASK_ID ? updated : t));
      return json(route, updated);
    }

    if (path.endsWith("/checkout") && method === "POST") {
      return json(route, {
        visitId: VISIT_ID,
        osaBefore: 0.78,
        osaAfter: 0.91,
        tasksTotal: state.tasks.length,
        tasksFixed: state.tasks.filter((t) => t.status === "FIXED").length,
        tasksBlocked: state.tasks.filter((t) => t.status === "BLOCKED").length,
        checkedOutAt: new Date().toISOString(),
      });
    }

    // An unstubbed endpoint should be loud: a silent 200 with no body turns
    // into a parse error three screens later, far from its cause.
    return json(route, { code: "NOT_STUBBED", message: `no stub for ${method} ${path}` }, 501);
  });

  return state;
}
