/**
 * Locks the mechanism behind issue #1300, against the server directly — no
 * browser involved, because the bug lives entirely in `/_next/image`'s
 * server-side request handling.
 *
 * ## The mechanism
 *
 * `/_next/image` shares one in-flight optimization promise per
 * `(href, width, quality)` cache key. The internal fetch that promise awaits
 * reuses the FIRST requester's own TCP socket to serve the file
 * (`next/dist/server/lib/mock-request.js`'s `createRequestResponseMocks`,
 * called from `fetchInternalImage`, passes `socket: _req.socket` — the real
 * socket — into the mocked response it streams the file onto). If that first
 * requester disconnects before the file finishes streaming — exactly what a
 * browser tab does when a Playwright test navigates away, and exactly what
 * any real visitor does by leaving the page — the socket the internal fetch
 * was reusing is already dead, `send` (the static-file streamer) never
 * reaches `finish` on it, and the shared promise never settles: every LATER
 * request for that same key hangs forever, not just the aborted one.
 *
 * Confirmed directly against a `node .next/standalone/server.js` build: an
 * HTTP request aborted ~2 ms after being sent, immediately followed by an
 * identical, un-aborted request, left the second request unanswered past a
 * 10 s bound in a cold `.next/cache/images`.
 *
 * ## Why this does not rely on the hero warm-up (issue #1303)
 *
 * `#1301`/`#1302` closed the CI symptom by warming every hero photo's
 * `/_next/image` cache keys — at `q=90`, the only quality
 * `heroImageWarmupUrls()` (`src/lib/hero-image-cache-warmup.ts`) ever
 * requests — before any spec runs. That made the ORIGINAL version of this
 * test pass for the wrong reason: by the time it sent its "aborted" request,
 * `hero-competition.jpg` at `w=828&q=90` was already a cache HIT, so the
 * request never reached `fetchInternalImage` at all — the abort had nothing
 * to interrupt, and a still-buggy server would have passed this test just as
 * cleanly as a fixed one.
 *
 * This spec asks for `q=91` instead — one integer outside the warm-up's only
 * quality, and never requested by any other code path in this app (every
 * real `<Image>` here renders through `HeroCarousel.tsx` at the same fixed
 * `quality={90}` the warm-up matches). `ImageOptimizerCache.getCacheKey`
 * (`next/dist/server/image-optimizer.js`) folds quality into the cache key,
 * so `q=91` is a cache key `warmHeroImageCache` never touches and no browser
 * ever asks for — this spec's own "aborted" request is unconditionally the
 * FIRST request that key ever sees, whether the warm-up ran, raced, or was
 * removed entirely. That is what makes this a test of the patched mechanism
 * in `fetchInternalImage` rather than of the cache's warm state: it fails
 * the same way with the warm-up left fully enabled as it would with the
 * warm-up deleted outright.
 *
 * ## What this test proves
 *
 * The same photo and width issue #1300's own trace named
 * (`hero-competition.jpg`, `w=828` — the candidate this app's `sizes` prop
 * produces at the landing spec's 1280×800 viewport), at the deliberately
 * unwarmed `q=91`, survives an abort-then-identical-request sequence within
 * a bound far under the flake's 15 s ceiling.
 *
 * The request MUST send the same `Accept` header a real Chromium `<img>`
 * fetch sends: `/_next/image` folds the negotiated output format into its
 * cache key too, so a request with no `Accept` header lands on a different
 * key (served as JPEG) than the one a browser actually reads (served as
 * WebP) — this is exactly the gap that let the #1300 hang survive an
 * earlier version of the warm-up fix: it was warming the JPEG key while
 * every real request asked for the WebP one.
 */
import http from "node:http";
import { test, expect } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

/**
 * The photo and width issue #1300's own trace named, at `q=91` — deliberately
 * one integer outside the hero warm-up's only quality (`q=90`), so this exact
 * cache key is never pre-populated. See the file doc comment's "Why this does
 * not rely on the hero warm-up" section.
 */
const HERO_IMAGE_PATH = "/_next/image?url=%2Flanding%2Fhero-competition.jpg&w=828&q=91";

/** Same `Accept` header a real Chromium `<img>` request sends — see the
 *  file doc comment for why this changes the cache key entirely. */
const CHROMIUM_IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

/** Far under the original 15 s ceiling: a healthy cache-hit answers in tens
 *  of milliseconds, so this only needs enough room for CI's own load. */
const RESOLVE_WITHIN_MS = 5_000;

/**
 * How long the first request is left open before it is torn down —
 * matches the timing that reproduced the hang in manual testing, against an
 * unpatched `node .next/standalone/server.js` reachable through
 * `PLAYWRIGHT_BASE_URL` (`HERO_WARMUP_DISABLED=1` — see `global-setup.ts`).
 * Whether the abort actually catches `fetchInternalImage` mid-stream on the
 * unpatched server also depends on how "hot" the route's own JIT/OS-cache
 * state already is (not only on this delay or on the cache key), which is
 * why reproducing #1300 locally needs the warm-up disabled: the full
 * warm-up narrows the same window this spec relies on to close reliably.
 */
const ABORT_AFTER_MS = 2;

function get(path: string, options: { abortAfterMs?: number } = {}): Promise<{ settled: boolean; status?: number }> {
  const url = new URL(path, E2E_BASE_URL);
  return new Promise((resolve) => {
    const req = http.get(url, { headers: { accept: CHROMIUM_IMAGE_ACCEPT } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ settled: true, status: res.statusCode }));
    });
    req.on("error", () => resolve({ settled: true }));
    if (options.abortAfterMs !== undefined) {
      setTimeout(() => req.destroy(), options.abortAfterMs);
    }
  });
}

test.describe("hero image optimizer survives an aborted first request (issue #1300)", () => {
  test("a request identical to one that was just aborted still resolves", async () => {
    // The abort itself: this request is intentionally torn down mid-flight,
    // the same way a browser tab does when a test navigates away from it.
    const aborted = get(HERO_IMAGE_PATH, { abortAfterMs: ABORT_AFTER_MS });

    // The regression: another request for the IDENTICAL cache key, sent
    // right after. On the buggy server this is the one that hangs.
    const second = get(HERO_IMAGE_PATH);

    await aborted;

    const outcome = await Promise.race([
      second.then((result) => ({ ...result, timedOut: false as const })),
      new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), RESOLVE_WITHIN_MS)),
    ]);

    expect(outcome.timedOut, `the second request for ${HERO_IMAGE_PATH} never resolved within ${RESOLVE_WITHIN_MS}ms after the first was aborted — the #1300 hang reproduced`).toBe(false);
    if (!outcome.timedOut) {
      expect(outcome.status).toBe(200);
    }
  });
});
