/**
 * Unit tests for src/lib/membership-status.ts.
 *
 * Issue #935: `BackendEstadoMembresia` (and the `MEMBERSHIP_STATUS_BY_ESTADO`
 * map built from it) did not know `SUSPENDIDA`, even though the backend has
 * emitted it since issue #400. A `SUSPENDIDA` membresía on a payment being
 * validated indexed the map to `undefined` instead of a real status.
 */
import { describe, it, expect } from "vitest";
import { MEMBERSHIP_STATUS_BY_ESTADO, readsAsVencida, type BackendEstadoMembresia } from "../membership-status";

describe("MEMBERSHIP_STATUS_BY_ESTADO", () => {
  it("maps SUSPENDIDA to its own status, not undefined", () => {
    expect(MEMBERSHIP_STATUS_BY_ESTADO.SUSPENDIDA).toBe("suspendida");
  });

  it("does not confuse SUSPENDIDA with VENCIDA or INACTIVA", () => {
    expect(MEMBERSHIP_STATUS_BY_ESTADO.SUSPENDIDA).not.toBe(MEMBERSHIP_STATUS_BY_ESTADO.VENCIDA);
    expect(MEMBERSHIP_STATUS_BY_ESTADO.SUSPENDIDA).not.toBe(MEMBERSHIP_STATUS_BY_ESTADO.INACTIVA);
  });

  it("is a complete Record over every backend estado", () => {
    const estados: BackendEstadoMembresia[] = ["INACTIVA", "ACTIVA", "VENCIDA", "SUSPENDIDA"];
    for (const estado of estados) {
      expect(MEMBERSHIP_STATUS_BY_ESTADO[estado]).toBeDefined();
    }
  });
});

describe("readsAsVencida", () => {
  it("does not fold SUSPENDIDA into the vencida bucket", () => {
    expect(readsAsVencida("SUSPENDIDA")).toBe(false);
  });
});
