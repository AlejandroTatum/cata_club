/**
 * Symmetry lock — the mirrored Mission/Vision section (issue #863, #996, #992).
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
 *
 * Issue #996: matching `h3` tops was not enough. Mission's lead ("Promover el
 * tenis de mesa mediante formación deportiva de calidad.", 65 chars) wraps an
 * extra line against Vision's ("Ser un club líder y referente provincial y
 * nacional.", 51 chars) at 1280/1366/1600 — and NOT at 1440/1920, which is
 * exactly why two earlier fixes (#863, #982) and the single-viewport,
 * heading-only version of this lock never caught it. Everything below the
 * lead inherited that extra line, 31.5px (the lead's own line-height) lower
 * on Mission than on Vision. Fixed with a shared row grid (`landing.css`):
 * this lock has to verify every row it protects, at every width where the
 * bug actually reproduces, not just the title.
 *
 * Issue #992: the previous version of this lock passed (`2 passed`) with
 * `align-items: center` on `.landing-editorial-item` — the exact revert of
 * #863's fix — because it never compared a paragraph's position, only the
 * `h3`s (which that particular mutation happens not to move) and the media's
 * size (never its own top). This version compares the top of every
 * corresponding row, which is what actually shifts under that mutation.
 */
import { test, expect, type Page } from "@playwright/test";

/**
 * 1280 and 1440 are the suite's existing desktop reference points elsewhere;
 * 1366 and 1600 are the two additional widths #996 named as reproducing the
 * bug (common laptop and half-a-4K-monitor widths), and 1920 is the widest
 * case in the issue's own measurement table. Between them they cover every
 * row in that table, wrapped and not.
 */
const DESKTOP_WIDTHS = [1280, 1366, 1440, 1600, 1920] as const;

interface EditorialGeometry {
  wrapperLeft: number;
  wrapperWidth: number;
  dividerCentre: number;
  mission: RowGeometry;
  vision: RowGeometry;
}

interface RowGeometry {
  eyebrowTop: number;
  headingTop: number;
  ruleTop: number;
  leadTop: number;
  bodyTop: number;
  itemHeight: number;
  media: DOMRect;
}

async function measureEditorial(page: Page): Promise<EditorialGeometry> {
  return page.evaluate(() => {
    const wrapper = document.querySelector(".landing-editorial") as HTMLElement;
    const divider = document.querySelector(".landing-editorial-divider") as HTMLElement;

    const readItem = (item: HTMLElement) => {
      const rect = (selector: string): DOMRect =>
        (item.querySelector(selector) as HTMLElement).getBoundingClientRect();
      return {
        eyebrowTop: rect(".landing-index").top,
        headingTop: rect("h3").top,
        ruleTop: rect(".landing-rule").top,
        leadTop: rect(".landing-lead").top,
        bodyTop: rect(".landing-editorial-copy p:not(.landing-lead)").top,
        itemHeight: item.getBoundingClientRect().height,
        media: rect(".landing-editorial-media img"),
      };
    };

    const items = document.querySelectorAll(".landing-editorial-item");
    const mission = readItem(items[0] as HTMLElement);
    const vision = readItem(items[1] as HTMLElement);

    const wrapperBox = wrapper.getBoundingClientRect();
    const dividerBox = divider.getBoundingClientRect();

    return {
      wrapperLeft: wrapperBox.left,
      wrapperWidth: wrapperBox.width,
      dividerCentre: dividerBox.left + dividerBox.width / 2,
      mission,
      vision,
    };
  });
}

test.describe("Mission/Vision editorial symmetry", () => {
  for (const width of DESKTOP_WIDTHS) {
    test(`aligns every corresponding row and keeps both halves the same height at ${width}px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 1000 });
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

      const geometry = await measureEditorial(page);

      // Recorded, not only asserted, following this repo's measurement
      // convention: the reader should be able to see what the geometry was.
      // eslint-disable-next-line no-console
      console.log(`mission/vision geometry (${width}px):`, JSON.stringify(geometry));

      // Every corresponding row lands on the same Y — eyebrow, heading, rule,
      // lead and body — regardless of which side's copy wraps a line longer.
      // This is the assertion #996 needed: a diff would previously appear
      // only from "leadTop" downward, never on "eyebrowTop"/"headingTop".
      const rowPairs: Array<[string, number, number]> = [
        ["eyebrow", geometry.mission.eyebrowTop, geometry.vision.eyebrowTop],
        ["heading", geometry.mission.headingTop, geometry.vision.headingTop],
        ["rule", geometry.mission.ruleTop, geometry.vision.ruleTop],
        ["lead", geometry.mission.leadTop, geometry.vision.leadTop],
        ["body", geometry.mission.bodyTop, geometry.vision.bodyTop],
      ];
      for (const [label, missionTop, visionTop] of rowPairs) {
        expect(Math.abs(missionTop - visionTop), `${label} row top must match between Mission and Vision`).toBeLessThanOrEqual(1);
      }

      // The two halves must end at the same height — a wrapped extra line on
      // either side must grow both columns' shared row, not just its own.
      expect(
        Math.abs(geometry.mission.itemHeight - geometry.vision.itemHeight),
        "Mission and Vision halves must end at the same total height",
      ).toBeLessThanOrEqual(1);

      // The divider belongs to the wrapper: it sits exactly at the wrapper's
      // horizontal centre, not wherever the taller column happens to end.
      const expectedCentre = geometry.wrapperLeft + geometry.wrapperWidth / 2;
      expect(Math.abs(geometry.dividerCentre - expectedCentre)).toBeLessThanOrEqual(2);

      // Identical 4:3 media geometry on both sides, top included: a shift
      // that only moves the photos (and never the headings) must still fail.
      expect(Math.abs(geometry.mission.media.width - geometry.vision.media.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.mission.media.height - geometry.vision.media.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(geometry.mission.media.top - geometry.vision.media.top)).toBeLessThanOrEqual(1);
      expect(geometry.mission.media.width / geometry.mission.media.height).toBeCloseTo(4 / 3, 1);
      expect(geometry.vision.media.width / geometry.vision.media.height).toBeCloseTo(4 / 3, 1);

      // Composition [image][mission] | [vision][image]: left to right, the two
      // images bracket the two copy blocks.
      expect(geometry.mission.media.left).toBeLessThan(geometry.mission.media.right);
      expect(geometry.vision.media.left).toBeGreaterThan(geometry.wrapperLeft + geometry.wrapperWidth / 2);
    });
  }

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
