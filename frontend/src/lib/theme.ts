/**
 * Theme preference — light or dark, chosen by the owner, defaulting to the OS.
 *
 * The truth lives on `<html data-theme="light|dark">`; the semantic colour
 * tokens read it through CSS variables (`globals.css`, `lib/theme-tokens.ts`).
 * The choice is persisted in `localStorage` under `THEME_STORAGE_KEY`; with no
 * stored choice the OS `prefers-color-scheme` decides.
 *
 * `THEME_INIT_SCRIPT` runs from `<head>` BEFORE the first paint, so a returning
 * dark user never sees a light flash. It is an inline script, so under the
 * strict nonce CSP (`middleware.ts`) it only runs with the request's nonce —
 * the root layout passes it. It must stay self-contained, dependency-free and
 * wrapped in try/catch: storage can throw (private mode, blocked cookies), and
 * a theme script that throws would take the whole document down with it.
 */

import type { ThemeName } from "./theme-tokens";

export type { ThemeName };

export const THEME_STORAGE_KEY = "cata_theme";

export const THEME_ATTRIBUTE = "data-theme";

/** A stored value is only trusted when it is exactly one of the two names. */
export function parseTheme(value: string | null | undefined): ThemeName | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The theme to draw: the stored choice, else the OS preference, else light. */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): ThemeName {
  return parseTheme(stored) ?? (prefersDark ? "dark" : "light");
}

/** Writes the theme onto `<html>`, where the CSS variables and `color-scheme` read it. */
export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement): void {
  root.setAttribute(THEME_ATTRIBUTE, theme);
  root.style.colorScheme = theme;
}

/** Reads what is on `<html>` now (the script already ran before hydration). */
export function readAppliedTheme(root: HTMLElement = document.documentElement): ThemeName {
  return parseTheme(root.getAttribute(THEME_ATTRIBUTE)) ?? "light";
}

/**
 * The pre-hydration script, as a string. Mirrors `resolveTheme` + `applyTheme`
 * in ES5 — it cannot import anything, it runs before any bundle exists.
 */
export const THEME_INIT_SCRIPT =
  "(function(){try{var t=localStorage.getItem(" +
  JSON.stringify(THEME_STORAGE_KEY) +
  ");if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}" +
  "var r=document.documentElement;r.setAttribute(" +
  JSON.stringify(THEME_ATTRIBUTE) +
  ",t);r.style.colorScheme=t}catch(e){}})();";
