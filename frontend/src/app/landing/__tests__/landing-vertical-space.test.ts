import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural spacing guards for issue #871: Valores and the CTA final each
// reserve less vertical space now, without touching copy, colours,
// typography or image sizing. jsdom cannot compute layout, so — the same
// convention `landing-stats-band.test.ts` and `Sponsors.test.tsx`
// use — these read the authored stylesheet directly. The real, rendered
// heights are proved in `tests/e2e/landing-vertical-space.spec.ts`; what
// lives here is the literal values that produce them, locked so a later
// edit cannot drift outside the approved range without this failing.
//
// Issue #1155 removes the Valores exit fade #1026 had asked for; issue
// #1372 later retired the Logros section this file also used to lock —
// its rules and their tests left together.
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

// ---------------------------------------------------------------------------
// Mission/Vision pillar photos — same convention as above: jsdom cannot lay
// out CSS Grid or compute a rendered box, so the geometry this locks is the
// literal rule text, not a live measurement. `.landing-pillar-photo` is the
// ONE class both `mission-focus.jpeg` and `vision-coaching.jpeg` render
// with (`landing-mission-vision-pillars.test.tsx` proves that DOM sharing);
// this lock proves the rule that class carries is what forces their two
// different native ratios (0.99 and 0.86) into one shared box, so a later
// edit cannot quietly split the rule in two and let the columns drift apart.
// ---------------------------------------------------------------------------
describe("Mission/Vision pillar photos", (): void => {
  it("forces both photos to one shared square ratio, cropped from the bottom", (): void => {
    const css = landingCss();
    const rule = ruleAt(css, ".landing-pillar-photo");
    expect(rule).toContain("aspect-ratio: 1 / 1");
    expect(rule).toContain("object-fit: cover");
    // Crops toward the top of the frame (i.e. trims the bottom) rather than
    // centring: vision-coaching.jpeg's two faces sit close enough to its top
    // edge that a centred crop would risk clipping them.
    expect(rule).toContain("object-position: top");
  });

  it("caps the photo near the text column's own width once mobile stacks to one column", (): void => {
    const css = landingCss();
    const mobileBlock = css.indexOf("@media (max-width: 768px)");
    const mobileRule = ruleAt(css, ".landing-pillar-photo", mobileBlock);
    const maxWidth = pxIn(mobileRule, "max-width");
    // Matches the ~330-375px the lead (30ch) and body (44ch) copy already
    // cap themselves to, so the photo never outgrows the text beside it.
    expect(maxWidth).toBeGreaterThanOrEqual(330);
    expect(maxWidth).toBeLessThanOrEqual(375);
  });
});
