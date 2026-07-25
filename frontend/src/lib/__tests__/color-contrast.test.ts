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

const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
const group = (key: string): Record<string, string> => colors[key] as Record<string, string>;

const cata = group("cata");
const ink = group("ink");
const state = group("state");
const coal = group("coal");

/** Page background shared by /trainer, /dashboard and friends. */
const PAGE_BG = "#F9FAFB";
/** `--canvas` — what the shell paints behind every page header. */
const CANVAS = colors.canvas as string;
/** `--paper` — the card/control surface. */
const PAPER = colors.paper as string;
/** The `.tbl thead th` fill: the one value the spec spells as a literal. */
const THEAD_BG = "#FAFAFB";

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

describe("/ranking — the unassigned-level chip", () => {
  // This used to guard a `Badge` reading "Sin asignar" in Tailwind greys. That
  // badge is gone: the unassigned rung on /ranking is now the `—` chip
  // (page.tsx:283-289), which wears the system's own neutral state pair. The
  // coverage follows the shipping markup rather than the retired one.
  it("meets AA for the em-dash chip on the neutral tint", () => {
    expect(contrastRatio(state.neutral, state["neutral-bg"])).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it("confirms the gray-400 the retired badge used would still fail today", () => {
    // Kept as a tripwire: 2.31:1 was the worst pair the audit found, and it is
    // the shape of mistake ("just use a lighter grey") most likely to recur.
    expect(contrastRatio("#9CA3AF", "#F3F4F6")).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("muted text on the canvas grey — kicker, subtitle, table head", () => {
  // The kicker ("Panel administrativo", "Área de entrenadores", …) and the
  // subtitle are two rules in PageHeader.tsx, and both sit on the `canvas` grey
  // the shell paints behind the header. The table head is the same problem on
  // the `#FAFAFB` fill.
  it("confirms ink-3 fails on both micro-label surfaces", () => {
    expect(contrastRatio(ink["3"], CANVAS)).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio(ink["3"], THEAD_BG)).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("keeps ink-3 itself, because it passes on paper", () => {
    // Why a companion and not a darker `ink-3`: the shared token is correct
    // everywhere it sits on `paper`, and darkening it would drag every muted
    // 12–13px line in the product darker for no accessibility gain.
    expect(contrastRatio(ink["3"], PAPER)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("meets AA with ink-3-strong on canvas, paper and the table-head fill", () => {
    expect(contrastRatio(ink["3-strong"], CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(ink["3-strong"], PAPER)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    expect(contrastRatio(ink["3-strong"], THEAD_BG)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("stays lighter than ink-2, so the eyebrow does not read as body ink", () => {
    expect(contrastRatio(ink["3-strong"], CANVAS)).toBeLessThan(
      contrastRatio(ink["2"], CANVAS),
    );
  });
});

describe("status badges — each foreground on its own -bg tint", () => {
  // `Badge` renders an 11.5px/700 label in `text-state-X` on `bg-state-X-bg`;
  // ErrorState, Stepper, ChatWidget and the enrollment notices reuse the same
  // pairing. The pair is the token's whole purpose, so it is the pair that has
  // to clear AA.
  it.each(["ok", "warn", "bad", "neutral"])("meets AA for %s", (tone) => {
    expect(contrastRatio(state[tone], state[`${tone}-bg`])).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it("confirms the three values the spec originally shipped did not", () => {
    // 4.49:1, 4.46:1 and 4.27:1 — all under, all measured.
    expect(contrastRatio("#157F3D", state["ok-bg"])).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio("#B45309", state["warn-bg"])).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio("#D92128", state["bad-bg"])).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("also improves the same foregrounds on paper and canvas", () => {
    for (const tone of ["ok", "warn", "bad"]) {
      expect(contrastRatio(state[tone], PAPER)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      expect(contrastRatio(state[tone], CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });
});

describe("sidebar rail — the two sub-labels on coal", () => {
  // Both are white at a fractional alpha, so the real foreground is the
  // composite against the surface underneath.
  const RAIL = coal.DEFAULT;
  /** The user card is `bg-white/[0.06]` over the rail. */
  const USER_CARD = compositeOver(PAPER, RAIL, 0.06);

  it("confirms the alphas the redesign shipped were under AA", () => {
    // "Panel de gestión" at 0.42 → 4.10:1, "Entrenador" at 0.45 → 4.35:1.
    expect(contrastRatio(compositeOver(PAPER, RAIL, 0.42), RAIL)).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio(compositeOver(PAPER, USER_CARD, 0.45), USER_CARD)).toBeLessThan(
      AA_NORMAL_TEXT,
    );
  });

  it("meets AA at 50% on both surfaces", () => {
    expect(contrastRatio(compositeOver(PAPER, RAIL, 0.5), RAIL)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(contrastRatio(compositeOver(PAPER, USER_CARD, 0.5), USER_CARD)).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
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
