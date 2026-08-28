import { expect, seedSession, test } from "./fixtures/test";

/* The build that ships has no reviewer controls in it.
 *
 * These are not cosmetic assertions. The state switchers can force screens the
 * real system decides — "ไม่พบชั้นวาง" has no other route into it at all, and
 * "GPS ไม่ตรง" overrides a server verdict that ends up in the evidence trail.
 * Hiding those with CSS would leave them one devtools session away; the flag
 * removes them from the bundle, and this file is what proves it stayed removed.
 *
 * Runs against the default dev server, which sets no NEXT_PUBLIC_DEMO_MODE.
 * The mirror suite for a demo build is demo-on.spec.ts. */

const STORE_ID = "st-101";

test("the sign-in screen ships no shared password and no prefilled account", async ({ page }) => {
  await page.goto("/m/login");

  await expect(page.getByLabel("อีเมล")).toHaveValue("");
  await expect(page.getByText("demo1234")).toHaveCount(0);
  await expect(page.getByText("เลือกบัญชีสาธิตด่วน")).toHaveCount(0);
  await expect(page.getByText("v0.9.0 · demo")).toHaveCount(0);
});

test("the platform launcher redirects instead of rendering", async ({ page }) => {
  await page.goto("/");

  await page.waitForURL("**/m/login");
  await expect(page.getByText("โหมดสาธิต")).toHaveCount(0);
});

test("no screen carries a state switcher", async ({ page }) => {
  await seedSession(page);

  for (const path of ["/m", `/m/store/${STORE_ID}/checkin`]) {
    await page.goto(path);
    await expect(page.getByText("สาธิตสถานะหน้าจอ")).toHaveCount(0);
  }
});

test("the check-in screen cannot be made to claim a GPS mismatch", async ({ page }) => {
  await seedSession(page);
  await page.goto(`/m/store/${STORE_ID}/checkin`);

  await expect(page.getByRole("button", { name: "GPS ไม่ตรง" })).toHaveCount(0);
  await expect(page.getByText("พิกัดไม่ตรงกับที่ตั้งร้าน")).toHaveCount(0);
});

test("the capture log is not reachable", async ({ page }) => {
  await seedSession(page);
  await page.goto("/m/captures");

  // Handed over to the screen that answers the question a rep actually has,
  // rather than 404ing on a link somebody bookmarked during a demo.
  await page.waitForURL("**/m/sync");
  await expect(page.getByText("capture id")).toHaveCount(0);
});

test("the dashboard does not tell a rep to sign in as a seeded account", async ({ page }) => {
  await seedSession(page);
  await page.goto("/w");

  // The signed-in rep's own address is shown, and on a real deployment that is
  // whatever their address is — so the assertion is about the instruction, not
  // about the string "shelfeye.demo" appearing anywhere on the page.
  await expect(page.getByText("manager@shelfeye.demo")).toHaveCount(0);
  await expect(page.getByText("admin@shelfeye.demo")).toHaveCount(0);
  await expect(page.getByText("กรุณาติดต่อผู้ดูแลระบบขององค์กร")).toBeVisible();
});
