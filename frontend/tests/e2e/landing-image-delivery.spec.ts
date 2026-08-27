/**
 * Locks — landing image delivery, in a real browser.
 *
 * Two defects measured against `main` @ `149c5c9`, at a 1280x800 viewport:
 *
 * 1. Three photographs shipped without a `sizes` prop, so Next built their
 *    srcset from the declared `width` alone and the browser took the top
 *    bucket: `photo-community.jpeg` served 194,016 bytes at `w=1200` into a
 *    227x170 box, `vision-team-1329.jpg` 172,216 bytes at `w=1920` into
 *    226x170, and `photo-arrival.png` at `w=1920` into 224x168.
 *
 * 2. Issue #705 — the hero carousel loaded 1 of 3 slides in Chromium (WebKit
 *    and Firefox loaded 3/3). The inactive slides are transparent and fully
 *    clipped, and Chromium's lazy-loader declines to fetch an image it reads
 *    as unviewable, so pressing tab 02 revealed an empty frame while the
 *    photo downloaded.
 *
 * The unit lock in `src/app/landing/__tests__/landing-image-delivery.test.tsx`
 * covers the props. This one covers what those props actually cause a browser
 * to fetch, which is the part no jsdom test can see. Both were confirmed red
 * by reverting each fix in turn.
 */
import { test, expect, type Page } from "@playwright/test";

/** The measurement viewport every byte count in this file refers to. */
const VIEWPORT = { width: 1280, height: 800 };

/**
 * A served variant may reasonably exceed the CSS box: the ladder is discrete,
 * and the browser rounds up to the next bucket. It may not exceed it several
 * times over — that is the `sizes`-less failure mode, where a 227px box was
 * answered with `w=1200`.
 */
const MAX_WIDTH_OVERSHOOT = 2;

interface RenderedImage {
  src: string;
  requestedWidth: number | null;
  boxWidth: number;
  loaded: boolean;
}

async function readLandingImages(page: Page): Promise<RenderedImage[]> {
  return page.evaluate((): RenderedImage[] =>
    Array.from(document.querySelectorAll<HTMLImageElement>(".landing-page img")).map((img): RenderedImage => {
      const current = img.currentSrc || img.src || "";
      let requestedWidth: number | null = null;
      if (current.includes("/_next/image")) {
        const raw = new URL(current, window.location.href).searchParams.get("w");
        requestedWidth = raw === null ? null : Number(raw);
      }
      return {
        src: current,
        requestedWidth,
        boxWidth: Math.round(img.getBoundingClientRect().width),
        loaded: img.complete && img.naturalWidth > 0,
      };
    }));
}

/** Walks the page so every lazy image below the fold gets its chance. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async (): Promise<void> => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await new Promise((resolve): void => { setTimeout(resolve, 120); });
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1_500);
}

test.describe("landing image delivery", () => {
  test("no landing photo is served several times wider than its box", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto("/");
    await scrollThrough(page);

    const images = await readLandingImages(page);
    const optimized = images.filter((img): boolean => img.loaded && img.requestedWidth !== null);

    // Guards the guard: an empty list would pass vacuously.
    expect(optimized.length).toBeGreaterThanOrEqual(5);

    const dpr = await page.evaluate((): number => window.devicePixelRatio);
    const oversized = optimized.filter((img): boolean =>
      (img.requestedWidth ?? 0) > img.boxWidth * dpr * MAX_WIDTH_OVERSHOOT + 64);

    expect(oversized.map((img): string => `${img.src} -> w=${img.requestedWidth} for a ${img.boxWidth}px box`)).toEqual([]);
  });

  test("every landing photo that is on screen actually decoded", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto("/");
    await scrollThrough(page);

    // `complete` alone is true for an image that failed; only a non-zero
    // natural width proves bytes arrived and decoded.
    const editorial = await page.evaluate((): boolean[] =>
      Array.from(document.querySelectorAll<HTMLImageElement>(".landing-editorial-media img, .landing-map-inset img"))
        .map((img): boolean => img.complete && img.naturalWidth > 0));

    expect(editorial.length).toBe(3);
    expect(editorial).toEqual([true, true, true]);
  });

  test("the hero never reveals a slide the browser has not fetched (issue #705)", async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto("/");

    const slideLoaded = (index: number): Promise<boolean> =>
      page.evaluate((i): boolean => {
        const img = document.querySelector<HTMLImageElement>(`img[data-slide="${i}"]`);
        return !!img && img.complete && img.naturalWidth > 0;
      }, index);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);

    // The first slide is `priority`, and the second is released once the page
    // goes idle — so by the time anyone can press tab 02, it is already there.
    await expect.poll(() => slideLoaded(0), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => slideLoaded(1), { timeout: 15_000 }).toBe(true);

    // The reveal itself: no waiting between the press and the assertion. On
    // `main` this is the step that fails — slide 1 is still at naturalWidth 0.
    await tabs.nth(1).click();
    expect(await slideLoaded(1)).toBe(true);

    // That first interaction releases the rest, so the same holds for 03.
    await expect.poll(() => slideLoaded(2), { timeout: 15_000 }).toBe(true);
    await tabs.nth(2).click();
    expect(await slideLoaded(2)).toBe(true);
  });
});
