/**
 * One focus indicator, used everywhere.
 *
 * `color-contrast.test.ts` proves the ring's colours can be seen. This proves
 * they are the ones actually on the controls: the yellow `ball` ring measured
 * 1.41:1 on paper, and it was spread across a dozen files by hand, so the
 * failure mode is not "the token is wrong" but "one screen kept the old
 * chain". A grep is the only test that catches that.
 *
 * ## What is banned, precisely
 *
 * Not the token `outline-ball` — a BARE `outline-ball`, i.e. a yellow band
 * with nothing contrasting next to it. The system rule in `globals.css` paints
 * two concentric bands for exactly this reason, and two call sites legitimately
 * repaint it by hand because that rule cannot reach them:
 *
 *   · `payments/page.tsx` — the detail heading is `tabindex="-1"`, which the
 *     rule's `:is(…)` list excludes.
 *   · `members/page.tsx` — a `<label>`, likewise not in the list.
 *
 * Both pair the ball with a `#131316` coal band, which is what carries the 3:1
 * (18.54:1 on paper, 13.13:1 against the ball). Banning the token outright
 * would fail those two and teach the next person to delete a measured ring, so
 * the assertion looks for the companion band instead.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

/** The coal band that has to sit next to the ball for the pair to measure. */
const COAL = "#131316";

/**
 * How far from the `outline-ball` the companion band may sit. A className is
 * often a multi-line template literal, so the check cannot be per-line, but it
 * must stay tight enough that an unrelated colour elsewhere in the file does
 * not launder a bare ring.
 */
const COMPANION_WINDOW = 240;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Comments describe the old ring at length — `globals.css` names the banned
 * class to explain why it is banned. Scanning prose would make the guard fire
 * on its own documentation.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every `outline-ball` left without a coal band within reach. */
export function bareBallRings(code: string): string[] {
  const bare: string[] = [];
  const ring = /(?:focus-visible|focus-within):outline-ball/g;
  let match: RegExpExecArray | null;
  while ((match = ring.exec(code)) !== null) {
    const from = Math.max(0, match.index - COMPANION_WINDOW);
    const window = code.slice(from, match.index + COMPANION_WINDOW);
    if (!window.includes(COAL)) bare.push(match[0]);
  }
  return bare;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  code: stripComments(readFileSync(path, "utf8")),
}));

describe("the focus indicator is the shared one", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("leaves no control wearing a bare yellow ring", () => {
    const offenders = FILES.filter(({ code }) => bareBallRings(code).length > 0).map(
      ({ path }) => path,
    );

    expect(offenders).toEqual([]);
  });

  it("still catches a bare ring — the assertion above is not vacuous", () => {
    // The two real call sites pass because of their coal band. Drop the band
    // and the guard has to fire, or it is only testing that the codebase is
    // currently quiet.
    expect(bareBallRings('className="focus-visible:outline-ball"')).toHaveLength(1);
    expect(
      bareBallRings(
        'className="focus-visible:outline-ball focus-visible:shadow-[0_0_0_4px_#131316]"',
      ),
    ).toHaveLength(0);
  });

  it("keeps `ball` available as a colour — only its bare use as a focus ring is banned", () => {
    // The yellow is still the brand's attention accent; it was never the
    // problem anywhere except as a 1.41:1 outline on white.
    const usesBall = FILES.some(({ code }) => /\bbg-ball\b|\btext-ball-ink\b/.test(code));
    expect(usesBall).toBe(true);
  });
});
