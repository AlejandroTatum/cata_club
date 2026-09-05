import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural spacing guards for issue #871: Valores, Logros and the CTA final
// each reserve less vertical space now, without touching copy, colours,
// typography or image sizing. jsdom cannot compute layout, so — the same
// convention `landing-palmares-colors.test.ts` and `Sponsors.test.tsx`
// use — these read the authored stylesheet directly. The real, rendered
// heights are proved in `tests/e2e/landing-vertical-space.spec.ts`; what
// lives here is the literal values that produce them, locked so a later
// edit cannot drift outside the approved range without this failing.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/** The first `<selector> { ... }` rule at or after `fromIndex`, as raw text. */
function ruleAt(css: string, selector: string, fromIndex = 0): string {
  const start = css.indexOf(`${selector} {`, fromIndex);
  if (start === -1) throw new Error(`rule not found: ${selector} (from ${fromIndex})`);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

/** The numeric px value of `prop` inside a rule's raw text. */
function pxIn(rule: string, prop: string): number {
  const match = rule.match(new RegExp(`(?<![-\\w])${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px`));
  if (!match) throw new Error(`property ${prop} not found in: ${rule}`);
  return Number.parseFloat(match[1]);
}

describe("landing vertical space (#871)", (): void => {
  describe("Valores", (): void => {
    it("shrinks the rally stage from 190px to the 140-155px window", (): void => {
      const css = landingCss();
      const height = pxIn(ruleAt(css, ".landing-rally"), "height");
      expect(height).toBeGreaterThanOrEqual(140);
      expect(height).toBeLessThanOrEqual(155);
    });

    it("tightens the section's own structural gap to 28-32px", (): void => {
      const css = landingCss();
      const gap = pxIn(ruleAt(css, ".landing-values"), "gap");
      expect(gap).toBeGreaterThanOrEqual(28);
      expect(gap).toBeLessThanOrEqual(32);
    });

    it("trims each value card's top padding to 24-28px on desktop and tablet", (): void => {
      const css = landingCss();
      const desktopTop = pxIn(ruleAt(css, ".landing-value"), "padding");
      expect(desktopTop).toBeGreaterThanOrEqual(24);
      expect(desktopTop).toBeLessThanOrEqual(28);

      const tabletRule = ruleAt(css, ".landing-value, .landing-value + .landing-value");
      const tabletTop = pxIn(tabletRule, "padding");
      expect(tabletTop).toBeGreaterThanOrEqual(24);
      expect(tabletTop).toBeLessThanOrEqual(28);
    });

    it("keeps the value body at 16px and the rally's own pin anchor untouched", (): void => {
      const css = landingCss();
      expect(ruleAt(css, ".landing-value p")).toContain("font-size: 16px");
      // The negative margin that lets the ball's guide overlap the cards below
      // it is part of the pin/flow choreography — not a target of this issue.
      expect(pxIn(ruleAt(css, ".landing-rally"), "margin-bottom")).toBe(-30);
    });
  });

  describe("Logros", (): void => {
    it("tightens the section's own structural gap to 28-32px", (): void => {
      const css = landingCss();
      const gap = pxIn(ruleAt(css, ".landing-wins"), "gap");
      expect(gap).toBeGreaterThanOrEqual(28);
      expect(gap).toBeLessThanOrEqual(32);
    });

    it("shrinks the ask/warning banners' vertical padding to 14-16px", (): void => {
      const css = landingCss();
      const askTop = pxIn(ruleAt(css, ".landing-palmares-ask"), "padding");
      expect(askTop).toBeGreaterThanOrEqual(14);
      expect(askTop).toBeLessThanOrEqual(16);
      // Already inside the window before this issue — proved unchanged.
      const warningTop = pxIn(ruleAt(css, ".landing-demo-warning"), "padding");
      expect(warningTop).toBeGreaterThanOrEqual(14);
      expect(warningTop).toBeLessThanOrEqual(16);
    });

    it("tightens the row rhythm to 7-8px on desktop, keeping 10px on mobile", (): void => {
      const css = landingCss();
      const desktopGap = pxIn(ruleAt(css, ".landing-palmares"), "gap");
      expect(desktopGap).toBeGreaterThanOrEqual(7);
      expect(desktopGap).toBeLessThanOrEqual(8);

      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      const mobileGap = pxIn(ruleAt(css, ".landing-palmares", mobileBlock), "gap");
      expect(mobileGap).toBe(10);
    });

    it("leaves the trophy photo columns untouched — the fix never shrinks images first", (): void => {
      const css = landingCss();
      // 210px desktop / 190px tablet / stacked on mobile: none of these are the
      // issue's concern, and none of them changed.
      expect(ruleAt(css, ".landing-palmares-row")).toContain("grid-template-columns: 210px minmax(0, 1fr) 124px");
    });
  });

  describe("CTA final", (): void => {
    it("shrinks the vertical padding to 56-64px on desktop and 48-56px on mobile", (): void => {
      const css = landingCss();
      const desktopRule = ruleAt(css, ".landing-motto");
      const desktopTop = pxIn(desktopRule, "padding");
      expect(desktopTop).toBeGreaterThanOrEqual(56);
      expect(desktopTop).toBeLessThanOrEqual(64);

      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      const mobileRule = ruleAt(css, ".landing-motto", mobileBlock);
      const mobileTop = pxIn(mobileRule, "padding");
      expect(mobileTop).toBeGreaterThanOrEqual(48);
      expect(mobileTop).toBeLessThanOrEqual(56);
    });

    it("preserves the content gap, the paddle size and the headline scale", (): void => {
      const css = landingCss();
      expect(pxIn(ruleAt(css, ".landing-motto"), "gap")).toBe(22);
      const paddleRule = ruleAt(css, ".landing-paddle");
      expect(pxIn(paddleRule, "width")).toBe(62);
      expect(pxIn(paddleRule, "height")).toBe(62);
      expect(ruleAt(css, ".landing-motto .landing-motto-lead")).toContain("font-size: 34px");
      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      expect(ruleAt(css, ".landing-motto .landing-motto-lead", mobileBlock)).toContain("font-size: 28px");
    });
  });
});

// ---------------------------------------------------------------------------
// #1026 — the Valores redesign. jsdom still cannot compute layout, so these
// keep reading the authored stylesheet, same convention as the #871 block
// above. What they lock is the redesign's three structural commitments: the
// section BLEEDS into its black neighbours instead of cutting, the rally
// counter presents as the scoreboard chip, and the value indices carry
// scoreboard-size numerals. None of it moves the #871 vertical budget, which
// is why the block above still passes untouched.
// ---------------------------------------------------------------------------
describe("Valores redesign (#1026)", (): void => {
  it("blends both edges into the neighbouring black sections", (): void => {
    const css = landingCss();
    const blend = css.match(/\.landing-values::after \{[^}]*\}/);
    expect(blend).not.toBeNull();
    expect(blend![0]).toContain("linear-gradient(180deg, var(--landing-brand-black)");
    expect(blend![0]).toContain("linear-gradient(0deg, var(--landing-brand-black)");
    // The wash paints BEHIND the section's children, never over their text.
    expect(blend![0]).toContain("z-index: 0");
    expect(blend![0]).toContain("pointer-events: none");
  });

  it("presents the rally counter as the scoreboard chip", (): void => {
    const css = landingCss();
    const chip = ruleAt(css, ".landing-rally-count");
    expect(chip).toContain("border-radius: 999px");
    expect(chip).toContain("background: var(--landing-brand-black)");
    expect(chip).toContain("color: var(--landing-brand-yellow)");
    // The count itself carries the ball's orange, the hero accent.
    expect(ruleAt(css, ".landing-rally-count b")).toContain("color: var(--landing-ball)");
  });

  it("raises the value index to the scoreboard numerals", (): void => {
    const css = landingCss();
    const index = ruleAt(css, ".landing-value .landing-index");
    expect(index).toContain("font-size: clamp(36px, 3.4vw, 48px)");
    expect(index).toContain("font-variant-numeric: tabular-nums");
  });

  it("draws the rally guide as the row's black spine, not a red scribble", (): void => {
    const css = landingCss();
    const guide = ruleAt(css, ".landing-rally-guide");
    expect(guide).toContain("stroke: var(--landing-text-strong)");
    expect(guide).toContain("stroke-width: 3");
  });
});
