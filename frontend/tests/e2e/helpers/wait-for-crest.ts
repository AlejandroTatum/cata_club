/**
 * Retry mitigation for `landing.spec.ts`'s "carries the club crest on the
 * paddle face" test — issue #681.
 *
 * ## What this tolerates, and what it does not fix
 *
 * A real CI run on this repo (`33028367971`, on branch `fix/flaky-crest-e2e`,
 * a branch that does not touch this asset's markup at all) failed that test
 * with `Test timeout of 30000ms exceeded`. Downloading and reading the
 * Playwright trace directly (`0-trace.network`, the HAR-like per-request log)
 * showed the actual cause: eight `/_next/image` requests fired in the same
 * millisecond all completed in under 40ms, except one —
 *
 *   `/_next/image?url=%2Fbrand%2Fcata-club-logo-avatar.png&w=96&q=75`
 *
 * — which the trace recorded as `status: -1, time: -1`: it never returned a
 * response at all. `test.trace` confirms the test was genuinely blocked
 * waiting on that exact image's `load` event, not stuck resolving a locator.
 * That URL is the shared 1x srcset candidate the navbar and hero paddle both
 * request (both render the crest at `width={84}`).
 *
 * This is an intermittent, server-side hang in Next.js 14.2's built-in
 * `/_next/image` route for one specific cache key. It was NOT reproduced
 * on demand locally — not via CPU throttling, not via a 546-request
 * synthetic burst, not via 60 truly-concurrent identical requests for that
 * exact cache key — so there is no verified fix for the hang itself. See
 * issue #681 for the full investigation and trace evidence; it stays open,
 * tracking the underlying Next.js bug, closed here only as *mitigated*.
 *
 * ## What this DOES do
 *
 * It gives the crest more than one independent chance to load: on any
 * attempt that doesn't reach `naturalWidth > 0` within its own bounded
 * budget, it reloads the page — a fresh navigation, which is a fresh network
 * request — and tries again, up to `maxAttempts` times. It never awaits a
 * single promise that can hang forever the way the original
 * `locator.evaluate(() => ... new Promise(...))` did; every check is a cheap,
 * synchronous read of `image.complete`/`image.naturalWidth`, polled from the
 * outside via `expect.poll`, so a request that never resolves can no longer
 * block the test past that attempt's own timeout.
 *
 * If the crest never loads across every attempt, this function does NOT
 * throw — it returns the real (zero) measurement from the last attempt, so
 * the caller's own `naturalWidth > 0` assertion is what fails. That keeps
 * the test honest: it still asserts the crest actually renders, and it still
 * fails for real if that never happens.
 *
 * ## The risk this accepts
 *
 * This mitigation assumes the hang is transient and Next-side — unlucky on
 * one request, unlikely to repeat identically on a fresh navigation. If the
 * hang were ever caused by something deterministic in THIS app instead (a
 * route, a middleware, app code that reliably breaks one specific request),
 * retrying would just as reliably paper over it, and the test would keep
 * passing while quietly eating multiple reloads every run. Nothing here
 * detects that difference. See the PR that introduced this mitigation for
 * the explicit tradeoff the product owner accepted.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export interface CrestRenderResult {
  naturalWidth: number;
  renderedWidth: number;
}

export interface WaitForCrestOptions {
  /** How many independent (page-reload-separated) chances the crest gets. */
  maxAttempts?: number;
  /** Budget for a single attempt's `expect.poll`, in milliseconds. */
  perAttemptTimeoutMs?: number;
}

const CREST_SELECTOR = "[data-serve-paddle] img";

/**
 * Waits for the hero paddle's crest to actually render, retrying across
 * fresh page loads instead of trusting a single load-event promise. See the
 * module doc above for why, and for what this does and does not guarantee.
 */
export async function waitForCrestToRender(
  page: Page,
  { maxAttempts = 3, perAttemptTimeoutMs = 8_000 }: WaitForCrestOptions = {},
): Promise<CrestRenderResult> {
  const crest: Locator = page.locator(CREST_SELECTOR);
  const readState = () =>
    crest.evaluate((image: HTMLImageElement) => ({
      naturalWidth: image.naturalWidth,
      renderedWidth: image.getBoundingClientRect().width,
    }));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      // A fresh navigation is a fresh network request for every resource on
      // the page, including this one. Retrying against the SAME page would
      // just re-await whatever the previous attempt was already waiting on.
      await page.reload();
    }

    await expect(crest).toHaveAttribute("src", /cata-club-logo-avatar/);
    await crest.evaluate((image: HTMLImageElement) => image.scrollIntoView({ block: "center" }));

    try {
      await expect
        .poll(
          () =>
            crest.evaluate(
              (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
            ),
          { timeout: perAttemptTimeoutMs, intervals: [250, 500, 1_000, 2_000] },
        )
        .toBe(true);
    } catch {
      // This attempt's budget ran out without the crest loading. Move on to
      // the next attempt (a fresh reload) rather than keep polling a request
      // that has already had its fair chance.
      continue;
    }

    return readState();
  }

  // Every attempt exhausted its budget. Return the real (zero) measurement
  // — see the module doc: this function mitigates a hang, it does not
  // launder one, so the caller's own assertion is what fails here.
  return readState();
}
