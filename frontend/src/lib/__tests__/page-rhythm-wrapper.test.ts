/**
 * The page rhythm is written by the shell, and only by the shell.
 *
 * `docs/ux/ritmo-vertical.md` settled the value and the owner in #31:
 *
 * | Trabajo                     | Idioma          | Quién lo escribe    |
 * |-----------------------------|-----------------|---------------------|
 * | Bloques de primer nivel     | `gap-page`      | `AppShell`, una vez |
 *
 * `AppShell` carries it out — `<main>` is `flex min-w-0 flex-1 flex-col
 * gap-page`, so every first-level block of every screen is already on the 20px
 * step the moment it is rendered. Ten screens wrote it a second time anyway,
 * and the doctrine's own words are why: it allowed a screen that ALSO fixes a
 * width to "conservar el envoltorio pero nombrar el escalón", offering two
 * spellings — `w-full space-y-page` and `flex flex-col gap-page` — and then, in
 * the section immediately below, measured one of them wrong.
 *
 * ## The measurement that the wrappers were never held to
 *
 * `space-y-*` sets `margin-top` on every later sibling INCLUDING one that is
 * out of flow. On a `fixed inset-0` veil with both `top` and `bottom` pinned,
 * that margin is not ignored: it shifts the box and takes height off it. The
 * doctrine measured it against the emitted CSS at 1440x900 —
 *
 * | | `space-y-page` | `flex flex-col gap-page` |
 * |---|---|---|
 * | `fixed inset-0` veil | `margin-top: 20px`, box 1440x880 @top 20 | 1440x900 @top 0 |
 *
 * — and moved `<main>` off `space-y`. It did not move the eight wrappers that
 * sit one level inside it, and those wrappers have exactly the same shape: a
 * flow container whose children include, on several screens, a `ConfirmDialog`
 * or an `AgeUpConfirmation` rendered inline rather than through a portal. None
 * of the eight has a veil as a later sibling TODAY, so nothing is visibly
 * broken; that is precisely the state the doctrine described as "inmune por un
 * parche que la cascada puede revertir" rather than "inmune por construcción".
 *
 * ## So the rule is the doctrine's own table, enforced
 *
 * `space-y-page` names the PAGE step, and the page step belongs to `AppShell`.
 * Inside a card the steps are `section` and `field`, and those stay untouched.
 * A screen that writes `space-y-page` is a screen re-deciding something the
 * shell already decided, in the spelling that was measured wrong.
 *
 * The second rule is the redundancy the first one leaves behind: a wrapper
 * opened directly inside `<AppShell>` whose class list is nothing but rhythm
 * and `w-full` does no work at all. `<main>` is a flex column, so its children
 * already stretch to full width and already sit 20px apart. Deleting the
 * wrapper changes no pixel and removes the node that could carry the margin.
 *
 * ## What this deliberately does NOT check
 *
 * A wrapper that is LOAD-BEARING stays. `/ayuda` caps its column at
 * `max-w-3xl` and `/student/add-dependent` at `max-w-[760px]`; both keep the
 * envelope, because the envelope is doing the width job the doctrine described
 * — they simply spell the step the way `<main>` spells it. The second rule
 * below only fires on a class list that contains NOTHING but rhythm and
 * `w-full`, so a cap, a `mx-auto`, a `max-w-*` or any real utility takes the
 * wrapper out of scope by construction.
 *
 * It also does not check `mb-*` on a first-level block. That is structure, and
 * a regular expression does not see structure — the same limit the rhythm
 * doctrine records for its own lock.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

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

/** Prose explaining the rule is not a breach of it. */
function stripComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The screens. A module that renders `<AppShell>` is a screen, and a screen is
 * the only thing that can wrap the shell's content — the same scoping the
 * rhythm axis of `arbitrary-style-values.test.ts` uses, and for the same
 * reason: a `ui/` primitive knows nothing about the page it lands on.
 */
const SCREENS = sourceFiles(SRC)
  .map((path) => ({
    path: path.slice(SRC.length + 1).replace(/\\/g, "/"),
    code: stripComments(readFileSync(path, "utf8")),
  }))
  .filter(({ code }) => /<AppShell\b/.test(code));

/**
 * Classes that do nothing when the parent is `<main>`.
 *
 * `w-full` is in the list because `<main>` is `flex flex-col`: its children are
 * flex items on a column, so `align-items: stretch` already gives them the full
 * cross-axis measure. Writing `w-full` on one asks for a width it already has.
 */
const NO_OP_CLASSES = new Set(["flex", "flex-col", "w-full", "gap-page", "space-y-page"]);

/**
 * Every `div` in a file that is opened with a static class string.
 *
 * Not anchored to the `<AppShell>` tag on purpose. These screens compose their
 * views as sibling functions — `/student` renders `ActivePortalView` and
 * `PendingEnrollmentView`, `/student/payments` renders `PaymentsContent` — so
 * the wrapper that opens the shell's content is usually four hundred lines
 * above the shell that receives it. An anchored scan reads the wrong element
 * and reports nothing, which is the worst thing a guard can do.
 *
 * Anything that is not a plainly readable `div` — a component, a fragment, a
 * `cn(...)` call, a template literal — is skipped rather than guessed at.
 */
function staticDivClassLists(code: string): string[][] {
  return [...code.matchAll(/<div className="([^"{}]*)"/g)].map((match) =>
    match[1].split(/\s+/).filter(Boolean),
  );
}

/** A wrapper that asks the parent for nothing it does not already give. */
function isInert(classes: string[]): boolean {
  return classes.length > 0 && classes.every((name) => NO_OP_CLASSES.has(name));
}

describe("the page rhythm is written by the shell", () => {
  it("finds the screens to check at all", () => {
    // Guards the guard: if the walk stops finding files, or `<AppShell>` is
    // renamed, both assertions below start passing on an empty set and this is
    // the only thing that says so.
    expect(SCREENS.length).toBeGreaterThanOrEqual(15);
  });

  it("is never re-declared by a screen as space-y-page", () => {
    const redeclared = SCREENS.filter(({ code }) => /\bspace-y-page\b/.test(code)).map(
      ({ path }) => path,
    );

    expect(redeclared).toEqual([]);
  });

  it("does not need a wrapper to carry it", () => {
    const inert = SCREENS.filter(({ code }) => staticDivClassLists(code).some(isInert)).map(
      ({ path }) => path,
    );

    expect(inert).toEqual([]);
  });

  it("leaves a wrapper alone the moment it does real work", () => {
    // The narrowness IS the rule. `/ayuda` caps its column and `add-dependent`
    // caps its wizard; both open a wrapper inside the shell on purpose, and a
    // rule wide enough to catch them would fire on the screens that thought
    // about it hardest.
    expect(isInert(["mx-auto", "flex", "max-w-3xl", "flex-col", "gap-page"])).toBe(false);
    expect(isInert(["flex", "w-full", "max-w-[760px]", "flex-col", "gap-page"])).toBe(false);
    expect(isInert(["flex", "flex-col", "gap-page"])).toBe(true);
    expect(isInert(["w-full", "space-y-page"])).toBe(true);
    // A `div` with no class list at all is markup, not a rhythm wrapper.
    expect(isInert([])).toBe(false);
  });
});
