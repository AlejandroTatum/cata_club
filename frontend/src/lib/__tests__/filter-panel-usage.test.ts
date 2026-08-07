/**
 * Filter controls live in a filter panel.
 *
 * The audit found the same two controls in three different homes and two
 * opposite orders. Members and Payments left the search and the chips loose on
 * the canvas — Members search-first, Payments chips-first; Attendance framed
 * them in a bordered panel with a small-caps caption; Reports framed them too,
 * one pixel off (`p-[17px_18px]`) and with no caption. Nothing was broken in
 * any single file, which is exactly why it drifted: each screen was internally
 * consistent and no reviewer sees five screens at once.
 *
 * `ui/FilterPanel` is now the one frame, and its slots (`search`, `chips`,
 * `fields`) render in a fixed order regardless of the order the props are
 * written in — so the ORDER half of this rule is carried by the type, not by
 * this file. What a type cannot carry is a screen that reaches past the panel
 * and drops a `SearchInput` or a `FilterPill` straight onto the canvas again.
 * That is the rule below.
 *
 * ## What this deliberately does NOT check
 *
 * That EVERY control in a file is inside the panel. A screen may legitimately
 * carry a second, bare search/filter control nested inside an already-panelled
 * section — a framed panel nested inside another would read as a second
 * page-level filter. A rule strict enough to catch that would fire on the
 * screen that thought about it hardest, and a guard that fires on correct code
 * is a guard people learn to skip. The narrow rule catches the real regression:
 * a new screen that filters and never imports the panel at all.
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
 * `components/ui/` is where the primitives live: `FilterPanel` itself composes
 * nothing, and `FilterPill` cannot be asked to import the panel that renders
 * it. Everything else is a screen.
 */
const PRIMITIVES = "components/ui/";

const FILES = sourceFiles(SRC)
  .map((path) => ({ path: path.slice(SRC.length + 1), code: stripComments(readFileSync(path, "utf8")) }))
  .filter(({ path }) => !path.replace(/\\/g, "/").startsWith(PRIMITIVES));

const RENDERS_CONTROL = /<(?:SearchInput|FilterPill)\b/;
const RENDERS_PANEL = /<FilterPanel\b/;

describe("filter controls live in a filter panel", () => {
  it("is used by every screen that filters", () => {
    const loose = FILES.filter(
      ({ code }) => RENDERS_CONTROL.test(code) && !RENDERS_PANEL.test(code),
    ).map(({ path }) => path);

    expect(loose).toEqual([]);
  });

  it("watches more than one screen", () => {
    // The rule is only worth anything while it covers the screens the audit
    // named. If this drops, the walk above stopped finding files and the first
    // assertion is passing on an empty set.
    const users = FILES.filter(({ code }) => RENDERS_PANEL.test(code)).map(({ path }) => path);

    expect(users.length).toBeGreaterThanOrEqual(5);
  });
});
