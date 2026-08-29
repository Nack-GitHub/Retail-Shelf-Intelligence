import { test, expect, seedSession, walkToCompare } from "./fixtures/test";
import { STORE_ID, VISIT_ID } from "./fixtures/api";

/* 72% is the value that catches the two sides drifting apart: the API calls it
   CRITICAL (its floor is 75), while the app used to carry a floor of 70 and
   call the same shelf LOW. Any figure the server has not already classified —
   the after-restock figure here — has to land on the API's answer. */
const OSA_AFTER_BETWEEN_THRESHOLDS = 0.72;

test("an after-restock figure below the API's floor reads as critical, not low", async ({
  page,
}) => {
  await seedSession(page);
  await page.route(`**/v1/visits/${VISIT_ID}/checkout`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        visitId: VISIT_ID,
        osaBefore: 0.78,
        osaAfter: OSA_AFTER_BETWEEN_THRESHOLDS,
        tasksTotal: 1,
        tasksFixed: 1,
        tasksBlocked: 0,
        checkedOutAt: new Date().toISOString(),
      }),
    }),
  );

  await walkToCompare(page);
  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await page.getByRole("button", { name: /^สรุปและเช็คเอาต์/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/checkout`);

  await expect(page.getByText("72")).toBeVisible();
  await expect(page.getByText("วิกฤต", { exact: true })).toBeVisible();
  await expect(page.getByText("ต่ำ", { exact: true })).toBeHidden();
});

test("the route list says which photograph each store's figure came from", async ({ page }) => {
  await seedSession(page);

  // The stubbed stores were last read before a restock, eleven days ago, while
  // the last visit was four days ago — a figure from a shelf nobody has
  // photographed since, which the card used to present as "OSA ครั้งก่อน".
  await page.goto("/m");

  await expect(page.getByText("OSA ล่าสุด").first()).toBeVisible();
  await expect(page.getByText("OSA ครั้งก่อน")).toBeHidden();

  // Both halves of the line: which side of the restock, and that the reading
  // predates the last visit — the case where the figure is nobody's result.
  await expect(page.getByText(/ก่อนเติมของ · วัดเมื่อ 11 วันก่อน/).first()).toBeVisible();
});
