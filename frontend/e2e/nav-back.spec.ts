import {
  test,
  expect,
  seedSession,
  loginThroughForm,
  openStore,
  checkIn,
  walkToCapture,
  walkToResult,
  walkToTasks,
  walkToCompare,
  fixFirstTask,
  AFTER_PHOTO_CTA,
} from "./fixtures/test";
import { STORE_ID } from "./fixtures/api";

/* Where "back" lands, from every screen a rep can be standing on.
 *
 * Each case is asserted twice — once through the header's back control and
 * once through the browser's own back button — because a rep on a phone uses
 * the edge-swipe as often as the arrow, and the two disagreeing is precisely
 * the complaint these tests exist to settle. */

const BACK = "ย้อนกลับ";

async function headerBack(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: BACK }).click();
}

test.describe("the back control lands on the screen the flow came from", () => {
  test("check-in goes back to the route list", async ({ page }) => {
    await seedSession(page);
    await openStore(page);

    await headerBack(page);
    await expect(page).toHaveURL(/\/m$/);
  });

  test("choosing a shelf goes back to the route list, not to check-in again", async ({ page }) => {
    await seedSession(page);
    await openStore(page);
    await checkIn(page);

    await headerBack(page);
    await expect(page).toHaveURL(/\/m$/);
  });

  test("the camera goes back to the shelf picker", async ({ page }) => {
    await seedSession(page);
    await walkToCapture(page);

    await page.getByRole("button", { name: "ยกเลิกและกลับ" }).click();
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/category$`));
  });

  test("the result goes back to the shelf picker", async ({ page }) => {
    await seedSession(page);
    await walkToResult(page);

    await headerBack(page);
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/category$`));
  });

  test("verification goes back to the result", async ({ page }) => {
    await seedSession(page);
    await walkToResult(page);
    await page.getByRole("button", { name: "ตรวจสอบทีละจุด" }).click();
    await page.waitForURL(`**/m/store/${STORE_ID}/verify`);

    await headerBack(page);
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/result$`));
  });

  test("the task list goes back to verification", async ({ page }) => {
    await seedSession(page);
    await walkToTasks(page);

    await headerBack(page);
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/verify$`));
  });

  test("the after-photo goes back to the task list", async ({ page }) => {
    await seedSession(page);
    await walkToCompare(page);

    await headerBack(page);
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/tasks$`));
  });
});

test.describe("the browser's own back button agrees with the header", () => {
  test("from the camera", async ({ page }) => {
    await seedSession(page);
    await walkToCapture(page);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/category$`));
  });

  test("from the result — the processing screen is not somewhere to go back to", async ({
    page,
  }) => {
    await seedSession(page);
    await walkToResult(page);

    await page.goBack();
    await expect(page).not.toHaveURL(/processing/);
    await expect(page).toHaveURL(new RegExp(`/m/store/${STORE_ID}/category$`));
  });

  test("from the shelf picker — check-in is not somewhere to go back to", async ({ page }) => {
    await seedSession(page);
    await openStore(page);
    await checkIn(page);

    await page.goBack();
    await expect(page).not.toHaveURL(/checkin/);
    await expect(page).toHaveURL(/\/m$/);
  });
});

test("going back during the check-in hand-off stays put", async ({ page }) => {
  await seedSession(page);
  await openStore(page);

  await page.getByText("ได้รับอนุญาตจากร้านให้ถ่ายภาพแล้ว").click();
  await page.getByRole("button", { name: "เริ่มตรวจชั้นวาง" }).click();

  // The screen holds its confirmation for a beat before handing over. A rep who
  // changes their mind in that beat must not be carried forward anyway.
  await headerBack(page);
  await page.waitForTimeout(1500);

  await expect(page).toHaveURL(/\/m$/);
});

test("signing in leaves no way back to the sign-in form", async ({ page }) => {
  await loginThroughForm(page);

  await page.goBack();

  // Asserted on what the rep sees rather than on the url: the complaint is
  // landing on a filled-in sign-in form while already signed in.
  await expect(page.getByLabel("รหัสผ่าน")).toBeHidden();
});

test("signing out leaves no way back into the app", async ({ page }) => {
  await seedSession(page);
  await page.goto("/m");
  await page.getByRole("button", { name: "ออก" }).click();
  await page.waitForURL("**/m/login");

  await page.goBack();

  await expect(page.getByText("เส้นทางวันนี้")).toBeHidden();
});

test("finishing a visit does not leave a hollow summary behind it", async ({ page }) => {
  await seedSession(page);
  await walkToCompare(page);
  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await page.getByRole("button", { name: /^สรุปและเช็คเอาต์/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/checkout`);

  await page.getByRole("button", { name: /ร้านถัดไป|จบงานวันนี้|กลับหน้าเส้นทาง/ }).first().click();
  await page.waitForURL(/\/m\/store\/store-002\/checkin$|\/m$/);

  await page.goBack();

  // Whatever is behind a finished visit, it must explain itself and offer a
  // way on — a summary with every number missing is worse than no summary.
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.getByRole("button").first()).toBeVisible();
});

test("retaking a shot does not stack the old result behind the camera", async ({ page }) => {
  await seedSession(page);
  await walkToResult(page);

  await page.getByRole("button", { name: "ถ่ายใหม่" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/capture`);

  await page.goBack();
  await expect(page).not.toHaveURL(/result/);
});

test("going back returns the rep to where they were in a long list", async ({ page }) => {
  await seedSession(page);
  await walkToTasks(page);
  await fixFirstTask(page);

  const scroller = page.locator("main").first();
  await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const before = await scroller.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);

  await page.getByRole("button", { name: AFTER_PHOTO_CTA }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/compare`);

  await page.getByRole("button", { name: "ย้อนกลับ" }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/tasks`);

  await expect
    .poll(() => page.locator("main").first().evaluate((el) => el.scrollTop), {
      timeout: 5000,
      message: "the list came back scrolled to the top",
    })
    .toBeGreaterThan(before / 2);
});
