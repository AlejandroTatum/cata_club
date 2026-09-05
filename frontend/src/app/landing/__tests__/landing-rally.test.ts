/**
 * Geometry guards for the Valores rally's scroll choreography (issue #637,
 * corrected by #1026).
 *
 * The regression itself is only visible in a browser — it is a layout fact, and
 * `tests/e2e/landing.spec.ts` is where it was reproduced. What lives here is
 * the arithmetic that browser evidence produced, so a later edit cannot quietly
 * undo it: every fixture below is a real measurement taken from the built page,
 * not a plausible-looking number.
 *
 *   390x844  section 1249px, values stacked one per row, each 172px
 *   844x390  section  884px, values in two columns, each 172px
 *  1024x768  section  874px, values in two columns, 172px then 146px
 *
 * #1026 removed the rally's second choreography — the pin. Its transparent
 * spacer padding showed the page's near-white background as a blank band under
 * the yellow section on every viewport taller than the section (711px of
 * section under 900px of viewport at 1440x900). The flowing choreography is
 * the only one now, so the source-level guards at the foot of this file keep
 * the pin and its dead decision machinery from coming back.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RALLY_FLOW_MIN_GAP,
  rallyFlowAnchorsPx,
  type RallyValueBox,
} from "@/app/landing/landing-rally";

const landingMotionSource = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/LandingMotion.tsx"), "utf8");
const landingRallySource = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing-rally.ts"), "utf8");

/** The measured layouts, as the rally sees them. */
const LAYOUTS: { name: string; viewport: number; boxes: RallyValueBox[] }[] = [
  {
    name: "phone portrait 390x844",
    viewport: 844,
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
    boxes: [
      { top: 2399, height: 172 },
      { top: 2399, height: 172 },
      { top: 2600, height: 146 },
      { top: 2600, height: 146 },
    ],
  },
];

describe("rallyFlowAnchorsPx", (): void => {
  for (const layout of LAYOUTS) {
    describe(layout.name, (): void => {
      const anchors = rallyFlowAnchorsPx(layout.boxes, layout.viewport);

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

// ---------------------------------------------------------------------------
// #1026 — the pin is retired, and with it the blank band its transparent
// spacer padding painted under the yellow section on tall viewports. These are
// source-level guards in the house style: the pin must not come back through a
// careless restore of one of its moving parts.
// ---------------------------------------------------------------------------
describe("the rally never pins again (#1026)", (): void => {
  it("leaves no pin in the motion layer", (): void => {
    const source = landingMotionSource();
    expect(source).not.toContain("pin: true");
    expect(source).not.toContain("rallyCanPin");
    expect(source).not.toContain("rallyHitIndex");
  });

  it("keeps no pin decision machinery in the rally geometry", (): void => {
    const source = landingRallySource();
    expect(source).not.toContain("rallyCanPin");
    expect(source).not.toContain("RALLY_HIT_PROGRESS");
    // The flowing anchors are the whole choreography now.
    expect(source).toContain("export function rallyFlowAnchorsPx");
  });
});
