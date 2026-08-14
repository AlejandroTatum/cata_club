/**
 * A screen is drawn on ONE of two content measures, and which one is a rule.
 *
 * #85 asked for the dead canvas under the last card to be closed. #96 measured
 * every list in a browser and showed it cannot be, by a page size: on the
 * seven screens that paginate, canvas and a capped page are mutually exclusive
 * states. What survived that proof were the two screens that do NOT paginate —
 * `/discounts`, which renders its whole catalog, and `/groups`, which renders
 * a card per categoría. Their canvas is a function of how many records exist.
 *
 * The answer chosen was to reframe rather than to fill: those two screens are
 * capped at 1024px (`AppShell` `measure="short"`) instead of the product's
 * 1408px. This file keeps that a decision rather than a habit, in two parts.
 *
 * ## 1. The set is exactly two
 *
 * Both directions matter, and the second one is the one that rots. A screen
 * that ADOPTS the short measure without measuring is how "narrow looks tidy"
 * spreads to a table that needs the width — the `/members` table alone carries
 * seven columns and would scroll sideways at 972px. A screen that DROPS it
 * silently is how #85 gets reopened. So the set is written out here and any
 * change to it has to change this file, which is the point.
 *
 * ## 2. Nobody writes a third measure by hand
 *
 * Both measures live on one element in `AppShell`, which is where the long
 * note explaining them lives. A screen that types `max-w-8xl` or `max-w-5xl`
 * into its own markup is answering a question the shell already answers, and
 * the answer would then exist in two places with nothing keeping them equal —
 * the exact drift `PAGE_RAIL` was extracted to stop after #36 found the same
 * split written six ways with four measures.
 *
 * ## What this deliberately does NOT check
 *
 * That the canvas got smaller. It did not, and that is recorded rather than
 * hidden: `tests/e2e/dead-canvas.spec.ts` measures the same 344/476/656px on
 * `/discounts` after this change as before it. The short measure changes the
 * proportion of the block above the emptiness, not the emptiness. A test
 * asserting otherwise would be asserting something that is not true.
 *
 * It also does not police every `max-w-*` in the product. `/ayuda` caps a
 * reading column at `max-w-3xl`, the Niveles ladder pairs two tiles at
 * `max-w-[520px]`, and the modal is `max-w-md`. Those are widths of a
 * COMPONENT, decided where they are written; the content measure is the width
 * of a SCREEN, and only the shell gets to set it. A rule wide enough to catch
 * all four would fire on the three files that thought about it hardest.
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

const FILES = sourceFiles(APP).map((path) => ({
  path: path.slice(APP.length + 1).replace(/\\/g, "/"),
  code: stripComments(readFileSync(path, "utf8")),
}));

/** Every screen that renders the shell at all — the population under the rule. */
const SHELL_SCREENS = FILES.filter(({ code }) => code.includes("<AppShell"));

/** The screens that ask for the narrow one. */
const SHORT_SCREENS = SHELL_SCREENS.filter(({ code }) => /measure="short"/.test(code)).map(
  ({ path }) => path,
);

/**
 * The screens whose height is a function of what EXISTS rather than of a page
 * size, each admitted on a reading rather than on a look.
 *
 * Changing this list means changing the readings in `dead-canvas.spec.ts`
 * too — a screen joins it because it was measured, not because it looked wide.
 *
 * | Screen                     | Why it qualifies                          | Reading |
 * |----------------------------|-------------------------------------------|---------|
 * | `/discounts`               | renders the whole catalog, no pager        | #85/#96 |
 * | `/groups`                  | a card per categoría, no pager             | #85/#96 |
 * | `/student/medical-record`  | five controls that never grow with data    | D11b    |
 * | `/student/payments`        | the family's own history, no pager         | D11b    |
 *
 * The last two are the socio redesign's (docs/ux/comparaciones/socio.html).
 *
 * The ficha médica is not a list at all — it is the extreme case of the same
 * shape, a block that is the SAME height empty or full because the record it
 * edits has no repeating part. It measured 52% dead canvas as an adult titular
 * and 33% as a guardian at 1440x900, the worst reading in the product, on the
 * product's WIDEST measure. Like the other two, `short` reframes that block
 * instead of filling it: there is no history, no trend and no "última
 * actualización" in the payload, and inventing one would break D14.
 *
 * `/student/payments` is the shape this rule was written for and was hiding it
 * behind a rail: one family's payments, all of them, no pager. Once "cómo se
 * registra un pago" moved behind "Ver ayuda" (D11c) the second column had
 * nothing left in it, and the single column that remained inherited 1356px —
 * a membership card with 600px of nothing to the right of its own heading.
 */
const SHORT_MEASURE_SCREENS = [
  "discounts/page.tsx",
  "groups/page.tsx",
  "student/medical-record/page.tsx",
  "student/payments/page.tsx",
];

/** A screen answering the shell's question in its own markup. */
const CONTENT_MEASURE_CLASS = /className=[^\n]*\bmax-w-(?:5xl|8xl)\b/;

describe("the content measure belongs to the shell", () => {
  it("is short on exactly the screens that cannot fill it", () => {
    expect(SHORT_SCREENS.sort()).toEqual(SHORT_MEASURE_SCREENS);
  });

  it("watches every screen that renders the shell", () => {
    // The canary. Seventeen screens render `AppShell` today; if this drops,
    // the walk stopped finding files and the assertion above is passing over
    // an empty set rather than over the product.
    expect(SHELL_SCREENS.length).toBeGreaterThanOrEqual(17);
  });

  it("is never written by hand in a screen", () => {
    const offenders = SHELL_SCREENS.filter(({ code }) => CONTENT_MEASURE_CLASS.test(code)).map(
      ({ path }) => path,
    );

    expect(offenders).toEqual([]);
  });
});
