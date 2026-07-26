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

/** Perceptual lightness, for reasoning about surface steps rather than text. */
export function lightness(hex: string): number {
  const y = relativeLuminance(parseHex(hex));
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

const AA_NORMAL_TEXT = 4.5;
/** WCAG 1.4.11 — a focus indicator must clear 3:1 against its adjacent colours. */
const AA_NON_TEXT = 3;

// ---------------------------------------------------------------------------
// Token values under test
// ---------------------------------------------------------------------------

const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
const group = (key: string): Record<string, string> => colors[key] as Record<string, string>;

const cata = group("cata");
const ink = group("ink");
const state = group("state");
const coal = group("coal");

const line = group("line");

/** `--canvas` — the page field. `AppShell` paints it, `body` matches it. */
const CANVAS = colors.canvas as string;
/** `--paper` — the card/control surface. */
const PAPER = colors.paper as string;
/** The inset fill inside a card: table heads, pagers, modal footers. */
const SUNKEN = colors.sunken as string;
/**
 * The page background every screen actually renders on. It used to be the
 * literal #F9FAFB the `body` rule carried, which was neither the shell's
 * `canvas` nor a token; both now resolve to the same value.
 */
const PAGE_BG = CANVAS;
/** Kept under its old name because the table head is what it dresses. */
const THEAD_BG = SUNKEN;

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

describe("the surface ladder — canvas, sunken, paper", () => {
  // The user-visible complaint these numbers answer: "ese fondo gris y cards
  // blanco no me gusta, no da contraste". The old pair was #F5F5F7 under
  // #FFFFFF — 1.089:1, a 3.4-point L* step, which is under the threshold
  // where a flat field reads as a plane of its own, so a screen of stacked
  // cards looked like one washed sheet.
  const OLD_CANVAS = "#F5F5F7";

  it("confirms the separation the spec shipped was the flat one", () => {
    expect(contrastRatio(PAPER, OLD_CANVAS)).toBeLessThan(1.1);
    expect(lightness(PAPER) - lightness(OLD_CANVAS)).toBeLessThan(4);
  });

  it("lifts a card at least 7 L* points off the page", () => {
    expect(contrastRatio(PAPER, CANVAS)).toBeGreaterThanOrEqual(1.2);
    expect(lightness(PAPER) - lightness(CANVAS)).toBeGreaterThanOrEqual(7);
  });

  it("keeps sunken between the two, so an inset area reads inside the card", () => {
    expect(lightness(CANVAS)).toBeLessThan(lightness(SUNKEN));
    expect(lightness(SUNKEN)).toBeLessThan(lightness(PAPER));
    // It also has to be a fill you can SEE on white — the #FAFAFB literal it
    // replaces was 1.043:1, which is nothing.
    expect(contrastRatio(SUNKEN, PAPER)).toBeGreaterThanOrEqual(1.09);
  });

  it("draws a card edge that is visible on both surfaces it borders", () => {
    // One `line` token has to work as the card outline against the canvas AND
    // as a row divider on paper. The spec's #E9E9EC is the failure case: on
    // this canvas it is the same luminance as the page.
    expect(contrastRatio("#E9E9EC", CANVAS)).toBeLessThan(1.02);
    expect(contrastRatio(line.DEFAULT, CANVAS)).toBeGreaterThanOrEqual(1.08);
    expect(contrastRatio(line.DEFAULT, PAPER)).toBeGreaterThanOrEqual(1.3);
  });

  it("gives a control a firmer border than a divider", () => {
    expect(contrastRatio(line["2"], PAPER)).toBeGreaterThan(
      contrastRatio(line.DEFAULT, PAPER),
    );
    expect(contrastRatio(line["2"], PAPER)).toBeGreaterThanOrEqual(1.5);
  });
});

describe("every foreground that lands on the deepened canvas", () => {
  // Deepening the page field costs contrast on the page field. This is the
  // list of tokens that pay for it, and the reason the canvas stops where it
  // does: one more step to #E4E4EC drops state-warn to 4.43:1.
  const ON_CANVAS = {
    ink: ink.DEFAULT,
    "ink-2": ink["2"],
    "ink-3-strong": ink["3-strong"],
    "state-ok": state.ok,
    "state-warn": state.warn,
    "state-bad": state.bad,
    "state-neutral": state.neutral,
  };

  it.each(Object.entries(ON_CANVAS))("meets AA for %s on canvas", (_name, value) => {
    expect(contrastRatio(value, CANVAS)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("pins the canvas at the darkest value the palette can carry", () => {
    const oneStepDarker = "#E4E4EC";
    expect(contrastRatio(state.warn, oneStepDarker)).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("the system focus ring — globals.css", () => {
  // The ring is two concentric 2px bands: `ball` hugging the control (the
  // box-shadow spread) and `coal` around it (the outline at a matching 2px
  // offset). The rule these numbers guard is at the bottom of `globals.css`.
  const RING_INNER = colors.ball as Record<string, string>;
  const BALL = RING_INNER.DEFAULT;
  const RING_OUTER = coal.DEFAULT;
  /** Every surface a focused control can sit on. */
  const SURFACES = { paper: PAPER, sunken: SUNKEN, canvas: CANVAS };

  it("confirms the bare ball fails on every light surface, which is why it was replaced", () => {
    // `focus-visible:outline-ball` was transcribed from `_sistema.css:80` into
    // 12 component files. This is the measurement that retired it.
    for (const surface of Object.values(SURFACES)) {
      expect(contrastRatio(BALL, surface)).toBeLessThan(AA_NON_TEXT);
    }
  });

  it("confirms the translucent red rings globals.css used to draw also failed", () => {
    // `focus:ring-cata-red/15`, `/30` and `focus:border-cata-red/40` — the
    // only other focus vocabulary the product had.
    expect(contrastRatio(compositeOver(cata.red, PAPER, 0.15), PAPER)).toBeLessThan(AA_NON_TEXT);
    expect(contrastRatio(compositeOver(cata.red, PAPER, 0.3), PAPER)).toBeLessThan(AA_NON_TEXT);
    expect(contrastRatio(compositeOver(cata.red, PAPER, 0.4), PAPER)).toBeLessThan(AA_NON_TEXT);
  });

  it.each(Object.entries(SURFACES))(
    "clears 3:1 with the coal band against %s",
    (_name, surface) => {
      expect(contrastRatio(RING_OUTER, surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  it("clears 3:1 with the coal band against the CTA red, the darkest control fill", () => {
    // A focused primary button: the ball band touches the red fill, the coal
    // band touches the page. The pair that could fail is coal against red.
    expect(contrastRatio(RING_OUTER, cata.red)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("keeps the two bands distinguishable from each other", () => {
    expect(contrastRatio(BALL, RING_OUTER)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("keeps the ball band as the visible indicator on the coal sidebar", () => {
    // On the rail the coal band merges into the surface, so the ball is what
    // marks focus — which is exactly the value `_sistema.css` specified, at
    // the contrast it was designed for.
    expect(contrastRatio(BALL, coal.DEFAULT)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(BALL, coal["2"])).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrastRatio(BALL, coal["3"])).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("the two focus rings the system rule cannot reach", () => {
  // Two indicators are drawn by hand instead of by the `globals.css` rule,
  // and neither can be folded into it:
  //
  //   · `members/page.tsx` puts a `focus-within` ring on the <label> wrapping
  //     an `sr-only` checkbox — a <label> is not in the rule's `:is(…)` list,
  //     and the ring has to sit on the box the user can see, not on the 1x1
  //     control that actually holds focus.
  //   · `payments/page.tsx` puts a `focus-visible` ring on an
  //     `h2[tabindex="-1"]` — the rule explicitly excludes `[tabindex="-1"]`,
  //     because a programmatic focus target is not a Tab stop.
  //
  // Both shipped as a bare `outline-ball`, i.e. the exact 1.41:1 failure the
  // system rule exists to correct. They now carry the same two-band pair.
  const BALL = (colors.ball as Record<string, string>).DEFAULT;
  const COMPANION = coal.DEFAULT;
  const SURFACES = { paper: PAPER, sunken: SUNKEN, canvas: CANVAS };

  it("confirms the bare ball ring both controls used to draw was 1.41:1 on paper", () => {
    expect(contrastRatio(BALL, PAPER)).toBeLessThan(AA_NON_TEXT);
    expect(contrastRatio(BALL, PAPER)).toBeCloseTo(1.41, 2);
  });

  it.each(Object.entries(SURFACES))(
    "clears 3:1 with the coal companion band against %s",
    (_name, surface) => {
      expect(contrastRatio(COMPANION, surface)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    },
  );

  it("clears 3:1 between the ball band and its coal companion", () => {
    expect(contrastRatio(BALL, COMPANION)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("clears 3:1 with the coal band against the two chip fills the members ring sits on", () => {
    // A role chip is `bg-paper` when unselected and `bg-coal/[0.04]` when
    // selected; the ring has to read on both.
    expect(contrastRatio(COMPANION, PAPER)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(
      contrastRatio(COMPANION, compositeOver(coal.DEFAULT, PAPER, 0.04)),
    ).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("muted small print that sits OUTSIDE a card", () => {
  // Three measured failures, all the same mistake: `ink-3` (or a translucent
  // `cata-text`) on a surface that is not `paper`.
  //
  //   · /login's security note ....... ink-3 on `canvas` .. 3.78:1
  //   · /student/enroll's step line .. ink-3 on `sunken` .. 4.21:1
  //     (the body fill is `bg-cata-bg`, i.e. `sunken`, not `paper`)
  //   · the enrol dev panel .......... cata-text/45 ....... 2.61:1
  //                                 .. cata-text/40 ....... 2.31:1
  it("confirms ink-3 fails on the two non-paper surfaces small print lands on", () => {
    expect(contrastRatio(ink["3"], CANVAS)).toBeLessThan(AA_NORMAL_TEXT);
    expect(contrastRatio(ink["3"], SUNKEN)).toBeLessThan(AA_NORMAL_TEXT);
  });

  it("confirms translucent cata-text was the worst pair in the product", () => {
    expect(contrastRatio(compositeOver(cata.text, SUNKEN, 0.4), SUNKEN)).toBeLessThan(3);
    expect(contrastRatio(compositeOver(cata.text, SUNKEN, 0.45), SUNKEN)).toBeLessThan(3);
  });

  it("meets AA with ink-3-strong on every surface those lines land on", () => {
    for (const surface of [PAPER, SUNKEN, CANVAS]) {
      expect(contrastRatio(ink["3-strong"], surface)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
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
  // the `sunken` fill.
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
  // backdrop is the composited tint, not the bare page. Measured against the
  // tint the original brand pink is 3.4:1 — even worse than the 3.85:1 an
  // audit computed against the bare page background. Deepening the canvas
  // deepens the tint too, which is why `fuchsia-ink` moved with it.
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
