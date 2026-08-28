import { test, expect, seedSession, walkToCapture } from "./fixtures/test";
import { STORE_ID } from "./fixtures/api";

/* Proves the harness itself works: stubs answer, the app boots, and a rep can
   be walked from the route list to the camera without a backend running. */

test("route list renders the stubbed stores", async ({ page }) => {
  await seedSession(page);
  await page.goto("/m");

  await expect(page.getByText("ShelfMart สาขาทดสอบ 1")).toBeVisible();
  await expect(page.getByText("ShelfMart สาขาทดสอบ 2")).toBeVisible();
});

test("a rep can walk from the route list to the camera", async ({ page }) => {
  await seedSession(page);
  await walkToCapture(page);

  await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/capture$`));
});

test("no endpoint the mobile flow uses is left unstubbed", async ({ page }) => {
  const unstubbed: string[] = [];
  page.on("response", (res) => {
    if (res.status() === 501) unstubbed.push(res.url());
  });

  await seedSession(page);
  await walkToCapture(page);

  expect(unstubbed).toEqual([]);
});
