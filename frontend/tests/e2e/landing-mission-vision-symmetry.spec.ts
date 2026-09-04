/**
 * Symmetry lock — the mirrored Mission/Vision section (issue #863, #996,
 * #992, #1009).
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
 * animates those with `gsap.from({ y: 40, duration: 0.7 })` (`LandingMotion.tsx`):
 * even with the `stagger` removed between Mission and Vision (issue #1009,
 * see below), that tween still takes ~700ms to settle, so mid-flight the
 * geometry legitimately has a `transform` on it. Without the emulation this
 * lock was reporting the animation rather than the grid — green on a fast
 * machine, red on a loaded CI runner, with no change to the section in
 * between. Under `reduce` the whole `(prefers-reduced-motion: no-preference)`
 * branch never runs, so what is measured is the CSS layout this test is
 * actually about.
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
 *
 * Issue #1009: none of the locks above ever ran with the reveal actually
 * playing, and the one at 390px only checked for overflow. Two more gaps were
 * found this way and are covered by the suites below in this file:
 *   - the two `h3`s drifted up to ~39px apart WHILE the reveal animated
 *     (`stagger: 0.1` between them), settling back to 0px — invisible to any
 *     `reduce`-emulated or post-settle measurement, but real on every scroll;
 *   - between 391 and 768px, where the halves stack into one column and the
 *     desktop shared-row grid above does not apply (`landing.css` scopes it to
 *     `>= 769px`), nothing measured whether the two leads still wrap to the
 *     same number of lines.
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

/**
 * In-flight lock — issue #1009. Every geometry test above measures the
 * settled grid under `prefers-reduced-motion: reduce`; none of them ever let
 * the reveal actually play. That is exactly how the PR #991 regression
 * escaped: a `-14.42` drift reading was archived as "a false positive of the
 * animation" instead of being read as the animation itself running with
 * `stagger: 0.1` between the two `h3`s. This test runs with reduced motion
 * left at its default (the reveal plays) and samples both headings on every
 * animation frame for the ~700ms the tween takes to settle.
 */
test.describe("Mission/Vision reveal stays symmetric in flight", () => {
  test("keeps the two headings moving together while the reveal plays at 1440px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");

    // Scroll and sample inside the same `evaluate` call: waiting on Playwright
    // actionability first (e.g. `scrollIntoViewIfNeeded`) risks letting the
    // whole ~700ms tween finish before sampling ever starts.
    const samples = await page.evaluate(async () => {
      const section = document.querySelector("#nosotros") as HTMLElement;
      const items = section.querySelectorAll(".landing-editorial-item");
      const missionHeading = items[0].querySelector("h3") as HTMLElement;
      const visionHeading = items[1].querySelector("h3") as HTMLElement;

      section.scrollIntoView({ block: "center" });

      const diffs: number[] = [];
      const start = performance.now();
      await new Promise<void>((resolve) => {
        function frame(): void {
          diffs.push(missionHeading.getBoundingClientRect().top - visionHeading.getBoundingClientRect().top);
          if (performance.now() - start < 1500) {
            requestAnimationFrame(frame);
          } else {
            resolve();
          }
        }
        requestAnimationFrame(frame);
      });
      return diffs;
    });

    const peak = Math.max(...samples.map((diff) => Math.abs(diff)));
    // Recorded, not only asserted — see this suite's measurement convention.
    // eslint-disable-next-line no-console
    console.log(`mission/vision reveal drift (1440px, ${samples.length} frames): peak ${peak.toFixed(2)}px`);

    // Measured on `main` before the fix: a ~37px peak from the 100ms stagger
    // between the two tweens. Fixed (no stagger between this pair), both
    // headings ride the same tween and the live peak measures 0.00px; the
    // ceiling below stays well clear of that to absorb CI frame jitter while
    // staying far short of the drift a reintroduced stagger would produce.
    expect(peak, "Mission and Vision headings must enter together, not up to 100ms apart").toBeLessThanOrEqual(8);
  });
});

/**
 * Stacked-range lock — issue #1009. At <= 768px `.landing-editorial-item`
 * loses the desktop shared-row grid (`landing.css` scopes it to
 * `>= 769px`) and the two halves stack into one column instead. The only
 * existing mobile test (390px, above) checks for overflow and nothing else;
 * this checks the one thing that actually matters once there is no
 * side-by-side reference: whether the two leads still wrap to the same
 * number of lines, so neither half's internal silhouette drifts from the
 * other's.
 */
test.describe("Mission/Vision keep the same lead silhouette while stacked (391-768px)", () => {
  const STACKED_WIDTHS = [391, 430, 500, 600, 700, 768] as const;

  for (const width of STACKED_WIDTHS) {
    test(`both leads wrap to the same number of lines at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");

      const section = page.locator("#nosotros");
      await section.scrollIntoViewIfNeeded();
      await expect(section.getByRole("heading", { name: "Nuestra Misión" })).toBeVisible();
      await expect(section.getByRole("heading", { name: "Nuestra Visión" })).toBeVisible();

      const geometry = await page.evaluate(() => {
        const items = document.querySelectorAll(".landing-editorial-item");
        const readLead = (item: Element): { lines: number; itemHeight: number } => {
          const lead = item.querySelector(".landing-lead") as HTMLElement;
          const lineHeight = parseFloat(getComputedStyle(lead).lineHeight);
          return {
            lines: Math.round(lead.getBoundingClientRect().height / lineHeight),
            itemHeight: (item as HTMLElement).getBoundingClientRect().height,
          };
        };
        return { mission: readLead(items[0]), vision: readLead(items[1]) };
      });

      // eslint-disable-next-line no-console
      console.log(`mission/vision stacked silhouette (${width}px):`, JSON.stringify(geometry));

      expect(geometry.mission.lines, "both leads must wrap to the same line count while stacked").toBe(
        geometry.vision.lines,
      );
    });
  }
});

/**
 * Copy-parity lock — issue #1009. The two leads must keep wrapping to the
 * same number of lines regardless of the exact column width they land in —
 * that is what protects a future copy edit from silently reintroducing the
 * defect this issue fixed. Character count cannot stand in for this: the
 * issue measured two 70-character strings where one wrapped differently from
 * the other, so this renders both leads' real text, in the real font
 * (`.landing-lead`, Playfair 21px / 31.5px line-height), at a swept range of
 * text widths and counts actual rendered lines.
 *
 * The sweep is dense (every 4px from 260 to 720px, 116 samples) rather than a
 * handful of fixed points, because a handful of fixed points is exactly the
 * kind of lock this issue is about: which points you happen to pick decides
 * whether it catches anything. A dense sweep exposes something a literal
 * "zero mismatches anywhere" assertion would get wrong, though: two
 * different-length sentences will always cross from N to N-1 lines at
 * slightly different widths, so a few-pixel-wide mismatch band right at each
 * crossover is mathematically unavoidable, not a defect. Measured on the
 * approved copy, both crossovers together account for 7/116 samples (~6%).
 * Measured on the previous copy ("Ser un club líder y referente provincial y
 * nacional.") — the one this issue replaces — the same sweep mismatches on
 * 65/116 samples (~56%), two ~180px-wide bands instead of two ~15px ones.
 * The ceiling below sits an order of magnitude above the unavoidable noise
 * and well below the defect it exists to catch.
 */
test.describe("Mission/Vision lead line-count parity across text widths", () => {
  test("both leads wrap to the same line count across a swept 260-720px text-width range", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");

    const missionText = await page
      .locator("#nosotros .landing-editorial-item")
      .nth(0)
      .locator(".landing-lead")
      .innerText();
    const visionText = await page
      .locator("#nosotros .landing-editorial-item")
      .nth(1)
      .locator(".landing-lead")
      .innerText();

    const widths: number[] = [];
    for (let width = 260; width <= 720; width += 4) widths.push(width);

    const results = await page.evaluate(
      async ({ missionText, visionText, widths }) => {
        await document.fonts.ready;
        // Appended inside `.landing-page`, not `document.body`: the real font
        // and colour come from CSS custom properties scoped to that element,
        // not `:root` — outside it the probe would measure the fallback
        // serif font instead of Playfair, and wrap at different widths.
        const scope = document.querySelector(".landing-page") as HTMLElement;
        const probe = document.createElement("p");
        probe.className = "landing-lead";
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.style.left = "-9999px";
        probe.style.top = "0";
        probe.style.maxWidth = "none";
        scope.appendChild(probe);

        const countLines = (text: string, width: number): number => {
          probe.style.width = `${width}px`;
          probe.textContent = text;
          const lineHeight = parseFloat(getComputedStyle(probe).lineHeight);
          return Math.round(probe.getBoundingClientRect().height / lineHeight);
        };

        const rows = widths.map((width) => ({
          width,
          mission: countLines(missionText, width),
          vision: countLines(visionText, width),
        }));

        probe.remove();
        return rows;
      },
      { missionText, visionText, widths },
    );

    const mismatches = results.filter((row) => row.mission !== row.vision);
    // eslint-disable-next-line no-console
    console.log(
      `lead line-count mismatches: ${mismatches.length}/${results.length} —`,
      mismatches.map((row) => `${row.width}px m${row.mission}/v${row.vision}`).join(" "),
    );

    expect(
      mismatches.length,
      "leads must wrap to the same line count across almost the whole swept width range",
    ).toBeLessThanOrEqual(20);
  });
});
