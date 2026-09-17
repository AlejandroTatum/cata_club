import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";

/**
 * Next.js default `images.deviceSizes` / `images.imageSizes`
 * (https://nextjs.org/docs/app/api-reference/components/image#devicesizes).
 * `next.config.js` does not override either list, so these ARE the values
 * `next/image` resolves against. If that ever changes, this list needs to
 * change with it — nothing here reads the live config, on purpose: the
 * warm-up below runs from a plain Node context before Next has finished
 * booting, too early to safely load `next.config.js` a second time.
 */
const DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];
const ALL_SIZES = [...DEVICE_SIZES, ...IMAGE_SIZES].sort((a, b) => a - b);

/** `HeroCarousel.tsx`'s `sizes` prop, shared by all three hero slides. */
const HERO_SIZES = "(max-width: 768px) 100vw, 60vw";

/** Same `quality` every hero slide renders with (`HeroCarousel.tsx`). */
const HERO_QUALITY = 90;

/**
 * The exact candidate widths `next/image`'s own `getWidths` produces for
 * `HERO_SIZES` (`node_modules/next/dist/shared/lib/get-img-props.js`): with
 * a `vw` unit present, it takes the smallest percentage (60), and returns
 * every size at or above `DEVICE_SIZES[0] * 0.6`. Reproduced here instead of
 * imported — `get-img-props.js` is a Next.js internal module path, not a
 * public export, and the arithmetic is a handful of lines that only change
 * if `HERO_SIZES` or the size lists above do.
 */
function heroCandidateWidths(): number[] {
  const smallestRatio = Math.min(
    ...Array.from(HERO_SIZES.matchAll(/(^|\s)(1?\d?\d)vw/g), (match) => Number(match[2])),
  ) * 0.01;
  return ALL_SIZES.filter((size) => size >= DEVICE_SIZES[0] * smallestRatio);
}

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
 * ## The fix
 *
 * Make the server itself the first requester, over its own loopback
 * connection — a connection nothing can navigate away from. By the time a
 * released hero slide's `<img>` asks for its bytes, they are already on
 * disk (`.next/cache/images`) and `ResponseCache` serves them straight from
 * there; the vulnerable "first ever optimization, on someone else's socket"
 * code path never runs for these three photos, for any visitor.
 *
 * Deliberately not awaited by the caller: this must never delay "Ready" or
 * crash the process if the warm-up itself fails for any reason (offline
 * build, a locked cache directory) — a missed warm-up only returns this
 * file's bug, not a new one.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || warmed) return;
  warmed = true;
  void warmHeroImageCache().catch((error: unknown) => {
    console.error("[instrumentation] hero image cache warm-up failed:", error);
  });
}

/**
 * Waits for the server's own HTTP listener to accept connections, then
 * requests every hero photo at every width Next.js could plausibly ask for.
 * Runs in the background; never throws past its own catch below.
 */
async function warmHeroImageCache(): Promise<void> {
  const port = process.env.PORT ?? "3000";
  const host = process.env.HOSTNAME ?? "127.0.0.1";
  const base = `http://${host}:${port}`;
  const widths = heroCandidateWidths();

  await waitUntilListening(base);

  for (const photo of HERO_PHOTOS) {
    for (const width of widths) {
      const url = `${base}/_next/image?url=${encodeURIComponent(photo.src)}&w=${width}&q=${HERO_QUALITY}`;
      try {
        const response = await fetch(url);
        // Drain the body: an un-consumed response can keep its connection
        // open, and this loop otherwise never reads it.
        await response.arrayBuffer();
      } catch (error) {
        console.error(`[instrumentation] failed to warm ${url}:`, error);
      }
    }
  }
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
