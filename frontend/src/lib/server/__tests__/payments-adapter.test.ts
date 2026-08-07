/**
 * Unit tests for src/lib/server/payments-adapter.ts — pure DTO translation,
 * no fetching. Mirrors src/lib/server/__tests__/members-adapter.test.ts's
 * fixture shapes for `BackendPersonaWithRepresentante`.
 */

import { describe, it, expect } from "vitest";
import {
  buildPaymentValidationRequest,
  buildRepresentanteNameMap,
  type BackendMembresia,
  type BackendPagoCore,
  type BackendPersonaWithRepresentante,
  type BackendTipoMembresia,
} from "../payments-adapter";

const selfManaged: BackendPersonaWithRepresentante = {
  id: 1,
  nombres: "Admin",
  apellidos: "Dev",
  representanteId: null,
};

const representante: BackendPersonaWithRepresentante = {
  id: 2,
  nombres: "Carlos",
  apellidos: "Martinez",
  representanteId: null,
};

const represented: BackendPersonaWithRepresentante = {
  id: 3,
  nombres: "Sofia",
  apellidos: "Martinez",
  representanteId: 2,
};

const danglingRepresentante: BackendPersonaWithRepresentante = {
  id: 4,
  nombres: "Huerfano",
  apellidos: "Solo",
  representanteId: 999, // representante not present in the fetched batch
};

describe("buildRepresentanteNameMap", () => {
  it("maps a self-managed persona to their own full name", () => {
    const map = buildRepresentanteNameMap([selfManaged]);
    expect(map.get(1)).toBe("Admin Dev");
  });

  it("maps a represented persona to their representante's full name, not their own", () => {
    const map = buildRepresentanteNameMap([representante, represented]);
    expect(map.get(3)).toBe("Carlos Martinez");
    expect(map.get(2)).toBe("Carlos Martinez");
  });

  it("falls back to the persona's own name when the representante is not in the batch", () => {
    const map = buildRepresentanteNameMap([danglingRepresentante]);
    expect(map.get(4)).toBe("Huerfano Solo");
  });
});

describe("buildPaymentValidationRequest", () => {
  const pago: BackendPagoCore = {
    id: 10,
    monto: "50.00",
    estadoPago: "APROBADO",
    tipoPago: "TRANSFERENCIA",
    fechaRegistro: "2026-07-18T16:09:25Z",
    fechaValidacion: "2026-07-18T16:18:48Z",
    fechaInicio: "2026-07-01",
    fechaFin: "2026-07-31",
    personaId: 3,
    membresiaId: 100,
    voucherUrl: null,
    voucherFormato: null,
  };

  const membresia: BackendMembresia = { id: 100, estado: "ACTIVA", tipoMembresiaId: 5 };
  const tipo: BackendTipoMembresia = { id: 5, categoria: "Mensual Adultos" };

  it("populates responsablePagoName when provided", () => {
    const request = buildPaymentValidationRequest(pago, "Sofia Martinez", membresia, tipo, "Carlos Martinez");
    expect(request.responsablePagoName).toBe("Carlos Martinez");
  });

  it("leaves responsablePagoName undefined when not provided (backward compatible)", () => {
    const request = buildPaymentValidationRequest(pago, "Sofia Martinez", membresia, tipo);
    expect(request.responsablePagoName).toBeUndefined();
  });
});
