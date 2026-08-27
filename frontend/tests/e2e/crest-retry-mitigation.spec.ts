/**
 * Verifies `waitForCrestToRender` (issue #681's mitigation) against the
 * exact failure mode it was written for — a `/_next/image` request that
 * never returns a response — without depending on that real Next.js hang
 * actually happening. The hang was never reproduced on demand (see
 * `helpers/wait-for-crest.ts`'s doc comment for the full trail), so this
 * simulates it directly with `page.route`, which we DO control.
 *
 * Two things need proving, and neither is optional:
 *   1. A request that hangs once, then succeeds on a fresh navigation,
 *      should not fail the test — that's the whole point of retrying.
 *   2. A request that hangs on EVERY attempt should still fail the test —
 *      otherwise this "mitigation" would just be the old bug wearing a
 *      passing test as a disguise.
 */
import { test, expect } from "@playwright/test";
import { waitForCrestToRender } from "./helpers/wait-for-crest";

/** The exact URL issue #681's CI trace recorded as `status: -1, time: -1`. */
const isHungCrestRequest = (url: URL): boolean =>
  url.pathname === "/_next/image" &&
  url.searchParams.get("url") === "/brand/cata-club-logo-avatar.png" &&
  url.searchParams.get("w") === "96";

test.describe("crest retry mitigation (issue #681)", () => {
  test("survives one hung request and still verifies a real load", async ({ page }) => {
    let interceptCount = 0;
    await page.route(isHungCrestRequest, async (route) => {
      interceptCount += 1;
      if (interceptCount === 1) {
        // Simulate the documented hang: never `fulfill`, never `abort`, never
        // `continue`. The request just sits there, exactly like the real
        // trace's `status: -1, time: -1` entry.
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const drawn = await waitForCrestToRender(page, { maxAttempts: 3, perAttemptTimeoutMs: 4_000 });

    // The real assertion, unweakened: the crest actually rendered.
    expect(drawn.naturalWidth).toBeGreaterThan(0);
    expect(drawn.renderedWidth).toBeGreaterThan(0);
    // And it got there by actually retrying, not by luck on the first try.
    expect(interceptCount).toBeGreaterThanOrEqual(2);
  });

  test("still fails when the crest never loads across every attempt", async ({ page }) => {
    await page.route(isHungCrestRequest, () => {
      // Never resolves, on any attempt — the permanent-hang case the module
      // doc's masking caveat is about.
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const drawn = await waitForCrestToRender(page, { maxAttempts: 2, perAttemptTimeoutMs: 3_000 });

    // The crest genuinely never loaded, so the SAME assertion the real test
    // makes must throw — proving the mitigation degrades to a real failure
    // rather than passing vacuously.
    expect(() => expect(drawn.naturalWidth).toBeGreaterThan(0)).toThrow();
    expect(drawn.naturalWidth).toBe(0);
  });
});
