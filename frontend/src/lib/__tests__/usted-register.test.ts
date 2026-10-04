/**
 * App-wide «tú» register lock — issue #340 follow-up, flipped by QA4 S6.
 *
 * The product speaks «tú» ("Inscríbete", "tu cuenta"). This lock bans voseo
 * ("Revisá", "vos") and "usted" shapes ("usted", "Inscríbase") in every
 * shipped source string. Legal pages (terminos, privacidad) stay in "usted"
 * until the lawyer replies, so they are allowlisted below.
 *
 * ProfilePage.test.tsx only renders `/profile`, so it can only catch a
 * regression there; this is a static sweep instead of a render sweep on
 * purpose: rendering every screen would mean rebuilding every screen's
 * auth/data mocks just to read its copy. `readableText()` (shared with
 * ui-vocabulary.test.ts) pulls out what a reader could actually see — quoted
 * literals and JSX text nodes, comments filtered out.
 *
 * Deliberately NOT excluding `app/api/**`: a BFF route's fallback message is
 * a string the backend never wrote, and it reaches the screen verbatim on
 * failure.
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
 * consumer stays on quoted-literal/JSX-text extraction only. The same
 * reason makes this catch the error-message tables, which the original
 * issue #340 audit's list never saw: those messages are backtick strings,
 * invisible to a scanner that only reads double quotes.
 */
function templateLiterals(text: string): string[] {
  const lines = text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  return lines.flatMap((line) => line.match(/`[^`\n]{4,}`/g) ?? []);
}

/** Legal pages stay in "usted" until the lawyer replies (QA4 S6). */
const USTED_ALLOWLIST = ["app/terminos/", "app/privacidad/"];

function findOffenders(): string[] {
  return sourceFiles(SRC, { exclude: USTED_ALLOWLIST }).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    return [...readableText(text), ...templateLiterals(text)]
      .filter((literal) => {
        // The "use client"/"use server" directives are code, not copy.
        if (/^"use (client|server)"$/.test(literal.trim())) return false;
        const regex = buildUstedRegisterRegex();
        return regex.test(literal);
      })
      .map((literal) => `${path.slice(SRC.length + 1)}: ${literal.trim()}`);
  });
}

describe("tú register — app-wide copy sweep (issue #340 follow-up, QA4 S6)", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk makes the assertion below vacuous.
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });

  it("allowlists the legal pages and nothing else", () => {
    const scanned = sourceFiles(SRC, { exclude: USTED_ALLOWLIST });
    expect(scanned.some((p) => p.includes("app/terminos/"))).toBe(false);
    expect(scanned.some((p) => p.includes("app/privacidad/"))).toBe(false);
    expect(scanned.some((p) => p.includes("app/trainer/"))).toBe(true);
  });

  it("recognises the voseo and usted shapes", () => {
    // A fresh regex per assertion: `buildUstedRegisterRegex()` returns a
    // global-flagged instance whose `.test()` advances its own `lastIndex`.
    const banned = (text: string) => buildUstedRegisterRegex().test(text);
    // Voseo stays banned.
    expect(banned("Revisá el resumen")).toBe(true);
    expect(banned("Reducí el monto ingresado.")).toBe(true);
    expect(banned("vos podés")).toBe(true);
    // Usted is banned: pronoun and imperatives.
    expect(banned("Usted puede entrar")).toBe(true);
    expect(banned("ustedes")).toBe(true);
    expect(banned("Inscríbase aquí")).toBe(true);
    expect(banned("Ingrese su correo")).toBe(true);
    expect(banned("Inténtelo de nuevo")).toBe(true);
    expect(banned("Reduzca el monto ingresado.")).toBe(true);
    expect(banned("Comuníquese con el club")).toBe(true);
    // Tú forms pass.
    expect(banned("tu cuenta")).toBe(false);
    expect(banned("Inscríbete aquí")).toBe(false);
    expect(banned("Ingresa tu correo")).toBe(false);
    expect(banned("apenas te lo asignen, entras directo")).toBe(false);
    expect(banned("Estás preguntando muy seguido")).toBe(false);
    expect(banned("Inténtalo de nuevo")).toBe(false);
    expect(banned("Reduce el monto ingresado.")).toBe(false);
    // "su"/"sus" are ordinary possessives, not banned.
    expect(banned("sus datos y su equipo")).toBe(false);
    // "cree" (indicative "believes") and "estas" (demonstrative) are not flagged.
    expect(banned("el club cree que")).toBe(false);
    expect(banned("estas seis fichas")).toBe(false);
  });

  it("leaves no voseo or usted shape in shipped copy anywhere in the app", () => {
    expect(findOffenders()).toEqual([]);
  });
});
