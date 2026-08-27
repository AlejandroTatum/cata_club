/**
 * App-wide "usted" register lock — issue #340 follow-up.
 *
 * ProfilePage.test.tsx's "usted register" describe block only ever renders
 * `/profile`, so it can only ever catch a regression there. The audit that
 * fixed `/profile` found the SAME defect (voseo/tuteo copy) already shipped
 * in eight other files — ProtectedRoute's error banner, the age-up
 * confirmation dialog, the trainer's session card, the chatbot's placeholder
 * and its own error-message table, the dashboard's pending-payments banner,
 * and a BFF route's fallback error message — none of which `/profile`'s
 * render-and-assert test could ever see.
 *
 * This is a static sweep instead of a render sweep on purpose: rendering
 * every screen in the app would mean rebuilding every screen's auth/data
 * mocks just to read its copy, which is what the per-role ProfilePage check
 * already pays for ONE screen. `readableText()` (shared with
 * ui-vocabulary.test.ts, the sibling lock for backend-vocabulary leaks) pulls
 * out what a reader could actually see — quoted literals and JSX text nodes,
 * comments filtered out — without needing to render anything.
 *
 * Deliberately NOT excluding `app/api/**` the way ui-vocabulary.test.ts
 * does: a BFF route's fallback message is a string the backend never wrote,
 * and it reaches the screen verbatim on failure (issue #340's own list
 * included `app/api/membresias/pagos/persona/[id]/route.ts`'s "No se
 * pudieron cargar tus pagos."). Vocabulary-leak reasoning ("this is server-
 * to-server") doesn't apply to a register defect authored in this repo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFiles, readableText } from "./source-scan";
import { buildUstedRegisterRegex } from "./usted-register-lock";

const SRC = join(__dirname, "..", "..");

/**
 * Backtick template literals — extracted here, not folded into the shared
 * `readableText()`, because this lock's regex matches whole words only
 * (lookaround-bounded), so an interpolated `${SOME_CONSTANT}` riding along
 * as inert text is harmless. `readableText()`'s other consumer,
 * ui-vocabulary.test.ts, matches by substring, where the same interpolation
 * IS a false positive (`EDAD_MAXIMA_ALUMNO` contains "ALUMNO") — that
 * consumer stays on quoted-literal/JSX-text extraction only. Same reason
 * this catches ChatWidget's `mensajeDeError()` table, which the original
 * issue #340 audit's list never saw: those messages are backtick strings,
 * invisible to a scanner that only reads double quotes.
 */
function templateLiterals(text: string): string[] {
  const lines = text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  return lines.flatMap((line) => line.match(/`[^`\n]{4,}`/g) ?? []);
}

function findOffenders(): string[] {
  return sourceFiles(SRC).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [...readableText(text), ...templateLiterals(text)]
      .filter((literal) => {
        const regex = buildUstedRegisterRegex();
        return regex.test(literal);
      })
      .map((literal) => `${path.slice(SRC.length + 1)}: ${literal.trim()}`);
  });
}

describe("usted register — app-wide copy sweep (issue #340 follow-up)", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk makes the assertion below vacuous.
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });

  it("recognises the voseo/tuteo shapes this audit named", () => {
    // A fresh regex per assertion: `buildUstedRegisterRegex()` returns a
    // global-flagged instance, and `.test()` advances that instance's own
    // `lastIndex` on every call — reusing one across several input strings
    // makes later assertions search from the wrong offset and silently
    // under-match. `findOffenders()` below already builds fresh per literal;
    // this test has to follow the same rule to test the regex honestly.
    expect(buildUstedRegisterRegex().test("Revisá el resumen")).toBe(true);
    // The shape this sweep ran green past until the word list grew: the
    // #666 cap message shipped "Reducí el monto ingresado." in #679.
    expect(buildUstedRegisterRegex().test("Reducí el monto ingresado.")).toBe(true);
    expect(buildUstedRegisterRegex().test("Reduzca el monto ingresado.")).toBe(false);
    expect(buildUstedRegisterRegex().test("tu cuenta")).toBe(true);
    expect(buildUstedRegisterRegex().test("vos podés")).toBe(true);
    expect(buildUstedRegisterRegex().test("apenas te lo asignen, entras directo")).toBe(true);
    expect(buildUstedRegisterRegex().test("Estás preguntando muy seguido")).toBe(true);
    // "usted" forms of the exact same verbs must NOT trip the lock.
    expect(buildUstedRegisterRegex().test("su cuenta")).toBe(false);
    expect(buildUstedRegisterRegex().test("entra directamente")).toBe(false);
    expect(buildUstedRegisterRegex().test("está disponible")).toBe(false);
    // "estas"/"esta" (demonstratives, no accent) are not the verb "estás".
    expect(buildUstedRegisterRegex().test("estas seis fichas")).toBe(false);
  });

  it("leaves no voseo/tuteo shape in shipped copy anywhere in the app", () => {
    expect(findOffenders()).toEqual([]);
  });
});
