/**
 * The design tokens are a transcription of `docs/ux/prototipos/_sistema.css`,
 * so these tests assert the transcription rather than any rendered output.
 * Every expected value below is quoted from that file with its line number.
 *
 * They also guard the two things a careless "cleanup" would break: the legacy
 * `cata-*` palette that ~8 live screens still reference, and Tailwind's own
 * `neutral` scale, which a top-level `neutral` token would have shadowed.
 */

import { describe, it, expect } from "vitest";
import tailwindConfig from "../../../../tailwind.config";

const extend = tailwindConfig.theme?.extend ?? {};
const colors = (extend.colors ?? {}) as Record<string, Record<string, string> | string>;
const heights = (extend.height ?? {}) as Record<string, string>;
const minHeights = (extend.minHeight ?? {}) as Record<string, string>;
const radii = (extend.borderRadius ?? {}) as Record<string, string>;

const nested = (key: string): Record<string, string> =>
  colors[key] as Record<string, string>;

describe("design tokens — rubber and ball (_sistema.css:20-26)", () => {
  it("carries the three coal steps", () => {
    expect(nested("coal")).toMatchObject({
      DEFAULT: "#131316",
      "2": "#1C1C21",
      "3": "#26262C",
    });
  });

  it("carries the ball and its text-weight companion", () => {
    expect(nested("ball")).toMatchObject({ DEFAULT: "#FFD600", ink: "#8A6D00" });
  });
});

describe("design tokens — ink and surfaces (_sistema.css:29-35)", () => {
  it("carries the ink ramp", () => {
    expect(nested("ink")).toMatchObject({
      DEFAULT: "#17181C",
      "2": "#4A4A55",
      "3": "#74747F",
    });
  });

  it("carries the AA-safe companion for 10.5px/700 micro labels", () => {
    // `ink-3` passes on `paper` and fails on `canvas`/`sunken`, so the ramp
    // keeps its value and the kicker/table-head treatment takes this one.
    // Deepening the canvas moved it one step darker (#6B6B76 → #63636E).
    // The ratios are asserted in lib/__tests__/color-contrast.test.ts.
    expect(nested("ink")["3-strong"]).toBe("#63636E");
  });

  it("carries both hairlines, one step darker than the spec shipped them", () => {
    // #E9E9EC / #D8D8DE were drawn for a #F5F5F7 page. On the reworked canvas
    // the divider hairline was 1.01:1 — a card outline the same luminance as
    // the page under it.
    expect(nested("line")).toMatchObject({ DEFAULT: "#DEDEE6", "2": "#CFCFDA" });
  });

  it("carries the three-surface ladder, not two near-white sheets", () => {
    // The spec's #F5F5F7 canvas put a white card 1.089:1 above its page — a
    // 3.4-point L* step, which is why a screen of cards read as one flat
    // sheet. The ladder is now canvas → sunken → paper, and
    // lib/__tests__/color-contrast.test.ts asserts the separations.
    expect(colors.canvas).toBe("#E8E8EE");
    expect(colors.sunken).toBe("#F4F4F7");
    expect(colors.paper).toBe("#FFFFFF");
  });
});

describe("design tokens — the four state pairs (_sistema.css:38-41)", () => {
  it("carries every foreground with its -bg companion", () => {
    expect(nested("state")).toEqual({
      ok: "#137739",
      "ok-bg": "#E7F4EC",
      warn: "#A94D08",
      "warn-bg": "#FBF0E2",
      neutral: "#63636E",
      "neutral-bg": "#EFEFF2",
      bad: "#C51B22",
      "bad-bg": "#FBE9EA",
    });
  });

  it("namespaces them so Tailwind's own neutral scale survives", () => {
    // A top-level `neutral` key in extend.colors replaces neutral-50…950
    // wholesale. Scoping under `state` keeps both usable.
    expect(colors.neutral).toBeUndefined();
  });

  it("keeps `bad` in the brand red family without reusing the CTA red exactly", () => {
    // The spec shipped `--bad` as literally `--red` (#D92128). That made the
    // error/destructive TEXT color identical to the fill of the primary CTA —
    // two jobs, one value — and the text job failed AA at 4.27:1 on its own
    // `bad-bg` tint. `bad` is now one notch darker so the pair passes; the CTA
    // red is untouched, because white on #D92128 was never the problem.
    // The rule "red is reserved for the CTA and for destructive/error" holds.
    const brandRed = (colors.cata as Record<string, string>).red;
    expect(brandRed).toBe("#D92128");
    expect(nested("state").bad).not.toBe(brandRed);
  });
});

describe("design tokens — level ramp (_sistema.css:44-45)", () => {
  const expected = [
    "#131316",
    "#26262C",
    "#3A3A42",
    "#4E4E58",
    "#62626E",
    "#7C7C88",
    "#9A9AA4",
    "#B8B8C0",
    "#D3D3D9",
    // The spec's base rung was #E9E9EC, which is 1.01:1 against the reworked
    // canvas — a level-10 chip on the page field would have vanished.
    "#DCDCE4",
  ];

  it("carries l1 through l10 in order", () => {
    expected.forEach((hex, index) => {
      expect(colors[`l${index + 1}`]).toBe(hex);
    });
  });

  it("starts at coal, because level 1 is the top of the ladder", () => {
    expect(colors.l1).toBe(nested("coal").DEFAULT);
  });
});

describe("design tokens — metrics (_sistema.css:48-50)", () => {
  const EXPECTED_HEIGHTS = {
    ctl: "40px",
    "ctl-sm": "32px",
    badge: "26px",
    row: "60px",
    thead: "44px",
    stat: "116px",
    drow: "56px",
  };

  it("carries every control height", () => {
    expect(heights).toMatchObject(EXPECTED_HEIGHTS);
  });

  it("mirrors them as min-heights for content that can outgrow the box", () => {
    expect(minHeights).toMatchObject(EXPECTED_HEIGHTS);
  });

  it("carries the two radii", () => {
    expect(radii).toMatchObject({ card: "14px", ctl: "10px" });
  });
});

describe("design tokens — the legacy cata palette is preserved", () => {
  it("still exposes the brand reds and yellow", () => {
    expect(colors.cata).toMatchObject({
      red: "#D92128",
      "red-light": "#E55157",
      "red-dark": "#A11D22",
      yellow: "#FFD600",
    });
  });

  it("still exposes the accessibility token Phase 0 added", () => {
    // Darkened from #A81257 with the canvas: the /trainer quick-action cards
    // are a fuchsia tint composited over the page field, so a deeper field
    // means a deeper card and a foreground that has to follow it down.
    expect((colors.cata as Record<string, string>)["fuchsia-ink"]).toBe("#9E114F");
  });

  it("keeps every legacy key — screens not yet migrated still reference them", () => {
    // Deleting the unused ones is a Phase 3 concern, once no screen reads them.
    expect(Object.keys(colors.cata as Record<string, string>)).toHaveLength(29);
  });
});
