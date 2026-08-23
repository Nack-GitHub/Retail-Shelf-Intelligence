/* ------------------------------------------------------------------
   The drawn stand-in shelf.

   This is NOT data — it is an illustration, shown only when there is no
   photograph to show: a reviewer on a laptop with no camera, or a screen
   reached before any capture exists. Real photos always win.

   It survived the deletion of lib/mock because losing it would make the
   whole flow unreviewable on the machines demos are actually given on.

   Drawn in 1920x1080 space, top-left origin, absolute pixels — the same
   contract the inference service uses, so nothing downstream has to
   special-case it.
   ------------------------------------------------------------------ */

export const IMAGE_W = 1920;
export const IMAGE_H = 1080;

export type SlotKind = "PRODUCT" | "GAP";
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
  { id: "r0s4", row: 0, x: 864, w: 136, kind: "PRODUCT", shape: "can", ...P.latte, confidence: 0.88 },
  { id: "r0s5", row: 0, x: 1008, w: 232, kind: "PRODUCT", shape: "can", ...P.espresso, confidence: 0.97 },
  { id: "r0s6", row: 0, x: 1248, w: 120, kind: "GAP", shape: "can", ...P.latte, confidence: 0.89 },
  { id: "r0s7", row: 0, x: 1376, w: 424, kind: "PRODUCT", shape: "can", ...P.green, confidence: 0.93 },

  // ---- row 1 : กาแฟ 3in1 แบบกล่อง ----
  { id: "r1s0", row: 1, x: 120, w: 168, kind: "PRODUCT", shape: "box", ...P.original, confidence: 0.95 },
  { id: "r1s1", row: 1, x: 296, w: 112, kind: "GAP", shape: "box", ...P.original, confidence: 0.93 },
  { id: "r1s2", row: 1, x: 416, w: 280, kind: "PRODUCT", shape: "box", ...P.cream, confidence: 0.92 },
  { id: "r1s3", row: 1, x: 704, w: 112, kind: "PRODUCT", shape: "box", ...P.mocha, confidence: 0.86 },
  { id: "r1s4", row: 1, x: 824, w: 168, kind: "PRODUCT", shape: "box", ...P.blue, confidence: 0.94 },
  { id: "r1s5", row: 1, x: 1000, w: 224, kind: "GAP", shape: "box", ...P.mocha, confidence: 0.52 },
  { id: "r1s6", row: 1, x: 1232, w: 280, kind: "PRODUCT", shape: "box", ...P.original, confidence: 0.96 },
  { id: "r1s7", row: 1, x: 1520, w: 112, kind: "GAP", shape: "box", ...P.black, confidence: 0.9 },
  { id: "r1s8", row: 1, x: 1640, w: 160, kind: "PRODUCT", shape: "box", ...P.black, confidence: 0.91 },

  // ---- row 2 : กาแฟถุงเติม / เมล็ดคั่ว ----
  { id: "r2s0", row: 2, x: 120, w: 248, kind: "PRODUCT", shape: "pouch", ...P.cream, confidence: 0.93 },
  { id: "r2s1", row: 2, x: 376, w: 160, kind: "PRODUCT", shape: "pouch", ...P.espresso, confidence: 0.84 },
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


/** The same shelf after a restock: filled gaps become product.
 *
 *  Used by the before/after comparison when there is no real after-photo to
 *  put beside the before-photo. */
export function slotsAfter(filledGapIds: string[]): Slot[] {
  const filled = new Set(filledGapIds.map((id) => id.replace(/^gap-/, "")));
  return SLOTS.map((s) =>
    filled.has(s.id) ? { ...s, kind: "PRODUCT" as const, confidence: 0.95 } : s,
  );
}
