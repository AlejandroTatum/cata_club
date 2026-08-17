/**
 * The database's words stay in the database.
 *
 * The post-integration evaluation scored "coincidencia con el mundo real" DOWN
 * from 9 to 8, and named the cause: backend vocabulary leaking into the
 * interface. `/admin/crear-cuenta` told an administrator that a Jugador is
 * "estudiante adulto (18+) con rol ALUMNO" — `ALUMNO` is a row in a roles
 * table, not a thing anyone at the club says out loud, and it tells the admin
 * nothing about what the account will be able to DO.
 *
 * ## Why the rule is "constant inside a sentence", not "constant anywhere"
 *
 * These identifiers are legitimate everywhere else: `allowedRoles={["admin"]}`,
 * a comparison against an API payload, a doc comment explaining the mapping.
 * Banning the token outright would be a rule nobody could follow. What is never
 * defensible is a SENTENCE that contains one — prose is by definition
 * user-facing, so a Spanish sentence carrying `ALUMNO` is a sentence somebody
 * will read.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceFiles, readableText } from "./source-scan";

const SRC = join(__dirname, "..", "..");

/** Backend enums and role rows. Real values, spelled the way the API spells them. */
const BACKEND_TERMS = [
  "ALUMNO",
  "REPRESENTANTE",
  "ADMINISTRADOR",
  "ENTRENADOR",
  "PENDIENTE_VALIDACION",
  "EstadoMembresia",
  "EstadoPago",
  "tipoPago",
  "estadoPago",
  "personaId",
  "horarioId",
];

/**
 * Prose, as opposed to an identifier or a bare value: at least three Spanish
 * words in a row somewhere in the literal. `"Jugador (rol ALUMNO)"` qualifies
 * once the parenthetical is counted; `"ADMINISTRADOR"` alone does not.
 */
const LOOKS_LIKE_A_SENTENCE = /(?:\b[a-záéíóúñ]{2,}\b[\s(,.—-]+){2,}\b[a-záéíóúñ]{2,}/;

/**
 * `app/api/**` is the BFF — a server talking to our own client, not to a
 * person. Its 400s name the field that was malformed ("horarioId es
 * obligatorio"), which is the useful thing to say to the caller and is never
 * rendered as copy. Excluded on purpose, not by oversight.
 */
const BFF = join("app", "api");

/** A line of code, told apart from a line of prose by how it ends. */
const IS_A_STATEMENT = /[;,{}()]\s*$|=>|\s=\s/;

const OFFENDERS = sourceFiles(SRC, { exclude: [BFF] }).flatMap((path) => {
  const text = readFileSync(path, "utf8");
  return readableText(text)
    .filter((literal) => LOOKS_LIKE_A_SENTENCE.test(literal))
    .filter((literal) => BACKEND_TERMS.some((term) => literal.includes(term)))
    .map((literal) => `${path.slice(SRC.length + 1)}: ${literal.trim()}`);
});

/** Exported shape of the scanner, so the scanner itself is testable. */
function readableTextForTest(text: string): string[] {
  return readableText(text);
}

describe("no backend vocabulary inside user-facing prose", () => {
  it("finds source files to check at all", () => {
    // Guards the guard: a broken walk makes the assertion below vacuous.
    expect(sourceFiles(SRC, { exclude: [BFF] }).length).toBeGreaterThan(50);
  });

  it("recognises a sentence when it sees one", () => {
    expect(LOOKS_LIKE_A_SENTENCE.test('"Cuenta de estudiante adulto"')).toBe(true);
    expect(LOOKS_LIKE_A_SENTENCE.test('"ADMINISTRADOR"')).toBe(false);
    expect(LOOKS_LIKE_A_SENTENCE.test('"PENDIENTE_VALIDACION"')).toBe(false);
  });

  it("tells a line of code apart from a line of prose", () => {
    expect(IS_A_STATEMENT.test("  porPersona.set(alumno.personaId);")).toBe(true);
    expect(IS_A_STATEMENT.test("  const x = byId.get(item.personaId);")).toBe(true);
    expect(IS_A_STATEMENT.test("  Cuenta de estudiante adulto (18+) con rol ALUMNO.")).toBe(false);
  });

  it("reads JSX text, not only quoted literals", () => {
    // The leak that motivated this test was bare prose between two tags.
    const jsx = "<p>\n  Cuenta de estudiante adulto (18+) con rol ALUMNO.\n</p>";
    const found = readableTextForTest(jsx);
    expect(found.some((t) => t.includes("rol ALUMNO"))).toBe(true);
  });

  it("leaves none in the shipped copy", () => {
    expect(OFFENDERS).toEqual([]);
  });
});
