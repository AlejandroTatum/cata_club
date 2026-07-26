/**
 * Playwright Configuration — Cata Club Admin Frontend
 *
 * Single smoke-test config for the admin flow:
 *   login → dashboard → members page.
 *
 * Uses the production Next.js server via the webServer option.
 * In CI, the workflow builds once before Playwright and this config only starts it.
 * Locally, Playwright builds then starts it.
 *
 * WHICH server the suite talks to is decided in `tests/e2e/e2e-target.ts` and
 * verified by `tests/e2e/global-setup.ts` — read the first for why this no
 * longer defaults to port 3000, and the second for what happens when the
 * target is absent or is not this app. The short version: the suite starts the
 * build it is meant to test, on a port nothing else claims, or it fails.
 */
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, E2E_SERVER_IS_MANAGED } from "./tests/e2e/e2e-target";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "playwright-report" }]],

  /* Runs before any browser is launched: a wrong or absent target stops the
     run here, with one message that names the address it probed. */
  globalSetup: "./tests/e2e/global-setup.ts",

  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
  },

  /* Omitted entirely when PLAYWRIGHT_BASE_URL names an external target, so the
     suite never starts a server it was not asked for and then tests a
     different one. */
  webServer: E2E_SERVER_IS_MANAGED
    ? {
        command: process.env.CI
          ? "node .next/standalone/server.js"
          : "pnpm build && node .next/standalone/server.js",
        url: E2E_BASE_URL,
        env: { PORT: String(E2E_PORT), HOSTNAME: "127.0.0.1" },
        /* Never adopt a process this run did not start. Reuse is exactly how
           the suite came to run, green, against a build that predated the
           branch under test. If the port is busy, Playwright says so. */
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
