/**
 * Unit tests for src/lib/server/members-adapter.ts — pure DTO translation,
 * no fetching. Mirrors src/lib/server/__tests__/attendance-adapter.test.ts.
 */

import { describe, it, expect } from "vitest";
import { buildMemberAccounts, type BackendPersonaFull } from "../members-adapter";
import type { BackendMembresia, BackendPagoListItem, BackendTipoMembresia } from "../payments-adapter";

const admin: BackendPersonaFull = {
  id: 1,
  nombres: "Admin",
  apellidos: "Dev",
  telefono: "0999999999",
  fechaNacimiento: "1990-01-01",
  representanteId: null,
};

const parent: BackendPersonaFull = {
  id: 2,
  nombres: "Carlos",
  apellidos: "Martinez",
  telefono: "0999999002",
  fechaNacimiento: "1980-01-01",
  representanteId: null,
};

const child: BackendPersonaFull = {
  id: 3,
  nombres: "Sofia",
  apellidos: "Martinez",
  telefono: "0999999003",
  fechaNacimiento: "2014-01-01",
  representanteId: 2,
};

const pago: BackendPagoListItem = {
  id: 10,
  monto: "50.00",
  estadoPago: "APROBADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-07-18T16:09:25Z",
  fechaValidacion: "2026-07-18T16:18:48Z",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-07-31",
  personaId: 3,
  personaNombreCompleto: "Sofia Martinez",
  membresiaId: 100,
  voucherUrl: null,
  voucherFormato: null,
};

const membresia: BackendMembresia = { id: 100, estado: "ACTIVA", tipoMembresiaId: 5 };
const tipo: BackendTipoMembresia = { id: 5, categoria: "Mensual Adultos", franjaHoraria: "18:00-20:00" };

describe("buildMemberAccounts", () => {
  it("groups a representante with their representados as one account", () => {
    const accounts = buildMemberAccounts(
      [admin, parent, child],
      new Map([[3, pago]]),
      new Map([[100, membresia]]),
      new Map(),
      new Map([[5, tipo]]),
      new Map([[3, 7]]),
    );

    const carlos = accounts.find((a) => a.id === "2");
    expect(carlos?.role).toBe("representante");
    expect(carlos?.estudiantes).toHaveLength(1);
    expect(carlos?.estudiantes[0].id).toBe("3");
    expect(carlos?.estudiantes[0].grupoId).toBe("7");
  });

  it("treats a root persona with no representados as a representante account (all root personas are adults)", () => {
    const accounts = buildMemberAccounts([admin], new Map(), new Map(), new Map(), new Map(), new Map());

    const account = accounts.find((a) => a.id === "1");
    expect(account?.role).toBe("representante");
    expect(account?.estudiantes).toHaveLength(1);
    expect(account?.estudiantes[0].id).toBe("1");
  });

  it("resolves membership + latest payment from the pago/membresia/tipo maps", () => {
    const accounts = buildMemberAccounts(
      [parent, child],
      new Map([[3, pago]]),
      new Map([[100, membresia]]),
      new Map(),
      new Map([[5, tipo]]),
      new Map(),
    );

    const student = accounts.find((a) => a.id === "2")?.estudiantes[0];
    expect(student?.membresia).toEqual({
      id: 100,
      tipo: "Mensual Adultos (18:00-20:00)",
      estado: "activa",
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-31",
      monto: 50,
    });
    expect(student?.ultimoPago?.estado).toBe("aprobado");
  });

  it("shows a membership that has no payment behind it, with no invented period", () => {
    // Three personas in the real data hold an ACTIVA membresía and zero Pago
    // rows (Ana García among them). Reading membership ONLY through the latest
    // payment reported them as membership-less while their own student portal
    // said "Membresía activa".
    const accounts = buildMemberAccounts(
      [admin],
      new Map(),
      new Map(),
      new Map([[1, { ...membresia, id: 3, montoAplicado: "25.00" }]]),
      new Map([[5, tipo]]),
      new Map(),
    );

    const student = accounts[0].estudiantes[0];
    expect(student.membresia).toEqual({
      id: 3,
      tipo: "Mensual Adultos (18:00-20:00)",
      estado: "activa",
      fechaInicio: "",
      fechaFin: "",
      monto: 25,
    });
    // No payment means no payment row — the membership does not fabricate one.
    expect(student.ultimoPago).toBeNull();
  });

  it("leaves membresia/ultimoPago null when a student has neither payment nor membership", () => {
    const accounts = buildMemberAccounts([admin], new Map(), new Map(), new Map(), new Map(), new Map());
    const student = accounts[0].estudiantes[0];
    expect(student.membresia).toBeNull();
    expect(student.ultimoPago).toBeNull();
    expect(student.grupoId).toBeNull();
    expect(student.activo).toBe(true);
  });

  it("returns no email field (Persona has none) and no accounts for non-root personas outside their group", () => {
    const accounts = buildMemberAccounts([parent, child], new Map(), new Map(), new Map(), new Map(), new Map());
    expect(accounts).toHaveLength(1);
    expect(accounts[0].email).toBeUndefined();
  });
});
