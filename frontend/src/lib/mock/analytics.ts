/* Manager & data-team mock data.
   NOTE: every aggregation here is at STORE or AREA level.
   There is deliberately no per-rep metric anywhere in this file. */

export const AREAS = [
  { id: "area-bke", name: "กรุงเทพฯ ตะวันออก" },
  { id: "area-bkn", name: "กรุงเทพฯ เหนือ" },
  { id: "area-bkw", name: "กรุงเทพฯ ตะวันตก" },
  { id: "area-est", name: "ภาคตะวันออก" },
];

export const KPIS = [
  {
    id: "osa",
    label: "OSA เฉลี่ยของพื้นที่",
    value: 83.4,
    unit: "%",
    delta: 2.1,
    deltaLabel: "เทียบ 4 สัปดาห์ก่อน",
    good: "up" as const,
    target: 90,
  },
  {
    id: "ttr",
    label: "เวลาเฉลี่ยจากตรวจพบถึงเติมของสำเร็จ",
    value: 41,
    unit: "นาที",
    delta: -7,
    deltaLabel: "เทียบ 4 สัปดาห์ก่อน",
    good: "down" as const,
    target: 30,
  },
  {
    id: "visits",
    label: "ร้านที่ตรวจสัปดาห์นี้",
    value: 128,
    unit: "ร้าน",
    delta: 12,
    deltaLabel: "จากแผน 140 ร้าน",
    good: "up" as const,
    target: 140,
  },
  {
    id: "cost",
    label: "ต้นทุนต่อการตรวจหนึ่งร้าน",
    value: 18.6,
    unit: "บาท",
    delta: -3.4,
    deltaLabel: "เทียบ 4 สัปดาห์ก่อน",
    good: "down" as const,
    target: 15,
  },
];

/** 12 สัปดาห์ย้อนหลัง */
export const OSA_TREND = [
  { week: "W31", osa: 76.2, visits: 96 },
  { week: "W32", osa: 77.8, visits: 104 },
  { week: "W33", osa: 75.4, visits: 88 },
  { week: "W34", osa: 78.9, visits: 112 },
  { week: "W35", osa: 80.1, visits: 118 },
  { week: "W36", osa: 79.3, visits: 109 },
  { week: "W37", osa: 81.6, visits: 121 },
  { week: "W38", osa: 82.4, visits: 126 },
  { week: "W39", osa: 80.8, visits: 115 },
  { week: "W40", osa: 83.1, visits: 130 },
  { week: "W41", osa: 84.6, visits: 133 },
  { week: "W42", osa: 83.4, visits: 128 },
];

export interface RiskRow {
  storeId: string;
  name: string;
  chain: string;
  osa: number;
  osaDelta: number;
  repeatGapSkus: number;
  lastVisit: string;
  daysSince: number;
  risk: "HIGH" | "MEDIUM" | "LOW";
}

export const RISK_RANKING: RiskRow[] = [
  { storeId: "st-103", name: "มินิบิ๊ก พระราม 9 ซอย 41", chain: "มินิบิ๊ก", osa: 68, osaDelta: -6.2, repeatGapSkus: 7, lastVisit: "10 ส.ค.", daysSince: 12, risk: "HIGH" },
  { storeId: "st-101", name: "ควิกช้อป อ่อนนุช 17", chain: "ควิกช้อป", osa: 74, osaDelta: -3.1, repeatGapSkus: 5, lastVisit: "14 ส.ค.", daysSince: 8, risk: "HIGH" },
  { storeId: "st-106", name: "มินิบิ๊ก ลาดพร้าว 101", chain: "มินิบิ๊ก", osa: 75, osaDelta: -1.8, repeatGapSkus: 6, lastVisit: "13 ส.ค.", daysSince: 9, risk: "HIGH" },
  { storeId: "st-107", name: "เฟรชมาร์ท เอกมัย 12", chain: "เฟรชมาร์ท", osa: 78, osaDelta: 0.4, repeatGapSkus: 4, lastVisit: "16 ส.ค.", daysSince: 6, risk: "MEDIUM" },
  { storeId: "st-102", name: "เฟรชมาร์ท ทองหล่อ 25", chain: "เฟรชมาร์ท", osa: 81, osaDelta: 1.2, repeatGapSkus: 3, lastVisit: "17 ส.ค.", daysSince: 5, risk: "MEDIUM" },
  { storeId: "st-105", name: "ควิกช้อป ศรีนครินทร์ 42", chain: "ควิกช้อป", osa: 85, osaDelta: 2.6, repeatGapSkus: 2, lastVisit: "13 ส.ค.", daysSince: 9, risk: "MEDIUM" },
  { storeId: "st-108", name: "ควิกช้อป สุขุมวิท 71", chain: "ควิกช้อป", osa: 86, osaDelta: -0.5, repeatGapSkus: 2, lastVisit: "18 ส.ค.", daysSince: 4, risk: "LOW" },
  { storeId: "st-104", name: "ร้านลุงสมชาย ซอยรามคำแหง 24", chain: "ร้านค้าดั้งเดิม", osa: 89, osaDelta: 3.3, repeatGapSkus: 1, lastVisit: "16 ส.ค.", daysSince: 6, risk: "LOW" },
  { storeId: "st-109", name: "เฟรชมาร์ท พัฒนาการ 20", chain: "เฟรชมาร์ท", osa: 91, osaDelta: 1.1, repeatGapSkus: 1, lastVisit: "19 ส.ค.", daysSince: 3, risk: "LOW" },
  { storeId: "st-110", name: "มินิบิ๊ก อุดมสุข 51", chain: "มินิบิ๊ก", osa: 93, osaDelta: 0.8, repeatGapSkus: 0, lastVisit: "20 ส.ค.", daysSince: 2, risk: "LOW" },
];

/* ---------------- store detail ---------------- */

export const STORE_OSA_HISTORY = [
  62, 66, 64, 71, 69, 74, 72, 70, 76, 73, 68, 74,
];

export const DOW = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];

/** heatmap: SKU x วันในสัปดาห์ — ค่า = จำนวนครั้งที่ตรวจพบว่าขาด */
export const OOS_HEATMAP = [
  { sku: "คาเฟ่โกลด์ เอสเปรสโซ 180 มล.", values: [1, 2, 3, 5, 6, 7, 4] },
  { sku: "ริชชี่ 3in1 ออริจินัล x27", values: [0, 1, 2, 3, 5, 6, 5] },
  { sku: "คาเฟ่โกลด์ ถุงเติม 200 ก.", values: [2, 2, 1, 2, 4, 5, 3] },
  { sku: "คาเฟ่โกลด์ ลาเต้เย็น 180 มล.", values: [0, 0, 1, 2, 3, 4, 2] },
  { sku: "โกลด์บรู กาแฟดำ x30", values: [1, 0, 0, 1, 2, 3, 1] },
  { sku: "ริชชี่ 3in1 มอคค่า x25", values: [0, 1, 0, 1, 1, 2, 1] },
];

export interface EvidenceItem {
  id: string;
  date: string;
  time: string;
  category: string;
  bay: string;
  osaBefore: number;
  osaAfter: number | null;
  gaps: number;
  fixed: number;
  disputed: boolean;
  gps: string;
  modelVersion: string;
  capturedByRole: string;
}

export const EVIDENCE_TIMELINE: EvidenceItem[] = [
  { id: "ev-1", date: "22 ส.ค. 2569", time: "09:14", category: "กาแฟ", bay: "A2", osaBefore: 78, osaAfter: 96, gaps: 6, fixed: 4, disputed: false, gps: "13.75390, 100.62210", modelVersion: "shelf-product-v3", capturedByRole: "พนักงานภาคสนาม" },
  { id: "ev-2", date: "14 ส.ค. 2569", time: "10:02", category: "กาแฟ", bay: "A2", osaBefore: 71, osaAfter: 88, gaps: 8, fixed: 6, disputed: true, gps: "13.75388, 100.62213", modelVersion: "shelf-product-v3", capturedByRole: "พนักงานภาคสนาม" },
  { id: "ev-3", date: "07 ส.ค. 2569", time: "09:41", category: "นมและผลิตภัณฑ์นม", bay: "B1", osaBefore: 84, osaAfter: 93, gaps: 4, fixed: 4, disputed: false, gps: "13.75391, 100.62208", modelVersion: "shelf-product-v2", capturedByRole: "พนักงานภาคสนาม" },
  { id: "ev-4", date: "31 ก.ค. 2569", time: "11:20", category: "กาแฟ", bay: "A1", osaBefore: 66, osaAfter: 79, gaps: 11, fixed: 7, disputed: false, gps: "13.75386, 100.62215", modelVersion: "shelf-product-v2", capturedByRole: "พนักงานภาคสนาม" },
];

/* ---------------- model health ---------------- */

export const MODEL_METRICS = [
  { id: "recall", label: "Recall — คลาส Empty Shelf", value: 0.914, target: 0.9, trend: 0.006, format: "ratio" as const },
  { id: "precision", label: "Precision — คลาส Empty Shelf", value: 0.871, target: 0.85, trend: -0.004, format: "ratio" as const },
  { id: "override", label: "อัตราการตีกลับจากพนักงาน", value: 0.118, target: 0.1, trend: 0.021, format: "pct" as const },
  { id: "map", label: "mAP@0.5 ทุกคลาส", value: 0.783, target: 0.75, trend: 0.011, format: "ratio" as const },
];

export const DRIFT_SERIES = [
  { week: "W31", value: 0.041 }, { week: "W32", value: 0.038 },
  { week: "W33", value: 0.046 }, { week: "W34", value: 0.052 },
  { week: "W35", value: 0.049 }, { week: "W36", value: 0.058 },
  { week: "W37", value: 0.063 }, { week: "W38", value: 0.071 },
  { week: "W39", value: 0.069 }, { week: "W40", value: 0.082 },
  { week: "W41", value: 0.094 }, { week: "W42", value: 0.108 },
];

export const DRIFT_THRESHOLD = 0.09;

export const MODEL_VERSIONS = [
  { version: "shelf-product-v3", sha: "a1b2c3d4", promotedAt: "02 ส.ค. 2569", active: true, dataset: "th-retail-2026-07", images: 18420 },
  { version: "shelf-product-v2", sha: "9f8e7d6c", promotedAt: "14 มิ.ย. 2569", active: false, dataset: "th-retail-2026-05", images: 12980 },
  { version: "shelf-product-v1", sha: "5a4b3c2d", promotedAt: "03 พ.ค. 2569", active: false, dataset: "th-retail-2026-03", images: 8140 },
];

/* ---------------- relabel queue ---------------- */

export interface RelabelItem {
  id: string;
  reason: "LOW_CONFIDENCE" | "REP_REJECTED";
  rejectedReason?: string;
  confidence: number;
  store: string;
  category: string;
  capturedAt: string;
  selected?: boolean;
}

export const RELABEL_QUEUE: RelabelItem[] = [
  { id: "rl-1", reason: "REP_REJECTED", rejectedReason: "มีของแต่ถูกบัง", confidence: 0.52, store: "มินิบิ๊ก พระราม 9", category: "กาแฟ", capturedAt: "22 ส.ค. 09:14" },
  { id: "rl-2", reason: "LOW_CONFIDENCE", confidence: 0.48, store: "มินิบิ๊ก พระราม 9", category: "กาแฟ", capturedAt: "22 ส.ค. 09:14" },
  { id: "rl-3", reason: "REP_REJECTED", rejectedReason: "ไม่ใช่สินค้าของเรา", confidence: 0.61, store: "ควิกช้อป อ่อนนุช 17", category: "เครื่องดื่ม", capturedAt: "21 ส.ค. 15:31" },
  { id: "rl-4", reason: "LOW_CONFIDENCE", confidence: 0.44, store: "เฟรชมาร์ท ทองหล่อ 25", category: "ขนมขบเคี้ยว", capturedAt: "21 ส.ค. 13:08" },
  { id: "rl-5", reason: "REP_REJECTED", rejectedReason: "เป็นพื้นที่ว่างปกติ", confidence: 0.58, store: "ร้านลุงสมชาย", category: "กาแฟ", capturedAt: "20 ส.ค. 16:44" },
  { id: "rl-6", reason: "LOW_CONFIDENCE", confidence: 0.51, store: "ควิกช้อป ศรีนครินทร์ 42", category: "นม", capturedAt: "20 ส.ค. 11:02" },
  { id: "rl-7", reason: "REP_REJECTED", rejectedReason: "มีของแต่ถูกบัง", confidence: 0.55, store: "มินิบิ๊ก ลาดพร้าว 101", category: "กาแฟ", capturedAt: "19 ส.ค. 10:19" },
  { id: "rl-8", reason: "LOW_CONFIDENCE", confidence: 0.39, store: "เฟรชมาร์ท เอกมัย 12", category: "อาหารสำเร็จรูป", capturedAt: "19 ส.ค. 09:50" },
  { id: "rl-9", reason: "REP_REJECTED", rejectedReason: "ไม่ใช่สินค้าของเรา", confidence: 0.63, store: "ควิกช้อป สุขุมวิท 71", category: "เครื่องดื่ม", capturedAt: "18 ส.ค. 14:27" },
];

/* ---------------- route planning (W4) ---------------- */

export interface PlannedStop {
  storeId: string;
  name: string;
  chain: string;
  risk: "HIGH" | "MEDIUM" | "LOW";
  riskScore: number;
  osa: number;
  daysSince: number;
  distanceKm: number;
  estMinutes: number;
}

export const NEXT_WEEK_PLAN: PlannedStop[] = [
  { storeId: "st-103", name: "มินิบิ๊ก พระราม 9 ซอย 41", chain: "มินิบิ๊ก", risk: "HIGH", riskScore: 92, osa: 68, daysSince: 12, distanceKm: 3.2, estMinutes: 25 },
  { storeId: "st-101", name: "ควิกช้อป อ่อนนุช 17", chain: "ควิกช้อป", risk: "HIGH", riskScore: 87, osa: 74, daysSince: 8, distanceKm: 0.4, estMinutes: 18 },
  { storeId: "st-106", name: "มินิบิ๊ก ลาดพร้าว 101", chain: "มินิบิ๊ก", risk: "HIGH", riskScore: 84, osa: 75, daysSince: 9, distanceKm: 7.8, estMinutes: 22 },
  { storeId: "st-107", name: "เฟรชมาร์ท เอกมัย 12", chain: "เฟรชมาร์ท", risk: "MEDIUM", riskScore: 66, osa: 78, daysSince: 6, distanceKm: 2.4, estMinutes: 20 },
  { storeId: "st-102", name: "เฟรชมาร์ท ทองหล่อ 25", chain: "เฟรชมาร์ท", risk: "MEDIUM", riskScore: 61, osa: 81, daysSince: 5, distanceKm: 1.9, estMinutes: 20 },
  { storeId: "st-105", name: "ควิกช้อป ศรีนครินทร์ 42", chain: "ควิกช้อป", risk: "MEDIUM", riskScore: 55, osa: 85, daysSince: 9, distanceKm: 6.1, estMinutes: 16 },
  { storeId: "st-108", name: "ควิกช้อป สุขุมวิท 71", chain: "ควิกช้อป", risk: "LOW", riskScore: 38, osa: 86, daysSince: 4, distanceKm: 3.7, estMinutes: 15 },
  { storeId: "st-104", name: "ร้านลุงสมชาย ซอยรามคำแหง 24", chain: "ร้านค้าดั้งเดิม", risk: "LOW", riskScore: 34, osa: 89, daysSince: 6, distanceKm: 4.6, estMinutes: 14 },
];
