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
    };
  }
}

export async function installCameraAudit(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async (constraints) => {
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
    };
  });
}

/** How many camera tracks the page is still holding open. */
export async function liveTrackCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__cameraAudit?.liveCount() ?? 0);
}

/** Ends every track the page was granted, the way the OS does on app switch. */
export async function killCameraTracks(page: Page): Promise<void> {
  await page.evaluate(() => window.__cameraAudit?.stopAll());
}
