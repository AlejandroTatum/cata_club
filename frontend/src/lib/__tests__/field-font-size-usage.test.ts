/**
 * A field a finger can focus is never smaller than the size that stops the
 * browser zooming into it.
 *
 * ## The mechanism this guards
 *
 * Mobile Safari and Chrome zoom the whole page whenever a focused form control
 * computes to less than 16px, and they do not zoom back out. `ChatWidget.tsx`
 * wrote the diagnosis down for its own composer (issue #644) and fixed that one
 * field; issue #767 is the same defect on the Miembros dialogs, where the zoom
 * magnifies a 590px dialog past the screen edge and leaves the user dragging
 * one line at a time through its scrolling body.
 *
 * The other way to stop it is `maximum-scale=1` in the viewport meta, which
 * breaks pinch-zoom for everyone (WCAG 1.4.4). So the FIELD has to carry the
 * floor, and this file is what keeps it carried.
 *
 * ## Why one CSS rule and not a marker per field
 *
 * `touch-target-usage.test.ts` guards a PROMISE — "this surface is sized for a
 * thumb" is a decision a person makes per control, so it is marked per control.
 * This is the opposite kind of fact. Nobody decides that a phone zooms; the
 * platform does, for every text-entry control on the page, and the inventory
 * proves it: of the 74 such controls in `src/`, 40 declared a size and every
 * single one of them was under 16px. An opt-in marker over a defect that is
 * already 100% present is a migration, not a guard.
 *
 * So the floor lives in ONE rule in `globals.css`, under a touch predicate, and
 * this file asserts three things about it that no amount of prose can:
 *
 *   1. it names a real step on the type ramp, and that step is at or above the
 *      threshold — so re-tuning `tailwind.config.ts` downward fails HERE, at
 *      the place that depends on the number, rather than shipping;
 *   2. it reaches every element that can be typed into; and
 *   3. it OUT-SPECIFIES every font-size class actually written on such a
 *      control in `src/`. That third one is the load-bearing check: a floor a
 *      call site can silently outrank is not a floor, and `globals.css:320`
 *      already argues specificity in prose for the focus ring — this makes the
 *      same argument executable.
 *
 * ## What this deliberately does NOT check
 *
 * **That the rule fires on a real phone.** `@media (pointer: coarse)` is a
 * claim about the device, and jsdom has no device. `members-dialog-zoom.mobile.spec.ts`
 * measures the computed size in an emulated mobile Chromium; this file measures
 * that the declaration those pixels come from is still here and still wins.
 *
 * **A control with no font-size class at all.** 34 of the 74 inherit their size
 * from an ancestor, which no static read can resolve. They are covered by the
 * rule (that is the whole point of putting it on the element rather than on a
 * class) and they are invisible to the specificity comparison, which is fine:
 * inheriting costs zero specificity, so they cannot be the case that outranks
 * it.
 *
 * **Desktop density.** `text-sm` on a field is still `text-sm` on a mouse, and
 * that is not a bug being tolerated — it is the reason the floor is behind a
 * touch predicate instead of replacing the ramp.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import tailwindConfig from "../../../tailwind.config";

const SRC = join(__dirname, "..", "..");
const GLOBALS_CSS = join(SRC, "app", "globals.css");

/**
 * The size at which iOS and Android stop zooming a focused field. Not a design
 * number and not on any ramp — it is the platform's, which is why the rule
 * below has to reach for the first ramp step that clears it rather than
 * spelling it out.
 */
const ZOOM_FLOOR_PX = 16;

const THEME = tailwindConfig.theme as {
  extend: { fontSize: Record<string, [string, Record<string, string>] | string> };
};

/** `text-lg` → 20. The ramp is the source; this file never restates a size. */
function rampStepPx(step: string): number | null {
  const entry = THEME.extend.fontSize[step];
  if (entry === undefined) return null;
  return Number.parseFloat(Array.isArray(entry) ? entry[0] : entry);
}

/** Every `text-<step>` on the ramp, longest first so `2xs` never matches as `xs`. */
const RAMP_STEPS = Object.keys(THEME.extend.fontSize).sort((a, b) => b.length - a.length);
const SIZE_CLASS = new RegExp(`(?<![\\w:-])text-(${RAMP_STEPS.join("|")})(?![\\w-])`, "g");

/* -------------------------------------------------------------------------
 * Reading the floor out of `globals.css`
 * ---------------------------------------------------------------------- */

interface FloorRule {
  /** The `@media` condition it sits behind. */
  readonly condition: string;
  /** The selector the floor is written on. */
  readonly selector: string;
  /** The ramp step it applies. */
  readonly step: string;
}

/**
 * The one rule in `globals.css` that raises form controls behind a touch
 * predicate. Parsed rather than imported because `@apply` is Tailwind's, not
 * CSS's — the built stylesheet is a build artifact, and the declaration is the
 * thing under review.
 */
export function readFloorRule(css: string): FloorRule | null {
  // A `@media` whose condition mentions a coarse pointer or a phone width.
  const media = /@media\s*\(([^{]*?(?:pointer:\s*coarse|max-width)[^{]*?)\)\s*\{/g;
  for (const open of css.matchAll(media)) {
    const body = blockAfter(css, open.index + open[0].length - 1);
    if (body === null) continue;
    const rule = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of body.matchAll(rule)) {
      const selector = match[1].trim();
      // The element itself, not a class that merely contains its name:
      // `.input-field` reads as `input` to a naive word boundary, and a floor
      // written on that class is exactly the weaker fix this rejects.
      if (!/(?<![.\w-])(input|select|textarea)(?![\w-])/.test(selector)) continue;
      const applied = [...match[2].matchAll(SIZE_CLASS)].map((m) => m[1]);
      if (applied.length === 0) continue;
      return { condition: open[1].trim(), selector, step: applied[0] };
    }
  }
  return null;
}

/** The text inside the brace at `from`, brace-balanced. */
function blockAfter(text: string, from: number): string | null {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(from + 1, i);
    }
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Specificity
 * ---------------------------------------------------------------------- */

/**
 * `[b, c]` of CSS specificity — classes/attributes/pseudo-classes, then
 * elements. The `a` column is ids, and nothing here has one.
 *
 * `:is()` and `:not()` take the specificity of their most specific argument,
 * which is exactly why `input:not([type="checkbox"])` can outrank a `.text-sm`
 * that a call site writes. Only the grammar this stylesheet actually uses is
 * implemented; anything richer would be a parser nobody reads.
 */
export function specificity(selector: string): [number, number] {
  let rest = selector;
  let b = 0;
  let c = 0;

  // Functional pseudo-classes first: replace each with its strongest argument.
  const functional = /:(?:is|not|where|has)\(/;
  while (functional.test(rest)) {
    const at = rest.search(functional);
    const open = rest.indexOf("(", at);
    const args = blockLike(rest, open, "(", ")");
    if (args === null) break;
    const name = rest.slice(at + 1, open);
    const inner =
      name === "where"
        ? ([0, 0] as [number, number])
        : args
            .split(",")
            .map(specificity)
            .reduce((best, one) => (one[0] * 100 + one[1] > best[0] * 100 + best[1] ? one : best), [
              0, 0,
            ] as [number, number]);
    b += inner[0];
    c += inner[1];
    rest = rest.slice(0, at) + " " + rest.slice(open + args.length + 2);
  }

  b += [...rest.matchAll(/\.[\w-]+/g)].length;
  b += [...rest.matchAll(/\[[^\]]*\]/g)].length;
  b += [...rest.matchAll(/:[\w-]+/g)].length;
  c += [...rest.matchAll(/(?:^|[\s>+~,])\s*([a-zA-Z][\w-]*)/g)].length;
  return [b, c];
}

function blockLike(text: string, at: number, open: string, close: string): string | null {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(at + 1, i);
    }
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Reading the call sites
 * ---------------------------------------------------------------------- */

/** Types that cannot be typed into, so they never trigger the zoom. */
const NON_TEXT_TYPE =
  /type=\{?["'](checkbox|radio|file|hidden|range|color|submit|button|image|reset)["']\}?/;

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

/**
 * The attributes of one JSX opening tag: everything up to the `>` that is not
 * inside braces, a string, or a comment.
 *
 * All three exclusions were paid for. A naive `[^>]*` ends at the arrow of
 * every `onChange={(e) => …}`, which is 34 of the 74 controls here. And the
 * comment skip is not tidiness: `MedicalRecordEditor.tsx:537` explains its
 * `maxLength` in a `//` comment BETWEEN two attributes, and that comment says
 * "issue #667's" — one apostrophe, which without this opens a string that never
 * closes, runs the scan through the next four controls and swallows their
 * classes into this one. The scan has to survive its own subject.
 */
export function openingTag(code: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const eol = code.indexOf("\n", i);
      if (eol === -1) break;
      i = eol;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return code.slice(from, i);
  }
  return code.slice(from);
}

interface Control {
  readonly where: string;
  readonly attrs: string;
}

/** Every text-entry control written in `src/`. */
export function textEntryControls(code: string, path = ""): Control[] {
  const found: Control[] = [];
  for (const match of code.matchAll(/<(input|select|textarea)(?=[\s/>])/g)) {
    const attrs = openingTag(code, match.index + match[0].length);
    if (NON_TEXT_TYPE.test(attrs)) continue;
    const line = code.slice(0, match.index).split("\n").length;
    found.push({ where: `${path}:${line}`, attrs });
  }
  return found;
}

const CONTROLS = sourceFiles(SRC).flatMap((path) =>
  textEntryControls(readFileSync(path, "utf8"), path.slice(SRC.length + 1).replace(/\\/g, "/")),
);

/**
 * How hard a call site pushes on font-size, in specificity terms: one class per
 * `text-*` step plus one for `.input-field`, which carries a size of its own.
 * A control that writes nothing scores 0 and inherits.
 */
function callSiteWeight(attrs: string): number {
  return (
    [...attrs.matchAll(SIZE_CLASS)].length + (/(?<![\w-])input-field(?![\w-])/.test(attrs) ? 1 : 0)
  );
}

const CSS = readFileSync(GLOBALS_CSS, "utf8");
const FLOOR = readFloorRule(CSS);

describe("a field a finger can focus clears the browser's zoom threshold", () => {
  it("finds the controls to check at all", () => {
    // Guards the guard: a scan that matches nothing makes everything below vacuous.
    expect(CONTROLS.length).toBeGreaterThan(50);
  });

  it("declares the floor in one place, behind a touch predicate", () => {
    expect(FLOOR).not.toBeNull();
    expect(FLOOR?.condition).toMatch(/pointer:\s*coarse/);
  });

  it("names a ramp step that actually clears 16px", () => {
    // `text-base` is 15px on this ramp and would LOOK like a fix. The number
    // is read from `tailwind.config.ts`, so shrinking the step fails here.
    const px = rampStepPx(FLOOR?.step ?? "");
    expect(px).not.toBeNull();
    expect(px).toBeGreaterThanOrEqual(ZOOM_FLOOR_PX);
  });

  it("reaches every element that can be typed into", () => {
    for (const element of ["input", "select", "textarea"]) {
      expect(`${element}: ${new RegExp(`\\b${element}\\b`).test(FLOOR?.selector ?? "")}`).toBe(
        `${element}: true`,
      );
    }
  });

  it("out-specifies every font-size class written on a control", () => {
    // The load-bearing one. `.input-field text-xs` on the Beneficio select is
    // two classes deep — a floor written as a bare `input` (0,0,1) would lose
    // to it silently, and the field would keep zooming while this file passed.
    const floor = specificity(FLOOR?.selector ?? "");
    const heaviest = CONTROLS.reduce(
      (worst, control) => {
        const weight = callSiteWeight(control.attrs);
        return weight > worst.weight ? { weight, where: control.where } : worst;
      },
      { weight: 0, where: "—" },
    );

    expect(`${heaviest.where} at ${heaviest.weight} classes vs floor ${floor[0]}`).toBe(
      `${heaviest.where} at ${heaviest.weight} classes vs floor ${floor[0]}`,
    );
    expect(floor[0]).toBeGreaterThan(heaviest.weight);
  });

  it("leaves no control carrying an inline font-size", () => {
    // An inline style beats every selector there is, so it is the one call-site
    // shape the floor cannot outrank. None exist; this keeps it that way.
    const offenders = CONTROLS.filter(({ attrs }) => /style=\{[^}]*fontSize/.test(attrs)).map(
      ({ where }) => where,
    );

    expect(offenders).toEqual([]);
  });

  it("still catches a weakened floor — the assertions above are not vacuous", () => {
    expect(readFloorRule("@media (pointer: coarse) { input, select, textarea { @apply text-lg; } }"))
      .toEqual({ condition: "pointer: coarse", selector: "input, select, textarea", step: "lg" });
    // A floor on a class instead of the element reaches no control that does
    // not opt in, which is how 34 of the 74 would silently fall out.
    expect(readFloorRule("@media (pointer: coarse) { .input-field { @apply text-lg; } }")).toBeNull();
    // No touch predicate at all is not a floor, it is a redesign.
    expect(readFloorRule("input, select, textarea { @apply text-lg; }")).toBeNull();

    // And the specificity arithmetic the floor depends on.
    expect(specificity("input")).toEqual([0, 1]);
    expect(specificity(".text-sm")).toEqual([1, 0]);
    expect(specificity('input:not([type="checkbox"])')).toEqual([1, 1]);
    expect(specificity(":is(input, select, textarea)")).toEqual([0, 1]);
    expect(specificity(':is(input, select, textarea):not([type="a"]):not([type="b"])')).toEqual([
      2, 1,
    ]);
    expect(specificity(":where(input)")).toEqual([0, 0]);
  });

  it("reads a JSX tag past the arrow of its own handler", () => {
    // 34 of the 74 controls in `src/` carry an `onChange={(e) => …}`, and a
    // scan that stops at that `>` reads an empty attribute list and reports
    // every one of them as clean.
    const code = '<input onChange={(e) => go(e)} className="text-xs" />';

    expect(textEntryControls(code)[0].attrs).toContain("text-xs");
    expect(textEntryControls('<input type="checkbox" className="text-xs" />')).toEqual([]);

    // …and past the apostrophe in a comment between two attributes, which is
    // the real shape at `MedicalRecordEditor.tsx:537`.
    const commented = '<input\n  // issue #667\'s cap\n  maxLength={150}\n/>\n<input className="text-sm" />';
    expect(textEntryControls(commented)).toHaveLength(2);
    expect(textEntryControls(commented)[0].attrs).not.toContain("text-sm");
  });
});
