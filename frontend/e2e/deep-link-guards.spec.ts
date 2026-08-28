import { test, expect, seedSession, walkToCapture } from "./fixtures/test";
import { STORE_ID } from "./fixtures/api";

/* Opening a screen with nothing behind it — a reload in the shop, a link
   someone pasted, a back button pressed after the visit closed.

   Not one of these may render an empty screen. The rule the codebase already
   states for data loading (src/lib/api/useResource.ts) holds here too: a blank
   screen that explains nothing is a bug, not a neutral state. */

const STEPS = [
  "checkin",
  "category",
  "capture",
  "processing",
  "result",
  "verify",
  "tasks",
  "compare",
  "checkout",
];

for (const step of STEPS) {
  test(`opening ${step} with no visit says so and offers a way on`, async ({ page }) => {
    await seedSession(page);
    await page.goto(`/m/store/${STORE_ID}/${step}`);

    // Something readable, and something to press. Both, on every screen.
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button").first()).toBeVisible();

    const text = await page.locator("main, body").first().innerText();
    expect(text.trim().length).toBeGreaterThan(10);
  });
}

test("reloading mid-visit lands somewhere the rep can carry on from", async ({ page }) => {
  await seedSession(page);
  await walkToCapture(page);

  await page.reload();

  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button").first()).toBeVisible();
});

test("the camera stays shut until consent is recorded", async ({ page }) => {
  await seedSession(page);
  await page.goto(`/m/store/${STORE_ID}/capture`);

  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.getByRole("button").first()).toBeVisible();
});
