import { test, expect, seedSession, walkToCompare } from "./fixtures/test";
import { STORE_ID, VISIT_ID } from "./fixtures/api";

/* The after-photo is what turns a rep's word that the shelf is full into a
   measurement, and it takes two steps the rep cannot see: an upload, then a
   model run on a worker. Check-out reads the analysis the moment it is asked,
   so anything that lets the rep reach it early hands them a summary that says
   nothing was photographed — and a route list that disagrees a few seconds
   later, once the worker catches up. */

test("check-out stays out of reach until the after-photo has been sent", async ({ page }) => {
  await seedSession(page);

  await walkToCompare(page);

  let releaseUpload = () => {};
  const uploadHeld = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  // Registered here rather than up front so it holds the after-photo alone:
  // the walk to this screen goes through the same presign for the before-shot.
  // Holding it is the window a rep on a slow connection actually stands in.
  await page.route("**/v1/captures/presign", async (route) => {
    await uploadHeld;
    await route.fallback();
  });

  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();

  // The shutter swaps the camera for the comparison, and the way on sits under
  // it. It must not be usable while the photograph it summarises is in flight.
  const checkout = page.getByRole("button", { name: /^สรุปและเช็คเอาต์/ });
  await expect(checkout).toBeVisible();
  await expect(checkout).toBeDisabled();

  releaseUpload();
  await expect(checkout).toBeEnabled({ timeout: 15_000 });
});

test("the summary waits for a queued analysis instead of reporting no photo", async ({ page }) => {
  await seedSession(page);

  // The worker is still reading the photograph on the first ask and has
  // finished by the second — the few seconds a rep spends walking to the till.
  let asks = 0;
  await page.route(`**/v1/visits/${VISIT_ID}/checkout`, (route) => {
    asks += 1;
    const pending = asks === 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        visitId: VISIT_ID,
        osaBefore: 0.78,
        osaAfter: pending ? null : 0.94,
        analysisPending: pending,
        tasksTotal: 1,
        tasksFixed: 1,
        tasksBlocked: 0,
        checkedOutAt: new Date().toISOString(),
      }),
    });
  });

  await walkToCompare(page);
  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await page.getByRole("button", { name: /^สรุปและเช็คเอาต์/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/checkout`);

  // Telling a rep they never photographed the shelf they just photographed is
  // the failure this whole round is about — it must not appear, even briefly.
  await expect(page.getByText("ยังไม่ได้ถ่ายภาพหลังเติมของ")).toBeHidden();
  await expect(page.getByText(/กำลังวิเคราะห์ภาพหลังเติมของ/)).toBeVisible();

  await expect(page.getByText("94")).toBeVisible({ timeout: 15_000 });
  expect(asks).toBeGreaterThan(1);
});

test("a summary that never gets its figure says so rather than blaming the rep", async ({
  page,
}) => {
  await seedSession(page);

  // Queued on the first ask, then the server stops answering — a worker that
  // died, or a phone that lost signal on the way to the till.
  let asks = 0;
  await page.route(`**/v1/visits/${VISIT_ID}/checkout`, (route) => {
    asks += 1;
    if (asks > 1) return route.fulfill({ status: 503, body: "" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        visitId: VISIT_ID,
        osaBefore: 0.78,
        osaAfter: null,
        analysisPending: true,
        tasksTotal: 1,
        tasksFixed: 1,
        tasksBlocked: 0,
        checkedOutAt: new Date().toISOString(),
      }),
    });
  });

  await walkToCompare(page);
  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await page.getByRole("button", { name: /^สรุปและเช็คเอาต์/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/checkout`);

  await expect(page.getByText(/ยังวิเคราะห์ภาพหลังเติมของไม่เสร็จ/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("ยังไม่ได้ถ่ายภาพหลังเติมของ")).toBeHidden();
  // The visit is closed either way: the way on must stay open.
  await expect(page.getByRole("button", { name: /ร้านถัดไป|จบงานวันนี้|กลับหน้าเส้นทาง/ }).first()).toBeEnabled();
});
