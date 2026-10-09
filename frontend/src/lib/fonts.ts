/**
 * The two type families of the product, loaded once for every route and
 * mapped onto `sans` / `display` in `tailwind.config.ts`.
 *
 *  - Switzer (`sans`): self-hosted variable woff2 through `next/font/local`,
 *    with its Fontshare license (`app/fonts/FFL.txt`) alongside.
 *  - Anybody (`display`): variable font through `next/font/google`, which Next
 *    downloads at build time and serves from our own origin.
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

import { Anybody } from "next/font/google";
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
 * Display and figures. Anybody is variable in weight and width; only the width
 * axis is requested on top of weight, and no width signature is applied yet:
 * the type scale keeps using it at its default width.
 */
export const anybody = Anybody({
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
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
