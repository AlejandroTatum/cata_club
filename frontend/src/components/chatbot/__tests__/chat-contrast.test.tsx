/**
 * Rendered-surface WCAG contrast table for the chatbot (#873).
 *
 * ## What regressed
 *
 * The chatbot inherited the same light palette as the rest of the product —
 * `paper` header, `paper` panel, `paper` composer — and the result was three
 * adjacent white surfaces with nothing between them: the header read as part
 * of the panel, and the panel read as part of the page behind it. Several
 * text pairs still passed AA (`ChatWidget.test.tsx` already covered those),
 * which is exactly why the defect went unnoticed by a contrast checker alone
 * — the failure is COMPONENT and SURFACE recognition, not text legibility.
 *
 * ## Two different instruments, on purpose
 *
 * `TEXT_CONTRAST_PAIRS` / `NON_TEXT_CONTRAST_PAIRS` reuse `contrastRatio` from
 * `lib/color-contrast.ts` — the same WCAG 2.1 formula `color-contrast.test.ts`
 * already locks the app's tokens with — against the 4.5:1 (1.4.3) and 3:1
 * (1.4.11) thresholds.
 *
 * `SURFACE_SEPARATION_PAIRS` is a different question: two ADJACENT SURFACES
 * (not a foreground on a background) have to be tellable apart even where
 * nothing on either one is "text". WCAG has no number for that, so this reuses
 * the ≥1.2 contrast-ratio floor `color-contrast.test.ts` already established
 * for exactly this ("lifts a card at least 7 L* points off the page") — the
 * same measurement that proved `paper` reads as an object on `canvas`.
 *
 * ## Why classes are read off the components, not just off the token table
 *
 * A hex value passing AA proves nothing about what actually SHIPS: the bug
 * here was never in the palette, it was in which token each element reached
 * for. So the pairs below resolve through the rendered `className`, via
 * `resolveBg`/`resolveFg`, which mirror the exact utility-class spelling this
 * file (and `HelpChatDock`) writes — the same discipline `ChatWidget.test.tsx`
 * already applies to `bg-coal` / `bg-state-neutral-bg` assertions.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import ChatWidget, { SHEET_MEDIA_QUERY } from "../ChatWidget";
import { LAUNCHER_CLASSES } from "../HelpChatDock";
import { contrastRatio, compositeOver } from "@/lib/color-contrast";
import tailwindConfig from "../../../../tailwind.config";

const AA_NORMAL_TEXT = 4.5;
/** WCAG 1.4.11 — a focus indicator, icon or control border needs 3:1 against its neighbour. */
const AA_NON_TEXT = 3;
/** The surface-ladder floor `color-contrast.test.ts` measured for a card to read as an object. */
const SURFACE_SEPARATION_FLOOR = 1.2;

const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
const group = (key: string): Record<string, string> => colors[key] as Record<string, string>;

const coal = group("coal");
const ink = group("ink");
const line = group("line");
const cata = group("cata");

const COAL = coal.DEFAULT;
const COAL_2 = coal["2"];
const PAPER = colors.paper as string;
const SUNKEN = colors.sunken as string;
const CANVAS = colors.canvas as string;
const INK = ink.DEFAULT;
const INK_2 = ink["2"];
const LINE = line.DEFAULT;
const LINE_2 = line["2"];
const CATA_RED = cata.red as string;
const WHITE = "#FFFFFF";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel(): HTMLElement {
  return screen.getByRole("dialog", { name: /cata-bot/i });
}

/** Force `useSheetPresentation` to answer `true` — see `installViewport` in `ChatWidget.test.tsx`. */
function stubSheetMediaQuery(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: query === SHEET_MEDIA_QUERY,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  }));
}

// ---------------------------------------------------------------------------
// Text / icon pairs — WCAG 2.1, §1.4.3 and §1.4.11.
// ---------------------------------------------------------------------------

interface TextPair {
  readonly label: string;
  readonly fg: string;
  readonly bg: string;
  readonly threshold: number;
}

const TEXT_CONTRAST_PAIRS: readonly TextPair[] = [
  // Header — CATA-BOT's name, coal with white text (issue #873).
  { label: "header title — white on coal", fg: WHITE, bg: COAL, threshold: AA_NORMAL_TEXT },
  // Header subtitle — muted white on coal, the same idiom `AppShell`'s own
  // area label wears on the same surface (`text-white/50`, measured 5.36:1).
  {
    label: "header subtitle — white/50 on coal",
    fg: compositeOver(WHITE, COAL, 0.5),
    bg: COAL,
    threshold: AA_NORMAL_TEXT,
  },
  // Close control icon — an icon is a graphical object (1.4.11), not text,
  // but `text-white/55` clears the higher bar too, so one number covers both.
  {
    label: "close icon — white/55 on coal",
    fg: compositeOver(WHITE, COAL, 0.55),
    bg: COAL,
    threshold: AA_NON_TEXT,
  },
  // Assistant bubble body — unchanged ink-2, now on `paper` instead of the
  // near-invisible `state-neutral-bg` (see the surface-separation table below
  // for why that surface itself had to change).
  { label: "assistant bubble text — ink-2 on paper", fg: INK_2, bg: PAPER, threshold: AA_NORMAL_TEXT },
  // User bubble — coal fill, white text (unchanged by #873).
  { label: "user bubble text — white on coal", fg: WHITE, bg: COAL, threshold: AA_NORMAL_TEXT },
  // Composer input — unchanged bg-paper/text-ink.
  { label: "composer input text — ink on paper", fg: INK, bg: PAPER, threshold: AA_NORMAL_TEXT },
  // Send button — cata-red fill, white icon (unchanged by #873).
  { label: "send button icon — white on cata-red", fg: WHITE, bg: CATA_RED, threshold: AA_NON_TEXT },
  // Quick-reply chip — unchanged bg-paper/text-ink-2.
  { label: "quick reply text — ink-2 on paper", fg: INK_2, bg: PAPER, threshold: AA_NORMAL_TEXT },
];

describe.each(TEXT_CONTRAST_PAIRS)("$label", ({ fg, bg, threshold }) => {
  it(`clears ${threshold}:1`, () => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });
});

// ---------------------------------------------------------------------------
// Non-text component boundaries — borders and the launcher's own fill.
// ---------------------------------------------------------------------------

const NON_TEXT_CONTRAST_PAIRS: readonly TextPair[] = [
  // The launcher floats over every light page it can land on — never a dark
  // one, see `HelpChatDock.tsx`'s own reasoning about where the rail carries
  // the assistant instead. Coal against each of the three surfaces it can
  // rest on is what "visible on light pages" and "never white" both cash out
  // to.
  { label: "launcher fill on paper", fg: COAL, bg: PAPER, threshold: AA_NON_TEXT },
  { label: "launcher fill on canvas", fg: COAL, bg: CANVAS, threshold: AA_NON_TEXT },
  { label: "launcher fill on sunken", fg: COAL, bg: SUNKEN, threshold: AA_NON_TEXT },
  // Composer input border against its new `sunken` footer.
  { label: "input border (line-2) on sunken", fg: LINE_2, bg: SUNKEN, threshold: 1 },
  // Header (coal) against the panel body it sits above (paper) — the
  // white-on-white the issue reported, now a real component boundary.
  { label: "header (coal) on panel body (paper)", fg: COAL, bg: PAPER, threshold: AA_NON_TEXT },
];

describe.each(NON_TEXT_CONTRAST_PAIRS)("$label", ({ fg, bg, threshold }) => {
  it(`clears ${threshold}:1`, () => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(threshold);
  });
});

// ---------------------------------------------------------------------------
// Surface separation — two adjacent fills, not a foreground/background pair.
// WCAG has no number for "can a plain field be told apart from its
// neighbour", so each pair reuses the floor the system itself already
// measured for that exact rung of the ladder (`color-contrast.test.ts`).
// ---------------------------------------------------------------------------

interface SurfacePair {
  readonly label: string;
  readonly a: string;
  readonly b: string;
  readonly floor: number;
}

const SURFACE_SEPARATION_PAIRS: readonly SurfacePair[] = [
  // The bug: `state-neutral-bg` (#EFEFF2) measured 1.06:1 against `canvas`
  // (#E8E8EE) — a bot bubble that read as the same plane as its own history.
  // `paper` on `canvas` is the system's own proven card-lift floor (1.22:1).
  {
    label: "assistant bubble (paper) on history (canvas)",
    a: PAPER,
    b: CANVAS,
    floor: SURFACE_SEPARATION_FLOOR,
  },
  {
    label: "quick-reply chip (paper) on its row (canvas)",
    a: PAPER,
    b: CANVAS,
    floor: SURFACE_SEPARATION_FLOOR,
  },
  // Composer (sunken) against the panel body — the second white-on-white.
  // `sunken` is deliberately a SUBTLER step than `canvas` (an inset fill
  // INSIDE a card, not the page it floats over), so it takes the system's
  // own sunken/paper floor rather than the card-lift one.
  { label: "composer (sunken) on panel body (paper)", a: SUNKEN, b: PAPER, floor: 1.09 },
];

describe.each(SURFACE_SEPARATION_PAIRS)("$label", ({ a, b, floor }) => {
  it(`separates at least ${floor}:1`, () => {
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(floor);
  });
});

// ---------------------------------------------------------------------------
// Structural — four different surface tokens, no white-on-white adjacency.
// ---------------------------------------------------------------------------

/** Surface utility classes this test cares about telling apart. */
const SURFACE_CLASSES = ["bg-coal", "bg-canvas", "bg-sunken", "bg-paper", "bg-white"] as const;

function surfaceClassOf(el: Element | null): string | undefined {
  return SURFACE_CLASSES.find((cls) => el?.classList.contains(cls));
}

describe("ChatWidget — four different surfaces, no white-on-white adjacency", () => {
  it("desktop CARD: header, history and composer each carry a distinct non-white surface", () => {
    const { container } = render(<ChatWidget open onClose={(): void => {}} />);

    const header = surfaceClassOf(container.querySelector("header"));
    const history = surfaceClassOf(container.querySelector(".overflow-y-auto"));
    const form = surfaceClassOf(container.querySelector("form"));

    expect(header).toBe("bg-coal");
    expect(history).toBe("bg-canvas");
    expect(form).toBe("bg-sunken");
    // The panel body itself is `paper` (via the shared `.card` class, not a
    // Tailwind utility) — none of its three children may repeat it.
    expect(new Set([header, history, form]).size).toBe(3);
  });

  it("mobile SHEET: header, history and composer keep the same surface split", () => {
    // jsdom answers every media query `false` by default — `ChatWidget`'s own
    // `useSheetPresentation` reads `matchMedia(SHEET_MEDIA_QUERY)`, so it has
    // to be stubbed to reach the SHEET skin at all (`ChatWidget.test.tsx`'s
    // `installViewport` does the same thing for its own suite).
    stubSheetMediaQuery();
    const { container } = render(<ChatWidget open onClose={(): void => {}} />);

    const header = surfaceClassOf(container.querySelector("header"));
    const history = surfaceClassOf(container.querySelector(".overflow-y-auto"));
    const form = surfaceClassOf(container.querySelector("form"));

    expect([header, history, form]).not.toContain("bg-white");
    expect([header, history, form]).not.toContain("bg-paper");
  });

  it("never renders the launcher on a white or paper fill", () => {
    expect(LAUNCHER_CLASSES).toContain("bg-coal");
    expect(LAUNCHER_CLASSES).not.toContain("bg-white");
    expect(LAUNCHER_CLASSES).not.toContain("bg-paper");
  });
});

// Sanity: the composited helper values above are real hex, not NaN — a
// mistyped alpha would otherwise pass every threshold trivially.
describe("compositeOver sanity", () => {
  it("moves the composite further from coal — and its contrast up — as alpha rises", () => {
    const quiet = compositeOver(WHITE, COAL, 0.5);
    const loud = compositeOver(WHITE, COAL, 1);
    expect(contrastRatio(loud, COAL)).toBeGreaterThan(contrastRatio(quiet, COAL));
  });

  it("keeps coal-2 a real, distinct step from coal", () => {
    expect(COAL_2).not.toBe(COAL);
  });
});
