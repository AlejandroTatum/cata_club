/**
 * One page, one `main` landmark.
 *
 * Every authenticated page used to render TWO, nested: the root layout wrapped
 * `{children}` in a `<main>` that carried nothing but a max-width and padding,
 * and every shell screen drew its own inside it. Someone navigating by landmark
 * found two regions called "principal" and had to guess; worse, the skip link
 * pointed at the INNER one, so the region a screen reader reaches first was not
 * the one the keyboard jump used. The page made two claims about where its
 * content began and they disagreed.
 *
 * ## Why this is a source rule and not a render assertion
 *
 * The defect is not "this screen has two" — it is "a wrapper that is not a
 * landmark was written as one". Rendering the fourteen routes of today proves
 * nothing about the fifteenth. What holds across every future route is the
 * ownership rule: a `<main>` belongs to a SHELL, and every page reaches the user
 * through exactly one of them.
 *
 * So the list below is the closed set of files allowed to declare the landmark.
 * Adding a `<main>` anywhere else fails here — including in a page that already
 * renders inside `AppShell`, which is the exact way the second one appeared.
 * Adding a genuinely new shell means adding a line here, on purpose, with the
 * reason next to it.
 *
 * The per-shell "exactly one" assertions live with each shell's own tests
 * (`AppShell.test.tsx`, `AuthShell.test.tsx`, `LandingPage.test.tsx`).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

/**
 * The shells. Every route in the product renders through exactly one of these,
 * and each one draws the landmark at the point its own content starts.
 */
const SHELLS: readonly string[] = [
  // Every authenticated route. Also the skip link's target — see its note on
  // why that element carries `tabIndex={-1}`.
  "components/shell/AppShell.tsx",
  // login / forgot-password / reset-password.
  "components/auth/AuthShell.tsx",
  // The public landing.
  "app/landing/LandingPage.tsx",
  // The two public routes that reach the user through no shell at all: they
  // used to borrow the root layout's landmark, which is precisely the wrapper
  // that stopped being one.
  "app/unauthorized/page.tsx",
  "app/student/enroll/page.tsx",
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

/** Prose that DISCUSSES the landmark is not a second landmark. */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const declaring = sourceFiles(SRC)
  .map((path) => ({
    path: path.slice(SRC.length + 1),
    code: stripComments(readFileSync(path, "utf8")),
  }))
  .filter(({ code }) => /<main[\s>]/.test(code))
  .map(({ path }) => path)
  .sort();

describe("the main landmark belongs to a shell, and only to a shell", () => {
  it("is declared by exactly the shells, and nowhere else", () => {
    expect(declaring).toEqual([...SHELLS].sort());
  });

  it("is not declared by the root layout, which only sets width and padding", () => {
    // `app/layout.tsx` wraps EVERY page. A landmark there is a landmark on top
    // of whatever the page's own shell already drew — which is how the product
    // ended up with two on every authenticated route.
    expect(declaring).not.toContain("app/layout.tsx");
  });

  it("is declared no more than once per file", () => {
    const twice = sourceFiles(SRC)
      .map((path) => ({
        path: path.slice(SRC.length + 1),
        code: stripComments(readFileSync(path, "utf8")),
      }))
      .filter(({ code }) => (code.match(/<main[\s>]/g) ?? []).length > 1)
      .map(({ path }) => path);

    expect(twice).toEqual([]);
  });
});
