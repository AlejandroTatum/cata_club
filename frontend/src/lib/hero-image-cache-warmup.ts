import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";

/**
 * Next.js default `images.deviceSizes` / `images.imageSizes`
 * (https://nextjs.org/docs/app/api-reference/components/image#devicesizes).
 * `next.config.js` does not override either list, so these ARE the values
 * `next/image` resolves against. If that ever changes, this list needs to
 * change with it.
 */
const DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const IMAGE_SIZES = [16, 32, 48, 64, 96, 128, 256, 384];
const ALL_SIZES = [...DEVICE_SIZES, ...IMAGE_SIZES].sort((a, b) => a - b);

/** `HeroCarousel.tsx`'s `sizes` prop, shared by all three hero slides. */
const HERO_SIZES = "(max-width: 768px) 100vw, 60vw";

/** Same `quality` every hero slide renders with (`HeroCarousel.tsx`). */
const HERO_QUALITY = 90;

/**
 * The `Accept` header a real Chromium `<img>` request sends. `/_next/image`
 * negotiates its OUTPUT FORMAT from this header against `images.formats`
 * (`next.config.js` doesn't override it, so the default is `["image/webp"]`)
 * and folds the negotiated format into the cache key itself
 * (`ImageOptimizerCache.getCacheKey` in
 * `node_modules/next/dist/server/image-optimizer.js`). A plain `fetch()`
 * with no `Accept` header negotiates to NOTHING, so Next serves and caches
 * the original JPEG under a DIFFERENT key than the WebP a real browser asks
 * for — measured directly: the same URL answered `Content-Type: image/jpeg`
 * (`X-Nextjs-Cache: HIT`, our own prior warm request) with no header, and
 * `Content-Type: image/webp` (`X-Nextjs-Cache: MISS`, never warmed) with
 * this one. Without it, this warm-up populates a cache key no real request
 * ever reads, which is exactly why it kept failing to close issue #1300 —
 * the browser's own request was still the first-ever request for the WebP
 * key, exposed to the abort race this file exists to prevent.
 */
const CHROMIUM_IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

/**
 * The exact candidate widths `next/image`'s own `getWidths` produces for
 * `HERO_SIZES` (`node_modules/next/dist/shared/lib/get-img-props.js`): with
 * a `vw` unit present, it takes the smallest percentage (60), and returns
 * every size at or above `DEVICE_SIZES[0] * 0.6`. Reproduced here instead of
 * imported — `get-img-props.js` is a Next.js internal module path, not a
 * public export, and the arithmetic is a handful of lines that only change
 * if `HERO_SIZES` or the size lists above do.
 */
export function heroCandidateWidths(): number[] {
  const smallestRatio = Math.min(
    ...Array.from(HERO_SIZES.matchAll(/(^|\s)(1?\d?\d)vw/g), (match) => Number(match[2])),
  ) * 0.01;
  return ALL_SIZES.filter((size) => size >= DEVICE_SIZES[0] * smallestRatio);
}

/**
 * Every `/_next/image` URL a browser could plausibly request for the three
 * hero photos, against the given base URL (e.g. `http://127.0.0.1:3390`).
 */
export function heroImageWarmupUrls(baseUrl: string): string[] {
  const widths = heroCandidateWidths();
  const urls: string[] = [];
  for (const photo of HERO_PHOTOS) {
    for (const width of widths) {
      urls.push(`${baseUrl}/_next/image?url=${encodeURIComponent(photo.src)}&w=${width}&q=${HERO_QUALITY}`);
    }
  }
  return urls;
}

/**
 * Requests every hero photo at every width `next/image` could ask for,
 * sequentially, over the given base URL — see the doc comment on
 * `register()` in `../../instrumentation.ts` for the mechanism this closes
 * (issue #1300). Awaiting this to completion, from a caller that starts
 * before any other client can reach the server, is what makes the closure
 * deterministic rather than a race — see `tests/e2e/global-setup.ts`.
 */
export async function warmHeroImageCache(baseUrl: string): Promise<void> {
  for (const url of heroImageWarmupUrls(baseUrl)) {
    try {
      // The `Accept` header is not optional: without it this warms a cache
      // key no browser ever reads — see `CHROMIUM_IMAGE_ACCEPT` above.
      const response = await fetch(url, { headers: { accept: CHROMIUM_IMAGE_ACCEPT } });
      // Drain the body: an un-consumed response can keep its connection
      // open, and this loop otherwise never reads it.
      await response.arrayBuffer();
    } catch (error) {
      console.error(`[hero-image-cache-warmup] failed to warm ${url}:`, error);
    }
  }
}
