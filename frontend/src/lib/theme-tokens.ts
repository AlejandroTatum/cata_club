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
 * Dark is coal-based, not a grey inversion: the surfaces are the brand's coal
 * stepped up in lightness, the ink ramp is its mirror, and the sticker
 * outline (`edge`) flips to a light line so the hard-shadow language still
 * reads on a dark page. Every foreground/background pair is measured in
 * `color-contrast.test.ts` against the same WCAG thresholds as light.
 */

export type ThemeName = "light" | "dark";

/** Token path in the `colors` tree → its dark-theme hex. */
export const DARK_COLORS: Readonly<Record<string, string>> = {
  // Surface ladder: canvas < paper < sunken, each a visible step.
  "canvas": "#0B0B0E",
  "paper": "#1C1C22",
  "sunken": "#26262D",
  "line.DEFAULT": "#2D2D35",
  "line.2": "#3D3D47",
  // The sticker outline and its hard shadow.
  "edge": "#D4D4DC",
  // Ink ramp.
  "ink.DEFAULT": "#ECECF0",
  "ink.2": "#BFBFCA",
  "ink.3": "#9A9AA7",
  "ink.3-strong": "#A8A8B5",
  // The text-weight yellow and pink companions.
  "ball.ink": "#FFD600",
  "cata.fuchsia-ink": "#FF7DB0",
  "enroll-wash": "#261B1D",
  // Status pairs: a light foreground on its own dark tint.
  "state.ok": "#5BD28A",
  "state.ok-bg": "#14301F",
  "state.warn": "#F2A154",
  "state.warn-bg": "#3A2612",
  "state.neutral": "#A8A8B5",
  "state.neutral-bg": "#2A2A31",
  "state.bad": "#FF7A80",
  "state.bad-bg": "#3F1B1E",
  // Account-type accents.
  "cuenta.representante": "#8FB0FF",
  "cuenta.representante-bg": "#1B2745",
  "cuenta.menor": "#C99BFF",
  "cuenta.menor-bg": "#2E1F47",
  "cuenta.entrenador": "#4FD6A4",
  "cuenta.entrenador-bg": "#123A2E",
  // Legacy aliases the older components still speak.
  "cata.border": "#2D2D35",
  "cata.bg": "#26262D",
  "cata.surface": "#1C1C22",
  "cata.text": "#E4E4EA",
  "cata.state-ok": "#5BD28A",
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
