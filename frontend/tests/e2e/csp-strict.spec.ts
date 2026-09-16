/**
 * Strict Content-Security-Policy smoke test (issue #1069, phase 3).
 *
 * The CSP is now generated per request in `src/middleware.ts` with a fresh
 * nonce and `'strict-dynamic'`. This spec pins the two things that matter at
 * the edge:
 *
 *   1. The served document actually carries the enforcing
 *      `Content-Security-Policy` header with a per-request nonce (and that the
 *      nonce differs between two document loads — it is not a static policy).
 *   2. Hydration is still alive under the strict policy: a client-side
 *      interactive element (the landing schedule section, which only appears
 *      after the app fetches /api/schedules) renders and settles. If the
 *      nonce plumbing ever breaks Next's injected RSC/bootstrap scripts, this
 *      stops passing.
 *
 * Local (non-live) spec: no backend needed — the schedule payload is stubbed
 * with `page.route`.
 */

import { test, expect } from "@playwright/test";

function extractNonce(csp: string): string | null {
  const match = csp.match(/'nonce-([^']+)'/);
  return match ? match[1] : null;
}

test.describe("Strict CSP", () => {
  test("serves an enforcing CSP with a per-request nonce and stays hydrated", async ({ page }) => {
    await page.route("**/api/schedules", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { category: "Infantil", ages: "8 a 12 años", blocks: [{ days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "16:00", endTime: "17:00" }] },
        ]),
      })
    );

    const first = await page.goto("/");
    expect(first, "the document response must exist").toBeTruthy();
    const firstCsp = first!.headers()["content-security-policy"] ?? "";
    expect(firstCsp).toContain("strict-dynamic");
    const firstNonce = extractNonce(firstCsp);
    expect(firstNonce, "CSP must carry a nonce").toBeTruthy();

    const second = await page.goto("/");
    const secondCsp = second!.headers()["content-security-policy"] ?? "";
    const secondNonce = extractNonce(secondCsp);
    expect(secondNonce).toBeTruthy();
    expect(secondNonce).not.toEqual(firstNonce);

    // Hydration proof: this section is fetched + rendered by client code that
    // only runs once React boots under the strict policy.
    await expect(page.locator(".landing-schedule-layout")).toBeVisible();
  });
});
