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

  // Issue #935: SUSPENDIDA (backend since #400) and REGULARIZACION (backend
  // since #284) were missing from this adapter's own unions, so a payment
  // tied to either indexed its lookup table to `undefined`.
  it("reads a SUSPENDIDA membresía as its own status, not undefined nor vencida", () => {
    const suspendida: BackendMembresia = { ...membresia, estado: "SUSPENDIDA" };
    const request = buildPaymentValidationRequest(pago, "Sofia Martinez", suspendida, tipo);
    expect(request.currentMembershipStatus).toBe("suspendida");
  });

  it("labels a REGULARIZACION payment distinctly from Efectivo and Transferencia", () => {
    const regularizacion: BackendPagoCore = { ...pago, tipoPago: "REGULARIZACION" };
    const request = buildPaymentValidationRequest(regularizacion, "Sofia Martinez", membresia, tipo);
    expect(request.paymentMethod).toBe("Regularización");
    expect(request.paymentMethod).not.toBe("Efectivo");
    expect(request.paymentMethod).not.toBe("Transferencia");
  });

  // Issue #868: the last path segment of `voucherUrl` — a signed download URL
  // for a real payment — is a technical id, never a name the payer chose.
  // The adapter must not derive or expose it at all; the UI decides what to
  // show ("Comprobante adjunto" or its absence) from `proofPreviewUrl` alone.
  it("does not derive or expose a proofFileName from voucherUrl", () => {
    const conVoucher: BackendPagoCore = {
      ...pago,
      voucherUrl:
        "https://storage.example.com/vouchers/a1b2c3d4-e5f6.pdf?X-Amz-Expires=3600&X-Amz-Signature=deadbeef",
      voucherFormato: "PDF",
    };
    const request = buildPaymentValidationRequest(conVoucher, "Sofia Martinez", membresia, tipo);
    expect(request).not.toHaveProperty("proofFileName");
  });
});
