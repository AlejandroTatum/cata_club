/**
 * Shared source-text parsers for the backend/frontend enum-parity guards —
 * `types/__tests__/enum-parity.test.ts` and its per-enum siblings
 * (`tipo-notificacion-parity.test.ts`, `estado-membresia-parity.test.ts`,
 * `tipo-pago-parity.test.ts`). Deliberately parses `backend/app/dominio/
 * enums.py` and the frontend union-type declarations as TEXT instead of
 * importing the Python enum (frontend tests don't run a Python process) or
 * hand-copying either list here (a hand-copied list is exactly the kind of
 * thing that goes stale — see issue #935, which is why these guards exist).
 *
 * Not a `.test.ts` file itself: Vitest only collects `*.test.{ts,tsx}`, so
 * this stays out of the run while still being the ONE place the parsing
 * regexes live — five near-identical copies of the same two functions is
 * what tripped Sonar's duplication gate before this file existed.
 */

/**
 * Every `class Name(str, enum.Enum):` name declared in the backend module.
 * Used to prove a table classifying every enum is actually exhaustive.
 */
export function backendEnumClassNames(source: string): string[] {
  return [...source.matchAll(/^class (\w+)\(str, enum\.Enum\):/gm)].map((m) => m[1]);
}

/** The member VALUES of one `class Name(str, enum.Enum): ...` body. */
export function backendEnumMembers(source: string, className: string): string[] {
  const classMatch = source.match(
    new RegExp(`class ${className}\\(str, enum\\.Enum\\):([\\s\\S]*?)(?:\\nclass \\w|$)`),
  );
  if (!classMatch) return [];
  const body = classMatch[1];
  // `[^"]+` (not `[A-Z0-9_]+`) on purpose: NivelTecnicoAlumno's values
  // ("NIVEL 1" … "NIVEL 10") contain a space.
  return [...body.matchAll(/^\s{4}[A-Z][A-Z0-9_]*\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** The literal members of an `export type Name = "A" | "B" | ...;` union. */
export function frontendUnionMembers(source: string, typeName: string): string[] {
  const typeMatch = source.match(new RegExp(`export type ${typeName} =([\\s\\S]*?);`));
  if (!typeMatch) return [];
  // Restricted to `[A-Z][A-Z0-9_]*` (not `[^"]+`) on purpose: the union
  // block can contain doc comments with their own quoted strings (e.g.
  // TipoNotificacion's), and those are never a member of the union itself.
  return [...typeMatch[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}
