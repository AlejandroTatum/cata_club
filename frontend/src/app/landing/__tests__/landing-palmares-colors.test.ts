import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The vitrina (ex palmarés, issue #657) colour rhythm lives in CSS that jsdom
// cannot compute, so these guards read the authored stylesheet directly — the
// same convention Sponsors.test.tsx and landing-gallery.test.ts use for
// stylesheet-only contracts. Issue #669 tokenizes it.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/**
 * The vitrina section: from `.landing-wins`'s own background rule through the
 * last medal-state rule, right before `.landing-motto` starts the next
 * section. Slicing here — rather than scanning the whole file — keeps this
 * lock from tripping on unrelated literals elsewhere in the stylesheet (the
 * primitive token definitions in `.landing-page` are a hex literal by
 * definition and must stay out of scope).
 */
const vitrinaSlice = (css: string): string =>
  css.slice(css.indexOf(".landing-wins {"), css.indexOf(".landing-motto {"));

// Token -> the exact literal it must resolve to. Locked to the values the
// stylesheet used before tokenization so a drifted token value is caught here
// instead of silently repainting a client-frozen, review-closed page.
const EXPECTED_TOKENS: Record<string, string> = {
  "--landing-vitrina-subtitle": "#cfd4da",
  "--landing-vitrina-text-muted": "#b9c0c8",
  "--landing-vitrina-photo-bg": "#151515",
  "--landing-medal-plata": "#d6dbe1",
  "--landing-medal-plata-fill": "#c9ced5",
  "--landing-medal-bronce": "#e0995a",
  "--landing-medal-bronce-fill": "#cd7f32",
  "--landing-medal-part": "#9aa2ab",
  "--landing-medal-pending": "#7d848c",
};

describe("landing vitrina colour tokens", (): void => {
  it("declares every vitrina token at the exact value the literal it replaces used", (): void => {
    const css = landingCss();
    for (const [token, value] of Object.entries(EXPECTED_TOKENS)) {
      expect(css).toMatch(new RegExp(`${token}:\\s*${value}\\b`));
    }
  });

  it("leaves no hardcoded hex colour in the vitrina section", (): void => {
    const slice = vitrinaSlice(landingCss());
    expect(slice).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("reads the gold, silver, bronze, and participación year colour from a token, not a literal", (): void => {
    const slice = vitrinaSlice(landingCss());
    expect(slice).toContain(".landing-palmares-row:has(.landing-medal-oro) .landing-palmares-year { color: var(--landing-highlight); }");
    expect(slice).toContain(".landing-palmares-row:has(.landing-medal-plata) .landing-palmares-year { color: var(--landing-medal-plata); }");
    expect(slice).toContain(".landing-palmares-row:has(.landing-medal-bronce) .landing-palmares-year { color: var(--landing-medal-bronce); }");
    expect(slice).toContain(".landing-palmares-row:has(.landing-medal-part) .landing-palmares-year { color: var(--landing-medal-part); }");
  });

  it("reads each medal badge's fill and accent colour from its named token", (): void => {
    const slice = vitrinaSlice(landingCss());
    expect(slice).toContain(".landing-medal-plata { background: color-mix(in srgb, var(--landing-medal-plata-fill) 14%, transparent); color: var(--landing-medal-plata); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--landing-medal-plata-fill) 38%, transparent); }");
    expect(slice).toContain(".landing-medal-bronce { background: color-mix(in srgb, var(--landing-medal-bronce-fill) 18%, transparent); color: var(--landing-medal-bronce); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--landing-medal-bronce-fill) 46%, transparent); }");
    expect(slice).toContain(".landing-medal-part { background: transparent; color: var(--landing-medal-part); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--landing-surface) 20%, transparent); }");
    expect(slice).toContain(".landing-medal-pending { background: transparent; color: var(--landing-medal-pending); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--landing-surface) 20%, transparent); text-transform: none; }");
  });

  it("locks the pending row and vitrina muted-text colour to their tokens", (): void => {
    const slice = vitrinaSlice(landingCss());
    expect(slice).toContain(".landing-wins .landing-section-header p { color: var(--landing-vitrina-subtitle); }");
    expect(slice).toContain(".landing-palmares-toggle label { display: inline-flex; align-items: center; gap: 10px; color: var(--landing-vitrina-text-muted);");
    expect(slice).toContain(".landing-palmares-ask span { color: var(--landing-vitrina-text-muted); font-size: 14.5px; line-height: 1.55; }");
    expect(slice).toContain("color: var(--landing-vitrina-text-muted); font-size: 14px; font-weight: 600; line-height: 1.5; }");
    expect(slice).toContain(".landing-palmares-photo { position: relative; aspect-ratio: 3 / 2; border-radius: 11px; overflow: hidden; background: var(--landing-vitrina-photo-bg); }");
    expect(slice).toContain(".landing-palmares-row.pending .landing-palmares-year { color: var(--landing-medal-pending); }");
    expect(slice).toContain(".landing-palmares-body .landing-palmares-venue { color: var(--landing-vitrina-text-muted); font-size: 14px; line-height: 1.5; }");
    expect(slice).toContain(".landing-palmares-row.pending .landing-palmares-body b, .landing-palmares-row.pending .landing-palmares-body .landing-palmares-venue { color: var(--landing-medal-pending); }");
  });
});
