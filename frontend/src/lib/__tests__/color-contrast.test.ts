/**
 * WCAG 2.1 contrast regression tests for the design tokens and palette values
 * that a measured accessibility audit flagged as failing AA (1.4.3).
 *
 * These assert the actual hex values rather than class names, so a future
 * "tweak the brand pink a little" cannot silently push body text back below
 * 4.5:1. Each pair below is a real foreground/background combination that
 * ships in the UI, including the alpha compositing Tailwind's `/nn` opacity
 * modifiers perform against the surface underneath.
 */

import { describe, it, expect } from "vitest";
import tailwindConfig from "../../../tailwind.config";

// ---------------------------------------------------------------------------
// WCAG relative luminance / contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio)
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ] as const;
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [
    relativeLuminance(parseHex(foreground)),
    relativeLuminance(parseHex(background)),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composite a translucent foreground over an opaque background (Tailwind's `/nn`). */
export function compositeOver(foreground: string, background: string, alpha: number): string {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  return `#${fg
    .map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const AA_NORMAL_TEXT = 4.5;

// ---------------------------------------------------------------------------
// Token values under test
// ---------------------------------------------------------------------------

const cata = (tailwindConfig.theme?.extend?.colors as { cata: Record<string, string> }).cata;

/** Page background shared by /trainer, /dashboard and friends. */
const PAGE_BG = "#F9FAFB";
/** Tailwind `gray-100`, the "Sin asignar" badge fill. */
const GRAY_100 = "#F3F4F6";
/** Tailwind `gray-700`, the badge's text color after the fix. */
const GRAY_700 = "#374151";

describe("contrastRatio helper", () => {
  it("returns 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("returns 1 for identical colors", () => {
    expect(contrastRatio("#D92128", "#D92128")).toBeCloseTo(1, 5);
  });

  it("is symmetric in its arguments", () => {
    expect(contrastRatio("#374151", "#F3F4F6")).toBeCloseTo(contrastRatio("#F3F4F6", "#374151"), 5);
  });
});

describe("/ranking — 'Sin asignar' nivel badge", () => {
  // Measured at 2.31:1 (gray-400 #9CA3AF on gray-100) — the worst pair in the
  // whole app, and it labels a real, actionable state.
  it("no longer uses the gray-400 that measured 2.31:1", () => {
    expect(contrastRatio("#9CA3AF", GRAY_100)).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("meets AA with gray-700 on the gray-100 badge fill", () => {
    expect(contrastRatio(GRAY_700, GRAY_100)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe("/trainer — fuchsia quick-action cards", () => {
  // The cards are `bg-cata-fuchsia/10` over the page background, so the real
  // backdrop is the composited tint, NOT #F9FAFB. Measured against the tint
  // the original brand pink is 3.38:1 — even worse than the 3.85:1 an audit
  // computed against the bare page background.
  const cardBg = compositeOver(cata.fuchsia, PAGE_BG, 0.1);
  const cardHoverBg = compositeOver(cata.fuchsia, PAGE_BG, 0.15);

  it("confirms the original brand pink fails AA as body text on the tinted card", () => {
    expect(contrastRatio(cata.fuchsia, cardBg)).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("exposes a dedicated ink token for fuchsia text on light surfaces", () => {
    expect(cata["fuchsia-ink"]).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("meets AA for the card title in both resting and hover states", () => {
    expect(contrastRatio(cata["fuchsia-ink"], cardBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(cata["fuchsia-ink"], cardHoverBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("meets AA for the card subtitle, which renders at 90% opacity", () => {
    // The subtitle used to be `text-cata-fuchsia/60` — 60% alpha of the brand
    // pink is 2.15:1. It now uses the ink token at 90%.
    expect(
      contrastRatio(compositeOver(cata["fuchsia-ink"], cardBg, 0.9), cardBg),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(
      contrastRatio(compositeOver(cata["fuchsia-ink"], cardHoverBg, 0.9), cardHoverBg),
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // Why a NEW token instead of darkening `cata-fuchsia` itself: Header.tsx
  // uses `hover:text-cata-fuchsia` against the near-black `cata-black` bar,
  // where the bright pink is a correct, passing choice. Darkening the shared
  // token to fix the light cards would have broken that usage.
  it("keeps the original brand pink readable on the dark header, so the shared token must not be darkened", () => {
    expect(contrastRatio(cata.fuchsia, cata.black)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(cata["fuchsia-ink"], cata.black)).toBeLessThan(AA_NORMAL_TEXT);
  });
});
