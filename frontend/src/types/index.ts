/** Domain types — mirrors the shape the backend contract will return.
 *  Kept in one place so swapping mock data for the real API is a
 *  data-layer change only, never a component change. */

export type RiskBand = "HIGH" | "MEDIUM" | "LOW";
export type OsaStatus = "OK" | "LOW" | "CRITICAL";
export type SemanticType = "PRODUCT" | "GAP" | "PRICE_TAG" | "PROMO_TAG";
export type StoreFormat = "HYPER" | "SUPER" | "CVS" | "TRAD";

export interface Store {
  id: string;
  externalCode: string;
  name: string;
  chain: string;
  storeFormat: StoreFormat;
  address: string;
  distanceKm: number;
  lastOsa: number;
  daysSinceLastVisit: number;
  riskBand: RiskBand;
  riskScore: number;
  repeatGapSkus: number;
  lat: number;
  lng: number;
  photoPolicy: "ALLOWED" | "RESTRICTED" | "FORBIDDEN";
  visitWindow: string;
}

export interface ShelfCategory {
  id: string;
  name: string;
  bays: string[];
  skuCount: number;
  lastOsa: number | null;
}

/** Bounding boxes are ALWAYS absolute pixels in the source image
 *  coordinate space, top-left origin. Never normalised. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection {
  detectionId: string;
  classId: number;
  className: string;
  semanticType: SemanticType;
  bbox: BBox;
  confidence: number;
  shelfRowIndex: number;
}

export type VerificationStatus = "PENDING" | "CONFIRMED" | "REJECTED";
export type RejectReason = "OCCLUDED" | "NOT_OUR_SKU" | "NORMAL_EMPTY" | "OTHER";

export interface GapFinding {
  id: string;
  detectionId: string;
  shelfRowIndex: number;
  positionLabel: string;
  confidence: number;
  isLowConfidence: boolean;
  verificationStatus: VerificationStatus;
  rejectedReason?: RejectReason;
  skuCode: string;
  skuName: string;
  skuBrand: string;
  priority: 1 | 2 | 3;
  facings: number;
}

export interface ShelfAnalysis {
  captureId: string;
  modelVersion: string;
  imageWidth: number;
  imageHeight: number;
  rowCount: number;
  gapRatio: number;
  osaScore: number;
  status: OsaStatus;
  inferenceMs: number;
  lowConfidenceCount: number;
  detections: Detection[];
  gapFindings: GapFinding[];
}

export type TaskStatus = "OPEN" | "FIXED" | "BLOCKED";
export type BlockedReason = "OUT_OF_BACKSTOCK" | "STORE_REFUSED" | "DELISTED";

export interface Task {
  id: string;
  findingId: string;
  skuCode: string;
  skuName: string;
  skuBrand: string;
  positionLabel: string;
  priority: 1 | 2 | 3;
  facings: number;
  status: TaskStatus;
  blockedReason?: BlockedReason;
}

export type SyncItemStatus = "PENDING" | "UPLOADING" | "FAILED" | "DONE";

export interface SyncItem {
  id: string;
  storeName: string;
  kind: "CAPTURE" | "VERIFY" | "TASK" | "CHECKOUT";
  label: string;
  sizeKb: number;
  queuedAt: string;
  status: SyncItemStatus;
  attempts: number;
  errorCode?: string;
}
