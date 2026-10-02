import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Proposal C varies the page's vertical rhythm on purpose. jsdom cannot
// compute layout, so — the convention `landing-vertical-space.test.ts` uses —
// these read the authored stylesheet: the four steps exist, grow in order, and
// the chapter openers and tight pairs use the right ones.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

const token = (css: string, name: string): number => {
  const match = css.match(new RegExp(`${name}:\\s*(\\d+)px`));
  if (!match) throw new Error(`token not found: ${name}`);
  return Number.parseInt(match[1], 10);
};

describe("landing section rhythm", (): void => {
  it("defines tight < dense < section < chapter, on desktop and again on mobile", (): void => {
    const css = landingCss();
    const mobile = css.slice(css.indexOf("@media (max-width: 768px)"));
    for (const scope of [css, mobile]) {
      const steps = ["tight", "dense", "section", "chapter"].map((name): number => token(scope, `--landing-space-${name}`));
      expect([...steps].sort((a, b): number => a - b)).toEqual(steps);
      expect(new Set(steps).size).toBe(4);
    }
  });

  it("opens the training chapter airy and keeps the proof and visit chapters tight", (): void => {
    const css = landingCss();
    expect(css).toContain(".landing-page .landing-section#nosotros { padding-block: var(--landing-space-chapter);");
    expect(css).toContain(".landing-page .landing-schedule { padding-block: var(--landing-space-chapter) var(--landing-space-section); }");
    expect(css).toContain(".landing-page .landing-gallery { padding-block: var(--landing-space-tight); }");
    expect(css).toContain(".landing-page .landing-location { padding-block: var(--landing-space-tight) var(--landing-space-section); }");
    expect(css).toContain(".landing-page .landing-values { padding-block: var(--landing-space-dense); }");
  });

  it("mirrors the second pillar without touching the DOM order", (): void => {
    const css = landingCss();
    expect(css).toContain(".landing-pillar--flip .landing-pillar-photo { grid-column: 1; grid-row: 1; }");
    expect(css).toContain(".landing-pillar--flip .landing-pillar-copy { grid-column: 2; grid-row: 1; }");
  });
});
