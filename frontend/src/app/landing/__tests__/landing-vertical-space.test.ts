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
    it("keeps each tile a fixed 176px stage for its numeral, no rally stage above it", (): void => {
      const css = landingCss();
      const height = pxIn(ruleAt(css, ".landing-tablero-tile"), "height");
      expect(height).toBe(176);
    });

    it("keeps the value body at 16px", (): void => {
      const css = landingCss();
      expect(ruleAt(css, ".landing-tablero-item p")).toContain("font-size: 16px");
    });
  });

  describe("Logros", (): void => {
    it("keeps the section's own structural gap at 28-32px", (): void => {
      const css = landingCss();
      const gap = pxIn(ruleAt(css, ".landing-wins"), "gap");
      expect(gap).toBeGreaterThanOrEqual(28);
      expect(gap).toBeLessThanOrEqual(32);
    });

    it("trims the section's own padding well below the shared 76px convention", (): void => {
      const css = landingCss();
      const rule = ruleAt(css, ".landing-wins");
      expect(pxIn(rule, "padding-top")).toBeLessThanOrEqual(24);
      expect(pxIn(rule, "padding-bottom")).toBeLessThanOrEqual(6);
    });

    it("keeps the feature photo at a fixed 380px height on desktop, 160px on mobile", (): void => {
      const css = landingCss();
      expect(pxIn(ruleAt(css, ".landing-logro-photo"), "height")).toBe(380);

      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      expect(pxIn(ruleAt(css, ".landing-logro-photo", mobileBlock), "height")).toBe(160);
    });

    it("keeps the carousel thumbnail row compact on desktop and mobile", (): void => {
      const css = landingCss();
      expect(pxIn(ruleAt(css, ".landing-logro-tab"), "min-height")).toBe(94);
      expect(ruleAt(css, ".landing-logro-tablist")).toContain("padding: 3px 2px 8px");

      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      expect(ruleAt(css, ".landing-logro", mobileBlock)).toContain("display: flex");
      expect(ruleAt(css, ".landing-logro", mobileBlock)).toContain("flex-direction: column");
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
// Valores tablero redesign — the scroll-scrubbed rally (ball, guide,
// scoreboard counter, dimming) was rejected for breaking on mobile and for
// the ball motif itself. Approved prototype `landing-valores-b-tablero.html`
// replaces it with a static scoreboard: one grid gives every tile the same
// top edge as every other tile BY CONSTRUCTION, so nothing has to scrub
// anything into alignment. jsdom still cannot compute layout, so these keep
// reading the authored stylesheet, same convention as the #871 block above.
// ---------------------------------------------------------------------------
describe("Valores tablero redesign", (): void => {
  it("blends only its bottom edge into the trophy wall below — the top is a hard seam against #nosotros' v2 white ground", (): void => {
    const css = landingCss();
    const blend = css.match(/\.landing-values::after \{[^}]*\}/);
    expect(blend).not.toBeNull();
    expect(blend![0]).not.toContain("linear-gradient(180deg, var(--landing-brand-black)");
    expect(blend![0]).toContain("linear-gradient(0deg, var(--landing-brand-black)");
    // The wash paints BEHIND the section's children, never over their text.
    expect(blend![0]).toContain("z-index: 0");
    expect(blend![0]).toContain("pointer-events: none");
  });

  it("carries no rally, ball, guide, counter, or dimming rules", (): void => {
    const css = landingCss();
    expect(css).not.toContain(".landing-rally");
    expect(css).not.toContain(".landing-value.dim");
    expect(css).not.toContain(".landing-value.hit");
  });

  it("presents the numeral in brand yellow on a black tile, tabular so digits never shift width", (): void => {
    const css = landingCss();
    const tile = ruleAt(css, ".landing-tablero-tile");
    expect(tile).toContain("background: var(--landing-brand-black)");
    expect(tile).toContain("color: var(--landing-highlight)");
    expect(tile).toContain("font-variant-numeric: tabular-nums");
  });

  it("both grid rows share one four-column track, so every title starts at the same top", (): void => {
    const css = landingCss();
    const grid = ruleAt(css, ".landing-tablero");
    expect(grid).toContain("display: grid");
    expect(grid).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
  });
});
