/**
 * `BackendTipoPago` (`../payments-adapter.ts`) must know every member the
 * backend's `TipoPago` enum defines (`backend/app/dominio/enums.py`).
 *
 * Issue #935: `REGULARIZACION` existed on the backend since issue #284 —
 * the union stayed at two values, and `PAYMENT_METHOD_BY_TIPO_PAGO` (a
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

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const BACKEND_ENUMS = join(REPO_ROOT, "backend", "app", "dominio", "enums.py");
const FRONTEND_PAYMENTS_ADAPTER = join(__dirname, "..", "payments-adapter.ts");

/** The `TipoPago(str, enum.Enum)` class body, up to the next `class`. */
function backendTipoPagoMembers(): string[] {
  const source = readFileSync(BACKEND_ENUMS, "utf-8");
  const classMatch = source.match(/class TipoPago\(str, enum\.Enum\):([\s\S]*?)(?:\nclass \w|$)/);
  if (!classMatch) return [];
  const body = classMatch[1];
  return [...body.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*=\s*"([A-Z][A-Z0-9_]*)"/gm)].map((m) => m[2]);
}

/** The literal members of `export type BackendTipoPago = ...;` in payments-adapter.ts. */
function frontendBackendTipoPagoMembers(): string[] {
  const source = readFileSync(FRONTEND_PAYMENTS_ADAPTER, "utf-8");
  const typeMatch = source.match(/export type BackendTipoPago =([\s\S]*?);/);
  if (!typeMatch) return [];
  return [...typeMatch[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

describe("BackendTipoPago — frontend union stays in sync with the backend enum", () => {
  const backend = backendTipoPagoMembers();
  const frontend = frontendBackendTipoPagoMembers();

  it("the parser actually finds the backend enum's members", () => {
    expect(backend.length).toBeGreaterThanOrEqual(3);
  });

  it("the parser actually finds the frontend union's members", () => {
    expect(frontend.length).toBeGreaterThanOrEqual(3);
  });

  it("every backend TipoPago value has a matching frontend literal", () => {
    const missing = backend.filter((value) => !frontend.includes(value));
    expect(missing).toEqual([]);
  });

  it("the frontend union names no tipo the backend does not emit", () => {
    const extra = frontend.filter((value) => !backend.includes(value));
    expect(extra).toEqual([]);
  });
});
