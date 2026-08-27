import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Issue #691: the institutional-stats band ("2013 / 12 / LOJA") and the
// ENTRENAMIENTOS section below it shared the same white grid background, so
// the boundary between the two disappeared. These locks read the authored
// stylesheet directly — jsdom cannot compute custom properties or ::before
// pseudo-elements — the same convention landing-palmares-colors.test.ts and
// landing-gallery.test.ts use for stylesheet-only contracts.
const landingCss = (): string =>
  readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");

/** Hue (0-360deg) of a `#rrggbb` literal, used to tell a warm neutral from a cool one. */
function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

describe("landing stats band separation", (): void => {
  it("gives the stats band and ENTRENAMIENTOS section different background values", (): void => {
    const css = landingCss();
    const statsBg = css.match(/\.landing-stats \{[^}]*background:\s*([^;]+);/)?.[1];
    const scheduleBg = css.match(/\.landing-schedule \{[^}]*background:\s*([^;]+);/)?.[1];
    expect(statsBg).toBeDefined();
    expect(scheduleBg).toBeDefined();
    expect(statsBg).not.toBe(scheduleBg);
  });

  it("keeps ENTRENAMIENTOS on the white surface token", (): void => {
    const css = landingCss();
    expect(css).toContain(".landing-schedule { background: var(--landing-surface); }");
  });

  it("declares a warm-toned stats background token, distinct in hue from the cool base token", (): void => {
    const css = landingCss();
    const statsBgToken = css.match(/--landing-stats-bg:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const baseBgToken = css.match(/--landing-bg-base:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(statsBgToken).toBeDefined();
    expect(baseBgToken).toBeDefined();
    const statsHue = hueOf(statsBgToken as string);
    const baseHue = hueOf(baseBgToken as string);
    // Warm = red/orange/yellow family, roughly 0-70deg on the hue wheel.
    expect(statsHue).toBeLessThan(70);
    // The existing landing neutral is cool (blue/cyan), around 200-220deg —
    // this is the tension the issue names: the palette's neutral isn't warm.
    expect(baseHue).toBeGreaterThan(150);
  });

  it("reads the stats band background from its own token, not the shared surface token", (): void => {
    const css = landingCss();
    expect(css).toMatch(/\.landing-stats \{[^}]*background:\s*var\(--landing-stats-bg\)/);
  });

  it("reduces the background grid's contrast on the stats band relative to other sections", (): void => {
    const css = landingCss();
    const generalMatch = css.match(/\.landing-section:not\(\.landing-motto\)::before \{[^}]*var\(--landing-brand-black\)\s*([\d.]+)%/);
    const statsMatch = css.match(/\.landing-stats::before \{[^}]*var\(--landing-brand-black\)\s*([\d.]+)%/);
    expect(generalMatch).toBeTruthy();
    expect(statsMatch).toBeTruthy();
    const generalPct = Number(generalMatch?.[1]);
    const statsPct = Number(statsMatch?.[1]);
    expect(statsPct).toBeGreaterThan(0);
    expect(statsPct).toBeLessThan(generalPct);
  });

  it("marks the stats/ENTRENAMIENTOS boundary with the existing hairline divider token", (): void => {
    const css = landingCss();
    expect(css).toMatch(/\.landing-stats \{[^}]*border-bottom:\s*1px solid var\(--landing-border\)/);
  });

  it("adds no shadow or per-stat card treatment to the individual stat blocks", (): void => {
    const css = landingCss();
    const statBlock = css.match(/\.landing-stat \{[^}]*\}/)?.[0] ?? "";
    expect(statBlock).not.toMatch(/box-shadow/);
    expect(statBlock).not.toMatch(/background/);
    expect(statBlock).not.toMatch(/border/);
  });

  it("does not override the stats background at the mobile breakpoint", (): void => {
    const css = landingCss();
    const mobileBlock = css.slice(css.indexOf("@media (max-width: 768px)"));
    const mobileStatsRule = mobileBlock.match(/\.landing-stats \{[^}]*\}/)?.[0] ?? "";
    expect(mobileStatsRule).not.toMatch(/background/);
  });
});
