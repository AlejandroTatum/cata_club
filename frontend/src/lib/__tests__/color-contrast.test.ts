/**
 * WCAG 2.1 contrast regression tests for the design tokens and palette values
 * that a measured accessibility audit flagged as failing AA (1.4.3).
 *
 * These assert the actual hex values rather than class names, so a future
 * "tweak the brand pink a little" cannot silently push body text back below
 * 4.5:1. Each pair below is a real foreground/background combination that
 * ships in the UI, including the alpha compositing Tailwind's `/nn` opacity
 * modifiers perform against the surface underneath.
 *
 * The last block is the one that reads SOURCE rather than tokens: proving a
 * token meets AA is worth nothing on a screen that hand-writes a hex instead of
 * naming it. The arbitrary-value lock deliberately leaves colours alone
 * (`arbitrary-style-values.test.ts:44-46` — "the palette guard owns them"), so
 * that half of the rule lives here, where the palette does.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

describe("account-type accents — /admin/crear-cuenta", () => {
  // The four account-type cards differentiate by hue: one icon chip each, and
  // the MENOR card opens a representative-search panel tinted to match. Three
  // of the four were written in Tailwind's DEFAULT palette rather than in a
  // token, and the surface-fill guard at the bottom of this file could not see
  // them: it matches arbitrary `bg-[#…]` only, so a named-but-off-system colour
  // passed while never being measured against anything.
  //
  // Two of those uses were under AA. The pair is what the token exists for, so
  // the pair is what has to clear it.
  const cuenta = group("cuenta");
  const TYPES = ["representante", "menor", "entrenador"];

  it.each(TYPES)("meets AA for %s on its own tint", (tone) => {
    expect(contrastRatio(cuenta[tone], cuenta[`${tone}-bg`])).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it.each(TYPES)("keeps %s readable on paper, where the result list sits", (tone) => {
    expect(contrastRatio(cuenta[tone], PAPER)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // Kept as tripwires. Both are the same shape of mistake the retired badge
  // grey was: reaching for a lighter step of a hue to make text look secondary,
  // on a tint that had no contrast budget left to spend.
  it("confirms the two purple values the block shipped would still fail today", () => {
    // `text-purple-500` on the `purple-50` panel, 3.69:1 — the "Buscando..."
    // status line while the representative search is in flight.
    expect(contrastRatio("#A855F7", "#FAF5FF")).toBeLessThan(AA_NORMAL_TEXT);
    // `text-purple-400` on white, 2.64:1 — the "ID: n" suffix on every result.
    // Lower than the 3.78:1 the audit filed as Alta on the login notice.
    expect(contrastRatio("#C084FC", PAPER)).toBeLessThan(AA_NORMAL_TEXT);
  });

  // The same screen carried two status blocks in the same off-system way: an
  // amber over-18 warning and a green summary-confirmation box. Those are
  // STATUS, not category, so they went to `state-warn` and `state-ok` rather
  // than to a token of their own. The green one hid the worst pair in the
  // product — worse than the 2.31:1 the audit had recorded as its floor.
  it("confirms the summary hint was effectively invisible before", () => {
    // `text-emerald-400/75` composited over `bg-emerald-50`: 1.58:1.
    expect(contrastRatio(compositeOver("#34D399", "#ECFDF5", 0.75), "#ECFDF5")).toBeLessThan(
      AA_NON_TEXT,
    );
  });

  it("gives that hint the muted ink meant for tinted surfaces", () => {
    expect(contrastRatio(ink["3-strong"], state["ok-bg"])).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("moves that ID suffix to the neutral ink, which does clear AA on paper", () => {
    // The suffix is metadata, not category identity, so it leaves the hue
    // entirely rather than looking for a darker purple.
    expect(contrastRatio(ink["3"], PAPER)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
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

// ---------------------------------------------------------------------------
// The palette on the screens — every surface fill must be a NAMED colour
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Prose is not code. `Table.tsx` explains at length why the head fill stopped
 * being the literal `#FAFAFB`, and a guard that fires on the explanation of its
 * own rule teaches people to delete the explanation.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("every surface fill on a screen comes from the palette", () => {
  const offenders = sourceFiles(SRC)
    .map((path) => ({
      path: path.slice(SRC.length + 1),
      code: stripComments(readFileSync(path, "utf8")),
    }))
    .flatMap(({ path, code }) =>
      (code.match(/\bbg-\[#[0-9A-Fa-f]{3,8}\]/g) ?? []).map((value) => `${path}: ${value}`),
    );

  // The specific value that made this rule necessary. `#FAFAFB` is the fill the
  // spec spelled as a literal in `.tbl thead th`; at 1.043:1 on white it was a
  // fill you could not see, so the primitive replaced it with the `sunken`
  // token. Three screens had copied the literal before that happened, and one
  // of them — `/reports` — also copied `text-ink-3` and so shipped a table head
  // at 4.21:1 while every other table in the product was at AA.
  it("no longer carries the retired #FAFAFB head fill anywhere", () => {
    expect(offenders.filter((line) => /#FAFAFB/i.test(line))).toEqual([]);
  });

  // Written as a rule rather than as that one value: a hand-written hex bypasses
  // the whole ladder this file proves. Whatever the next literal is, it is
  // already wrong before anyone measures it.
  it("names every background it paints, so the ladder above actually applies", () => {
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tailwind's own palette is not this product's palette
// ---------------------------------------------------------------------------

/**
 * The rule above catches `bg-[#FAFAFB]` and misses `bg-purple-50`, because one
 * is spelled as a literal and the other as a name. But `purple-50` is no more
 * this product's colour than the hex was: it is Tailwind's default palette,
 * measured against nothing, and it is how two under-AA pairs shipped inside
 * `admin/crear-cuenta` while this file reported 54 green assertions (#139).
 *
 * So the second half of the rule: a named colour has to be named HERE.
 */
const TAILWIND_HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW_PALETTE = new RegExp(
  `\\b(?:bg|text|border|divide|ring|from|via|to)-(?:${TAILWIND_HUES})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`,
  "g",
);

/**
 * The files that still carry it, frozen on 2026-08-05. Not approved values:
 * measured debt. The list only ever shrinks, and `admin/crear-cuenta` is the
 * first entry off it.
 *
 * Entries are never added. A new one is exactly what this guard exists to
 * prevent — an unavoidable new hue gets a name in `tailwind.config.ts` first,
 * and stops being Tailwind's.
 */
const RAW_PALETTE_DEBT: readonly string[] = [
  "app/attendance/attendance-utils.ts",
  "app/groups/page.tsx",
  "app/members/MedicalRecordEditor.tsx",
  "app/student/add-dependent/page.tsx",
  "app/student/enroll/page.tsx",
  "app/student/proof-utils.ts",
];

describe("no screen paints with Tailwind's default palette", () => {
  const offenders = sourceFiles(SRC)
    .map((path) => ({
      path: path.slice(SRC.length + 1),
      code: stripComments(readFileSync(path, "utf8")),
    }))
    .flatMap(({ path, code }) =>
      (code.match(RAW_PALETTE) ?? []).map((value) => `${path}: ${value}`),
    );

  it("no longer carries any of it in the account-creation screen", () => {
    expect(offenders.filter((line) => line.startsWith("app/admin/crear-cuenta/"))).toEqual([]);
  });

  it("keeps the frozen debt from spreading to a file that was clean", () => {
    const files = [...new Set(offenders.map((line) => line.slice(0, line.indexOf(": "))))].sort();
    expect(files.filter((file) => !RAW_PALETTE_DEBT.includes(file))).toEqual([]);
  });

  it("reports a debt entry that no longer has any use left, so the list shrinks", () => {
    const files = new Set(offenders.map((line) => line.slice(0, line.indexOf(": "))));
    expect(RAW_PALETTE_DEBT.filter((file) => !files.has(file))).toEqual([]);
  });
});
