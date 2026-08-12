/**
 * One back control, and it comes from the ui kit.
 *
 * The product used to ship two implementations of the same control —
 * `components/BackLink.tsx` (a bare `btn-ghost` text link) and
 * `components/ui/BackLink.tsx` (the bordered button skin) — and screens
 * drifted between them. Issue #202 consolidates both into the canonical
 * `ui/BackLink`. This rule guards the consolidation the same way
 * `primary-action.test.ts` guards the header slot: a screen importing the
 * retired path is a screen that never migrated, and a regression test over
 * today's screens cannot see that. The failure this catches — "somebody
 * reached for the old path again" — is a shape you can read off the source
 * and cannot see in a snapshot.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");

/** The retired shared implementation, retired by #202. */
const LEGACY_PATH = join(SRC, "components", "BackLink.tsx");
const LEGACY_IMPORT = /from\s+["']@\/components\/BackLink["']/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

describe("there is one back control, and it comes from the ui kit", () => {
  it("no source file imports the retired components/BackLink path", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => ({ path, code: readFileSync(path, "utf8") }))
      .filter(({ code }) => LEGACY_IMPORT.test(code))
      .map(({ path }) => path.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it("the legacy implementation file is gone", () => {
    expect(existsSync(LEGACY_PATH)).toBe(false);
  });
});
