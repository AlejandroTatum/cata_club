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
//
// Issue #1154 deliberately reverts #871's trim for Logros (gap and padding
// back to the shared rhythm, thumbnails image-over-text and larger), and
// issue #1155 removes the Valores exit fade #1026 had asked for: those locks
// below were rewritten with the new intention in the same PR, not deleted.
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
    // Issue #1154 reverted #871's deliberate trim for Logros: the section
    // re-joins the shared rhythm every other band keeps.
    it("returns the section's own structural gap to the shared 44px (issue #1154)", (): void => {
      const css = landingCss();
      expect(pxIn(ruleAt(css, ".landing-wins"), "gap")).toBe(44);
    });

    it("recovers the shared vertical padding by inheriting .landing-section's rhythm, with no override left anywhere (issue #1154)", (): void => {
      const css = landingCss();
      // The desktop rule carries no padding of its own, so the 76px of
      // `.landing-section` applies — above the 56px floor the issue sets.
      expect(ruleAt(css, ".landing-wins")).not.toContain("padding");
      // And the 768px block dropped its #871 trim too: mobile inherits the
      // section's 64px rather than re-trimming to 22/14.
      expect(css).not.toMatch(/\.landing-wins \{[^}]*padding/);
    });

    it("keeps the feature photo at a fixed 380px height on desktop, 160px on mobile", (): void => {
      const css = landingCss();
      expect(pxIn(ruleAt(css, ".landing-logro-photo"), "height")).toBe(380);

      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      expect(pxIn(ruleAt(css, ".landing-logro-photo", mobileBlock), "height")).toBe(160);
    });

    // Issue #1154: each thumbnail is image-over-text — the photo owns the
    // full card width and the index + label sit below it — so no band of
    // the card is left without image or without text (the old 54px side
    // column stranded 28px under the photo). The card grew with the photo;
    // the strip keeps its horizontal scroll and its keyboard focus ring.
    it("lays each thumbnail image-over-text, larger, with no residual band (issue #1154)", (): void => {
      const css = landingCss();
      const tab = ruleAt(css, ".landing-logro-tab");
      expect(pxIn(tab, "min-width")).toBeGreaterThan(138);
      expect(pxIn(tab, "min-height")).toBeGreaterThan(94);
      // One column: nothing sits beside the image anymore.
      expect(tab).toContain("grid-template-columns: 1fr");
      expect(tab).not.toContain("54px");
      const img = ruleAt(css, ".landing-logro-tab img");
      expect(img).toContain("width: 100%");
      expect(pxIn(img, "height")).toBeGreaterThan(54);

      const tablist = ruleAt(css, ".landing-logro-tablist");
      expect(tablist).toContain("overflow-x: auto");
      expect(
        ruleAt(css, ".landing-logro-control:focus-visible, .landing-logro-tab:focus-visible"),
      ).toContain("outline: 3px solid var(--landing-highlight)");

      const mobileBlock = css.indexOf("@media (max-width: 768px)");
      expect(ruleAt(css, ".landing-logro", mobileBlock)).toContain("display: flex");
      expect(ruleAt(css, ".landing-logro", mobileBlock)).toContain("flex-direction: column");
    });

    // Issue #1159: without an explicit grow factor, a flex item's default is
    // `flex: 0 1 auto` — the seven tabs stopped at their content width and
    // any leftover space in `.landing-logro-tablist` went unused past the
    // last card. `flex: 1 1 176px` shares that leftover space evenly, while
    // `min-width: 176px` keeps that same number a hard floor so the strip
    // still falls back to horizontal scroll below it instead of squeezing
    // the cards narrower.
    it("lets the seven thumbnail tabs grow to fill the strip, with 176px as a hard floor (issue #1159)", (): void => {
      const css = landingCss();
      const tab = ruleAt(css, ".landing-logro-tab");
      expect(tab).toContain("flex: 1 1 176px");
      expect(pxIn(tab, "min-width")).toBe(176);
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
  // Issue #1155 reverted #1026's exit fade on request: the yellow meets the
  // trophy wall's black in a hard cut, like every other section boundary.
  // Written as absence, so the gradient cannot quietly return.
  it("cuts hard from the yellow into the trophy wall below — the exit fade is gone (issue #1155)", (): void => {
    const css = landingCss();
    expect(css).not.toContain(".landing-values::after");
    expect(css).not.toContain("linear-gradient(0deg, var(--landing-brand-black)");
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
