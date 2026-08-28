import { expect, test } from "./fixtures/test";

/* The demo build still works.
 *
 * Gating the reviewer controls behind a flag creates a second configuration
 * that nobody exercises by accident — and a demo that breaks is discovered in
 * front of the audience. Runs only under `npm run test:e2e:demo`. */

test("the sign-in screen offers the seeded accounts", async ({ page }) => {
  await page.goto("/m/login");

  await expect(page.getByLabel("อีเมล")).toHaveValue("rep@shelfeye.demo");
  await expect(page.getByText("เลือกบัญชีสาธิตด่วน")).toBeVisible();
  await expect(page.getByRole("button", { name: /พนักงานตรวจ/ })).toBeVisible();
});

test("the platform launcher renders", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("โหมดสาธิต")).toBeVisible();
  await expect(page.getByRole("heading", { name: /ตรวจช่องว่างบนชั้นวาง/ })).toBeVisible();
});

test("the route screen carries its state switcher", async ({ page }) => {
  await page.goto("/m/login");
  await page.getByLabel("อีเมล").fill("rep@shelfeye.demo");
  await page.getByLabel("รหัสผ่าน").fill("demo1234");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await page.waitForURL("**/m");

  await expect(page.getByText("สาธิตสถานะหน้าจอ")).toBeVisible();
});
