/**
 * `TipoNotificacion` (this file's `domain.ts`) must know every member the
 * backend's `TipoNotificacion` enum defines
 * (`backend/app/dominio/enums.py`).
 *
 * Auditoría 2026-08-10 / fix 19: `VINCULACION_REPRESENTANTE` existed on the
 * backend — emitted from `persona_servicio.py`, migrated into the Postgres
 * enum — for a whole feature (INS-2, docs/decisiones-de-negocio-2026-08-11.md
 * §1) before the frontend's union ever heard of it. `NotificationBell.tsx`'s
 * `Record<TipoNotificacion, string>` DOES catch a missing label once a type
 * is IN the union — TypeScript refuses to compile a partial `Record`. What it
 * cannot catch is the union itself falling behind the backend, because
 * nothing type-checks a TS string-literal union against a Python enum. This
 * guard is that missing link: it reads both sources as text and diffs the
 * member sets, so a backend value added without a matching frontend literal
 * fails here instead of shipping as a blank, unlabeled notification.
 *
 * Deliberately parses source text instead of importing the Python enum
 * (frontend tests don't run a Python process) or hand-copying the list here
 * (a hand-copied list is exactly the kind of thing that goes stale — see the
 * bug this guard exists to catch). A one-line regex per side keeps the parser
 * honest: if either source's shape changes enough to break the regex, the
 * "finds something" tests below fail loudly instead of the diff silently
 * comparing empty sets.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const BACKEND_ENUMS = join(REPO_ROOT, "backend", "app", "dominio", "enums.py");
const FRONTEND_DOMAIN_TYPES = join(__dirname, "..", "domain.ts");

/** The `TipoNotificacion(str, enum.Enum)` class body, up to the next `class`. */
function backendTipoNotificacionMembers(): string[] {
  const source = readFileSync(BACKEND_ENUMS, "utf-8");
  const classMatch = source.match(/class TipoNotificacion\(str, enum\.Enum\):([\s\S]*?)(?:\nclass \w|$)/);
  if (!classMatch) return [];
  const body = classMatch[1];
  return [...body.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*=\s*"([A-Z][A-Z0-9_]*)"/gm)].map(
    (m) => m[2],
  );
}

/** The literal members of `export type TipoNotificacion = ...;` in domain.ts. */
function frontendTipoNotificacionMembers(): string[] {
  const source = readFileSync(FRONTEND_DOMAIN_TYPES, "utf-8");
  const typeMatch = source.match(/export type TipoNotificacion =([\s\S]*?);/);
  if (!typeMatch) return [];
  return [...typeMatch[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

describe("TipoNotificacion — frontend union stays in sync with the backend enum", () => {
  const backend = backendTipoNotificacionMembers();
  const frontend = frontendTipoNotificacionMembers();

  it("the parser actually finds the backend enum's members", () => {
    // Guard of the guard: a broken regex would make the real assertion below
    // vacuously true (both sides empty).
    expect(backend.length).toBeGreaterThanOrEqual(5);
  });

  it("the parser actually finds the frontend union's members", () => {
    expect(frontend.length).toBeGreaterThanOrEqual(5);
  });

  it("every backend TipoNotificacion value has a matching frontend literal", () => {
    const missing = backend.filter((value) => !frontend.includes(value));
    expect(missing).toEqual([]);
  });

  it("the frontend union names no type the backend does not emit", () => {
    const extra = frontend.filter((value) => !backend.includes(value));
    expect(extra).toEqual([]);
  });
});
