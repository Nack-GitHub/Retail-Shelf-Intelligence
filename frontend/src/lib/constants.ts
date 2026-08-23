/* Domain constants — not mock data.
 *
 * These are the closed sets the API validates against: `RejectReason` and
 * `BlockedReason` are Literal-typed on the backend schemas, so a value not in
 * these lists is rejected as a 422 before any handler runs. They live in the
 * frontend because the labels and hints are UI copy, and shipping Thai
 * microcopy through an API would put wording changes behind a deploy.
 */

export const REJECT_REASONS = [
  { id: "OCCLUDED", label: "มีของแต่ถูกบัง", hint: "มีสินค้าอยู่ แต่ถูกป้าย/กล่อง/คนบัง" },
  { id: "NOT_OUR_SKU", label: "ไม่ใช่สินค้าของเรา", hint: "พื้นที่ของแบรนด์อื่นหรือสินค้าคู่แข่ง" },
  { id: "NORMAL_EMPTY", label: "เป็นพื้นที่ว่างปกติ", hint: "ช่องว่างที่ไม่ได้จัดวางสินค้าอยู่แล้ว" },
  { id: "OTHER", label: "อื่น ๆ", hint: "ระบุเหตุผลเพิ่มเติม" },
] as const;

export const BLOCKED_REASONS = [
  { id: "OUT_OF_BACKSTOCK", label: "ของหมดหลังร้าน", hint: "จะส่งคำขอเติมสินค้าให้อัตโนมัติ" },
  { id: "STORE_REFUSED", label: "ร้านไม่อนุญาตให้เติม", hint: "ร้านขอจัดของเอง หรือปิดพื้นที่" },
  { id: "DELISTED", label: "ร้านเลิกขายสินค้านี้", hint: "แจ้งทีมการค้าเพื่อทบทวนรายการ" },
] as const;
