/**
 * Graduate goes where DESIGN.md sends it, and nowhere else.
 *
 * The foundation loaded the three families and made Barlow the default `sans`,
 * so every string in the product changed face on its own. `display` did not:
 * it is a utility that has to be ASKED for, and for two commits nobody asked —
 * `PageHeader`'s `<h1>` was `text-xl font-extrabold`, which resolves to Barlow,
 * so the product contradicted its own design system in the element that names
 * each screen. A component test can lock the one component it renders; only a
 * scan can keep the next heading from being written in Barlow by default.
 *
 * ## The rule this encodes
 *
 * DESIGN.md's "regla de Graduate": display, uppercase, **never below 15px** and
 * **never inside a paragraph**. It is a collegiate face with a single 400 cut,
 * no lowercase design and almost no vertical range, so below the floor it stops
 * being words and becomes texture. The three steps that may spend it are
 * `headline` (26px page title), `title` (20px card/dialog title) and `stat`
 * (32px figure) — and the two the shared primitives own, `PageHeader` and
 * `StatCard`, have their own tests beside them.
 *
 * What is left for a scan is the part that lives in screen files:
 *
 *  · Every heading already sitting at the TITLE step takes the display face.
 *    Every `<h1>`–`<h3>` written at `text-lg` in this product is a card title
 *    or a dialog title — that is what the step means — so the rule needs no
 *    allowlist and no judgement call at the call site.
 *  · The face never lands under the floor, and never on a paragraph, a table
 *    cell or a form label. Those are `body`/`dense`, and "si dudás, es Barlow".
 *  · Where it does land, the tracking is a DECLARED step. Graduate is wide and
 *    flat, so it has to contradict the negative tracking every size step above
 *    15px carries — `tracking-flat` and friends exist for exactly that, and a
 *    hand-written `tracking-[0.013em]` beside a display heading is the drift
 *    `arbitrary-style-values.test.ts` was written against.
 *
 * The landing is out of scope on purpose: it has its own type scale and its own
 * sheet (`app/landing/landing.css`), and it is worked on separately.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");

/** Size steps below Graduate's 15px floor. `text-base` IS the floor and passes. */
const BELOW_FLOOR = /\btext-(?:2xs|xs|sm)\b/;

/** The declared tracking steps (`tailwind.config.ts`), plus Tailwind's own. */
const DECLARED_TRACKING =
  /\btracking-(?:dense|flat|caps|caps-wide|tighter|tight|normal|wide|wider|widest)\b/;

/** Elements that carry `body` or `dense` text, whatever else is around them. */
const PROSE_ELEMENTS = /^(?:p|label|td|th|TableCell|TableHeaderCell)$/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "landing") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * The prose around these rules names the banned classes to explain why they are
 * banned — including this file's own neighbours. Scanning comments would make
 * every guard fire on its own documentation.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Every JSX opening tag with its attributes.
 *
 * The braced part allows ONE level of nesting, because the attribute this guard
 * has to see through is a template literal with an interpolation in it —
 * ``id={`edit-member-title-${account.id}`}`` — and a single-level `\{[^{}]*\}`
 * stops at the `${`, drops the tag, and quietly makes the scan miss the one
 * dialog title in the product.
 */
function openingTags(code: string): { tag: string; text: string }[] {
  const found: { tag: string; text: string }[] = [];
  const pattern = /<([A-Za-z][A-Za-z0-9]*)((?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    found.push({ tag: match[1], text: match[0] });
  }
  return found;
}

/** Headings at the 20px `title` step that were left in the interface face. */
export function titlesMissingTheDisplayFace(code: string): string[] {
  return openingTags(code)
    .filter(({ tag, text }) => /^h[1-3]$/.test(tag) && /\btext-lg\b/.test(text))
    .filter(({ text }) => !/\bfont-display\b/.test(text))
    .map(({ text }) => text.replace(/\s+/g, " "));
}

/** Every place the display face lands somewhere the rule forbids. */
export function displayFaceViolations(code: string): string[] {
  const offences: string[] = [];
  for (const { tag, text } of openingTags(code)) {
    if (!/\bfont-display\b/.test(text)) continue;
    const where = text.replace(/\s+/g, " ");
    if (BELOW_FLOOR.test(text)) offences.push(`below the 15px floor: ${where}`);
    if (PROSE_ELEMENTS.test(tag)) offences.push(`on a <${tag}>: ${where}`);
    if (!DECLARED_TRACKING.test(text)) offences.push(`no declared tracking step: ${where}`);
  }
  return offences;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  code: stripComments(readFileSync(path, "utf8")),
}));

describe("Graduate reaches the titles", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("leaves no heading at the title step written in the interface face", () => {
    const offenders = FILES.flatMap(({ path, code }) =>
      titlesMissingTheDisplayFace(code).map((tag) => `${path} — ${tag}`),
    );

    expect(offenders).toEqual([]);
  });

  it("still catches a title left in Barlow — the assertion above is not vacuous", () => {
    expect(titlesMissingTheDisplayFace('<h2 className="text-lg font-bold">x</h2>')).toHaveLength(1);
    expect(
      titlesMissingTheDisplayFace('<h2 className="font-display text-lg tracking-flat">x</h2>'),
    ).toHaveLength(0);
  });
});

describe("Graduate stays inside its own rule", () => {
  it("never lands below the floor, in prose, or on a loose tracking value", () => {
    const offenders = FILES.flatMap(({ path, code }) =>
      displayFaceViolations(code).map((offence) => `${path} — ${offence}`),
    );

    expect(offenders).toEqual([]);
  });

  it("still catches each of the three, so the assertion above is not vacuous", () => {
    expect(
      displayFaceViolations('<span className="font-display text-sm tracking-flat" />'),
    ).toEqual([expect.stringContaining("below the 15px floor")]);

    expect(displayFaceViolations('<p className="font-display text-lg tracking-flat" />')).toEqual([
      expect.stringContaining("on a <p>"),
    ]);

    expect(
      displayFaceViolations('<h1 className="font-display text-xl tracking-[0.013em]" />'),
    ).toEqual([expect.stringContaining("no declared tracking step")]);
  });
});
