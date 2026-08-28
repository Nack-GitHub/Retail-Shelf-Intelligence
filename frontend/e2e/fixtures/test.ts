import { test as base, expect, type Page } from "@playwright/test";
import { installApiStubs, STORE_ID } from "./api";

/* Every test gets the API stubs installed before its first navigation, and a
   handful of helpers for reaching a given screen. Walking the UI to get there
   (rather than seeding state) is deliberate: the thing under test IS how state
   and history accumulate on the way. */

export const test = base.extend<{ stubs: Awaited<ReturnType<typeof installApiStubs>> }>({
  // `auto` because a test that forgets to ask for the stubs does not fail — it
  // silently reaches the dev server's rewrite, gets a connection refused, and
  // reports a routing bug that is really a missing fixture.
  stubs: [
    async ({ page }, use) => {
      const state = await installApiStubs(page);
      await use(state);
    },
    { auto: true },
  ],
});

export { expect };

const TOKEN_KEY = "shelfeye.token";
const EXPIRY_KEY = "shelfeye.token.expiresAt";

/** Puts a valid token in sessionStorage so a test can start past the login
 *  screen. Tests that are *about* logging in should use the form instead. */
export async function seedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ([tokenKey, expiryKey]) => {
      window.sessionStorage.setItem(tokenKey, "test-token");
      window.sessionStorage.setItem(expiryKey, String(Date.now() + 3600_000));
    },
    [TOKEN_KEY, EXPIRY_KEY],
  );
}

export async function loginThroughForm(page: Page): Promise<void> {
  await page.goto("/m/login");
  await page.getByLabel("อีเมล").fill("rep@shelfeye.demo");
  await page.getByLabel("รหัสผ่าน").fill("demo1234");
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page.waitForURL("**/m");
}

export async function openStore(page: Page): Promise<void> {
  await page.goto("/m");
  await page.getByRole("button", { name: /ShelfMart สาขาทดสอบ 1/ }).first().click();
  await page.waitForURL(`**/m/store/${STORE_ID}/checkin`);
}

/** Ticks the photo-consent box and checks in. The consent box is visually a
 *  card, so the click has to land on the label rather than the sr-only input. */
export async function checkIn(page: Page): Promise<void> {
  await page.getByText("ได้รับอนุญาตจากร้านให้ถ่ายภาพแล้ว").click();
  await page.getByRole("button", { name: "เริ่มตรวจชั้นวาง" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/category`);
}

/** Route list → check-in → category → capture, the way a rep gets there. */
export async function walkToCapture(page: Page): Promise<void> {
  await openStore(page);
  await checkIn(page);
  await page.getByRole("button", { name: /^เปิดกล้อง/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/capture`);
}

/** True once the viewfinder is actually painting frames, not merely mounted. */
export async function cameraIsLive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector("video");
    if (!el) return false;
    const stream = el.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    return (
      !!stream &&
      track?.readyState === "live" &&
      el.readyState >= 2 &&
      el.videoWidth > 0
    );
  });
}

export async function expectCameraLive(page: Page, timeout = 8000): Promise<void> {
  await expect
    .poll(() => cameraIsLive(page), {
      timeout,
      message: "viewfinder never started painting frames",
    })
    .toBe(true);
}

/* ---- camera track audit ----
   A camera track that outlives the screen that opened it keeps the hardware
   busy, and the next getUserMedia fails with NotReadableError. Nothing in the
   DOM reveals an orphaned track, so getUserMedia is wrapped to keep a census. */

declare global {
  interface Window {
    __cameraAudit?: {
      liveCount: () => number;
      granted: number;
      stopAll: () => void;
      breakDevice: () => void;
    };
  }
}

/** @param grantDelayMs stretches getUserMedia so a test can leave the screen
 *  while the request is still in flight — the window in which a real phone
 *  shows its permission sheet, and the one where tracks get orphaned. */
export async function installCameraAudit(page: Page, grantDelayMs = 0): Promise<void> {
  await page.addInitScript((delay) => {
    const tracks: MediaStreamTrack[] = [];
    let broken = false;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (broken) throw new DOMException("no camera", "NotFoundError");
      const stream = await original(constraints);
      stream.getTracks().forEach((t) => tracks.push(t));
      window.__cameraAudit!.granted += 1;
      return stream;
    };

    window.__cameraAudit = {
      granted: 0,
      liveCount: () => tracks.filter((t) => t.readyState === "live").length,
      // Simulates the OS reclaiming the camera — what iOS does on app switch.
      stopAll: () => tracks.forEach((t) => t.stop()),
      // Simulates the camera going away for good, so recovery cannot succeed
      // and the screen falls back to its no-camera path.
      breakDevice: () => {
        broken = true;
        tracks.forEach((t) => t.stop());
      },
    };
  }, grantDelayMs);
}

/** How many camera tracks the page is still holding open. */
export async function liveTrackCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__cameraAudit?.liveCount() ?? 0);
}

/** How many times getUserMedia has resolved. Waiting on this before counting
 *  live tracks matters: a request still in flight owns no track yet, so the
 *  census would read zero and prove nothing. */
export async function grantedCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__cameraAudit?.granted ?? 0);
}

/** Ends every track the page was granted, the way the OS does on app switch. */
export async function killCameraTracks(page: Page): Promise<void> {
  await page.evaluate(() => window.__cameraAudit?.stopAll());
}

/** Takes the camera away permanently and waits for the screen to give up on
 *  it, so the no-camera path is the one under test.
 *
 *  Waiting on the screen's own message rather than on the track: the track dies
 *  first, and a shutter pressed in between still takes the live path off the
 *  last decoded frame. */
export async function breakCamera(page: Page): Promise<void> {
  await page.evaluate(() => window.__cameraAudit?.breakDevice());
  await expect(page.getByText("ไม่พบกล้องบนอุปกรณ์นี้")).toBeVisible({ timeout: 20_000 });
}

/* ---- deeper walks ----
   These click through the real screens rather than seeding the store, because
   what the navigation tests are checking is precisely what history and visit
   state look like after a rep has walked this path. */

/** Presses the shutter and keeps the shot. */
export async function takePhoto(page: Page): Promise<void> {
  await expectCameraLive(page);
  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await expect(page.getByRole("button", { name: "ใช้ภาพนี้" })).toBeVisible();
}

export async function walkToResult(page: Page): Promise<void> {
  await walkToCapture(page);
  await takePhoto(page);
  await page.getByRole("button", { name: "ใช้ภาพนี้" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/result`, { timeout: 20_000 });
}

export async function walkToTasks(page: Page): Promise<void> {
  await walkToResult(page);
  await page.getByRole("button", { name: "ตรวจสอบทีละจุด" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/verify`);

  await page.getByRole("button", { name: "ใช่ ขาดจริง" }).first().click();
  await page.getByRole("button", { name: "ไปยังรายการที่ต้องทำ" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/tasks`);
}

export async function walkToCompare(page: Page): Promise<void> {
  await walkToTasks(page);
  await page.getByText("กาแฟกระป๋องทดสอบ 180ml").first().click();
  await page.getByRole("button", { name: "เติมของแล้ว" }).click();
  await page.getByRole("button", { name: "ถ่ายภาพหลังเติมของ" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/compare`);
}
