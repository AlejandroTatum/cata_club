import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #1255: `.landing-hero .landing-button` (specificity 0,2,0) outranks
// the unscoped `.landing-button-outline` rule (0,1,0), so the hero's
// secondary CTA ("Ver horarios") computes the same solid background as the
// primary one. jsdom cannot resolve CSS specificity, so — the same
// convention `landing-stats-band.test.ts` and `Sponsors.test.tsx` use —
// this reads the authored stylesheet directly and locks the hero override to
// stay scoped away from the outline variant.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/** Every `.landing-hero .landing-button...\{...\}` rule, as raw text. */
function heroButtonRules(css: string): string[] {
  return css.match(/\.landing-hero \.landing-button[^{]*\{[^}]*\}/g) ?? [];
}

describe("landing hero outline button (#1255)", (): void => {
  it("never lets a `.landing-hero .landing-button` rule that includes the outline variant set a background", (): void => {
    const rules = heroButtonRules(landingCss());
    expect(rules.length).toBeGreaterThan(0);
    rules.forEach((rule): void => {
      if (/^\.landing-hero \.landing-button-outline\b/.test(rule)) return;
      if (rule.includes(":not(.landing-button-outline)")) return;
      expect(rule).not.toMatch(/background:/);
    });
  });

  it("keeps the outline variant's own rule transparent with a visible border", (): void => {
    const css = landingCss();
    const start = css.indexOf(".landing-button-outline {");
    const end = css.indexOf("}", start);
    const rule = css.slice(start, end + 1);
    expect(rule).toContain("background: transparent");
    expect(rule).toContain("border: 2px solid var(--landing-on-action)");
  });

  it("leaves the contact card's outline button styling untouched", (): void => {
    const css = landingCss();
    expect(css).toContain(".landing-contact .landing-button-outline { border-color: var(--landing-action); color: var(--landing-action); }");
    expect(css).toContain(".landing-contact .landing-button-outline:hover { border-color: var(--landing-action-hover); background: var(--landing-action-hover); color: var(--landing-on-action); }");
  });
});
