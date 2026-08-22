import type { Detection, GapFinding, ShelfAnalysis } from "@/types";

/* ------------------------------------------------------------------
   The shelf is described ONCE, here.
   The rendered photo and the detection boxes are both derived from
   this array, so an overlay box can never drift away from the thing
   it is pointing at. Image space is 1920x1080, top-left origin,
   absolute pixels — the same contract the inference service uses.
   ------------------------------------------------------------------ */

export const IMAGE_W = 1920;
export const IMAGE_H = 1080;

export type SlotKind = "PRODUCT" | "ALMOST" | "GAP";
export type Shape = "can" | "box" | "pouch" | "jar";

export interface Slot {
  id: string;
  row: 0 | 1 | 2;
  x: number;
  w: number;
  kind: SlotKind;
  shape: Shape;
  /** packaging colours — muted on purpose so the overlay colours win */
  body: string;
  cap: string;
  band: string;
  confidence: number;
}

/** board = y of the shelf surface the products stand on */
export const ROWS = [
  { board: 400, height: 226, label: "ชั้นที่ 1" },
  { board: 680, height: 205, label: "ชั้นที่ 2" },
  { board: 960, height: 214, label: "ชั้นที่ 3" },
] as const;

const P = {
  espresso: { body: "#4a3226", cap: "#2c1d16", band: "#c8a06a" },
  latte: { body: "#b8a184", cap: "#7d6a52", band: "#f0e6d6" },
  mocha: { body: "#7b3f2e", cap: "#54291d", band: "#e2b07a" },
  original: { body: "#c0392b", cap: "#8c2820", band: "#f4d8b0" },
  black: { body: "#2f3640", cap: "#1c2027", band: "#c9a227" },
  green: { body: "#3f6f52", cap: "#2a4d39", band: "#dfe9d8" },
  blue: { body: "#3a5a86", cap: "#28405f", band: "#dbe6f2" },
  cream: { body: "#d9c9a8", cap: "#a8977a", band: "#7b3f2e" },
} as const;

export const SLOTS: Slot[] = [
  // ---- row 0 : กาแฟพร้อมดื่ม (กระป๋อง) ----
  { id: "r0s0", row: 0, x: 120, w: 200, kind: "PRODUCT", shape: "can", ...P.espresso, confidence: 0.96 },
  { id: "r0s1", row: 0, x: 328, w: 136, kind: "PRODUCT", shape: "can", ...P.latte, confidence: 0.94 },
  { id: "r0s2", row: 0, x: 472, w: 104, kind: "GAP", shape: "can", ...P.espresso, confidence: 0.91 },
  { id: "r0s3", row: 0, x: 584, w: 272, kind: "PRODUCT", shape: "can", ...P.mocha, confidence: 0.95 },
  { id: "r0s4", row: 0, x: 864, w: 136, kind: "ALMOST", shape: "can", ...P.latte, confidence: 0.88 },
  { id: "r0s5", row: 0, x: 1008, w: 232, kind: "PRODUCT", shape: "can", ...P.espresso, confidence: 0.97 },
  { id: "r0s6", row: 0, x: 1248, w: 120, kind: "GAP", shape: "can", ...P.latte, confidence: 0.89 },
  { id: "r0s7", row: 0, x: 1376, w: 424, kind: "PRODUCT", shape: "can", ...P.green, confidence: 0.93 },

  // ---- row 1 : กาแฟ 3in1 แบบกล่อง ----
  { id: "r1s0", row: 1, x: 120, w: 168, kind: "PRODUCT", shape: "box", ...P.original, confidence: 0.95 },
  { id: "r1s1", row: 1, x: 296, w: 112, kind: "GAP", shape: "box", ...P.original, confidence: 0.93 },
  { id: "r1s2", row: 1, x: 416, w: 280, kind: "PRODUCT", shape: "box", ...P.cream, confidence: 0.92 },
  { id: "r1s3", row: 1, x: 704, w: 112, kind: "ALMOST", shape: "box", ...P.mocha, confidence: 0.86 },
  { id: "r1s4", row: 1, x: 824, w: 168, kind: "PRODUCT", shape: "box", ...P.blue, confidence: 0.94 },
  { id: "r1s5", row: 1, x: 1000, w: 224, kind: "GAP", shape: "box", ...P.mocha, confidence: 0.52 },
  { id: "r1s6", row: 1, x: 1232, w: 280, kind: "PRODUCT", shape: "box", ...P.original, confidence: 0.96 },
  { id: "r1s7", row: 1, x: 1520, w: 112, kind: "GAP", shape: "box", ...P.black, confidence: 0.9 },
  { id: "r1s8", row: 1, x: 1640, w: 160, kind: "PRODUCT", shape: "box", ...P.black, confidence: 0.91 },

  // ---- row 2 : กาแฟถุงเติม / เมล็ดคั่ว ----
  { id: "r2s0", row: 2, x: 120, w: 248, kind: "PRODUCT", shape: "pouch", ...P.cream, confidence: 0.93 },
  { id: "r2s1", row: 2, x: 376, w: 160, kind: "ALMOST", shape: "pouch", ...P.espresso, confidence: 0.84 },
  { id: "r2s2", row: 2, x: 544, w: 304, kind: "PRODUCT", shape: "pouch", ...P.mocha, confidence: 0.95 },
  { id: "r2s3", row: 2, x: 856, w: 176, kind: "GAP", shape: "pouch", ...P.cream, confidence: 0.48 },
  { id: "r2s4", row: 2, x: 1040, w: 272, kind: "PRODUCT", shape: "jar", ...P.black, confidence: 0.97 },
  { id: "r2s5", row: 2, x: 1320, w: 200, kind: "PRODUCT", shape: "jar", ...P.green, confidence: 0.94 },
  { id: "r2s6", row: 2, x: 1528, w: 272, kind: "PRODUCT", shape: "pouch", ...P.blue, confidence: 0.92 },
];

export function slotBox(s: Slot) {
  const row = ROWS[s.row];
  return { x: s.x, y: row.board - row.height, w: s.w, h: row.height };
}

function position(x: number, w: number): "ซ้าย" | "กลาง" | "ขวา" {
  const c = x + w / 2;
  return c < 700 ? "ซ้าย" : c < 1300 ? "กลาง" : "ขวา";
}

/* ---- the six confirmed-pending gaps, in reading order ---- */
const GAP_SKUS: Record<
  string,
  { code: string; name: string; brand: string; priority: 1 | 2 | 3; facings: number }
> = {
  r0s2: { code: "CF-ESP-180", name: "เอสเปรสโซ กระป๋อง 180 มล.", brand: "คาเฟ่โกลด์", priority: 1, facings: 2 },
  r0s6: { code: "CF-LAT-180", name: "ลาเต้เย็น กระป๋อง 180 มล.", brand: "คาเฟ่โกลด์", priority: 2, facings: 2 },
  r1s1: { code: "RC-ORI-27", name: "3in1 ออริจินัล 17.5 ก. x27", brand: "ริชชี่", priority: 1, facings: 2 },
  r1s5: { code: "RC-MOC-25", name: "3in1 มอคค่า 18 ก. x25", brand: "ริชชี่", priority: 2, facings: 4 },
  r1s7: { code: "GB-BLK-30", name: "กาแฟดำ 2 ก. x30", brand: "โกลด์บรู", priority: 3, facings: 2 },
  r2s3: { code: "CF-REF-200", name: "ถุงเติม 200 ก.", brand: "คาเฟ่โกลด์", priority: 1, facings: 3 },
};

const CLASS_MAP: Record<SlotKind, { id: number; name: string }> = {
  PRODUCT: { id: 7, name: "Packaged Coffee" },
  ALMOST: { id: 12, name: "Low Stock Facing" },
  GAP: { id: 19, name: "Empty Shelf" },
};

export function buildDetections(): Detection[] {
  const out: Detection[] = SLOTS.map((s) => {
    const cls = CLASS_MAP[s.kind];
    return {
      detectionId: `det-${s.id}`,
      classId: cls.id,
      className: cls.name,
      semanticType: s.kind === "GAP" ? "GAP" : "PRODUCT",
      bbox: slotBox(s),
      confidence: s.confidence,
      shelfRowIndex: s.row,
    } satisfies Detection;
  });
  // price rails — present in every real frame, hidden behind a filter chip
  ROWS.forEach((row, r) => {
    [180, 760, 1340].forEach((x, tagIndex) => {
      out.push({
        detectionId: `det-tag-${r}-${tagIndex}`,
        classId: 31,
        className: "Price Tag",
        semanticType: "PRICE_TAG",
        bbox: { x, y: row.board + 4, w: 132, h: 26 },
        confidence: 0.9,
        shelfRowIndex: r,
      });
    });
  });
  return out;
}

export function buildGapFindings(): GapFinding[] {
  return SLOTS.filter((s) => s.kind === "GAP").map((s) => {
    const sku = GAP_SKUS[s.id];
    return {
      id: `gap-${s.id}`,
      detectionId: `det-${s.id}`,
      shelfRowIndex: s.row,
      positionLabel: `${ROWS[s.row].label} · ตำแหน่ง${position(s.x, s.w)}`,
      confidence: s.confidence,
      isLowConfidence: s.confidence < 0.6,
      verificationStatus: "PENDING",
      skuCode: sku.code,
      skuName: sku.name,
      skuBrand: sku.brand,
      priority: sku.priority,
      facings: sku.facings,
    } satisfies GapFinding;
  });
}

export const ALMOST_COUNT = SLOTS.filter((s) => s.kind === "ALMOST").length;

/** Maps the mock geometry onto whatever image was actually captured.
 *  Until a model is wired up the boxes are simulated, but they live in the
 *  real image's pixel space so the overlay maths is already correct. */
export function buildAnalysis(image?: { width: number; height: number }): ShelfAnalysis {
  const sx = image ? image.width / IMAGE_W : 1;
  const sy = image ? image.height / IMAGE_H : 1;
  const scale = (d: Detection): Detection =>
    sx === 1 && sy === 1
      ? d
      : {
          ...d,
          bbox: {
            x: Math.round(d.bbox.x * sx),
            y: Math.round(d.bbox.y * sy),
            w: Math.round(d.bbox.w * sx),
            h: Math.round(d.bbox.h * sy),
          },
        };

  const detections = buildDetections().map(scale);
  const gapFindings = buildGapFindings();
  return {
    captureId: "cap-01J8X4Q2ZK",
    modelVersion: "shelf-product-v3",
    imageWidth: image?.width ?? IMAGE_W,
    imageHeight: image?.height ?? IMAGE_H,
    rowCount: ROWS.length,
    gapRatio: 0.22,
    osaScore: 78,
    status: "LOW",
    inferenceMs: 1840,
    lowConfidenceCount: gapFindings.filter((g) => g.isLowConfidence).length,
    detections,
    gapFindings,
  };
}

/** Slots as they look after the rep restocks: filled gaps become product. */
export function slotsAfter(filledGapIds: string[]): Slot[] {
  const filled = new Set(filledGapIds.map((id) => id.replace(/^gap-/, "")));
  return SLOTS.map((s) =>
    filled.has(s.id) ? { ...s, kind: "PRODUCT" as const, confidence: 0.95 } : s,
  );
}
