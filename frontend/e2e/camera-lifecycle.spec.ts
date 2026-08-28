import {
  test,
  expect,
  seedSession,
  walkToCapture,
  walkToCompare,
  takePhoto,
  expectCameraLive,
  installCameraAudit,
  liveTrackCount,
  grantedCount,
  killCameraTracks,
  breakCamera,
  AFTER_PHOTO_CTA,
} from "./fixtures/test";
import { STORE_ID } from "./fixtures/api";

/* What a rep does all day: open the camera, leave the screen, come back. The
   viewfinder has to be painting frames every single time, and the shot they
   already took has to still be there. */

test("the viewfinder paints frames on the first visit", async ({ page }) => {
  await seedSession(page);
  await walkToCapture(page);

  await expectCameraLive(page);
});

test("the viewfinder comes back after leaving the screen and returning", async ({
  page,
  stubs,
}) => {
  // The screen holds back its markup until the store and category load. On a
  // phone that data is slower than a getUserMedia whose permission was granted
  // on an earlier screen, so the stream is ready before the <video> exists.
  stubs.screenDataDelayMs = 600;

  await seedSession(page);
  await walkToCapture(page);
  await expectCameraLive(page);

  await page.getByRole("button", { name: "ยกเลิกและกลับ" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/category`);

  await page.getByRole("button", { name: /^เปิดกล้อง/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/capture`);

  await expectCameraLive(page);
});

test("the shot taken before leaving is still there on return", async ({ page }) => {
  await seedSession(page);
  await walkToCapture(page);
  await takePhoto(page);

  // Was: click through to the capture log and back. That screen is demo-only
  // now, and page.goto() would not do as a replacement — a full document load
  // clears the in-memory visit, so the shot would be gone for a reason that
  // has nothing to do with the bug. History back/forward is a client-side
  // navigation, which is what the rep's gesture actually is.
  await page.goBack();
  await page.waitForURL(`**/m/store/${STORE_ID}/category`);

  await page.goForward();
  await page.waitForURL(`**/m/store/${STORE_ID}/capture`);

  await expect(page.getByRole("button", { name: "ใช้ภาพนี้" })).toBeVisible();
});

test("leaving while the permission request is in flight does not orphan the camera", async ({
  page,
}) => {
  // Long enough that the screen is left before getUserMedia resolves — the
  // window where a stream comes back to a component that no longer exists.
  await installCameraAudit(page, 1200);
  await seedSession(page);

  await walkToCapture(page);
  await page.getByRole("button", { name: "ยกเลิกและกลับ" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/category`);

  // The abandoned request has to be given the chance to resolve first — a
  // request still in flight owns no track, so counting now proves nothing.
  await expect
    .poll(() => grantedCount(page), { timeout: 8000, message: "camera request never resolved" })
    .toBeGreaterThan(0);

  await expect
    .poll(() => liveTrackCount(page), {
      timeout: 3000,
      message: "a camera track outlived the screen that opened it",
    })
    .toBe(0);

  await page.getByRole("button", { name: /^เปิดกล้อง/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/capture`);
  await expectCameraLive(page, 12_000);
});

test("the viewfinder recovers when the system takes the camera away", async ({ page }) => {
  await installCameraAudit(page);
  await seedSession(page);
  await walkToCapture(page);
  await expectCameraLive(page);

  await killCameraTracks(page);

  await expectCameraLive(page, 12_000);
});

test("the viewfinder recovers after the app comes back to the foreground", async ({ page }) => {
  await installCameraAudit(page);
  await seedSession(page);
  await walkToCapture(page);
  await expectCameraLive(page);

  await killCameraTracks(page);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expectCameraLive(page, 12_000);
});

test("the shutter works as soon as the viewfinder is live", async ({ page }) => {
  await seedSession(page);
  await walkToCapture(page);
  await expectCameraLive(page);

  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();

  await expect(page.getByRole("button", { name: "ใช้ภาพนี้" })).toBeVisible();
  await expect(page.getByText("ถ่ายภาพไม่สำเร็จ ลองอีกครั้ง")).toBeHidden();
});

test("backing out mid-shutter does not record an after-photo that was never taken", async ({
  page,
}) => {
  await installCameraAudit(page);
  await seedSession(page);
  await walkToCompare(page);
  await expectCameraLive(page);

  // With no camera the shutter falls back to a delayed stand-in rather than a
  // real photograph, and that delay is what a rep can walk out of.
  await breakCamera(page);

  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await page.goBack();
  await page.waitForURL(`**/m/store/${STORE_ID}/tasks`);

  await page.getByRole("button", { name: AFTER_PHOTO_CTA }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/compare`);

  // Still the capture screen: nothing was photographed, so there is nothing
  // to compare and the shutter must still be offered.
  await expect(page.getByRole("button", { name: "ถ่ายภาพ" })).toBeVisible();
});
