import { test, expect, seedSession, walkToCompare, AFTER_PHOTO_CTA } from "./fixtures/test";
import { STORE_ID } from "./fixtures/api";

test("moving on from a finished visit does not flash a closed-visit notice", async ({ page }) => {
  await seedSession(page);
  await walkToCompare(page);
  await page.getByRole("button", { name: "ถ่ายภาพ" }).click();
  await page.getByRole("button", { name: /^สรุปและเช็คเอาต์/ }).click();
  await page.waitForURL(`**/m/store/${STORE_ID}/checkout`);

  const guard = page.getByText("การเข้าร้านนี้ปิดแล้ว");
  await page.getByRole("button", { name: /ร้านถัดไป|จบงานวันนี้|กลับหน้าเส้นทาง/ }).first().click();

  // Leaving discards the visit, and the guard reads the visit. The rep must not
  // be told the shop they just finished is closed on the way to the next one.
  await expect(guard).toBeHidden({ timeout: 2000 });
  await page.waitForURL(/\/m\/store\/store-002\/checkin$|\/m$/);
});
