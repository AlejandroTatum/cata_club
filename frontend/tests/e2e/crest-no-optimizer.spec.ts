/**
 * Lock — issue #681: the club crest must never go through Next's built-in
 * `/_next/image` optimizer, on any page that renders it.
 *
 * ## Why a lock instead of another retry
 *
 * Two previous attempts at #681 tried to survive the optimizer's hang
 * (PR #682 reduced how much of it the app asked for; PR #687 retried the
 * test around it) and both were disproven by real CI evidence, not by
 * reasoning. The CI trace that finally explained it (run `33032824372`)
 * showed the SAME `/_next/image` request —
 *
 *   `/_next/image?url=%2Fbrand%2Fcata-club-logo-avatar.png&w=96&q=75`
 *
 * — returning `status: -1` (no response, ever) on THREE separate fresh
 * page loads, ~8s apart, in the same CI job's Node process, while a
 * sibling cache key (`w=128`, same asset) succeeded instantly every time.
 * The hang is scoped to the server-side cache key for the life of that
 * process, not to an individual request, so no client-side retry —
 * `page.reload()` included — can ever outrun it.
 *
 * The fix that follows is: never create that cache key. The crest is now
 * served as a pre-sized static file with `unoptimized`, so no consumer
 * ever asks `/_next/image` for it. This lock is what makes that
 * verifiable without reproducing the hang itself — it doesn't need the
 * bug to fire to prove the app no longer depends on the route that has
 * it. Run against `main` before this fix, it fails: every crest consumer
 * there requests `/_next/image`. That failure is the proof this lock is
 * actually checking something.
 */
import { test, expect, type Page } from "@playwright/test";

/** Matches an optimizer request for the crest under either filename it has
 *  ever had, so this lock also catches a future regression that swaps the
 *  asset back onto the optimized path under a new name. */
const CREST_THROUGH_OPTIMIZER = (url: string): boolean =>
  url.includes("/_next/image") && (url.includes("cata-club-logo-avatar") || url.includes("cata-club-crest"));

function trackCrestOptimizerRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (CREST_THROUGH_OPTIMIZER(request.url())) hits.push(request.url());
  });
  return hits;
}

test.describe("crest never requests the image optimizer (issue #681)", () => {
  test("landing page: navbar, hero paddle, and Motto paddle", async ({ page }) => {
    const hits = trackCrestOptimizerRequests(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    // The hero paddle crest is above the fold and loads on its own; the
    // Motto paddle crest is below it and needs a scroll to come into view
    // (and, on `main`, to fire its lazy-loaded optimizer request) before its
    // absence can be asserted honestly.
    await page.locator("[data-serve-paddle] img").waitFor();
    await page.locator("[data-motto-paddle] img").scrollIntoViewIfNeeded();
    // Give any in-flight request a moment to actually reach the network
    // layer before reading the tally.
    await page.waitForTimeout(1_000);

    expect(hits).toEqual([]);
  });

  test("chat launcher (any page) and panel avatar (once opened)", async ({ page }) => {
    const hits = trackCrestOptimizerRequests(page);

    await page.goto("/login");
    const launcher = page.getByRole("button", { name: /Abrir CATA-BOT/i });
    await expect(launcher).toBeVisible({ timeout: 20_000 });
    await launcher.click();
    await expect(page.locator('div[role="dialog"][aria-label*="CATA-BOT"]')).toBeVisible();
    await page.waitForTimeout(1_000);

    expect(hits).toEqual([]);
  });
});
