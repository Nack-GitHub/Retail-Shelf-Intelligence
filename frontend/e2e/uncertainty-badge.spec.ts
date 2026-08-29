import { CAPTURE_ID } from "./fixtures/api";
import { expect, seedSession, test, walkToResult } from "./fixtures/test";

/* The "ต้องตรวจสอบ" badge is an instruction to go and decide something, so it
   belongs on gaps and nothing else. `is_low_confidence` is set on every kind of
   detection, and on a real bay photo most of the boxes under the threshold are
   products and price tags — badging all of them buried the shelf under labels
   the rep could not act on.

   These two cases sit either side of that line, and the fixture below is the
   one thing the shared stub cannot express: it needs an uncertain PRODUCT and
   an uncertain GAP in the same photo. */

const LOW_CONF_ANALYSIS = {
  captureId: CAPTURE_ID,
  modelVersion: "test-v1",
  imageUrl: null,
  imageWidth: 1920,
  imageHeight: 1080,
  rowCount: 1,
  gapRatio: 0.2,
  osaScore: 0.8,
  status: "LOW",
  inferenceMs: 700,
  lowConfidenceCount: 2,
  lowConfidenceThreshold: 0.55,
  detections: [
    {
      detectionId: "det-sure-product",
      classId: 0,
      className: "product",
      semanticType: "PRODUCT",
      bbox: { x: 20, y: 60, w: 200, h: 300 },
      confidence: 0.94,
      shelfRowIndex: 1,
    },
    {
      detectionId: "det-unsure-product",
      classId: 0,
      className: "product",
      semanticType: "PRODUCT",
      bbox: { x: 260, y: 60, w: 200, h: 300 },
      confidence: 0.41,
      shelfRowIndex: 1,
    },
    {
      detectionId: "det-unsure-tag",
      classId: 31,
      className: "price",
      semanticType: "PRICE_TAG",
      bbox: { x: 260, y: 380, w: 120, h: 40 },
      confidence: 0.44,
      shelfRowIndex: 1,
    },
    {
      detectionId: "det-unsure-gap",
      classId: 19,
      className: "gap",
      semanticType: "GAP",
      bbox: { x: 520, y: 60, w: 200, h: 300 },
      confidence: 0.46,
      shelfRowIndex: 1,
    },
  ],
  gapFindings: [
    {
      id: "finding-low-001",
      detectionId: "det-unsure-gap",
      shelfRowIndex: 1,
      positionLabel: "ชั้นที่ 1 · ตำแหน่งซ้าย",
      confidence: 0.46,
      isLowConfidence: true,
      verificationStatus: "PENDING",
      skuCode: "SKU-1001",
      skuName: "กาแฟกระป๋องทดสอบ 180ml",
      skuBrand: "TestBrand",
      priority: 1,
      facings: 2,
    },
  ],
};

/** Registered inside the test body so it takes precedence over the shared
 *  stub's catch-all, which Playwright installed first. */
async function stubLowConfidenceResult(page: Parameters<typeof seedSession>[0]) {
  await page.route("**/v1/captures/*/result", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(LOW_CONF_ANALYSIS),
    }),
  );
}

/** The badge is an SVG <text> inside the overlay. Scoping to the SVG matters:
 *  "ต้องตรวจสอบ" is also a filter chip and a count tile on this screen, and a
 *  plain text query would happily match those and pass no matter what. */
const badges = (page: Parameters<typeof seedSession>[0]) =>
  page.locator("svg text", { hasText: "ต้องตรวจสอบ" });

test("only the uncertain gap is badged, not the uncertain product or tag", async ({ page }) => {
  await seedSession(page);
  await stubLowConfidenceResult(page);
  await walkToResult(page);

  await expect(badges(page)).toHaveCount(1);
});

test("the count tile agrees with the number of badges on the photo", async ({ page }) => {
  await seedSession(page);
  await stubLowConfidenceResult(page);
  await walkToResult(page);

  // One uncertain finding, one badge. The tile counts findings and the overlay
  // used to draw every uncertain detection, so these two disagreed by three.
  await expect(page.getByText("มี 1 จุดที่ระบบไม่มั่นใจ")).toBeVisible();
  await expect(badges(page)).toHaveCount(1);
});
