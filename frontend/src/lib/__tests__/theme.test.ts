/**
 * Theme preference: what `<html>` gets, and the pre-paint script that sets it.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  parseTheme,
  readAppliedTheme,
  resolveTheme,
} from "../theme";
import { buildContentSecurityPolicy } from "../middleware-utils";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = { ...initial };
  return {
    getItem: (key: string): string | null => (key in store ? store[key] : null),
    setItem: (key: string, value: string): void => {
      store[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => undefined,
    key: (): string | null => null,
    length: 0,
  } as Storage;
}

function stubMatchMedia(prefersDark: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  }));
}

/** Runs the real inline script against a stubbed environment and reports what it did to <html>. */
function runInitScript(opts: { stored?: string; prefersDark: boolean; storageThrows?: boolean }): string | null {
  stubMatchMedia(opts.prefersDark);
  if (opts.storageThrows) {
    vi.stubGlobal("localStorage", {
      getItem: (): never => {
        throw new Error("blocked");
      },
    });
  } else {
    vi.stubGlobal("localStorage", memoryStorage(opts.stored ? { [THEME_STORAGE_KEY]: opts.stored } : {}));
  }
  document.documentElement.removeAttribute("data-theme");
  new Function(THEME_INIT_SCRIPT)();
  return document.documentElement.getAttribute("data-theme");
}

describe("theme resolution", () => {
  it("trusts only the two known names", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("sepia")).toBeNull();
    expect(parseTheme("")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it("lets the stored choice beat the OS, and the OS decide when nothing is stored", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("garbage", true)).toBe("dark");
  });

  it("writes the attribute and the native color-scheme together", () => {
    applyTheme("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(readAppliedTheme()).toBe("dark");
    applyTheme("light");
    expect(readAppliedTheme()).toBe("light");
  });
});

describe("the pre-paint init script", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies the stored choice over the OS preference", () => {
    expect(runInitScript({ stored: "light", prefersDark: true })).toBe("light");
    expect(runInitScript({ stored: "dark", prefersDark: false })).toBe("dark");
  });

  it("falls back to prefers-color-scheme with no stored choice, and ignores a corrupt one", () => {
    expect(runInitScript({ prefersDark: true })).toBe("dark");
    expect(runInitScript({ prefersDark: false })).toBe("light");
    expect(runInitScript({ stored: "banana", prefersDark: true })).toBe("dark");
  });

  it("never throws when storage is blocked — a theme script must not break the page", () => {
    expect(() => runInitScript({ prefersDark: true, storageThrows: true })).not.toThrow();
  });

  it("agrees with `resolveTheme` for every stored/OS combination", () => {
    for (const stored of [undefined, "light", "dark", "junk"]) {
      for (const prefersDark of [true, false]) {
        expect(runInitScript({ stored, prefersDark })).toBe(resolveTheme(stored, prefersDark));
      }
    }
  });
});

describe("the strict CSP stays strict", () => {
  it("serves the script through the request nonce, not through a weaker policy", () => {
    const csp = buildContentSecurityPolicy("abc123");
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("has the root layout read the middleware's nonce and hand it to the script", () => {
    const layout = readFileSync(join(__dirname, "..", "..", "app", "layout.tsx"), "utf8");
    expect(layout).toMatch(/headers\(\)\)\.get\("x-nonce"\)/);
    expect(layout).toMatch(/<ThemeScript nonce=\{nonce\} \/>/);
    // Inside <head>, so it runs before the first paint.
    expect(layout.indexOf("<head>")).toBeLessThan(layout.indexOf("<ThemeScript"));
    expect(layout.indexOf("<ThemeScript")).toBeLessThan(layout.indexOf("<body className"));
  });
});
