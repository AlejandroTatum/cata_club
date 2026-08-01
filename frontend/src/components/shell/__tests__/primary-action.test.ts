/**
 * One place for a screen's primary action.
 *
 * It used to have three. The action sat in the header's `actions` slot on
 * attendance, groups and discounts; loose in the body on members (wedged
 * against the search field), dashboard (inside the hero) and reports (inside
 * the filter card); and was absent on payments and the Niveles ladder. An admin
 * who learned "the button is at the top right" was right on three screens out
 * of eight.
 *
 * ## Why a source rule
 *
 * Rendering the eight screens of today proves nothing about the ninth, and the
 * failure is not "this screen renders it wrong" — it is "this screen never
 * reached for the slot". `AppShell` has offered `actions` since `PageHeader`
 * existed; three screens simply did not use it. That is a shape you can read
 * off the source and cannot see in a snapshot.
 *
 * The exceptions are NAMED, not inferred. A screen with no header action has to
 * be a decision someone made, with the reason next to it — otherwise the rule
 * decays back into "some screens have one".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");

/** Every admin surface that draws its own `AppShell`. */
const ADMIN_SCREENS = [
  "app/dashboard/page.tsx",
  "app/members/page.tsx",
  "app/groups/page.tsx",
  "app/discounts/page.tsx",
  "app/attendance/page.tsx",
  "app/reports/page.tsx",
];

/**
 * Screens whose primary action is legitimately NOT in the header, each with the
 * reason it is not. Adding a line here is the deliberate act; forgetting the
 * slot is not.
 */
const NO_HEADER_ACTION: Record<string, string> = {
  // A validation queue: the actions are per row, and the batch bar only exists
  // when there are reviewed rows to flush.
  "app/payments/page.tsx": "queue — actions are per row",
  // Levels are created from inside the rung being edited, which is context the
  // header does not have.
  "components/nivel/NivelLadderScreen.tsx": "creation needs the rung as context",
};

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

describe("the primary action lives in the header slot", () => {
  it.each(ADMIN_SCREENS)("%s passes an actions slot", (path) => {
    expect(read(path)).toMatch(/\bactions=\{/);
  });

  it.each(Object.entries(NO_HEADER_ACTION))(
    "%s deliberately passes none — %s",
    (path) => {
      // Asserted in the negative on purpose: if one of these grows a header
      // action, the exception is stale and should be deleted rather than left
      // to describe something that is no longer true.
      expect(read(path)).not.toMatch(/\bactions=\{/);
    },
  );

  it("names every screen that draws an AppShell, so none can be forgotten", () => {
    // The guard is only as good as its list. This is what fails when a new
    // admin screen appears and nobody adds it above — the exact way the three
    // body-CTA screens went unnoticed in the first place.
    const known = new Set([...ADMIN_SCREENS, ...Object.keys(NO_HEADER_ACTION)]);

    // Trainer and student surfaces are out of scope here: their action model is
    // the subject of its own issue, and folding them in now would assert a rule
    // that has not been decided for them yet.
    const outOfScope = /^app\/(trainer|student|admin|ayuda|profile)\//;

    const drawsShell = sourceFiles(join(SRC, "app"))
      .concat(sourceFiles(join(SRC, "components", "nivel")))
      .map((p) => p.slice(SRC.length + 1))
      .filter((p) => /<AppShell\b/.test(read(p)))
      .filter((p) => !outOfScope.test(p));

    expect(drawsShell.filter((p) => !known.has(p))).toEqual([]);
  });
});

function sourceFiles(dir: string): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
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
