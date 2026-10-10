/**
 * The theme tokens exist in three places that must say the same thing:
 *
 *   · `LIGHT_COLORS` in `tailwind.config.ts` — the light hex, the one place a
 *     light colour is chosen;
 *   · `DARK_COLORS` in `lib/theme-tokens.ts` — the dark hex;
 *   · the channel triples `globals.css` declares on `:root` and
 *     `html[data-theme="dark"]`, which is what the browser actually paints.
 *
 * Tailwind sees none of the hex: `themedColors` hands it
 * `rgb(var(--c-…) / <alpha-value>)`. So a token edited in the tree but not in
 * the stylesheet would pass every contrast test and ship the old colour. This
 * is the guard for that, and for the inverse mistake — a brand constant
 * (`coal`, `ball`, `cata-red`) quietly turning into a theme variable.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindConfig, { LIGHT_COLORS } from "../../../tailwind.config";
import { DARK_COLORS, cssVarName, hexToChannels, themedColorValue } from "../theme-tokens";

const CSS = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");

const lookup = (tree: unknown, dotted: string): unknown =>
  dotted.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], tree);

/** Every `--c-*: R G B;` declaration inside the first rule whose selector contains `selector`. */
function declarationsOf(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector);
  expect(start, `globals.css has no rule for ${selector}`).toBeGreaterThan(-1);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const block = CSS.slice(open + 1, close);
  const found: Record<string, string> = {};
  for (const match of block.matchAll(/(--c-[a-z0-9-]+):\s*([0-9]+ [0-9]+ [0-9]+);/g)) {
    found[match[1]] = match[2];
  }
  return found;
}

const paths = Object.keys(DARK_COLORS);
const LIGHT_BLOCK = declarationsOf(":root,\nhtml[data-theme=\"dark\"] body:has(.landing-page)");
const DARK_BLOCK = declarationsOf('html[data-theme="dark"] {');

describe("theme tokens — one colour, three copies, no drift", () => {
  it("has a light value in the palette tree for every token that has a dark one", () => {
    for (const path of paths) {
      expect(typeof lookup(LIGHT_COLORS, path), `${path} is not a colour in LIGHT_COLORS`).toBe("string");
    }
  });

  it.each(paths)("declares %s in globals.css, light and dark, matching the tokens", (path) => {
    const name = cssVarName(path);
    expect(LIGHT_BLOCK[name], `${name} (light)`).toBe(hexToChannels(lookup(LIGHT_COLORS, path) as string));
    expect(DARK_BLOCK[name], `${name} (dark)`).toBe(hexToChannels(DARK_COLORS[path]));
  });

  it("declares no variable the tokens do not know about", () => {
    const known = new Set(paths.map(cssVarName));
    for (const name of [...Object.keys(LIGHT_BLOCK), ...Object.keys(DARK_BLOCK)]) {
      expect(known.has(name), `${name} is declared in globals.css but not in DARK_COLORS`).toBe(true);
    }
  });

  it("hands Tailwind the variable form, so opacity modifiers keep working", () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
    expect(colors.paper).toBe("rgb(var(--c-paper) / <alpha-value>)");
    expect(lookup(colors, "ink.3-strong")).toBe(themedColorValue("ink.3-strong"));
    expect(lookup(colors, "state.bad-bg")).toBe("rgb(var(--c-state-bad-bg) / <alpha-value>)");
  });

  it("leaves the brand constants as plain hex — a red fill is red in both themes", () => {
    const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>;
    expect(lookup(colors, "coal.DEFAULT")).toBe("#131316");
    expect(lookup(colors, "ball.DEFAULT")).toBe("#FFD600");
    expect(lookup(colors, "cata.red")).toBe("#D92128");
    expect(paths.filter((p) => /^(coal|ball\.DEFAULT|cata\.red$|cata\.yellow)/.test(p))).toEqual([]);
  });

  it("switches dark on the <html> attribute the pre-paint script writes", () => {
    expect(tailwindConfig.darkMode).toEqual(["selector", 'html[data-theme="dark"]']);
  });

  it("re-declares the light values for the landing, which is never dark", () => {
    expect(CSS).toContain('html[data-theme="dark"] .landing-page');
    expect(CSS).toContain('html[data-theme="dark"] body:has(.landing-page)');
  });
});
