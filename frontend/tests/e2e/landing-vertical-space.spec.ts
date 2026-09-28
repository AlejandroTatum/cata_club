/**
 * Vertical space, measured (issue #871; Valores rewritten as a tablero).
 *
 * Valores and the CTA final reserve less structural space than the original
 * template — tighter section gaps, tighter ask/warning padding and a shorter
 * CTA padding. Valores itself later
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
 * The Logros band (`.landing-wins`) this file also used to measure and cap
 * left the page in issue #1372; its measurements, its geometry lock and its
 * ceiling retired with the section.
 *
 * `document.scrollHeight` moved twice for Mission/Vision (`#nosotros`):
 * `.landing-values` and `.landing-motto` — the two bands this file still
 * measures — never changed size at either point,
 * so their individual ceilings below are untouched by either move.
 *
 * It first ROSE when each pillar gained one photo BELOW its body copy:
 * desktop's two pillars sit side by side with each other, so only one
 * photo's height (~588px including its 24px top margin) was added to the
 * page; mobile stacks both pillars into one column, so BOTH photos added
 * their own height.
 *
 * It then FELL when the photo moved beside the copy instead of below it (a
 * client-reported layout fix): on desktop each pillar became its own two
 * column grid (copy | photo), so the photo's height only grows the pillar
 * when it exceeds the copy column's own height — it no longer stacks a
 * whole extra photo height onto the page, which is why desktop's
 * `scrollHeight` below is now LOWER than even the pre-photo baseline this
 * file used to carry (6505px). Below the mobile breakpoint the pillar still
 * stacks copy above photo exactly as before (`.landing-pillar {
 * grid-template-columns: 1fr; }` in the 768px block), so mobile's
 * `scrollHeight` is unchanged from the previous measurement.
 *
 *   Section (desktop 1440x900)          height
 *   .landing-values (tablero)            701px
 *   .landing-motto                       384px
 *   document.scrollHeight (photo beside copy)      6472px
 *
 *   Section (mobile 390x844)            height
 *   .landing-values (tablero)            941px
 *   .landing-motto                       438px
 *   document.scrollHeight (unchanged — pillar still stacks)  9057px
 *
 * Issue #1372 then removed the Logros band from between Valores and the CTA
 * (roughly one `.landing-wins` height, ~1027px desktop / ~1194px mobile, off
 * the page). No fresh measurement run has re-based the scrollHeight ceilings
 * yet, so they keep their pre-removal values: still valid upper bounds over
 * the now-shorter page, just looser than the recorded-numbers convention
 * wants. Re-tighten them from a new measured run, not by arithmetic.
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
 *  rally's single 148px stage did, even after trimming the tile to 176px and
 *  the tile→text gap to 18px — the numbers
 *  `landing-vertical-space.test.ts` locks. Nothing else in #871's approved
 *  range moved.
 *
 *  `scrollHeight` rose from 6505px to 7093px desktop, 8445px to 9177px mobile,
 *  for Mission/Vision's per-pillar photos when they sat BELOW the copy (see
 *  the file header) — neither `valores` nor `cta` moved, so only
 *  `scrollHeight` needed a new ceiling.
 *
 *  It then DROPPED — desktop only — once the photo moved beside the copy
 *  instead of below it: measured 6472px, below even the pre-photo 6505px
 *  baseline (a narrower copy column wraps to more lines than the extra
 *  height the photo used to add). The ceiling tightens to match, same 120px
 *  buffer convention, rather than keeping the old 7093px headroom the new
 *  layout no longer needs. Mobile's `scrollHeight` did not move at all — the
 *  pillar still stacks copy above photo below the breakpoint — so its
 *  ceiling stays exactly as it was (120px over the same measured 9057px).
 *
 *  The `logros` ceiling and its scrollHeight share of #1154's rhythm left
 *  with the section in #1372 (see the file header). */
const CEILINGS: Record<(typeof VIEWPORTS)[number]["name"], Record<string, number>> = {
  desktop: { valores: 709, cta: 400, scrollHeight: 6592 },
  mobile: { valores: 1170, cta: 450, scrollHeight: 9177 },
};

test.describe("landing vertical space", () => {
  for (const vp of VIEWPORTS) {
    test(`shrinks Valores and the CTA on ${vp.name} without overflow`, async ({
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
      expect(heights.cta as number, `.landing-motto height at ${vp.name}`).toBeLessThanOrEqual(ceilings.cta);
      expect(heights.scrollHeight, `document scrollHeight at ${vp.name}`).toBeLessThanOrEqual(ceilings.scrollHeight);
      // No overlap/clipping shows up as horizontal overflow: a card or row
      // pushed wider than its column would grow scrollWidth past clientWidth.
      expect(heights.overflowPx, `no horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(0);
    });
  }

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
