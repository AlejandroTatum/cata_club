/**
 * The lock on `docs/archive/prototypes/prototipos/_sistema.css`.
 *
 * That file is the visual authority for the 32 prototypes: values get copied
 * OUT of it when a screen is implemented. So when the app moved its surfaces
 * and the sheet did not follow, the prototypes started advertising a contrast
 * the user would never receive — `--canvas` #F5F5F7 against the product's
 * #E8E8EE, `--ink-3-strong` #6B6B76 against #63636E, `--line` #E9E9EC against
 * #DEDEE6. It ran that way for months because nothing measured it (#214).
 *
 * Two halves, and neither is worth anything alone:
 *
 *   (a) the shared tokens in the sheet ARE the tokens in `tailwind.config.ts`.
 *       The app owns the value; the sheet replicates it. If the app moves one
 *       and the sheet does not follow, this goes red.
 *   (b) the contrast pairs the sheet documents in its own comments actually
 *       measure what the comments claim. A comment is prose; this is the
 *       measurement.
 *
 * The measurement comes from `lib/color-contrast.ts`, the same instrument
 * `color-contrast.test.ts` reads the app's palette through. Duplicating the
 * WCAG formula here would let the two copies drift, which is the same failure
 * as the two token files drifting.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contrastRatio } from "../color-contrast";
import tailwindConfig from "../../../tailwind.config";

// ---------------------------------------------------------------------------
// The two sides of the contract
// ---------------------------------------------------------------------------

const SISTEMA_CSS = join(
  __dirname,
  "..", "..", "..", "..",
  "docs", "ux", "prototipos", "_sistema.css",
);

/**
 * Only the first `:root` block. The sheet has a second one inside
 * `@media (prefers-color-scheme: dark)` that re-declares the review-frame
 * tokens; folding the two together would silently overwrite the light values.
 */
function readSistemaTokens(): Record<string, string> {
  const source = readFileSync(SISTEMA_CSS, "utf8");
  const start = source.indexOf(":root {");
  const end = source.indexOf("\n}", start);
  if (start < 0 || end < 0) throw new Error(`no :root block in ${SISTEMA_CSS}`);
  const block = source.slice(start, end);

  const tokens: Record<string, string> = {};
  for (const [, name, hex] of block.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})/g)) {
    tokens[name] = hex.toUpperCase();
  }
  return tokens;
}

const css = readSistemaTokens();

const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
const group = (key: string): Record<string, string> => colors[key] as Record<string, string>;

const ink = group("ink");
const line = group("line");
const coal = group("coal");
const ball = group("ball");
const state = group("state");
const cata = group("cata");

/**
 * Every token the sheet shares with the product, mapped to the app value that
 * owns it. The sheet's job is to replicate this column, never to invent it.
 */
const SHARED: Record<string, string> = {
  // the three-surface ladder
  canvas: colors.canvas as string,
  sunken: colors.sunken as string,
  paper: colors.paper as string,
  // the hairlines that draw on that ladder
  line: line.DEFAULT,
  "line-2": line["2"],
  // the ink ramp
  ink: ink.DEFAULT,
  "ink-2": ink["2"],
  "ink-3": ink["3"],
  "ink-3-strong": ink["3-strong"],
  // rubber, red, ball
  coal: coal.DEFAULT,
  "coal-2": coal["2"],
  "coal-3": coal["3"],
  red: cata.red,
  "red-dark": cata["red-dark"],
  ball: ball.DEFAULT,
  "ball-ink": ball.ink,
  // the state ramp — the pairs the badges are built out of
  ok: state.ok,
  "ok-bg": state["ok-bg"],
  warn: state.warn,
  "warn-bg": state["warn-bg"],
  neutral: state.neutral,
  "neutral-bg": state["neutral-bg"],
  bad: state.bad,
  "bad-bg": state["bad-bg"],
  // the level ramp — l1 is the top of the ladder, l10 the base
  l1: colors.l1 as string,
  l2: colors.l2 as string,
  l3: colors.l3 as string,
  l4: colors.l4 as string,
  l5: colors.l5 as string,
  l6: colors.l6 as string,
  l7: colors.l7 as string,
  l8: colors.l8 as string,
  l9: colors.l9 as string,
  l10: colors.l10 as string,
};

/**
 * Tokens the sheet declares that deliberately have NO counterpart in the app.
 * Listed rather than skipped, because "the sheet is in sync" is only a true
 * statement if every token it carries is accounted for — either matched above
 * or excluded here with a reason.
 *
 *   · `chrome-*` dress the REVIEW FRAME — the breadcrumb, the annotation
 *     block, the footer that wrap each prototype page. They are scaffolding
 *     around the mockup, not product surface, and they are the only tokens in
 *     the sheet that follow the system light/dark scheme. The product ships no
 *     equivalent because the product has no review frame.
 *   · `ball-ink-strong` is a prototype-only companion: `.note .mine` is the
 *     one place in either codebase where ink lands ON the yellow, and the
 *     shared `ball-ink` measures 3.48:1 there. It is NOT mirrored into the app
 *     on purpose — mirroring it would give the prototype better contrast than
 *     the product, which is the exact drift this file exists to prevent. The
 *     app's own yellow pair carries the same 3.48:1 and needs its own fix.
 *
 * The reverse direction is not asserted: the app legitimately carries tokens
 * the prototypes never needed (`cuenta-*` for the account-type screen,
 * `fuchsia-ink`, the legacy `cata-*` aliases). The sheet is the subset.
 */
const PROTOTYPE_ONLY = new Set([
  "chrome-bg",
  "chrome-ink",
  "chrome-mute",
  "chrome-line",
  "chrome-surf",
  "ball-ink-strong",
]);

describe("_sistema.css replicates the app's token contract", () => {
  it.each(Object.entries(SHARED))(
    "--%s carries the value tailwind.config.ts owns",
    (token, appValue) => {
      expect(css[token], `--${token} is missing from _sistema.css`).toBeDefined();
      expect(
        css[token],
        `--${token}: _sistema.css says ${css[token]}, the app says ${appValue.toUpperCase()}`,
      ).toBe(appValue.toUpperCase());
    },
  );

  it("accounts for every colour token the sheet declares", () => {
    // The guard on the guard: a token added to the sheet and to neither list
    // above is a value nobody is measuring. That is how #F5F5F7 survived.
    const unaccounted = Object.keys(css).filter(
      (token) => !(token in SHARED) && !PROTOTYPE_ONLY.has(token),
    );
    expect(unaccounted).toEqual([]);
  });

  it("still has the app as the sole author of a shared value", () => {
    // Restated as the rule rather than as the 34 pairs: the sheet must not
    // hold an opinion of its own about anything the app also defines.
    const divergent = Object.entries(SHARED)
      .filter(([token, appValue]) => css[token] !== appValue.toUpperCase())
      .map(([token]) => token);
    expect(divergent).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) The pairs the sheet's own comments claim to measure
// ---------------------------------------------------------------------------

/** WCAG 1.4.3 — text under 18.66px needs 4.5:1. */
const AA_NORMAL_TEXT = 4.5;

/**
 * Read from the CSS, not from the app. These assertions have to go red when
 * `_sistema.css` moves, which is the whole point — asserting the app's values
 * back at the app would prove nothing about the sheet.
 */
const t = (name: string): string => {
  const value = css[name];
  if (!value) throw new Error(`--${name} not declared in _sistema.css`);
  return value;
};

describe("the text pairs _sistema.css documents meet AA", () => {
  // Each entry is [name, foreground token, background token]. The name is what
  // shows up in the failure message: when this goes red the point is knowing
  // WHICH pair broke, not that some number moved.
  const PAIRS: readonly (readonly [string, string, string])[] = [
    // The issue's headline pair: the muted companion on the deepened page
    // field. `.topbar .date`, `.statelabel`, `.hint`, `.muted` inside `.app`.
    ["--ink-3-strong on --canvas", "ink-3-strong", "canvas"],
    // Why the shared token was kept instead of being darkened: it is correct
    // everywhere it sits on a card.
    ["--ink-3 on --paper", "ink-3", "paper"],
    // The companion has to cover the other two surfaces it can land on too.
    ["--ink-3-strong on --sunken", "ink-3-strong", "sunken"],
    ["--ink-3-strong on --paper", "ink-3-strong", "paper"],
    // The four badge pairs. Each foreground is DEFINED to be read on its own
    // -bg tint, so the pair is what has to clear AA, not the foreground alone.
    ["--ok on --ok-bg", "ok", "ok-bg"],
    ["--warn on --warn-bg", "warn", "warn-bg"],
    ["--neutral on --neutral-bg", "neutral", "neutral-bg"],
    ["--bad on --bad-bg", "bad", "bad-bg"],
    // Those same four also land on the page field, and deepening the canvas is
    // what nearly cost them: --warn at 4.59:1 is the pair that pins #E8E8EE.
    ["--ok on --canvas", "ok", "canvas"],
    ["--warn on --canvas", "warn", "canvas"],
    ["--neutral on --canvas", "neutral", "canvas"],
    ["--bad on --canvas", "bad", "canvas"],
    // `.note .mine` — the 10.5px/700 pill of the review frame, the only ink
    // that falls ON the yellow.
    ["--ball-ink-strong on --ball (.note .mine)", "ball-ink-strong", "ball"],
    // `.muted`, `.hint`, `.statelabel` and `.crumb .sep` default to the review
    // frame's own muted ink, because outside `.app` they sit on --chrome-bg.
    ["--chrome-mute on --chrome-bg", "chrome-mute", "chrome-bg"],
  ];

  it.each(PAIRS)("%s clears 4.5:1", (name, fg, bg) => {
    const ratio = contrastRatio(t(fg), t(bg));
    expect(ratio, `${name} measures ${ratio.toFixed(2)}:1, under ${AA_NORMAL_TEXT}:1`)
      .toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("--ink-3-strong on the #FAFAFB table head clears 4.5:1", () => {
    // The one surface in the sheet still spelled as a literal instead of as
    // `--sunken` (`.tbl thead th`, `.pager`, `.modal .mfoot`). Measured here so
    // the literal is not the one fill nobody checks.
    const ratio = contrastRatio(t("ink-3-strong"), "#FAFAFB");
    expect(ratio, `--ink-3-strong on the thead fill measures ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("confirms --ink-3 is the value that does NOT survive the page field", () => {
    // The half of the fix that is easy to undo by "simplifying" the sheet back
    // to one muted grey. It fails, and this says so out loud.
    expect(contrastRatio(t("ink-3"), t("canvas"))).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("the review frame keeps its muted ink readable in dark scheme too", () => {
  // `.muted` / `.hint` / `.statelabel` default to `--chrome-mute` precisely
  // because the frame follows the system scheme and `--ink-3-strong` does not:
  // on the dark frame the app companion falls to 3.27:1. Parsed from the dark
  // block, which `readSistemaTokens` deliberately excludes from everything else.
  const source = readFileSync(SISTEMA_CSS, "utf8");
  const darkStart = source.indexOf("@media (prefers-color-scheme: dark)");
  const dark = Object.fromEntries(
    [...source.slice(darkStart, source.indexOf("\n}", source.indexOf("{", darkStart + 40)))
      .matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})/g)]
      .map(([, name, hex]) => [name, hex.toUpperCase()]),
  ) as Record<string, string>;

  it("clears 4.5:1 for --chrome-mute on the dark --chrome-bg", () => {
    const ratio = contrastRatio(dark["chrome-mute"], dark["chrome-bg"]);
    expect(ratio, `--chrome-mute on the dark frame measures ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it("confirms --ink-3-strong could not have carried the frame", () => {
    expect(contrastRatio(t("ink-3-strong"), dark["chrome-bg"])).toBeLessThan(AA_NORMAL_TEXT);
  });
});

describe("the hairlines draw a real edge on the surfaces they border", () => {
  /**
   * NOT 3:1. WCAG 1.4.11 asks 3:1 of the visual boundary that IDENTIFIES a
   * component or of a graphic required to understand content. What separates a
   * card from the page here is the fill step — `--paper` over `--canvas`, the
   * 1.220:1 / 7.8 L* jump the surface rework exists to create — and the
   * hairline reinforces that edge rather than carrying it. A card border at
   * 3:1 would be about #9A9AA4 and would turn every screen into a wireframe;
   * neither the app (`tailwind.config.ts:108-123`) nor any shipped design
   * system draws one there. So the thresholds below are the app's own
   * documented floors, mirroring `color-contrast.test.ts:143-157`.
   */
  const CARD_EDGE_ON_CANVAS = 1.08;
  const DIVIDER_ON_PAPER = 1.3;
  const CONTROL_BORDER_ON_PAPER = 1.5;

  it("confirms the value the sheet used to ship was invisible on the canvas", () => {
    // #E9E9EC against #E8E8EE: 1.007:1. The card outline had the same
    // luminance as the field it sat on. This is the tripwire — if `--canvas`
    // is ever walked back, this assertion is the one that says so.
    const ratio = contrastRatio("#E9E9EC", t("canvas"));
    expect(ratio, `the retired --line measures ${ratio.toFixed(3)}:1 on --canvas`)
      .toBeLessThan(1.02);
  });

  it("--line reads against --canvas, where the card edge is drawn", () => {
    const ratio = contrastRatio(t("line"), t("canvas"));
    expect(ratio, `--line on --canvas measures ${ratio.toFixed(3)}:1`)
      .toBeGreaterThanOrEqual(CARD_EDGE_ON_CANVAS);
  });

  it("--line reads against --paper, where the same token draws dividers", () => {
    // One token has to work as the card outline AND as the row divider, the
    // `.track` fill, the `.sk` skeleton and the `.statelabel::after` rule.
    const ratio = contrastRatio(t("line"), t("paper"));
    expect(ratio, `--line on --paper measures ${ratio.toFixed(3)}:1`)
      .toBeGreaterThanOrEqual(DIVIDER_ON_PAPER);
  });

  it("--line-2 gives a control a firmer border than a divider", () => {
    // `.input`, `.btn`, `.pill`, `.srch`, `.srch kbd`, `.icob`, `.choice`,
    // `.fiche`, `.chk .bx` — every interactive box in the sheet.
    const control = contrastRatio(t("line-2"), t("paper"));
    const divider = contrastRatio(t("line"), t("paper"));
    expect(control, `--line-2 on --paper measures ${control.toFixed(3)}:1`)
      .toBeGreaterThanOrEqual(CONTROL_BORDER_ON_PAPER);
    expect(control, "--line-2 must read firmer than --line on the same surface")
      .toBeGreaterThan(divider);
  });

  it("keeps the surface ladder itself tellable apart", () => {
    // The step the hairline reinforces. If this collapses, no border value
    // rescues the screen.
    const ratio = contrastRatio(t("paper"), t("canvas"));
    expect(ratio, `--paper on --canvas measures ${ratio.toFixed(3)}:1`)
      .toBeGreaterThanOrEqual(1.2);
  });
});
