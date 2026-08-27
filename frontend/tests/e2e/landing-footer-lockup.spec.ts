/**
 * Lock — issue #710: the landing footer lockup must not go through
 * `/_next/image`.
 *
 * ## Why this exists separately from `crest-no-optimizer.spec.ts`
 *
 * PR #692 took the five *crest* consumers off the optimizer so issue #681's
 * poisonable cache key could never be created. That sweep matched on the
 * crest's filenames, and the footer lockup uses a different asset, so it was
 * missed: measured on `main` @ `97ae590` it still resolved to
 *
 *   `/_next/image?url=%2Flanding%2Fcata-club-logo.jpeg&w=64&q=75`
 *   `/_next/image?url=%2Flanding%2Fcata-club-logo.jpeg&w=128&q=75`
 *
 * Both returned 200 when measured — this is residual exposure, not an
 * observed hang. But #681's hang is scoped to a server-side cache key for
 * the life of the Node process, so a key that is never created is the only
 * state that cannot get stuck, and one 52px mark is not worth carrying that
 * risk for.
 *
 * ## Why an e2e test and not a unit assertion
 *
 * Under vitest, `next/image` renders the plain `src` whether or not
 * `unoptimized` is set, so a jsdom assertion about `/_next/image` can never
 * fail and would prove nothing. Only a real Next server rewrites the URL, so
 * only a real server can witness the regression.
 *
 * Run against the pre-fix tree this fails with the two URLs above.
 */
import { test, expect, type Page } from "@playwright/test";

/** Matches an optimizer request for the lockup under either path it has had,
 *  so a future move back onto the optimized route is caught under either
 *  name. */
const LOCKUP_THROUGH_OPTIMIZER = (url: string): boolean =>
  url.includes("/_next/image") && url.includes("cata-club-logo");

function trackLockupOptimizerRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (LOCKUP_THROUGH_OPTIMIZER(request.url())) hits.push(request.url());
  });
  return hits;
}

test.describe("footer lockup never requests the image optimizer (issue #710)", () => {
  test("landing footer: pre-sized, served direct, and actually decoded", async ({ page }) => {
    const hits = trackLockupOptimizerRequests(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    // The footer is below the fold and loads lazily, so the request — which
    // on `main` is the optimizer request — only fires once it is scrolled to.
    const lockup = page.locator(".landing-footer-brand img").first();
    await lockup.scrollIntoViewIfNeeded();
    await expect(lockup).toBeVisible();
    await page.waitForTimeout(1_500);

    expect(hits).toEqual([]);

    const state = await lockup.evaluate((node) => {
      const image = node as HTMLImageElement;
      const box = image.getBoundingClientRect();
      return {
        src: image.currentSrc || image.src,
        // Decoded, not merely "visible": a broken image is visible too.
        decoded: image.complete && image.naturalWidth > 0,
        naturalWidth: image.naturalWidth,
        renderedWidth: Math.round(box.width),
        renderedHeight: Math.round(box.height),
      };
    });

    expect(state.decoded).toBe(true);
    expect(state.src).toContain("/brand/cata-club-logo-176.jpeg");
    expect(state.src).not.toContain("/_next/image");
    // 176 real pixels into a 52 CSS px box: 3.4x, so the mark stays crisp on
    // every mainstream density without the optimizer resizing anything.
    expect(state.naturalWidth).toBe(176);
    expect(state.renderedWidth / state.renderedHeight).toBeCloseTo(1, 1);
    expect(state.naturalWidth / state.renderedWidth).toBeGreaterThanOrEqual(3);
  });
});
