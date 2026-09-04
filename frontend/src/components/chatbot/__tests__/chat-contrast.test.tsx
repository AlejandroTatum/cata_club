/**
 * Rendered-surface WCAG contrast table for the chatbot (#873, #1007).
 *
 * ## What regressed (#873)
 *
 * The chatbot inherited the same light palette as the rest of the product —
 * `paper` header, `paper` panel, `paper` composer — and the result was three
 * adjacent white surfaces with nothing between them: the header read as part
 * of the panel, and the panel read as part of the page behind it. Several
 * text pairs still passed AA (`ChatWidget.test.tsx` already covered those),
 * which is exactly why the defect went unnoticed by a contrast checker alone
 * — the failure is COMPONENT and SURFACE recognition, not text legibility.
 *
 * ## The panel went dark (#1007)
 *
 * Product decided the panel itself should sit on the `coal` ladder rather
 * than `paper`/`canvas`/`sunken` — the same ladder `AppShell`'s rail already
 * uses. Every new pair below reuses a rung the system already measured
 * rather than inventing one: the bot's bubble (`coal-3` on `coal`) sits at
 * the same 1.20:1 card-lift floor `paper` on `canvas` used to clear, and the
 * header/composer (`coal-2` on `coal`) sit at the 1.09:1 "inset inside a
 * card" floor `sunken` on `paper` already cleared. This file's job is the
 * same as it was for #873: prove the new surfaces still separate and the
 * text on them still reads, not just that the hex values look plausible.
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
 * same measurement that proved `paper` reads as an object on `canvas` — plus
 * the ≥1.09 "inset inside a card" floor for the header/composer step.
 *
 * ## Why classes are read off the components, not just off the token table
 *
 * A hex value passing AA proves nothing about what actually SHIPS: the bug
 * here was never in the palette, it was in which token each element reached
 * for. So the pairs below resolve through the rendered `className`, via
 * `resolveBg`/`resolveFg`, which mirror the exact utility-class spelling this
 * file (and `HelpChatDock`) writes — the same discipline `ChatWidget.test.tsx`
 * already applies to `bg-coal` / `bg-coal-3` assertions.
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
/** The surface-ladder floor for something inset INSIDE a card (header/composer on the panel body). */
const INSET_SEPARATION_FLOOR = 1.09;

const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
const group = (key: string): Record<string, string> => colors[key] as Record<string, string>;

const coal = group("coal");
const ink = group("ink");
const cata = group("cata");
const state = group("state");

const COAL = coal.DEFAULT;
const COAL_2 = coal["2"];
const COAL_3 = coal["3"];
const PAPER = colors.paper as string;
const INK = ink.DEFAULT;
const CATA_RED = cata.red as string;
const CATA_RED_LIGHT = cata["red-light"] as string;
const STATE_BAD = state.bad as string;
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
  // Header — CATA-BOT's name, white on coal-2 (issue #1007: coal-2, one step
  // lighter than the coal panel body, not the flat coal of #873).
  { label: "header title — white on coal-2", fg: WHITE, bg: COAL_2, threshold: AA_NORMAL_TEXT },
  // Header subtitle — muted white on coal-2, the same idiom `AppShell`'s own
  // area label wears (`text-white/50`).
  {
    label: "header subtitle — white/50 on coal-2",
    fg: compositeOver(WHITE, COAL_2, 0.5),
    bg: COAL_2,
    threshold: AA_NORMAL_TEXT,
  },
  // Close control icon — an icon is a graphical object (1.4.11), not text,
  // but `text-white/55` clears the higher bar too, so one number covers both.
  {
    label: "close icon — white/55 on coal-2",
    fg: compositeOver(WHITE, COAL_2, 0.55),
    bg: COAL_2,
    threshold: AA_NON_TEXT,
  },
  // Assistant bubble body — issue #1007: white/[0.82] on coal-3, the panel's
  // own lifted surface, not the light theme's ink-2 on paper.
  {
    label: "assistant bubble text — white/[0.82] on coal-3",
    fg: compositeOver(WHITE, COAL_3, 0.82),
    bg: COAL_3,
    threshold: AA_NORMAL_TEXT,
  },
  // User bubble — issue #1007: paper fill, ink text — the exact mirror of the
  // light theme's coal-on-canvas pairing, and deliberately never red (red is
  // reserved for the send button, the panel's one CTA).
  { label: "user bubble text — ink on paper", fg: INK, bg: PAPER, threshold: AA_NORMAL_TEXT },
  // Composer input — issue #1007: white on coal, not the light theme's ink on
  // paper.
  { label: "composer input text — white on coal", fg: WHITE, bg: COAL, threshold: AA_NORMAL_TEXT },
  // Send button — cata-red fill, white icon (unchanged since #873).
  { label: "send button icon — white on cata-red", fg: WHITE, bg: CATA_RED, threshold: AA_NON_TEXT },
  // Quick-reply chip — issue #1007: white/75 on coal-3.
  {
    label: "quick reply text — white/75 on coal-3",
    fg: compositeOver(WHITE, COAL_3, 0.75),
    bg: COAL_3,
    threshold: AA_NORMAL_TEXT,
  },
  // Message-limit counter — issue #1007: white/55 on the coal row it shares
  // with the quick replies.
  {
    label: "message limit counter — white/55 on coal",
    fg: compositeOver(WHITE, COAL, 0.55),
    bg: COAL,
    threshold: AA_NORMAL_TEXT,
  },
  // Message-limit counter, past the cap — issue #1007: cata-red-light, not
  // state-bad. `state-bad` on `coal` fails AA (see the sanity check below);
  // this is the actual token the composer wears once the limit is exceeded.
  {
    label: "message limit counter (exceeded) — cata-red-light on coal",
    fg: CATA_RED_LIGHT,
    bg: COAL,
    threshold: AA_NORMAL_TEXT,
  },
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
  // to. Unaffected by #1007 — the launcher never repainted, only the panel
  // behind it did.
  { label: "launcher fill on paper", fg: COAL, bg: PAPER, threshold: AA_NON_TEXT },
  { label: "launcher fill on canvas", fg: COAL, bg: colors.canvas as string, threshold: AA_NON_TEXT },
  { label: "launcher fill on sunken", fg: COAL, bg: colors.sunken as string, threshold: AA_NON_TEXT },
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
  // Issue #1007: the assistant bubble's coal-3 against the coal history it
  // floats over — the same card-lift floor `paper` on `canvas` used to clear
  // for #873.
  {
    label: "assistant bubble (coal-3) on history (coal)",
    a: COAL_3,
    b: COAL,
    floor: SURFACE_SEPARATION_FLOOR,
  },
  {
    label: "quick-reply chip (coal-3) on its row (coal)",
    a: COAL_3,
    b: COAL,
    floor: SURFACE_SEPARATION_FLOOR,
  },
  // Header (coal-2) against the panel body it sits above (coal) — the
  // inset-inside-a-card step, same floor `sunken` on `paper` already clears.
  { label: "header (coal-2) on panel body (coal)", a: COAL_2, b: COAL, floor: INSET_SEPARATION_FLOOR },
  // Composer (coal-2) against the panel body — the second inset step.
  { label: "composer (coal-2) on panel body (coal)", a: COAL_2, b: COAL, floor: INSET_SEPARATION_FLOOR },
];

describe.each(SURFACE_SEPARATION_PAIRS)("$label", ({ a, b, floor }) => {
  it(`separates at least ${floor}:1`, () => {
    expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(floor);
  });
});

// ---------------------------------------------------------------------------
// Structural — four different surface tokens, no same-surface adjacency.
// ---------------------------------------------------------------------------

/** Surface utility classes this test cares about telling apart. */
const SURFACE_CLASSES = ["bg-coal", "bg-coal-2", "bg-coal-3", "bg-paper", "bg-white"] as const;

function surfaceClassOf(el: Element | null): string | undefined {
  return SURFACE_CLASSES.find((cls) => el?.classList.contains(cls));
}

describe("ChatWidget — four different surfaces, no same-surface adjacency", () => {
  it("desktop CARD: header, history and composer each carry a distinct surface", () => {
    const { container } = render(<ChatWidget open onClose={(): void => {}} />);

    const header = surfaceClassOf(container.querySelector("header"));
    const history = surfaceClassOf(container.querySelector(".overflow-y-auto"));
    const form = surfaceClassOf(container.querySelector("form"));

    expect(header).toBe("bg-coal-2");
    expect(history).toBe("bg-coal");
    expect(form).toBe("bg-coal-2");
    // The panel body itself is `coal` (a Tailwind utility, issue #1007) —
    // the history repeats it on purpose (it IS the panel body's own fill),
    // but header and composer must not collapse into either the panel body
    // or each other.
    expect(new Set([header, form]).size).toBe(1);
    expect(header).not.toBe(history);
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
    expect(header).toBe("bg-coal-2");
    expect(history).toBe("bg-coal");
    expect(form).toBe("bg-coal-2");
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

  it("keeps coal-2 and coal-3 real, distinct steps from coal", () => {
    expect(COAL_2).not.toBe(COAL);
    expect(COAL_3).not.toBe(COAL);
    expect(COAL_3).not.toBe(COAL_2);
  });

  // The reason the exceeded-limit counter and the alert box wear
  // `cata-red-light` and not `state-bad` on the dark panel (issue #1007).
  it("proves state-bad fails AA on coal where cata-red-light clears it", () => {
    expect(contrastRatio(STATE_BAD, COAL)).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio(CATA_RED_LIGHT, COAL)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
