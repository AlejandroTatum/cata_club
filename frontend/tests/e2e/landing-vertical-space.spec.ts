/**
 * Vertical space, measured (issue #871; Valores rewritten as a tablero).
 *
 * Valores, Logros and the CTA final each reserve less structural space than
 * the original template — tighter section gaps, tighter ask/warning padding,
 * a tighter Logros row rhythm and a shorter CTA padding. Valores itself later
 * dropped the scroll-scrubbed rally (ball, guide, scoreboard counter,
 * dimming) for a static tablero of four numeral tiles: it does not scrub
 * anything into place, so it cannot break the way the rally did on mobile.
 * None of it touches copy, colour, typography or image sizing, so a unit
 * test reading the stylesheet (`landing-vertical-space.test.ts`) can lock the
 * literal values, but only a real browser can say what those literals
 * actually PRODUCE once flex/grid layout, web fonts and real content
 * settle — which is what this file measures.
 *
 * Recorded, not only asserted — the same convention `content-measure.spec.ts`
 * uses: the numbers below were captured with the exact same pipeline this
 * file runs (`pnpm exec playwright test`), so a future reader can see what
 * the sections cost without re-running the measurement.
 *
 * `.landing-wins` dropped sharply again once Logros was redesigned (issue
 * #657's follow-up) from the five-row placeholder trophy wall to a single
 * documented result told as a feature story plus a four-photo podios row —
 * see `landing-logros-d-historia.html`.
 *
 *   Section (desktop 1440x900)          height
 *   .landing-values (tablero)            701px
 *   .landing-wins                        788px
 *   .landing-motto                       384px
 *   document.scrollHeight               6146px
 *
 *   Section (mobile 390x844)            height
 *   .landing-values (tablero)            941px
 *   .landing-wins                       1067px
 *   .landing-motto                       438px
 *   document.scrollHeight               8197px
 */
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 390, height: 844, name: "mobile" },
] as const;

/** Ceilings with headroom over the measured numbers above, so a rendering
 *  quirk (font metrics, sub-pixel rounding) never fails this on its own —
 *  only a real regression past the approved range does.
 *
 *  `desktop.valores` moved from #871's 660px to 709px (701px measured + 8px
 *  headroom, same convention as every other ceiling here): the tablero's four
 *  200px-class tiles plus their text row cost more vertical space than the
 *  rally's single 148px stage did, even after trimming the tile to 176px, the
 *  tile→text gap to 18px and the cue's `margin-top` to 36px — the numbers
 *  `landing-vertical-space.test.ts` locks. Nothing else in #871's approved
 *  range moved.
 *
 *  `logros` and `scrollHeight` both dropped hard with the Logros redesign
 *  (feature story + podios row replacing the five-row placeholder wall);
 *  the ceilings below carry the same headroom convention over the
 *  `<MEASURED_*>` numbers recorded in the file header above. */
const CEILINGS: Record<(typeof VIEWPORTS)[number]["name"], Record<string, number>> = {
  desktop: { valores: 709, logros: 820, cta: 400, scrollHeight: 7300 },
  mobile: { valores: 1170, logros: 1160, cta: 450, scrollHeight: 8600 },
};

test.describe("landing vertical space", () => {
  for (const vp of VIEWPORTS) {
    test(`shrinks Valores, Logros and the CTA on ${vp.name} without overflow`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      const heights = await page.evaluate(() => {
        const heightOf = (selector: string): number | null => {
          const el = document.querySelector(selector);
          return el ? el.getBoundingClientRect().height : null;
        };
        return {
          valores: heightOf(".landing-values"),
          logros: heightOf(".landing-wins"),
          cta: heightOf(".landing-motto"),
          scrollHeight: document.documentElement.scrollHeight,
          overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      await testInfo.attach(`heights-${vp.name}`, {
        body: JSON.stringify(heights, null, 2),
        contentType: "application/json",
      });

      const ceilings = CEILINGS[vp.name];
      expect(heights.valores, `.landing-values height at ${vp.name}`).not.toBeNull();
      expect(heights.valores as number, `.landing-values height at ${vp.name}`).toBeLessThanOrEqual(ceilings.valores);
      expect(heights.logros as number, `.landing-wins height at ${vp.name}`).toBeLessThanOrEqual(ceilings.logros);
      expect(heights.cta as number, `.landing-motto height at ${vp.name}`).toBeLessThanOrEqual(ceilings.cta);
      expect(heights.scrollHeight, `document scrollHeight at ${vp.name}`).toBeLessThanOrEqual(ceilings.scrollHeight);
      // No overlap/clipping shows up as horizontal overflow: a card or row
      // pushed wider than its column would grow scrollWidth past clientWidth.
      expect(heights.overflowPx, `no horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(0);
    });
  }

  /**
   * The redesigned Logros geometry: one feature photo at its fixed height,
   * four podios photos in a hard-edged row, none of them shrunk to buy the
   * section its lower budget. Every geometry read waits for the section's
   * own reveal (`opacity: 1` on its last `[data-reveal]`) via `expect.poll`
   * first — a one-shot read straight after `scrollIntoView` raced the
   * reveal transition and failed in CI on exactly that pattern (PR #1127).
   */
  test("keeps the feature photo and the four podios at their fixed heights", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.locator("#logros").scrollIntoViewIfNeeded();

    const podiosReveal = page.locator("#logros .landing-podios-block[data-reveal]");
    await expect.poll(async () => podiosReveal.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    const desktopMetrics = await page.evaluate(() => {
      const feature = document.querySelector<HTMLElement>(".landing-logro-photo");
      const podios = Array.from(document.querySelectorAll<HTMLElement>(".landing-podios > li"));
      return {
        featureHeight: feature ? feature.getBoundingClientRect().height : null,
        podiosCount: podios.length,
        podiosHeights: podios.map((li) => li.getBoundingClientRect().height),
      };
    });

    await testInfo.attach("logros-geometry-desktop", {
      body: JSON.stringify(desktopMetrics, null, 2),
      contentType: "application/json",
    });

    expect(desktopMetrics.featureHeight, "feature photo height on desktop").toBe(380);
    expect(desktopMetrics.podiosCount, "podios count").toBe(4);
    for (const height of desktopMetrics.podiosHeights) {
      expect(height, "podio photo height on desktop").toBe(150);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator("#logros").scrollIntoViewIfNeeded();
    await expect.poll(async () => podiosReveal.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    const mobileMetrics = await page.evaluate(() => {
      const feature = document.querySelector<HTMLElement>(".landing-logro-photo");
      const podios = Array.from(document.querySelectorAll<HTMLElement>(".landing-podios > li"));
      return {
        featureHeight: feature ? feature.getBoundingClientRect().height : null,
        podiosHeights: podios.map((li) => li.getBoundingClientRect().height),
      };
    });

    await testInfo.attach("logros-geometry-mobile", {
      body: JSON.stringify(mobileMetrics, null, 2),
      contentType: "application/json",
    });

    expect(mobileMetrics.featureHeight, "feature photo height on mobile").toBe(160);
    for (const height of mobileMetrics.podiosHeights) {
      expect(height, "podio photo height on mobile").toBe(120);
    }
  });

  /**
   * The CTA's own accessibility/motion contract: the shorter padding must not
   * disturb the 48px tap target, the paddle, or the reduced-motion guarantee
   * that already existed for the rest of the page (`landing.css`'s global
   * `prefers-reduced-motion: reduce` block scopes it to the motto's own
   * children, but nothing exercised that scoped rule until now).
   */
  test("keeps the CTA's tap target and reduced-motion guarantee under the shorter padding", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const motto = page.locator(".landing-motto");
    await expect(motto).toBeVisible();

    for (const selector of [
      "[data-motto-paddle]",
      "[data-motto-copy]",
      "[data-motto-cta]",
      ".landing-stars",
    ]) {
      const el = motto.locator(selector);
      await expect(el).toHaveCSS("opacity", "1");
      await expect(el).toHaveCSS("transform", "none");
    }

    const cta = motto.locator("[data-motto-cta]");
    const ctaBox = await cta.evaluate((el) => el.getBoundingClientRect());
    expect(ctaBox.height, "CTA keeps its 48px touch target").toBeGreaterThanOrEqual(48);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "no horizontal overflow under reduced motion").toBeLessThanOrEqual(0);
  });
});
