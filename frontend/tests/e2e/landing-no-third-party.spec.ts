/**
 * Lock — issue #709: loading the landing page must not contact any host but
 * our own, and the map's marker must not come from a CDN.
 *
 * ## What was measured
 *
 * On `main` @ `97ae590`, a single load of `/` at 1440x900 — no scrolling at
 * all — produced **11 requests to third-party hosts**:
 *
 *   - 9 tiles from `a|b|c.tile.openstreetmap.org`
 *   - `https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png`
 *   - `https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png`
 *
 * `#contacto` is at the bottom of the page, so a visitor who reads the hero
 * and leaves still paid all eleven, and their IP still reached two hosts we
 * do not control. The `unpkg` pair was worse than a privacy cost: block that
 * CDN and the map still draws while the pin vanishes without a word.
 *
 * ## What this lock checks
 *
 * Two things, and it needs both — "no requests" alone would also pass for a
 * map that never works again:
 *
 *   1. a plain landing load reaches no third-party host at all;
 *   2. scrolled to `#contacto`, the map really renders — tiles present, and
 *      a marker that decoded (`complete && naturalWidth > 0`, never mere
 *      visibility) from a same-origin URL, positioned inside the canvas.
 *
 * Run against the pre-fix tree, part 1 fails with the eleven URLs above and
 * part 2 fails on the marker's origin.
 */
import { test, expect, type Page } from "@playwright/test";

const SAME_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isThirdParty(url: string): boolean {
  if (!url.startsWith("http")) return false;
  try {
    return !SAME_ORIGIN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function trackThirdPartyRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (isThirdParty(request.url())) hits.push(request.url());
  });
  return hits;
}

test.describe("landing contacts no third party (issue #709)", () => {
  test("a plain landing load reaches no external host", async ({ page }) => {
    const hits = trackThirdPartyRequests(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("[data-serve-paddle] img").waitFor();
    // Long enough that the eager map on `main` has fired its tiles and marker;
    // reading the tally any sooner would let the old behaviour pass.
    await page.waitForTimeout(3_000);

    expect(hits).toEqual([]);
  });

  test("scrolled to #contacto the map still renders, pinned from our own origin", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    await page.locator("#contacto").scrollIntoViewIfNeeded();

    const marker = page.locator(".leaflet-marker-icon").first();
    await marker.waitFor({ timeout: 30_000 });
    await expect(page.locator(".leaflet-container")).toBeVisible();

    const state = await page.evaluate(() => {
      const canvas = document.querySelector(".leaflet-container");
      const pin = document.querySelector(".leaflet-marker-icon") as HTMLImageElement | null;
      const tiles = Array.from(document.querySelectorAll<HTMLImageElement>(".leaflet-tile"));
      if (!canvas || !pin) return null;
      const canvasBox = canvas.getBoundingClientRect();
      const pinBox = pin.getBoundingClientRect();
      return {
        src: pin.currentSrc || pin.src,
        decoded: pin.complete && pin.naturalWidth > 0,
        insideCanvas:
          pinBox.left >= canvasBox.left - 1 &&
          pinBox.right <= canvasBox.right + 1 &&
          pinBox.bottom >= canvasBox.top - 1 &&
          pinBox.top <= canvasBox.bottom + 1,
        tileCount: tiles.length,
        tilesDecoded: tiles.filter((tile) => tile.complete && tile.naturalWidth > 0).length,
      };
    });

    expect(state).not.toBeNull();
    // The pin itself, decoded — `toBeVisible()` would pass on a broken image.
    expect(state?.decoded).toBe(true);
    expect(state?.src).toContain("/leaflet/marker-icon");
    expect(isThirdParty(state?.src ?? "")).toBe(false);
    // Centred on the club: the marker must sit within the canvas it belongs to.
    expect(state?.insideCanvas).toBe(true);
    expect(state?.tileCount).toBeGreaterThan(0);
  });
});
