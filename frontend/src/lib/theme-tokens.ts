/**
 * The themed colour tokens — which entries of the palette in
 * `tailwind.config.ts` change with the theme, and what they become in dark.
 *
 * The light value of every token is the hex already written in the config
 * tree (`LIGHT_COLORS`), which stays the one place a light colour is chosen.
 * This module adds the other half: the dark value, keyed by the token's path
 * in that tree. `tailwind.config.ts` turns each entry into
 * `rgb(var(--c-<name>) / <alpha-value>)`, so Tailwind's `/nn` opacity
 * modifiers keep working, and `globals.css` declares the channel triples on
 * `:root` (light) and `html[data-theme="dark"]` (dark).
 * `theme-tokens-parity.test.ts` fails if `globals.css` drifts from either
 * side — three copies of a colour is exactly what that guard exists for.
 *
 * Deliberately NOT themed: the brand constants (`coal`, `ball`, `cata.red` and
 * friends — a red fill is red in both themes, and coal is the sidebar, the
 * text on the ball and the coal stat block), the chart ramp `l1…l10`, and the
 * landing, which keeps its own `--landing-*` palette and stays light.
 *
 * Dark is coal-based, not a grey inversion: the surfaces are an elevation
 * ladder (rail, canvas, paper, sunken, popover), the ink ramp is its mirror,
 * and the sticker outline (`edge`) drops to a quiet line with a pure-black
 * hard shadow (`edge-shadow`), reserving bright rims (`edge-hot`) for the
 * highlighted pieces. Every foreground/background pair is measured in
 * `color-contrast.test.ts` against the same WCAG thresholds as light.
 */

export type ThemeName = "light" | "dark";

/** Token path in the `colors` tree → its dark-theme hex. */
export const DARK_COLORS: Readonly<Record<string, string>> = {
  // ELEVATION LADDER, darkest to lightest: rail < canvas < paper < sunken <
  // popover. The sidebar rail is the deepest layer, the page a step above it,
  // a card clearly above the page, and a menu or dialog above the card. Each
  // rung is a visible step (>= 1.07:1 rail/canvas, >= 1.14:1 elsewhere).
  "rail": "#0C0C0E",
  "canvas": "#151519",
  "paper": "#212128",
  "sunken": "#2B2B33",
  "popover": "#31313B",
  "line.DEFAULT": "#2F2F38",
  "line.2": "#474752",
  // STICKER LANGUAGE IN DARK. Every container wears a quiet outline and a hard
  // shadow in pure black, darker than the page, so depth reads without glare.
  // Bright outlines are spent only on the highlighted pieces (`edge-hot`: the
  // primary action, the title highlight, the KPI slabs) and on focus.
  "edge": "#2F2F36",
  "edge-shadow": "#000000",
  "edge-hot": "#FFD600",
  "edge-focus": "#F2F2F5",
  // Chart tracks (rings, progress bars) and the data ink drawn on them.
  "track": "#3F3F4B",
  "mark": "#FFD600",
  // Text on a solid themed fill: those fills are pale in dark, so the text is
  // the canvas colour (>= 8:1 on every fill it sits on).
  "on-solid": "#151519",
  // KPI slabs: the brand fills one step deeper so they hold their identity on
  // a dark page without glaring; white on the red and coal on the yellow
  // stay above 7:1.
  "kpi.red": "#A8161D",
  "kpi.ball": "#D9B000",
  "kpi.coal": "#0C0C0E",
  // Ink ramp: primary near-white (never #FFF), every step >= 7:1 on paper.
  "ink.DEFAULT": "#EDEDF1",
  "ink.2": "#CFCFD8",
  "ink.3": "#B0B0BD",
  "ink.3-strong": "#BDBDC9",
  // The text-weight yellow and pink companions.
  "ball.ink": "#FFD600",
  "cata.fuchsia-ink": "#FF7DB0",
  "enroll-wash": "#2A1E20",
  // Icon chips: a dark tint of the hue with the hue itself as the ink.
  "chip.ball": "#3A3210",
  "chip.red": "#3F1B1E",
  "chip.red-ink": "#FF9096",
  // Status pairs: a light foreground on its own dark tint.
  "state.ok": "#62D892",
  "state.ok-bg": "#14301F",
  "state.warn": "#F5AE6B",
  "state.warn-bg": "#3A2612",
  "state.neutral": "#B6B6C2",
  "state.neutral-bg": "#2A2A31",
  "state.bad": "#FF9096",
  "state.bad-bg": "#3F1B1E",
  // Account-type accents.
  "cuenta.representante": "#8FB0FF",
  "cuenta.representante-bg": "#1B2745",
  "cuenta.menor": "#C99BFF",
  "cuenta.menor-bg": "#2E1F47",
  "cuenta.entrenador": "#4FD6A4",
  "cuenta.entrenador-bg": "#123A2E",
  // Legacy aliases the older components still speak.
  "cata.border": "#2F2F38",
  "cata.bg": "#2B2B33",
  "cata.surface": "#212128",
  "cata.text": "#E4E4EA",
  "cata.state-ok": "#62D892",
};

/** The CSS custom property that carries a token's RGB channels. */
export function cssVarName(path: string): string {
  const name = path
    .split(".")
    .filter((part) => part !== "DEFAULT")
    .join("-");
  return `--c-${name}`;
}

/** `#E8E8EE` → `232 232 238`, the form `rgb(var(--c-x) / <alpha-value>)` takes. */
export function hexToChannels(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(" ");
}

/** What Tailwind gets in place of the hex: the token, read from its variable. */
export function themedColorValue(path: string): string {
  return `rgb(var(${cssVarName(path)}) / <alpha-value>)`;
}
