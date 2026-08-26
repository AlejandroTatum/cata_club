/**
 * Geometry guards for the Valores rally (issue #637).
 *
 * The regression itself is only visible in a browser — it is a layout fact, and
 * `tests/e2e/landing.spec.ts` is where it is reproduced and where the fix is
 * proved. What lives here is the arithmetic that browser evidence produced, so
 * a later edit cannot quietly undo it: every fixture below is a real
 * measurement taken from the built page, not a plausible-looking number.
 *
 *   390x844  section 1249px, values stacked one per row, each 172px
 *   844x390  section  884px, values in two columns, each 172px
 *  1024x768  section  874px, values in two columns, 172px then 146px
 *  1440x900  section  711px, all four values in one row, each 172px
 */
import { describe, expect, it } from "vitest";
import {
  RALLY_FLOW_MIN_GAP,
  RALLY_HIT_PROGRESS,
  RALLY_VALUE_COUNT,
  rallyCanPin,
  rallyFlowAnchorsPx,
  rallyHitIndex,
  type RallyValueBox,
} from "@/app/landing/landing-rally";

/** The measured layouts, as the rally sees them. */
const LAYOUTS: { name: string; viewport: number; section: number; boxes: RallyValueBox[] }[] = [
  {
    name: "phone portrait 390x844",
    viewport: 844,
    section: 1249,
    boxes: [
      { top: 3619, height: 172 },
      { top: 3819, height: 172 },
      { top: 4020, height: 172 },
      { top: 4220, height: 172 },
    ],
  },
  {
    name: "phone landscape 844x390",
    viewport: 390,
    section: 884,
    boxes: [
      { top: 2515, height: 172 },
      { top: 2515, height: 172 },
      { top: 2715, height: 172 },
      { top: 2715, height: 172 },
    ],
  },
  {
    name: "tablet 1024x768",
    viewport: 768,
    section: 874,
    boxes: [
      { top: 2399, height: 172 },
      { top: 2399, height: 172 },
      { top: 2600, height: 146 },
      { top: 2600, height: 146 },
    ],
  },
];

describe("rallyCanPin", (): void => {
  it("refuses to pin a section taller than the viewport", (): void => {
    // Both phone viewports: pinned, values 02-04 were frozen below the fold for
    // the whole scrub. This is the decision that stops that happening.
    expect(rallyCanPin(1249, 844)).toBe(false);
    expect(rallyCanPin(884, 390)).toBe(false);
    expect(rallyCanPin(874, 768)).toBe(false);
  });

  it("keeps pinning the desktop section, which fits", (): void => {
    expect(rallyCanPin(711, 900)).toBe(true);
    // Exactly the viewport still fits — nothing is hidden.
    expect(rallyCanPin(900, 900)).toBe(true);
  });

  it("treats an unmeasured section as unpinnable", (): void => {
    // Better a section that scrolls than a pin taken on a height of zero.
    expect(rallyCanPin(0, 844)).toBe(false);
    expect(rallyCanPin(711, 0)).toBe(false);
    expect(rallyCanPin(Number.NaN, 844)).toBe(false);
  });
});

describe("RALLY_HIT_PROGRESS", (): void => {
  it("carries one ascending progress stop per value card", (): void => {
    // `LandingPage` renders four `ValueCard`s, 01 through 04. A list that fell
    // out of step with them would strand the tail of the rally: progress is
    // mapped back to an index by counting the stops it has passed.
    expect(RALLY_VALUE_COUNT).toBe(4);
    expect(RALLY_HIT_PROGRESS).toHaveLength(RALLY_VALUE_COUNT);
    RALLY_HIT_PROGRESS.forEach((stop, index): void => {
      expect(stop, `stop ${index} inside the scrub`).toBeGreaterThan(0);
      expect(stop, `stop ${index} inside the scrub`).toBeLessThan(1);
      if (index > 0) expect(stop).toBeGreaterThan(RALLY_HIT_PROGRESS[index - 1]);
    });
  });
});

describe("rallyHitIndex", (): void => {
  it("reaches every value across the pinned scrub", (): void => {
    expect(rallyHitIndex(0)).toBe(-1);
    expect(rallyHitIndex(0.18)).toBe(-1);
    RALLY_HIT_PROGRESS.forEach((stop, index): void => {
      expect(rallyHitIndex(stop), `value ${index + 1} at its own stop`).toBe(index);
    });
    // The end of the scrub is 4/4, never 3/4 — the last value has to land.
    expect(rallyHitIndex(1)).toBe(RALLY_VALUE_COUNT - 1);
  });
});

describe("rallyFlowAnchorsPx", (): void => {
  for (const layout of LAYOUTS) {
    describe(layout.name, (): void => {
      const anchors = rallyFlowAnchorsPx(layout.boxes, layout.viewport);

      it("does not pin, so these anchors are the ones that run", (): void => {
        expect(rallyCanPin(layout.section, layout.viewport)).toBe(false);
      });

      it("lights every value while that value is fully on screen", (): void => {
        // The whole of issue #637 in one assertion: the anchor is where the
        // value's TOP sits when it lights up, so it must be at or below the top
        // of the viewport and leave room for the value's own height.
        anchors.forEach((anchor, index): void => {
          const box = layout.boxes[index];
          expect(anchor, `value ${index + 1} not above the viewport`).toBeGreaterThanOrEqual(0);
          expect(anchor + box.height, `value ${index + 1} clear of the fold`).toBeLessThanOrEqual(layout.viewport);
        });
      });

      it("lights them in order, each with room to be seen before the next", (): void => {
        // Scroll position at which each value lights up. Two values sharing a
        // grid row share a `top`, so only the anchors separate them — and the
        // first attempt at this left value 02 lit for 9px.
        const scrolls = anchors.map((anchor, index): number => layout.boxes[index].top - anchor);
        scrolls.forEach((scroll, index): void => {
          if (index === 0) return;
          expect(scroll - scrolls[index - 1], `gap before value ${index + 1}`).toBeGreaterThanOrEqual(
            RALLY_FLOW_MIN_GAP,
          );
        });
      });
    });
  }

  it("centres a value that has its row to itself", (): void => {
    // Stacked, a value needs no separation from itself, so it takes the middle
    // of its window rather than either edge.
    const [anchor] = rallyFlowAnchorsPx([{ top: 3619, height: 172 }], 844);
    expect(anchor).toBe((844 - 172) / 2);
  });

  it("shows as much as it can of a value taller than the viewport", (): void => {
    // No window exists at all here; the top of the viewport is the best offer.
    expect(rallyFlowAnchorsPx([{ top: 1000, height: 700 }], 500)).toEqual([0]);
  });
});
