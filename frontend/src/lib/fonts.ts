/**
 * The three type families the brand owns, self-hosted, for the WHOLE product.
 *
 * Until now the product ran on two typographic systems at once. The public
 * landing (`app/page.tsx`) declared these same three `.woff2` files under
 * `--font-landing-*` variables, while everything behind the login rendered in
 * Inter, pulled in as four `@fontsource/inter` stylesheets in the root layout.
 * So the faces the club chose stopped at the front door: a visitor met Graduate
 * and Barlow, and the moment they became a member they were handed a different
 * product in a face nobody picked. This module is what the rest of the app now
 * loads, and `tailwind.config.ts` maps it onto `sans` / `display` / `serif`.
 *
 * Self-hosted through `next/font/local` rather than fetched from Google: the
 * files already sit in `public/fonts/`, and a local font is inlined into the
 * build with a preload link and a generated family name, so there is no
 * third-party request on the critical path and no layout shift from a stylesheet
 * that arrives late.
 *
 * `display: "swap"` on all three, deliberately. The alternative (`optional` /
 * `block`) either drops the brand face on a slow connection or blanks the text
 * while it loads; `swap` renders the fallback immediately and repaints. The
 * repaint is the cost of never showing an empty screen, and the fallback stacks
 * in `tailwind.config.ts` are chosen so the reflow is small.
 *
 * NOTE — the landing keeps its own `--font-landing-*` declarations of these
 * exact three files in `app/page.tsx`. That duplication is DELIBERATE and
 * TEMPORARY: the landing is being redesigned in parallel and owns its variables
 * while that work is in flight. `next/font/local` deduplicates identical font
 * files at build time, so the duplication costs variable names, not bytes. When
 * the redesign lands, `app/page.tsx` and `landing.css` should read these
 * variables and the `--font-landing-*` set should disappear.
 */

import localFont from "next/font/local";

/**
 * Interface text — every label, cell, button, paragraph and form field in the
 * product. Five weights because the interface actually uses five: 400 body,
 * 500 controls, 600 titles, 700 table heads and badges, 800 the stat numbers
 * and the brand lockup.
 */
export const barlow = localFont({
  src: [
    { path: "../../public/fonts/barlow-400.woff2", weight: "400" },
    { path: "../../public/fonts/barlow-500.woff2", weight: "500" },
    { path: "../../public/fonts/barlow-600.woff2", weight: "600" },
    { path: "../../public/fonts/barlow-700.woff2", weight: "700" },
    { path: "../../public/fonts/barlow-800.woff2", weight: "800" },
  ],
  variable: "--font-barlow",
  display: "swap",
});

/**
 * Display only, and only in uppercase. Graduate is a collegiate/athletic face
 * with no lowercase design intent and very little vertical range, so it holds a
 * headline and falls apart in a paragraph. One weight is all it ships and all
 * it needs — size and case carry its emphasis, not weight.
 */
export const graduate = localFont({
  src: "../../public/fonts/graduate-400.woff2",
  variable: "--font-graduate",
  display: "swap",
});

/**
 * The editorial voice: a pull quote, a motto, the one line on a screen that is
 * meant to be read slowly rather than scanned. 600 rather than 400 because it
 * always appears large, where Playfair's high stroke contrast thins out the
 * regular weight.
 */
export const playfair = localFont({
  src: "../../public/fonts/playfair-display-600.woff2",
  variable: "--font-playfair",
  display: "swap",
});

/**
 * The three variable classes, in the order they go on `<html>`. Exported as one
 * string because a layout that mounts two of the three ships a `var()` that
 * resolves to nothing, and that failure is invisible until someone opens the
 * screen that uses the missing family.
 */
export const fontVariables = `${barlow.variable} ${graduate.variable} ${playfair.variable}`;
