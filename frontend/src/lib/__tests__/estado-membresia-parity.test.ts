/**
 * `BackendEstadoMembresia` (`../membership-status.ts`) must know every
 * member the backend's `EstadoMembresia` enum defines
 * (`backend/app/dominio/enums.py`).
 *
 * Issue #935: `SUSPENDIDA` existed on the backend since issue #400 — the
 * union stayed at three values, and `MEMBERSHIP_STATUS_BY_ESTADO` (a
 * `Record` over it) is exhaustive over the union, not the enum, so
 * TypeScript never flagged the drift. Same mode of failure
 * `tipo-notificacion-parity.test.ts` (issue #768) exists to catch, applied
 * to this second file that guard does not cover. Parses source text on
 * both sides instead of importing the Python enum or hand-copying the
 * list, for the same reason that file does.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const BACKEND_ENUMS = join(REPO_ROOT, "backend", "app", "dominio", "enums.py");
const FRONTEND_MEMBERSHIP_STATUS = join(__dirname, "..", "membership-status.ts");

/** The `EstadoMembresia(str, enum.Enum)` class body, up to the next `class`. */
function backendEstadoMembresiaMembers(): string[] {
  const source = readFileSync(BACKEND_ENUMS, "utf-8");
  const classMatch = source.match(/class EstadoMembresia\(str, enum\.Enum\):([\s\S]*?)(?:\nclass \w|$)/);
  if (!classMatch) return [];
  const body = classMatch[1];
  return [...body.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*=\s*"([A-Z][A-Z0-9_]*)"/gm)].map((m) => m[2]);
}

/** The literal members of `export type BackendEstadoMembresia = ...;` in membership-status.ts. */
function frontendBackendEstadoMembresiaMembers(): string[] {
  const source = readFileSync(FRONTEND_MEMBERSHIP_STATUS, "utf-8");
  const typeMatch = source.match(/export type BackendEstadoMembresia =([\s\S]*?);/);
  if (!typeMatch) return [];
  return [...typeMatch[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

describe("BackendEstadoMembresia — frontend union stays in sync with the backend enum", () => {
  const backend = backendEstadoMembresiaMembers();
  const frontend = frontendBackendEstadoMembresiaMembers();

  it("the parser actually finds the backend enum's members", () => {
    expect(backend.length).toBeGreaterThanOrEqual(4);
  });

  it("the parser actually finds the frontend union's members", () => {
    expect(frontend.length).toBeGreaterThanOrEqual(4);
  });

  it("every backend EstadoMembresia value has a matching frontend literal", () => {
    const missing = backend.filter((value) => !frontend.includes(value));
    expect(missing).toEqual([]);
  });

  it("the frontend union names no estado the backend does not emit", () => {
    const extra = frontend.filter((value) => !backend.includes(value));
    expect(extra).toEqual([]);
  });
});
