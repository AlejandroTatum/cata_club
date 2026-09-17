import { warmHeroImageCache } from "@/lib/hero-image-cache-warmup";
import { HERO_WARMUP_DISABLE_TOKEN } from "@/lib/hero-warmup-disable-token";

/** Guards against a duplicate run — Next.js dev's Fast Refresh can reload
 *  this module without restarting the process, and this warm-up should only
 *  ever run once per server lifetime. */
let warmed = false;

/**
 * Runs once when the Node.js server process starts:
 * https://nextjs.org/docs/app/guides/instrumentation
 *
 * ## The bug this closes (issue #1300)
 *
 * `/_next/image` shares ONE in-flight optimization promise per
 * `(href, width, quality)` cache key (`Batcher` in
 * `next/dist/lib/batcher.js`, used by `ResponseCache` in
 * `next/dist/server/response-cache/index.js`). The internal fetch that
 * promise awaits reuses the FIRST requester's own TCP socket
 * (`fetchInternalImage` → `createRequestResponseMocks` in
 * `next/dist/server/lib/mock-request.js`, which builds the mocked response
 * with `socket: _req.socket` — the real, original socket). If that first
 * requester's browser tab disconnects — a Playwright test navigating away,
 * or any real visitor leaving the page — before the static file finishes
 * streaming, the socket the internal fetch was reusing is already dead, the
 * `send`-package stream serving `public/landing/*.jpg` never reaches
 * `finish` on that dead socket, and the shared promise never settles: every
 * later request for that SAME key hangs forever, not just the aborted one.
 *
 * Reproduced directly against this server (not through a browser) with a
 * raw HTTP request that aborts after ~2 ms, immediately followed by a
 * second, un-aborted request for the identical URL: the second request
 * never resolved inside a 10 s bound. A key that is already cached never
 * takes this path again — `ResponseCache.get` returns the cached buffer
 * before ever calling `responseGenerator` — so only the very FIRST
 * optimization of a given `(photo, width)` pair is exposed, which lines up
 * with the CI trace: slide 0 (`priority`, always requested before anything
 * else, at page parse) never flaked, and slide 2 (requested 5.7 s later,
 * once the suite's early request burst had quietened) answered in 11 ms.
 *
 * ## Why this alone is not the fix
 *
 * This warm-up is fire-and-forget and races real traffic: nothing blocks
 * the server from accepting connections while it runs. Under CI's own
 * concurrency (4 parallel Playwright workers navigating to the landing page
 * within the first second of the run) the warm-up lost that race on the
 * very first CI run after this file shipped alone — the trace showed the
 * identical `status: -1` signature, for the identical URL, because a real
 * browser's request became the FIRST-ever request for that key before this
 * loop reached it. For CI, the deterministic fix is
 * `tests/e2e/global-setup.ts`, which awaits `warmHeroImageCache` to
 * completion BEFORE Playwright starts any worker — no competing traffic can
 * exist yet, so there is no race to lose. This instrumentation hook stays
 * as defense-in-depth for real deployments, where there is no equivalent
 * "nothing runs until this resolves" gate: it narrows the exposed window
 * from the image's entire cache lifetime to the first moments after a
 * fresh server starts, but does not close it to zero for a real visitor
 * who requests an uncached width in that window and then immediately
 * navigates away.
 *
 * Deliberately not awaited by the caller: this must never delay "Ready" or
 * crash the process if the warm-up itself fails for any reason (offline
 * build, a locked cache directory) — a missed warm-up only returns this
 * file's bug, not a new one.
 *
 * `HERO_WARMUP_DISABLED` skips this step, but only when it holds the exact
 * opaque `HERO_WARMUP_DISABLE_TOKEN` (`@/lib/hero-warmup-disable-token`) —
 * not just any truthy value. `hero-image-optimizer-abort.spec.ts`
 * (issue #1303) sets it verbatim on the isolated child server it spawns for
 * its own reproduction; nothing else in this codebase reads or sets it. A
 * stray `HERO_WARMUP_DISABLED=1` (or `=true`) copy-pasted into a real
 * deployment's environment does not match this token, so it cannot
 * silently disable the one thing keeping every other hero image safe.
 */
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME !== "nodejs" ||
    warmed ||
    process.env.HERO_WARMUP_DISABLED === HERO_WARMUP_DISABLE_TOKEN
  )
    return;
  warmed = true;
  const port = process.env.PORT ?? "3000";
  const host = process.env.HOSTNAME ?? "127.0.0.1";
  const base = `http://${host}:${port}`;
  void waitUntilListening(base)
    .then((): Promise<void> => warmHeroImageCache(base))
    .catch((error: unknown) => {
      console.error("[instrumentation] hero image cache warm-up failed:", error);
    });
}

/** Retries a lightweight request until the server answers or the budget
 *  runs out — `register()` can run before `listen()` has completed. */
async function waitUntilListening(base: string): Promise<void> {
  const attempts = 20;
  const delayMs = 250;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fetch(base, { method: "HEAD" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
