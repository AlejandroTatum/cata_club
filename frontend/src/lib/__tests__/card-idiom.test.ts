/**
 * One spelling for the paper card.
 *
 * The product had two, and they rendered pixel for pixel the same thing:
 * `.card` (`globals.css:67-71`) and the utility string `rounded-card border
 * border-line bg-paper`. Same white, same `#DEDEE6` hairline, same 14px radius,
 * same shadow. Forty call sites used the first, twenty-one the second, and the
 * split ran exactly along "screen written before the redesign" / "screen
 * written after it" — which is to say it was not a decision, it was a seam.
 *
 * ## The part that was not cosmetic
 *
 * The shadow reaches the utility spelling through a COMPOUND selector:
 *
 *     .rounded-card.bg-paper, .card, .card-hover { @apply shadow-card }
 *
 * `.rounded-card.bg-paper` needs BOTH classes present. So a card written as
 * `rounded-card border border-line` — no `bg-paper`, because it sits on a
 * different fill — silently loses its elevation, and nothing says so. Four such
 * elements exist today; each is a deliberate inset or a non-paper surface, and
 * none of them should be a `.card`. That is exactly why the paper card needs a
 * name of its own rather than a string you assemble and hope you finished.
 *
 * ## What this does NOT ban
 *
 * `rounded-card` on its own is a RADIUS token and stays: the coal heroes, the
 * gradient student card, the `state-bad` alert panels and the sunken help panel
 * all use it correctly and are not paper cards. The rule below is narrow on
 * purpose — it names the one combination that duplicates `.card`.
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
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
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

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  code: stripComments(readFileSync(path, "utf8")),
}));

/**
 * The three classes that, TOGETHER, re-declare `.card`.
 *
 * Checked as a set over the tokens of one class string rather than with a
 * regex that walks between them. A pattern like
 * `rounded-card[^"]*border-line[^"]*bg-paper` needs two unbounded runs either
 * side of an alternation, which is a shape that backtracks badly on long lines
 * — and every one of these files has long lines. Splitting on whitespace is
 * linear and says what it means.
 */
const CARD_TOKENS = ["rounded-card", "border-line", "bg-paper"];

/** Every `class`/`className` string literal in a file, as token lists. */
function classLists(code: string): string[][] {
  const lists: string[][] = [];
  for (const match of code.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    lists.push((match[1] ?? match[2] ?? "").split(/\s+/).filter(Boolean));
  }
  return lists;
}

describe("the paper card has one spelling", () => {
  it("is never assembled from utilities", () => {
    const assembled = FILES.filter(({ code }) =>
      classLists(code).some((tokens) => CARD_TOKENS.every((token) => tokens.includes(token))),
    ).map(({ path }) => path);

    expect(assembled).toEqual([]);
  });

  it("keeps rounded-card available as the radius token it is", () => {
    // The narrowness IS the rule. A guard that banned `rounded-card` outright
    // would fire on every coal hero and every alert panel in the product, and a
    // guard that fires on correct code is a guard people learn to skip.
    const radiusUsers = FILES.filter(({ code }) => /\brounded-card\b/.test(code));
    expect(radiusUsers.length).toBeGreaterThan(0);
  });
});
