/**
 * `AUTH_SHELL_PREFIXES` (in `shell-routes.ts`) must claim every route whose
 * page actually renders `AuthShell`.
 *
 * This is the second time that list drifted from the pages it describes:
 * `/reset-password` was missing once (see the comment on `shell-routes.ts`),
 * and `/verificar-correo` was missing a second time — a route that renders
 * `AuthShell` fell through `resolveShellKind` to `"public"`, so a signed-in
 * visitor saw the full authenticated top nav stacked on top of `AuthShell`'s
 * own split-screen composition. `shell-routes.test.ts` used to assert the
 * SAME three routes by hand right next to the SAME three routes typed by
 * hand in `AUTH_SHELL_PREFIXES` — a hand-copied list checked against another
 * hand-copied list, so both omitted `/verificar-correo` together and neither
 * caught it.
 *
 * This guard reads the truth instead of repeating it: it walks
 * `frontend/src/app/**\/page.tsx`, keeps the ones that import `AuthShell`,
 * and asserts `resolveShellKind` resolves each one's route to `"auth"`. Add a
 * page that renders `AuthShell` and forget it in `AUTH_SHELL_PREFIXES`, and
 * this fails without anyone remembering to come here.
 *
 * Deliberately parses source text instead of importing the page modules:
 * these are `"use client"` pages with server-only and browser-only
 * dependencies (Next router hooks, API calls) that a plain Vitest module
 * import cannot resolve — reading the import statement is the cheap, honest
 * check that the composition exists without having to render it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveShellKind } from "@/lib/shell-routes";

const APP_DIR = join(__dirname, "..", "..", "app");

/** Every `page.tsx` under `dir`, test directories excluded. */
function appPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...appPageFiles(full));
      continue;
    }
    if (entry === "page.tsx") found.push(full);
  }
  return found;
}

/** The URL a `page.tsx` under `APP_DIR` answers to, route groups stripped. */
function routeFor(pagePath: string): string {
  const withoutFile = pagePath.slice(APP_DIR.length).replace(/[\\/]page\.tsx$/, "");
  const segments = withoutFile.split(/[\\/]/).filter((segment) => segment && !/^\(.*\)$/.test(segment));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

const AUTH_SHELL_IMPORT = /from\s+["']@\/components\/auth\/AuthShell["']/;

interface AuthShellPage {
  /** Path relative to `frontend/src/app`, for a readable failure message. */
  path: string;
  route: string;
}

const authShellPages: AuthShellPage[] = appPageFiles(APP_DIR)
  .filter((path) => AUTH_SHELL_IMPORT.test(readFileSync(path, "utf8")))
  .map((path) => ({ path: path.slice(APP_DIR.length + 1), route: routeFor(path) }))
  .sort((a, b) => a.route.localeCompare(b.route));

describe("AUTH_SHELL_PREFIXES stays in sync with the pages that render AuthShell", () => {
  it("the walker actually finds pages that render AuthShell", () => {
    // Guard of the guard: a broken regex or a moved `app/` directory would
    // make the real assertion below vacuously true (an empty list).
    expect(authShellPages.length).toBeGreaterThanOrEqual(5);
  });

  it("resolves \"auth\" for every page that renders AuthShell", () => {
    const found = authShellPages.map(({ path, route }) => `${route} (${path})`).join(", ");
    const missing = authShellPages.filter(({ route }) => resolveShellKind(route) !== "auth");

    expect(
      missing.map(({ route }) => route),
      `AuthShell pages found: ${found}. ` +
        `Missing from AUTH_SHELL_PREFIXES in shell-routes.ts: ${
          missing.length === 0 ? "none" : missing.map(({ path, route }) => `${route} (${path})`).join(", ")
        }`,
    ).toEqual([]);
  });
});
