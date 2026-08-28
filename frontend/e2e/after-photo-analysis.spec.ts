import { test, expect, seedSession, walkToCompare } from "./fixtures/test";

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
