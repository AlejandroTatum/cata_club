/**
 * Vertical space, measured (issue #871).
 *
 * Valores, Logros and the CTA final each reserve less structural space now —
 * a smaller rally stage, tighter section gaps, tighter ask/warning padding,
 * a tighter Logros row rhythm and a shorter CTA padding. None of it touches
 * copy, colour, typography or image sizing, so a unit test reading the
 * stylesheet (`landing-vertical-space.test.ts`) can lock the literal values,
 * but only a real browser can say what those literals actually PRODUCE once
 * flex/grid layout, web fonts and real content settle — which is what this
 * file measures.
 *
 * Recorded, not only asserted — the same convention `content-measure.spec.ts`
 * uses: the before/after numbers below were captured with the exact same
 * pipeline this file runs (`pnpm exec playwright test`), once against
 * `origin/main` and once against this branch, so a future reader can see what
 * the sections used to cost without re-running the comparison.
 *
 *   Section (desktop 1440x900)   before   after
 *   .landing-values                711px   633px
 *   .landing-rally                 190px   148px
 *   .landing-wins                 1372px  1314px
 *   .landing-motto                 432px   384px
 *   document.scrollHeight         8478px  8294px
 *
 *   Section (mobile 390x844)     before   after
 *   .landing-values               1249px  1147px
 *   .landing-rally                 190px   148px
 *   .landing-wins                 2468px  2418px
 *   .landing-motto                 462px   438px
 *   document.scrollHeight        10404px 10228px
 */
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 390, height: 844, name: "mobile" },
] as const;

/** Ceilings with headroom over the "after" numbers above, so a rendering
 *  quirk (font metrics, sub-pixel rounding) never fails this on its own —
 *  only a real regression past the approved range does. Each ceiling still
 *  sits comfortably under the matching "before" number. */
const CEILINGS: Record<(typeof VIEWPORTS)[number]["name"], Record<string, number>> = {
  desktop: { valores: 660, rally: 156, logros: 1340, cta: 400, scrollHeight: 8400 },
  mobile: { valores: 1170, rally: 156, logros: 2440, cta: 450, scrollHeight: 10300 },
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
          rally: heightOf(".landing-rally"),
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
      expect(heights.rally as number, `.landing-rally height at ${vp.name}`).toBeGreaterThanOrEqual(140);
      expect(heights.rally as number, `.landing-rally height at ${vp.name}`).toBeLessThanOrEqual(ceilings.rally);
      expect(heights.logros as number, `.landing-wins height at ${vp.name}`).toBeLessThanOrEqual(ceilings.logros);
      expect(heights.cta as number, `.landing-motto height at ${vp.name}`).toBeLessThanOrEqual(ceilings.cta);
      expect(heights.scrollHeight, `document scrollHeight at ${vp.name}`).toBeLessThanOrEqual(ceilings.scrollHeight);
      // No overlap/clipping shows up as horizontal overflow: a card or row
      // pushed wider than its column would grow scrollWidth past clientWidth.
      expect(heights.overflowPx, `no horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(0);
    });
  }

  /**
   * The row rhythm, not just the container's declared `gap`: flexbox `gap`
   * only produces the requested distance when nothing else (an image's own
   * intrinsic size, a border) pushes rows apart, so this reads the real
   * distance between two rendered rows instead of trusting the CSS literal.
   */
  test("tightens the Logros row rhythm without shrinking the trophy photos", async ({ page }, testInfo) => {
    await page.goto("/");
    const rows = page.locator(".landing-palmares-row");
    await expect(rows).toHaveCount(5);

    const desktopMetrics = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(".landing-palmares-row"));
      const gaps = nodes.slice(1).map((row, index) => {
        const previous = nodes[index].getBoundingClientRect();
        const current = row.getBoundingClientRect();
        return current.top - previous.bottom;
      });
      const photo = document.querySelector<HTMLElement>(".landing-palmares-photo");
      return { gaps, photoWidth: photo ? photo.getBoundingClientRect().width : null };
    });

    await testInfo.attach("row-rhythm-desktop", {
      body: JSON.stringify(desktopMetrics, null, 2),
      contentType: "application/json",
    });

    for (const gap of desktopMetrics.gaps) {
      expect(gap, "desktop row-to-row gap").toBeGreaterThanOrEqual(6);
      expect(gap, "desktop row-to-row gap").toBeLessThanOrEqual(9);
    }
    // 210px columns on desktop (untouched by this issue) — proof the space
    // was not resolved by shrinking the photo first.
    expect(desktopMetrics.photoWidth as number, "trophy photo width on desktop").toBeGreaterThanOrEqual(190);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const mobileGaps = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(".landing-palmares-row"));
      return nodes.slice(1).map((row, index) => {
        const previous = nodes[index].getBoundingClientRect();
        const current = row.getBoundingClientRect();
        return current.top - previous.bottom;
      });
    });

    await testInfo.attach("row-rhythm-mobile", {
      body: JSON.stringify(mobileGaps, null, 2),
      contentType: "application/json",
    });

    for (const gap of mobileGaps) {
      expect(gap, "mobile row-to-row gap").toBeGreaterThanOrEqual(9);
      expect(gap, "mobile row-to-row gap").toBeLessThanOrEqual(11);
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
