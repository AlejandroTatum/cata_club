/**
 * The two type families of the product, loaded once for every route and
 * mapped onto `sans` / `display` in `tailwind.config.ts`.
 *
 *  - Switzer (`sans`): self-hosted variable woff2 through `next/font/local`,
 *    with its Fontshare license (`app/fonts/FFL.txt`) alongside.
 *  - Anybody (`display`): self-hosted variable woff2 (weight + width axes)
 *    through `next/font/local`, with its SIL OFL license
 *    (`app/fonts/OFL-Anybody.txt`) alongside. Nothing is fetched from a font
 *    CDN at build time.
 *
 * The club's voice (the auth motto, the enrolment welcome line) is NOT a third
 * family: it is Anybody at a different weight and width (`.font-voice`). The
 * landing still loads Playfair for its own motto, declared in `app/page.tsx`.
 *
 * `display: "swap"` on both: the fallback renders immediately and the
 * brand face repaints, so the screen is never blank. The fallback stacks in
 * `tailwind.config.ts` keep that reflow small.
 *
 * NOTE: the landing keeps its own `--font-landing-*` declarations in
 * `app/page.tsx`, Playfair included; it owns those variables.
 */

import localFont from "next/font/local";

/**
 * Interface text: every label, cell, button, paragraph and form field in the
 * product. Switzer is a variable file, so the whole 100-900 weight range comes
 * from one self-hosted woff2. It ships with its Fontshare license
 * (`app/fonts/FFL.txt`), which has to stay next to the font file.
 */
export const switzer = localFont({
  src: "../app/fonts/Switzer-Variable.woff2",
  weight: "100 900",
  variable: "--font-switzer",
  display: "swap",
});

/**
 * Display and figures. Anybody is variable in weight (100-900) and width
 * (`wdth` 50-150). The file is the Latin subset (Spanish included) that Google
 * Fonts serves for Anybody v1.113 to the build's user agent, i.e. what the app
 * loaded before it was vendored; the license
 * (`app/fonts/OFL-Anybody.txt`) has to stay next to it. The `font-stretch`
 * range is declared so the generated @font-face covers the whole width axis;
 * the type scale then drives it with `font-variation-settings` (see
 * `.font-display` in `globals.css`).
 */
export const anybody = localFont({
  src: "../app/fonts/Anybody-Variable.woff2",
  weight: "100 900",
  declarations: [{ prop: "font-stretch", value: "50% 150%" }],
  variable: "--font-anybody",
  display: "swap",
});

/**
 * The variable classes, in the order they go on `<html>`. Exported as one
 * string because a layout that mounts one of the two ships a `var()` that
 * resolves to nothing, and that failure is invisible until someone opens the
 * screen that uses the missing family.
 */
export const fontVariables = `${switzer.variable} ${anybody.variable}`;
