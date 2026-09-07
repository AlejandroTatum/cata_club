import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The Logros redesign's colour rhythm lives in CSS that jsdom cannot compute,
// so these guards read the authored stylesheet directly — the same
// convention Sponsors.test.tsx and landing-gallery.test.ts use for
// stylesheet-only contracts. Replaces `landing-palmares-colors.test.ts`,
// retired along with the medal badges and pending-row states it locked.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/**
 * The Logros section: from `.landing-wins`'s own background rule through the
 * last podios rule, right before `.landing-motto` starts the next section.
 */
const logrosSlice = (css: string): string =>
  css.slice(css.indexOf(".landing-wins {"), css.indexOf(".landing-motto {"));

describe("landing Logros colour tokens", (): void => {
  it("declares the trophy-wall tokens at the exact value the literals they replace used", (): void => {
    const css = landingCss();
    expect(css).toMatch(/--landing-vitrina-text-muted:\s*#b9c0c8\b/);
    expect(css).toMatch(/--landing-vitrina-photo-bg:\s*#151515\b/);
  });

  it("leaves no hardcoded hex colour in the Logros section", (): void => {
    const slice = logrosSlice(landingCss());
    expect(slice).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("reads the ground, surface and highlight colours from tokens, not literals", (): void => {
    const slice = logrosSlice(landingCss());
    expect(slice).toContain(".landing-wins { background: var(--landing-brand-black); color: var(--landing-surface);");
    expect(slice).toContain(".landing-wins .landing-eyebrow { color: var(--landing-highlight); }");
    expect(slice).toContain(".landing-logro-kicker { margin: 0; font-weight: 700; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: var(--landing-highlight); }");
    expect(slice).toContain(".landing-logro-title { margin: 0; font-weight: 800;");
  });

  it("locks the story copy, fact hairline and fact label to their expected mixes/token", (): void => {
    const slice = logrosSlice(landingCss());
    expect(slice).toContain("color: color-mix(in srgb, var(--landing-surface) 82%, transparent); }");
    expect(slice).toContain("border-top: 1px solid color-mix(in srgb, var(--landing-surface) 22%, transparent);");
    expect(slice).toContain(".landing-logro-fact dt { margin: 0 0 1px; font-weight: 700; font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase; color: var(--landing-vitrina-text-muted); }");
  });

  it("carries no medal, pending-row or demo-warning rules", (): void => {
    const css = landingCss();
    expect(css).not.toContain(".landing-medal");
    expect(css).not.toContain(".landing-palmares");
    expect(css).not.toContain(".landing-demo-warning");
  });
});
