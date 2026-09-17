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
 * 10 s bound in a cold `.next/cache/images`. `instrumentation.ts` closes it
 * by making the SERVER itself the first requester of every hero photo, over
 * its own loopback connection — nothing can navigate away from that one —
 * before any browser gets the chance.
 *
 * ## What this test proves
 *
 * The exact photo, width and quality issue #1300's own trace named
 * (`hero-competition.jpg`, `w=828`, `q=90` — the candidate this app's
 * `sizes` prop produces at the landing spec's 1280×800 viewport) survives
 * an abort-then-identical-request sequence within a bound far under the
 * flake's 15 s ceiling. Without `instrumentation.ts` (or with a cold image
 * cache), this hangs — reverting it, or deleting
 * `.next/standalone/.next/cache/images` right before this spec runs,
 * reproduces the failure this locks against.
 */
import http from "node:http";
import { test, expect } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

/** The exact request the #1300 trace named as never answering. */
const HERO_IMAGE_PATH = "/_next/image?url=%2Flanding%2Fhero-competition.jpg&w=828&q=90";

/** Far under the original 15 s ceiling: a healthy cache-hit answers in tens
 *  of milliseconds, so this only needs enough room for CI's own load. */
const RESOLVE_WITHIN_MS = 5_000;

/** How long the first request is left open before it is torn down —
 *  matches the timing that reproduced the hang in manual testing. */
const ABORT_AFTER_MS = 2;

function get(path: string, options: { abortAfterMs?: number } = {}): Promise<{ settled: boolean; status?: number }> {
  const url = new URL(path, E2E_BASE_URL);
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
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
