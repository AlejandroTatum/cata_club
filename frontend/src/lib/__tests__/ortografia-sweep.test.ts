/**
 * App-wide copy-ortografía sweep — issue #865.
 *
 * Sibling of `usted-register.test.ts`: same `sourceFiles()` walker and the
 * same `readableText()` extraction (quoted literals and JSX text nodes,
 * comments filtered out) — only the word list changes
 * (`ortografia-lock.ts`'s `GRAFIAS_PROHIBIDAS` instead of the voseo/tuteo
 * one). Reusing `readableText()` rather than a bare per-line word match is
 * what keeps this sweep safe against identifiers that happen to spell a
 * prohibited word — `groups/page.tsx` keeps a local `inscriptos` variable
 * (issue #865 explicitly preserves identifiers) that a naive whole-line
 * match would flag on every read of `const inscriptos = ...`.
 *
 * The one shape this therefore does NOT catch is a JSX text node split
 * across a `{expression}`, like `{inscriptos} inscrito{inscriptos === 1 ?
 * "" : "s"}` in `/groups` — neither of `readableText()`'s patterns matches
 * it (the bare-line heuristic requires no `{`/`}` anywhere in the line; the
 * `>text<` pattern requires no braces between the tags either). That one
 * rendering is guarded instead by `GroupsPage.test.tsx`, which renders the
 * component and asserts the exact interpolated text — the right tool for a
 * shape a static sweep cannot see without also matching identifiers.
 *
 * `app/landing` is excluded on purpose: landing copy is out of this issue's
 * inventory (parallel PRs #982/#871/#872 own it), and a sweep that could
 * fail on copy this PR has no authority to fix would make the gate
 * unmaintainable for whoever merges next.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles, readableText } from "./source-scan";
import { buildGrafiaProhibidaRegex } from "./ortografia-lock";

const SRC = join(__dirname, "..", "..");
const LANDING = join(SRC, "app", "landing");

function findOffenders(): string[] {
  return sourceFiles(SRC, { exclude: [LANDING] }).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return readableText(text)
      .filter((literal) => buildGrafiaProhibidaRegex().test(literal))
      .map((literal) => `${path.slice(SRC.length + 1)}: ${literal.trim()}`);
  });
}

describe("ortografía y registro — barrido de grafías prohibidas (issue #865)", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk makes the assertion below vacuous.
    expect(sourceFiles(SRC, { exclude: [LANDING] }).length).toBeGreaterThan(50);
  });

  it("recognises the prohibited spellings this audit named", () => {
    // A fresh regex per assertion — same reason `findOffenders()` builds one
    // per line: a global regex's `.test()` advances its own `lastIndex`.
    expect(buildGrafiaProhibidaRegex().test("2 inscriptos")).toBe(true);
    expect(buildGrafiaProhibidaRegex().test("Todavía no hay alumnos inscriptos")).toBe(true);
    expect(buildGrafiaProhibidaRegex().test("inscrpicion")).toBe(true);
    // The corrected forms must NOT trip the lock.
    expect(buildGrafiaProhibidaRegex().test("2 inscritos")).toBe(false);
    expect(buildGrafiaProhibidaRegex().test("inscripción")).toBe(false);
    // Identifiers that merely contain the word must NOT trip it either —
    // this is what makes the sweep safe against `countInscriptos`.
    expect(buildGrafiaProhibidaRegex().test("countInscriptos(card.rows)")).toBe(false);
  });

  it("leaves no prohibited spelling in shipped copy anywhere in the app", () => {
    expect(findOffenders()).toEqual([]);
  });
});
