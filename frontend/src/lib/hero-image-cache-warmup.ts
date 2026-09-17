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
      const response = await fetch(url);
      // Drain the body: an un-consumed response can keep its connection
      // open, and this loop otherwise never reads it.
      await response.arrayBuffer();
    } catch (error) {
      console.error(`[hero-image-cache-warmup] failed to warm ${url}:`, error);
    }
  }
}
