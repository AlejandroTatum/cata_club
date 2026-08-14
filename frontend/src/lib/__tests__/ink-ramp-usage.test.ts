/**
 * The ink ramp is four tokens, not an opacity slider.
 *
 * `DESIGN.md` gives muted text exactly two names — `ink-3` for paper and
 * `ink-3-strong` for the canvas and for a sunken well — and the reason it
 * gives two is that the same grey does not survive all three surfaces. What
 * this product actually did in several screens was ignore both and dial the
 * body ink down with an alpha: `text-cata-text/45`, `text-cata-text/40`,
 * `text-cata-text/50`. That reads as the same idea and is not, because an
 * alpha has no measurement attached to it.
 *
 * ## The numbers, and where the line is
 *
 * `cata-text` is `#1F2937` (`tailwind.config.ts`), the legacy body ink.
 * Composited on the three surfaces the product has, its steps measure:
 *
 * | Step  | on `paper` | on `canvas` |
 * |-------|-----------|-------------|
 * | `/30` | 1.85:1    | 1.76:1      |
 * | `/35` | 2.09:1    | 1.99:1      |
 * | `/40` | 2.36:1    | 2.25:1      |
 * | `/45` | 2.67:1    | 2.55:1      |
 * | `/50` | 3.05:1    | 2.88:1      |
 * | `/65` | 4.72:1    | 4.34:1      |
 *
 * Everything at `/50` and below fails AA on every surface the product owns —
 * four of them fail the 3:1 floor that even a non-text graphic has to clear.
 * That is what this guard bans, and the line is drawn where the measurement
 * draws it, not at a round number.
 *
 * `/65` is left alone on purpose. It clears AA on paper (4.72:1), so it is a
 * legibility question on the canvas rather than a defect, and the screens that
 * still carry it are not the ones this batch opened. Banning it here would be
 * a rule that fires on files nobody is allowed to touch, which is how a lock
 * gets an allowlist and stops meaning anything.
 *
 * ## Why a scan and not a token test
 *
 * `color-contrast.test.ts` proves the tokens in the ramp are safe. It cannot
 * see a screen that declined to use them: an alpha on a different token is a
 * new colour that never passed through the ramp at all. Only a grep catches
 * that, and this failure spread to six files without one.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

/**
 * The alpha steps that measure under 3.1:1 on every product surface.
 *
 * Written as an explicit list rather than a numeric range so that adding a
 * step to it is a decision with a number behind it, the same way the table in
 * the doc comment above is.
 */
const SUB_AA_STEPS = [30, 35, 40, 45, 50];

const RETIRED_INK = new RegExp(`\\btext-cata-text/(?:${SUB_AA_STEPS.join("|")})\\b`, "g");

/**
 * The landing has its own sheet and its own type scale, and it is worked on
 * separately — the same carve-out `display-face-usage.test.ts` makes.
 */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "landing" || entry === "mocks") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.(?:tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Comments are not shipped, and this rule has to be explainable.
 *
 * Two files carry the retired step inside prose that says why it was retired —
 * including the table in this file's own header. Scanning comments would make
 * the guard fire on its own documentation, which is how a rule ends up being
 * softened for the wrong reason.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Every place a screen dialled the body ink down instead of naming a step. */
export function opacityDerivedInk(code: string): string[] {
  return Array.from(stripComments(code).matchAll(RETIRED_INK), (match) => match[0]);
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  code: readFileSync(path, "utf8"),
}));

describe("muted text names a step of the ink ramp", () => {
  it("finds source files to check at all", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("recognises the retired steps and leaves the measured one alone", () => {
    expect(opacityDerivedInk('className="text-cata-text/45"')).toEqual(["text-cata-text/45"]);
    expect(opacityDerivedInk('className="text-cata-text/40 mt-1"')).toEqual(["text-cata-text/40"]);
    expect(opacityDerivedInk('className="text-cata-text/65"')).toEqual([]);
  });

  it("leaves no sub-AA ink anywhere in the product", () => {
    const offences = FILES.flatMap(({ path, code }) =>
      opacityDerivedInk(code).map((hit) => `${path}: ${hit}`),
    );

    expect(offences).toEqual([]);
  });
});
