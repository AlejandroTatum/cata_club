/**
 * A paginated list shows TEN rows, and that number is a measurement.
 *
 * #85 asked for more rows per page, on the theory that the dead canvas its
 * screenshots showed was a page size that stopped too early. Measured in a
 * browser across all seven paginated lists, at two row densities and three
 * desktop heights (`tests/e2e/dead-canvas.spec.ts`), it is not:
 *
 *   - With MORE records than a page, every list already overflows 1440×900 —
 *     the tallest by 420px — and leaves at most 90px of canvas at 1920×1080.
 *     There is nothing left for extra rows to close.
 *   - With FEWER records than a page, canvas appears (up to 498px) — but the
 *     page did not fill, so a larger page size mounts exactly zero extra rows
 *     into it.
 *
 * Those two states are exhaustive, which is what makes ten the answer rather
 * than a habit: dead canvas and a capped page never coexist. The reverse was
 * built and measured too. Twenty rows adds 480–600px of scroll to every list
 * at 1366×768, taking the tallest page from 1.72 to 2.45 viewports, and buys
 * nothing at either viewport the issue was written about.
 *
 * So the rule this file keeps is that the number stays one number. Four of the
 * eight constants were already pinned beside their own screen; two — the
 * groups roster and the trainer history — were bare module-local `const`s
 * with nothing watching them at all, which is how a product ends up
 * paginating six ways. A source scan is what reaches those: they are not
 * exported, so no unit test can import them.
 *
 * The trainer attendance wizard's roster used to be the ninth (`WIZARD_PAGE_SIZE`)
 * and is gone on purpose (issue #318 / hallazgo #58): pagination there forced a
 * page change mid-session on any roster over 10 alumnos, which the audit
 * measured as the single largest contributor to a 22-click walkthrough on a
 * 15-alumno session. That roster does not paginate at all any more, so it is
 * not a candidate for "the same number on every screen" — there is no number.
 *
 * ## What this deliberately does NOT check
 *
 * That ten is right for a phone. Below `sm` these lists are card stacks, not
 * tables, and a card is roughly twice a row — the e2e measurement is scoped to
 * desktop heights for the same reason, and a rule asserting one number across
 * both would be asserting something nobody measured.
 *
 * It also does not forbid a screen from paginating at a different size
 * forever. It forbids doing it SILENTLY: changing the number here means
 * changing the recorded readings in `dead-canvas.spec.ts` too, which is the
 * whole point.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "..", "..", "app");

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

/**
 * Any `const …PAGE_SIZE = <number>`, exported or not. The name is the thing
 * every one of the nine already agreed on; the declaration style is not.
 */
const PAGE_SIZE_DECLARATION = /const\s+([A-Z_]*PAGE_SIZE)\s*(?::\s*number\s*)?=\s*(\d+)/g;

const ROWS_PER_PAGE = 10;

const DECLARATIONS = sourceFiles(APP).flatMap((path) => {
  const code = stripComments(readFileSync(path, "utf8"));
  return [...code.matchAll(PAGE_SIZE_DECLARATION)].map((match) => ({
    path: path.slice(APP.length + 1).replace(/\\/g, "/"),
    name: match[1],
    size: Number(match[2]),
  }));
});

describe("a paginated list shows ten rows", () => {
  it("is the same number on every screen", () => {
    const odd = DECLARATIONS.filter(({ size }) => size !== ROWS_PER_PAGE).map(
      ({ path, name, size }) => `${path}: ${name} = ${size}`,
    );

    expect(odd).toEqual([]);
  });

  it("watches every list that paginates", () => {
    // The canary. Eight declarations across six screens is what remains
    // after issue #318/#58 removed the trainer wizard's page size constant
    // (see the module docstring); if this drops further, the walk stopped
    // finding files and the assertion above is passing over an empty set.
    expect(DECLARATIONS.length).toBeGreaterThanOrEqual(8);

    // …including the two that no unit test can reach, because they are
    // module-local and unexported. They are the reason this is a source scan.
    const scanned = new Set(DECLARATIONS.map(({ path }) => path));
    expect([...scanned]).toEqual(
      expect.arrayContaining([
        "groups/page.tsx",
        "trainer/attendance/history/page.tsx",
      ]),
    );
    // There used to be a lock here asserting the wizard's `page.tsx` carried
    // no `…PAGE_SIZE` constant (#318/#58). The wizard was deleted while it is
    // rebuilt inside the Members area, so the lock now guards a file that
    // cannot exist and would pass no matter what anyone wrote. When the roster
    // comes back inside Members, it gets a lock naming its real path.
  });
});
