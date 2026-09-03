/**
 * Symmetry lock — the mirrored Mission/Vision section (issue #863).
 *
 * Measured against `main`: `.landing-editorial-item` centred its own two
 * children independently (`align-items: center`, computed per item) and the
 * divider was a `border-left` painted on the second item rather than owned by
 * `.landing-editorial`. jsdom cannot lay out CSS Grid, so none of this is
 * visible from a unit test — the structural half of this lock lives in
 * `src/app/landing/__tests__/landing-editorial-symmetry.test.tsx`; this file
 * measures what only a real browser can: whether the two halves actually land
 * on the same geometry.
 *
 * The desktop case measures under `prefers-reduced-motion: reduce`, following
 * this suite's convention for geometry (`landing-vertical-space.spec.ts`).
 * `.landing-editorial-item` carries `data-reveal`, and the motion layer
 * animates those with `gsap.from({ y: 40, duration: 0.7, stagger: 0.1 })`
 * (`LandingMotion.tsx`): the two halves start 100ms apart, so mid-flight their
 * headings legitimately sit up to 40px apart. Without the emulation this lock
 * was reporting the animation rather than the grid — green on a fast machine,
 * red on a loaded CI runner, with no change to the section in between. Under
 * `reduce` the whole `(prefers-reduced-motion: no-preference)` branch never
 * runs, so what is measured is the CSS layout this test is actually about.
 */
import { test, expect } from "@playwright/test";

test.describe("Mission/Vision editorial symmetry", () => {
  test("aligns both headings on the same Y and keeps the divider centred on desktop", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const section = page.locator("#nosotros");
    await section.scrollIntoViewIfNeeded();

    const missionHeading = section.getByRole("heading", { name: "Nuestra Misión" });
    const visionHeading = section.getByRole("heading", { name: "Nuestra Visión" });
    await expect(missionHeading).toBeVisible();
    await expect(visionHeading).toBeVisible();

    // Asserted, not assumed: if the reveal ever runs despite the emulation,
    // this fails naming the cause instead of silently measuring a frame
    // mid-animation again and blaming the grid.
    for (const item of await section.locator(".landing-editorial-item").all()) {
      await expect(item, "reveal settled before measuring").toHaveCSS("transform", "none");
    }

    const geometry = await page.evaluate(() => {
      const wrapper = document.querySelector(".landing-editorial") as HTMLElement;
      const divider = document.querySelector(".landing-editorial-divider") as HTMLElement;
      const mission = document.querySelector(".landing-editorial-item:nth-child(1) h3") as HTMLElement;
      const vision = document.querySelector(".landing-editorial-item:nth-child(3) h3") as HTMLElement;
      const missionMedia = document.querySelector(".landing-editorial-item:nth-child(1) .landing-editorial-media img") as HTMLElement;
      const visionMedia = document.querySelector(".landing-editorial-item:nth-child(3) .landing-editorial-media img") as HTMLElement;

      const wrapperBox = wrapper.getBoundingClientRect();
      const dividerBox = divider.getBoundingClientRect();
      const dividerCentre = dividerBox.left + dividerBox.width / 2;

      return {
        missionHeadingTop: mission.getBoundingClientRect().top,
        visionHeadingTop: vision.getBoundingClientRect().top,
        wrapperLeft: wrapperBox.left,
        wrapperWidth: wrapperBox.width,
        dividerCentre,
        missionMedia: missionMedia.getBoundingClientRect(),
        visionMedia: visionMedia.getBoundingClientRect(),
      };
    });

    // Recorded, not only asserted, following this repo's measurement
    // convention: the reader should be able to see what the geometry was.
    // eslint-disable-next-line no-console
    console.log("mission/vision geometry (1280px):", JSON.stringify(geometry));

    // Top alignment: an unequal-height copy must not shift the other half's
    // heading — both start at the same Y regardless of how much text either
    // side carries.
    expect(Math.abs(geometry.missionHeadingTop - geometry.visionHeadingTop)).toBeLessThanOrEqual(1);

    // The divider belongs to the wrapper: it sits exactly at the wrapper's
    // horizontal centre, not wherever the taller column happens to end.
    const expectedCentre = geometry.wrapperLeft + geometry.wrapperWidth / 2;
    expect(Math.abs(geometry.dividerCentre - expectedCentre)).toBeLessThanOrEqual(2);

    // Identical 4:3 media geometry on both sides.
    expect(Math.abs(geometry.missionMedia.width - geometry.visionMedia.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.missionMedia.height - geometry.visionMedia.height)).toBeLessThanOrEqual(1);
    expect(geometry.missionMedia.width / geometry.missionMedia.height).toBeCloseTo(4 / 3, 1);
    expect(geometry.visionMedia.width / geometry.visionMedia.height).toBeCloseTo(4 / 3, 1);

    // Composition [image][mission] | [vision][image]: left to right, the two
    // images bracket the two copy blocks.
    expect(geometry.missionMedia.left).toBeLessThan(geometry.missionMedia.right);
    expect(geometry.visionMedia.left).toBeGreaterThan(geometry.wrapperLeft + geometry.wrapperWidth / 2);
  });

  test("stacks Mission and Vision without horizontal overflow at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const section = page.locator("#nosotros");
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole("heading", { name: "Nuestra Misión" })).toBeVisible();
    await expect(section.getByRole("heading", { name: "Nuestra Visión" })).toBeVisible();

    const layout = await page.evaluate(() => {
      const wrapper = document.querySelector(".landing-editorial") as HTMLElement;
      const cs = getComputedStyle(wrapper);
      return {
        trackCount: cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
        wrapperOverflowPx: wrapper.scrollWidth - wrapper.clientWidth,
        pageOverflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(layout.trackCount, "stacked to a single column on mobile").toBe(1);
    expect(layout.wrapperOverflowPx, "no overflow inside the editorial wrapper").toBeLessThanOrEqual(0);
    expect(layout.pageOverflowPx, "no page-level horizontal scroll").toBeLessThanOrEqual(0);
  });
});
