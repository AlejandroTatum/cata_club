/**
 * The design tokens are a transcription of `docs/archive/prototypes/prototipos/_sistema.css`,
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
const spacing = (extend.spacing ?? {}) as Record<string, string>;
const fontFamily = (extend.fontFamily ?? {}) as Record<string, string[]>;
const fontSize = (extend.fontSize ?? {}) as Record<
  string,
  [string, { lineHeight: string; letterSpacing: string }]
>;

/** The number in front of a `px` value, so a step can be compared to a metric. */
const px = (value: string): number => Number.parseInt(value, 10);

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
    // The companion is the one value in this block that is NOT the sheet's
    // #8A6D00 any more. That transcription failed AA on both surfaces it
    // reaches — 3.48:1 printed on the ball, 4.03:1 on `canvas` — so it took
    // the #6E5700 the sheet had already grown locally as `--ball-ink-strong`
    // and kept to itself. The ratios are asserted in
    // lib/__tests__/color-contrast.test.ts; the sheet now mirrors this value.
    expect(nested("ball")).toMatchObject({ DEFAULT: "#FFD600", ink: "#6E5700" });
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

describe("design tokens — vertical rhythm (_sistema.css:152, 222, 104)", () => {
  it("carries the three named rhythm steps", () => {
    // `.canvas` (:152) is the page column: 20px between every first-level
    // block. `.stats` (:222) and `.grid2` (:203) are the gutter between
    // sibling cards: 14px. `.note` (:104), `.choice` (:333) and `.mcard`
    // (:449) are the stack inside a card: 7px.
    expect(spacing).toMatchObject({ page: "20px", section: "14px", field: "7px" });
  });

  it("derives every step from a committed metric instead of picking it", () => {
    // The point of the derivation: a rhythm nobody can argue with later.
    // `page` is half the control height, `section` IS the card radius — the
    // gutter between two cards equals the curve that carves their corners —
    // and `field` is half of `section`.
    expect(px(spacing.page) * 2).toBe(px(heights.ctl));
    expect(spacing.section).toBe(radii.card);
    expect(px(spacing.field) * 2).toBe(px(spacing.section));
  });

  it("keeps the four numeric spacing extensions the shell already uses", () => {
    // Named keys are additions, not a replacement: `pt-18` and friends are
    // live in the auth shell and the landing page.
    expect(spacing).toMatchObject({
      "18": "4.5rem",
      "22": "5.5rem",
      "30": "7.5rem",
      "88": "22rem",
    });
  });
});

describe("design tokens — the three brand type families", () => {
  /**
   * The product shipped on Inter, loaded as four `@fontsource/inter` stylesheets
   * in the root layout, while the three families the brand actually owns —
   * Barlow, Graduate, Playfair Display — were self-hosted `.woff2` files that
   * only `app/page.tsx` declared, i.e. only the public landing ever rendered
   * them. One product, two typographic systems, and the one the club paid for
   * was the one 32 authenticated screens never saw.
   *
   * The families now come from `lib/fonts.ts` and reach every route through
   * the CSS variables the root layout puts on `<html>`. These assertions read
   * the variable NAMES rather than a resolved family string on purpose:
   * `next/font/local` generates the actual family name at build time, so the
   * variable is the only stable thing to hold a config to.
   */
  it("makes Barlow the interface text, at the head of the fallback chain", () => {
    expect(fontFamily.sans?.[0]).toBe("var(--font-barlow)");
  });

  it("exposes Graduate as the display face", () => {
    expect(fontFamily.display?.[0]).toBe("var(--font-graduate)");
  });

  it("exposes Playfair as the serif voice", () => {
    expect(fontFamily.serif?.[0]).toBe("var(--font-playfair)");
  });

  /**
   * The voice STEP, not just the voice family.
   *
   * `DESIGN.md`'s frontmatter has declared `typography.voice` —
   * `clamp(20px, 2.4vw, 31px)`, line-height 1.3, tracking normal — since the
   * system was written, and the scale never carried it, so the one phrase per
   * screen the club speaks in first person had no size to take. That is not an
   * oversight with no consequence: `/login`'s motto, which is exactly that
   * phrase, sat in Barlow ExtraBold at the 46px `display` step because the
   * display step was the only hero size on offer.
   *
   * A clamp rather than two breakpoint sizes because the voice is one line of
   * copy that has to hold its proportion against a panel that grows — the same
   * reason the brand cluster's own measure is a clamp.
   */
  it("carries the voice step DESIGN.md declares, so the club's own phrase has a size", () => {
    const [size, meta] = fontSize.voice as [string, { lineHeight: string; letterSpacing: string }];
    expect(size).toBe("clamp(20px, 2.4vw, 31px)");
    expect(meta.lineHeight).toBe("1.3");
    // Normal, not the tightening every other step above `base` carries:
    // Playfair's high stroke contrast needs its own sidebearings to stay
    // readable, and this step is read rather than scanned.
    expect(meta.letterSpacing).toBe("normal");
  });

  it("keeps a system fallback behind each of the three", () => {
    // A `var()` that never resolves — a font file that 404s, a variable the
    // layout forgot to mount — falls through to nothing and the browser picks
    // its own default. Each stack has to name what it degrades TO.
    for (const key of ["sans", "display", "serif"]) {
      expect(fontFamily[key]?.length, `${key} has no fallback behind the variable`)
        .toBeGreaterThan(1);
    }
  });

  it("no longer names Inter in any of the three stacks", () => {
    // The value being retired. Inter sat at the head of `sans` and was the
    // reason every admin screen rendered in a face the brand does not use.
    const named = Object.entries(fontFamily).flatMap(([key, stack]) =>
      stack.filter((entry) => /inter/i.test(entry)).map((entry) => `${key}: ${entry}`),
    );
    expect(named).toEqual([]);
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
