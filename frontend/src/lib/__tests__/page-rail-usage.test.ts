/**
 * A page splits into a main column and a rail ONE way.
 *
 * Issue #36 described the student and profile screens as already sharing "the"
 * second-column pattern and asked for it to be carried into the admin screens.
 * They were not sharing it. The same split was written six ways, with four
 * different rail measures — 340px twice, 360px on `/student/payments`, 380px
 * on `/profile`, `minmax(0,340px)` with a 16px gap on the dashboard — and none
 * of the odd ones carried a comment saying why. Nothing was wrong inside any
 * one file, which is exactly how it drifted: each screen was internally
 * consistent and no reviewer opens five screens at once.
 *
 * `ui/PAGE_RAIL` is now the one string, exported beside `STAT_GRID` and for
 * the same reason. The rule below is that no screen writes the track by hand
 * again.
 *
 * ## What this deliberately does NOT check
 *
 * That every two-column layout in the product is a rail. `/payments` splits
 * its proof viewer off with `lg:grid-cols-5` + `lg:col-span-3`, and that is a
 * PROPORTIONAL split, not a rail: the payment proof is an image, and an image
 * that scales with the window is the point of showing it. That is not the
 * shape this constant describes, and a rule wide enough to catch it would
 * fire on a file that thought about it hardest — a guard that fires on
 * correct code is a guard people learn to skip.
 *
 * The narrow rule catches the real regression: a new screen that wants a rail
 * and types its own measure instead of importing the one that exists.
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

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1).replace(/\\/g, "/"),
  code: stripComments(readFileSync(path, "utf8")),
}));

/**
 * The rail shape, whatever measure it is spelled with: a flexible first track
 * that may shrink to nothing, and a second one that is a fixed width. This is
 * what all six variants had in common.
 */
const HAND_WRITTEN_RAIL = /grid-cols-\[minmax\(0,\s*1fr\)_/;

const USES_CONSTANT = /\bPAGE_RAIL\b/;

describe("a page splits into a main column and a rail one way", () => {
  it("is never written by hand", () => {
    const handWritten = FILES.filter(({ code }) => HAND_WRITTEN_RAIL.test(code)).map(
      ({ path }) => path,
    );

    expect(handWritten).toEqual([]);
  });

  it("watches more than one screen", () => {
    // The rule is only worth anything while it covers the screens the audit
    // named. If this drops, the walk above stopped finding files and the first
    // assertion is passing on an empty set.
    const users = FILES.filter(({ code }) => USES_CONSTANT.test(code)).map(({ path }) => path);

    expect(users.length).toBeGreaterThanOrEqual(6);
  });
});
