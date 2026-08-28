import { defineConfig, devices } from "@playwright/test";

/* These tests exercise front-end routing and camera lifecycle, so they stub the
   API rather than talking to it (see e2e/fixtures/api.ts). Requiring postgres,
   redis, minio, the API and a worker just to prove that the back button lands on
   the right screen would make this suite the one nobody runs. */

export default defineConfig({
  testDir: "./e2e",
  /* A full walk crosses nine screens and decides eight gaps one at a time, and
     the verification screen deliberately holds each verdict on screen for a
     beat. Thirty seconds is a budget for a unit test, not for that. */
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : [["list"]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    // A rep holds the phone in portrait; the layout only becomes the framed
    // desktop mock above the lg breakpoint, and that frame is not what ships.
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 13.7563, longitude: 100.5018 },
    locale: "th-TH",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        launchOptions: {
          args: [
            // A synthetic camera whose tracks stop and fire "ended" like real
            // hardware — which is exactly what these tests need to reproduce.
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
