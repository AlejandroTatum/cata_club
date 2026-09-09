/**
 * Vertical space, measured (issue #871; Valores rewritten as a tablero).
 *
 * Valores and the CTA final reserve less structural space than the original
 * template — tighter section gaps, tighter ask/warning padding and a shorter
 * CTA padding (Logros held that tighter rhythm until #1154 restored the
 * shared one; see the history below). Valores itself later
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
 * `.landing-wins` dropped sharply once Logros was redesigned (issue #657's
 * follow-up) from the five-row placeholder trophy wall to a single documented
 * result told as a feature story plus a four-photo podios row — see
 * `landing-logros-d-historia.html`. Issue #1154 then deliberately moved it
 * back UP: the section returned to the shared vertical rhythm (76px/64px
 * padding, 44px gap — #871's trim reverted) and its thumbnails grew into
 * image-over-text cards worth actually reading. The higher `logros` and
 * `scrollHeight` numbers below are the approved new rhythm, not a regression;
 * the #871-era compressed values were 788px/1067px and scrollHeight
 * 6146px/8197px.
 *
 * `document.scrollHeight` moved again when Mission/Vision (`#nosotros`) gained
 * one photo per pillar below its body copy: `.landing-values`, `.landing-wins`
 * and `.landing-motto` — the three sections this file actually shrinks — did
 * not change size at all, so their individual ceilings below are untouched.
 * Desktop's two pillars sit side by side, so only one photo's height
 * (~588px including its 24px top margin) is added to the page. Mobile stacks
 * both pillars into one column, so BOTH photos add their own height — at the
 * 390px viewport below, each photo is capped by the 342px column, not the
 * 360px `max-width` (`landing.css`), so the mobile increase is 2 × 366px.
 *
 *   Section (desktop 1440x900)          height
 *   .landing-values (tablero)            701px
 *   .landing-wins (#1154)               1027px
 *   .landing-motto                       384px
 *   document.scrollHeight (mission/vision photos)  6973px
 *
 *   Section (mobile 390x844)            height
 *   .landing-values (tablero)            941px
 *   .landing-wins (#1154)               1194px
 *   .landing-motto                       438px
 *   document.scrollHeight (mission/vision photos)  9057px
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
 *  `logros` and `scrollHeight` dropped hard with the Logros redesign (feature
 *  story + podios row replacing the five-row placeholder wall), then rose
 *  again with #1154's approved rhythm — the sections above and below Logros
 *  did not move. The ceilings below carry the same headroom convention (+8px)
 *  over the measured numbers recorded in the file header; `scrollHeight`
 *  keeps a wider buffer because it aggregates the whole page and absorbs
 *  environment font-metric variance.
 *
 *  `scrollHeight` rose again — 6505px to 7093px desktop, 8445px to 9177px
 *  mobile — for Mission/Vision's new per-pillar photos (see the file header):
 *  neither `valores`, `logros` nor `cta` moved, so only `scrollHeight` needed
 *  a new ceiling. Both keep the same 120px buffer over their measured
 *  6973px/9057px. */
const CEILINGS: Record<(typeof VIEWPORTS)[number]["name"], Record<string, number>> = {
  desktop: { valores: 709, logros: 1035, cta: 400, scrollHeight: 7093 },
  mobile: { valores: 1170, logros: 1203, cta: 450, scrollHeight: 9177 },
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
   * The redesigned Logros geometry: one feature photo at its fixed height and
   * a horizontally scrollable competition selector whose tabs retain a useful
   * touch target. Every geometry read waits for the feature's own reveal via
   * `expect.poll`; a one-shot read after `scrollIntoView` races the transition.
   */
  test("keeps the feature photo and competition tabs at their intended heights", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.locator("#logros").scrollIntoViewIfNeeded();

    const logroReveal = page.locator("#logros .landing-logro[data-reveal]");
    await expect.poll(async () => logroReveal.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    const desktopMetrics = await page.evaluate(() => {
      const feature = document.querySelector<HTMLElement>(".landing-logro-photo");
      const tabs = Array.from(document.querySelectorAll<HTMLElement>(".landing-logro-tab"));
      return {
        featureHeight: feature ? feature.getBoundingClientRect().height : null,
        tabCount: tabs.length,
        tabHeights: tabs.map((tab) => tab.getBoundingClientRect().height),
      };
    });

    await testInfo.attach("logros-geometry-desktop", {
      body: JSON.stringify(desktopMetrics, null, 2),
      contentType: "application/json",
    });

    expect(desktopMetrics.featureHeight, "feature photo height on desktop").toBeCloseTo(380, 0);
    expect(desktopMetrics.tabCount, "competition tab count").toBe(7);
    for (const height of desktopMetrics.tabHeights) {
      expect(height, "competition tab touch target on desktop").toBeGreaterThanOrEqual(94);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.locator("#logros").scrollIntoViewIfNeeded();
    await expect.poll(async () => logroReveal.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    const mobileMetrics = await page.evaluate(() => {
      const feature = document.querySelector<HTMLElement>(".landing-logro-photo");
      const tabs = Array.from(document.querySelectorAll<HTMLElement>(".landing-logro-tab"));
      return {
        featureHeight: feature ? feature.getBoundingClientRect().height : null,
        tabHeights: tabs.map((tab) => tab.getBoundingClientRect().height),
      };
    });

    await testInfo.attach("logros-geometry-mobile", {
      body: JSON.stringify(mobileMetrics, null, 2),
      contentType: "application/json",
    });

    expect(mobileMetrics.featureHeight, "feature photo height on mobile").toBeCloseTo(160, 0);
    for (const height of mobileMetrics.tabHeights) {
      expect(height, "competition tab touch target on mobile").toBeGreaterThanOrEqual(94);
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
