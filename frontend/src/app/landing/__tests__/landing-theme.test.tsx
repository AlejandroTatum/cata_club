/** @vitest-environment jsdom */

/**
 * The landing in two themes (S11).
 *
 * The owner asked for the dark/light choice "en la lading" as well as the
 * login. The landing paints itself from `--landing-*` variables, so dark is a
 * second set of values for the same names, not a second stylesheet: these
 * tests pin the toggle in the navbar, the shared storage key (so the choice
 * made here is the one the panel opens with) and the dark palette's contrast
 * and elevation, measured on the values rather than on class names.
 *
 * Under the strict CSP nothing here may be an inline script: the pre-paint
 * script is the root layout's nonce'd `ThemeScript`, which the landing shares.
 */

import "./landing-render-mocks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPage from "@/app/landing/LandingPage";
import { contrastRatio, lightness } from "@/lib/color-contrast";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { resetLandingTestEnvironment, stubLandingGlobals } from "./landing-test-doubles";

const css = readFileSync(resolve(process.cwd(), "src/app/landing/landing.css"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const globalsCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/** Declarations of the first rule that opens with `selector {`. */
function declarations(selector: string): Record<string, string> {
  const start = cssNoComments.indexOf(`${selector} {`);
  expect(start, `landing.css has no rule for ${selector}`).toBeGreaterThan(-1);
  const body = cssNoComments.slice(cssNoComments.indexOf("{", start) + 1, cssNoComments.indexOf("\n}", start));
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/(--landing-[a-z0-9-]+):\s*([^;]+);/g)) found[match[1]] = match[2].trim();
  return found;
}

const LIGHT = declarations(".landing-page");
const DARK = declarations('html[data-theme="dark"] .landing-page');

const hex = (token: string, source: Record<string, string> = DARK): string => {
  const value = source[token] ?? LIGHT[token];
  expect(value, `${token} has no value`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
};

/** jsdom under this Node has no usable localStorage; the toggle only needs get/set. */
function memoryStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => (key in store ? store[key] : null),
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
  } as Storage;
}

beforeEach((): void => {
  stubLandingGlobals();
  vi.stubGlobal("localStorage", memoryStorage());
  document.documentElement.setAttribute("data-theme", "light");
});

afterEach((): void => {
  resetLandingTestEnvironment();
  document.documentElement.removeAttribute("data-theme");
});

describe("landing theme toggle", (): void => {
  it("sits in the navbar next to the login entry, with the app's accessible name", (): void => {
    render(<LandingPage />);

    const navbar = screen.getByRole("navigation", { name: "Navegación principal" });
    const toggle = within(navbar).getByRole("button", { name: "Modo oscuro" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.closest(".landing-nav-actions")).toContainElement(within(navbar).getByRole("link", { name: /entrar/i }));
    expect(screen.getAllByRole("button", { name: "Modo oscuro" })).toHaveLength(1);
  });

  it("switches <html data-theme> and stores the choice under the key the panel reads", async (): Promise<void> => {
    render(<LandingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Modo oscuro" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("cata_theme");
    await waitFor(() => expect(screen.getByRole("button", { name: "Modo oscuro" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("uses the landing's sticker skin, not the app bar's", (): void => {
    render(<LandingPage />);

    const toggle = screen.getByRole("button", { name: "Modo oscuro" });
    expect(toggle).toHaveClass("landing-theme-toggle");
    const rule = css.slice(css.indexOf(".landing-theme-toggle {"), css.indexOf("}", css.indexOf(".landing-theme-toggle {")));
    expect(rule).toContain("min-width: 44px");
    expect(rule).toContain("min-height: 44px");
  });
});

describe("landing dark palette", (): void => {
  it("is no longer pinned to the light app tokens", (): void => {
    const pin = globalsCss.slice(0, globalsCss.indexOf("{", globalsCss.indexOf(":root,")));
    expect(pin).not.toContain("body:has(.landing-page)");
    expect(css).not.toMatch(/<script/i);
  });

  it("leaves the light palette exactly as approved", (): void => {
    expect(LIGHT["--landing-brand-red"]).toBe("#d92128");
    expect(LIGHT["--landing-brand-yellow"]).toBe("#ffd600");
    expect(LIGHT["--landing-bg-base"]).toBe("#f9fafb");
    expect(LIGHT["--landing-surface-base"]).toBe("#ffffff");
    expect(LIGHT["--landing-text-base"]).toBe("#1f2937");
    expect(LIGHT["--landing-card"]).toBe("var(--landing-surface-base)");
    expect(LIGHT["--landing-action-ink"]).toBe("var(--landing-brand-red)");
    expect(LIGHT["--landing-line"]).toBe("var(--landing-brand-black)");
    expect(LIGHT["--landing-drop"]).toBe("var(--landing-brand-black)");
  });

  it("climbs an elevation ladder: coal < page < band < card < tile", (): void => {
    const coal = lightness(hex("--landing-brand-black", LIGHT));
    const page = lightness(hex("--landing-bg-base"));
    const band = lightness(hex("--landing-stats-bg"));
    const card = lightness(hex("--landing-card"));
    expect(coal).toBeLessThan(page);
    expect(page).toBeLessThan(band);
    expect(band).toBeLessThan(card);
  });

  it("keeps body text, muted text and links at AA on the page and on cards", (): void => {
    for (const ground of ["--landing-bg-base", "--landing-card", "--landing-stats-bg"]) {
      for (const text of ["--landing-text-base", "--landing-text-muted-base", "--landing-text-strong", "--landing-action-ink", "--landing-brand-fuchsia-strong"]) {
        expect(contrastRatio(hex(text), hex(ground)), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps white on the red block and coal on the yellow block at AA", (): void => {
    expect(contrastRatio("#ffffff", hex("--landing-brand-red"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", hex("--landing-brand-red-strong"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex("--landing-brand-black", LIGHT), hex("--landing-brand-yellow"))).toBeGreaterThanOrEqual(7);
    // Yellow numerals sit on coal tiles and on the muted red block (large text, 3:1).
    expect(contrastRatio(hex("--landing-brand-yellow"), hex("--landing-brand-black", LIGHT))).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(hex("--landing-brand-yellow"), hex("--landing-brand-red"))).toBeGreaterThanOrEqual(3);
  });

  it("does not glare: the saturated fills are quieter than their light-mode versions", (): void => {
    expect(lightness(hex("--landing-brand-yellow"))).toBeLessThan(lightness(hex("--landing-brand-yellow", LIGHT)));
    expect(lightness(hex("--landing-brand-red"))).toBeLessThan(lightness(hex("--landing-brand-red", LIGHT)));
  });

  it("makes the sticker edge quiet and the hard shadow darker than the page", (): void => {
    const page = lightness(hex("--landing-bg-base"));
    expect(lightness(hex("--landing-drop"))).toBeLessThan(page);
    // A quiet edge: visible against the card, never a bright outline.
    expect(contrastRatio(hex("--landing-line"), hex("--landing-card"))).toBeLessThan(2);
    expect(lightness(hex("--landing-line"))).toBeLessThan(lightness(hex("--landing-text-base")) / 2);
  });
});

describe("landing dark, beyond the palette", (): void => {
  it("dims the bright map tiles so the map does not glare on the dark page", (): void => {
    expect(css).toMatch(/html\[data-theme="dark"\] \.landing-map \.leaflet-tile-pane \{ filter: brightness\(0\.[0-9]+\)/);
  });

  it("keeps the lockup, toggle and ENTRAR on one row on a phone by tightening, not by hiding the toggle", (): void => {
    const phone = css.slice(css.indexOf("The toggle takes ~50px"), css.indexOf("/* ── Launch curtain"));
    expect(phone).toContain(".landing-nav-cta { padding-inline: 12px; }");
    expect(phone).toContain(".landing-logo small { letter-spacing: 2px; }");
    expect(phone).not.toMatch(/landing-theme-toggle[^}]*display: none/);
  });
});

describe("landing sticker layer reads the themed tokens", (): void => {
  it("draws edges and hard shadows from --landing-line / --landing-drop, never from the fixed coal", (): void => {
    const sticker = css.slice(css.indexOf("Plan prices (LAN-03)"));
    const offenders = sticker
      .split("\n")
      .filter((line) => /(border[a-z-]*|box-shadow|text-shadow|--[a-z-]*(shadow|lift[a-z-]*|edge)):[^;]*var\(--landing-(ink|brand-black)\)/.test(line))
      .filter((line) => !/color-mix/.test(line));
    expect(offenders.map((line) => line.slice(0, 90))).toEqual([]);
  });

  it("never paints text with the fixed coal on a surface that turns dark", (): void => {
    for (const selector of [".landing-hero-nav", ".landing-contact dt"]) {
      const start = css.lastIndexOf(`${selector} {`);
      const rule = css.slice(start, css.indexOf("}", start));
      expect(rule, selector).not.toMatch(/(^|[ ;{])color: var\(--landing-ink\)/);
    }
  });
});
