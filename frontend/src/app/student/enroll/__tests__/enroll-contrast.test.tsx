/**
 * WCAG contrast table for the surface hierarchy `/student/enroll` gained in
 * #874: the enrollment wash, the stepper's three states and the red carve-out
 * on the selected choice card.
 *
 * Same instrument `color-contrast.test.ts` locks the app's tokens with
 * (`contrastRatio`, WCAG 2.1 §1.4.3/§1.4.11) and the same shape
 * `chat-contrast.test.tsx` (#873) uses for a page-specific surface —
 * `describe.each` over declared pairs, read straight off `tailwind.config`
 * rather than re-typed hex, so a token edit there cannot silently drift this
 * table out of date.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { contrastRatio } from "@/lib/color-contrast";
import tailwindConfig from "../../../../../tailwind.config";

const AA_NORMAL_TEXT = 4.5;
/** WCAG 1.4.11 — a border, ring or icon needs 3:1 against its neighbour. */
const AA_NON_TEXT = 3;
/** The surface-ladder floor `color-contrast.test.ts` already measured. */
const CARD_LIFT_FLOOR = 1.2;
const SUNKEN_ON_PAPER_FLOOR = 1.09;

const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
const group = (key: string): Record<string, string> => colors[key] as Record<string, string>;

const ink = group("ink");
const state = group("state");
const cata = group("cata");

const WASH = colors["enroll-wash"] as string;
const PAPER = colors.paper as string;
const SUNKEN = colors.sunken as string;
const CANVAS = colors.canvas as string;
const COAL = (group("coal") as Record<string, string>).DEFAULT;
const INK = ink.DEFAULT;
const INK_3_STRONG = ink["3-strong"];
const STATE_OK = state.ok;
const STATE_OK_BG = state["ok-bg"];
const CATA_RED = cata.red as string;
const CATA_RED_DARK = cata["red-dark"] as string;
const WHITE = "#FFFFFF";

interface Pair {
  readonly label: string;
  readonly fg: string;
  readonly bg: string;
  readonly threshold: number;
}

// ---------------------------------------------------------------------------
// Text pairs — WCAG 2.1 §1.4.3.
// ---------------------------------------------------------------------------

const TEXT_CONTRAST_PAIRS: readonly Pair[] = [
  // The header/context block's own eyebrow and heading (#874).
  { label: "heading — ink on enroll-wash", fg: INK, bg: WASH, threshold: AA_NORMAL_TEXT },
  { label: "eyebrow — ink-3-strong on enroll-wash", fg: INK_3_STRONG, bg: WASH, threshold: AA_NORMAL_TEXT },
  // The pending stepper pill's label, now on `sunken` instead of `paper`.
  { label: "pending pill text — ink-3-strong on sunken", fg: INK_3_STRONG, bg: SUNKEN, threshold: AA_NORMAL_TEXT },
  // The current stepper pill, unchanged by #874 but part of the same table.
  { label: "current pill text — white on coal", fg: WHITE, bg: COAL, threshold: AA_NORMAL_TEXT },
  // The completed stepper pill — now filled with its own tint, not `paper`.
  { label: "completed pill text — state-ok on state-ok-bg", fg: STATE_OK, bg: STATE_OK_BG, threshold: AA_NORMAL_TEXT },
  // `cata-red-dark` is what the scope asks for wherever red TEXT is needed on
  // a light surface — never the fill token, which fails AA there.
  { label: "cata-red-dark on paper", fg: CATA_RED_DARK, bg: PAPER, threshold: AA_NORMAL_TEXT },
  { label: "cata-red-dark on enroll-wash", fg: CATA_RED_DARK, bg: WASH, threshold: AA_NORMAL_TEXT },
];

describe.each(TEXT_CONTRAST_PAIRS)("$label", ({ fg, bg, threshold }) => {
  it(`clears ${threshold}:1`, () => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });
});

// ---------------------------------------------------------------------------
// Non-text boundaries — WCAG 2.1 §1.4.11.
// ---------------------------------------------------------------------------

const NON_TEXT_CONTRAST_PAIRS: readonly Pair[] = [
  // The primary button fill, unchanged — included because #874 leans on it
  // being the ONE place `cata-red` was already correct.
  { label: "primary button — white on cata-red", fg: WHITE, bg: CATA_RED, threshold: AA_NON_TEXT },
  // The selected choice card's new border/ring (#874's one carve-out from
  // "la regla del rojo único").
  { label: "selected card border — cata-red on paper", fg: CATA_RED, bg: PAPER, threshold: AA_NON_TEXT },
];

describe.each(NON_TEXT_CONTRAST_PAIRS)("$label", ({ fg, bg, threshold }) => {
  it(`clears ${threshold}:1`, () => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });
});

// ---------------------------------------------------------------------------
// Surface separation — the ladder's own established floors, reused rather
// than re-derived, to confirm #874 did not disturb them.
// ---------------------------------------------------------------------------

describe("surface ladder — paper still lifts off canvas", () => {
  it(`separates at least ${CARD_LIFT_FLOOR}:1`, () => {
    expect(contrastRatio(PAPER, CANVAS)).toBeGreaterThanOrEqual(CARD_LIFT_FLOOR);
  });
});

describe("surface ladder — sunken still separates from paper", () => {
  it(`separates at least ${SUNKEN_ON_PAPER_FLOOR}:1`, () => {
    expect(contrastRatio(SUNKEN, PAPER)).toBeGreaterThanOrEqual(SUNKEN_ON_PAPER_FLOOR);
  });
});

// ---------------------------------------------------------------------------
// The enrollment wash separates by WARMTH, not by lightness — a luminance
// floor is the wrong instrument here (see `tailwind.config.ts`'s own note:
// `enroll-wash` sits 1.06:1 from `paper`, well under the ladder's own
// 1.09:1 sunken/paper floor). What has to hold instead is that it is a real,
// distinct, warm token — not `paper` wearing a different name.
// ---------------------------------------------------------------------------

describe("enroll-wash — a warm tint, not a repaint of paper", () => {
  function channels(hex: string): readonly [number, number, number] {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  it("is a distinct hex from paper, sunken and canvas", () => {
    expect(WASH).not.toBe(PAPER);
    expect(WASH).not.toBe(SUNKEN);
    expect(WASH).not.toBe(CANVAS);
  });

  it("carries a warm cast — red channel ahead of green and blue", () => {
    const [r, g, b] = channels(WASH);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
});
