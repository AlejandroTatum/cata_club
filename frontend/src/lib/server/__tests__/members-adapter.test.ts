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

const membresia: BackendMembresia = {
  id: 100,
  estado: "ACTIVA",
  tipoMembresiaId: 5,
  montoAplicado: "25.00",
};
const tipo: BackendTipoMembresia = { id: 5, categoria: "Mensual Adultos" };

describe("buildMemberAccounts", () => {
  it("returns one row per persona, not just per root — a representative and their representado both get their own row", () => {
    const accounts = buildMemberAccounts(
      [admin, parent, child],
      new Map([[3, pago]]),
      new Map([[100, membresia]]),
      new Map(),
      new Map([[5, tipo]]),
    );

    // Three personas in, three rows out — a represented persona is no longer
    // nested inside their representative's row and excluded from the top-level
    // list.
    expect(accounts).toHaveLength(3);

    const carlos = accounts.find((a) => a.id === "2");
    expect(carlos?.role).toBe("representante");
    // Carlos' own row carries only himself — his own (empty) membership/payment
    // status, not Sofia's.
    expect(carlos?.estudiantes).toHaveLength(1);
    expect(carlos?.estudiantes[0].id).toBe("2");
    expect(carlos?.estudiantes[0].membresia).toBeNull();
    // A root with no representative of their own has no `representadoPor`.
    expect(carlos?.representadoPor).toBeUndefined();

    const sofia = accounts.find((a) => a.id === "3");
    expect(sofia?.estudiantes).toHaveLength(1);
    expect(sofia?.estudiantes[0].id).toBe("3");
    // Sofia's row names her representative by full name.
    expect(sofia?.representadoPor).toBe("Carlos Martinez");
    // Her own membership/payment status comes through on her own row, not
    // aggregated into or hidden behind Carlos'.
    expect(sofia?.estudiantes[0].membresia?.estado).toBe("activa");
    expect(sofia?.estudiantes[0].ultimoPago?.estado).toBe("aprobado");
  });

  it("treats a root persona with no representados as a representante account (all root personas are adults)", () => {
    const accounts = buildMemberAccounts([admin], new Map(), new Map(), new Map(), new Map());

    const account = accounts.find((a) => a.id === "1");
    expect(account?.role).toBe("representante");
    expect(account?.estudiantes).toHaveLength(1);
    expect(account?.estudiantes[0].id).toBe("1");
    expect(account?.representadoPor).toBeUndefined();
  });

  it("resolves membership + latest payment from the pago/membresia/tipo maps", () => {
    const accounts = buildMemberAccounts(
      [parent, child],
      new Map([[3, pago]]),
      new Map([[100, membresia]]),
      new Map(),
      new Map([[5, tipo]]),
    );

    const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
    // Issue #313 (K5 hallazgo #44): `membresia.monto` es el PRECIO DEL PLAN
    // (`montoAplicado`, $25), no el monto del último pago ($50 — una
    // renovación de dos meses en este fixture). Antes ambos números se
    // conflaban en uno solo (`pago?.monto ?? membresia.montoAplicado`), así
    // que la ficha mostraba el mismo importe dos veces y un admin no podía
    // saber si el alumno debía 25 o 50.
    expect(student?.membresia).toEqual({
      id: 100,
      tipo: "Mensual Adultos",
      estado: "activa",
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-31",
      monto: 25,
    });
    expect(student?.ultimoPago?.estado).toBe("aprobado");
    expect(student?.ultimoPago?.monto).toBe(50);
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
    );

    const student = accounts[0].estudiantes[0];
    expect(student.membresia).toEqual({
      id: 3,
      tipo: "Mensual Adultos",
      estado: "activa",
      fechaInicio: "",
      fechaFin: "",
      monto: 25,
    });
    // No payment means no payment row — the membership does not fabricate one.
    expect(student.ultimoPago).toBeNull();
  });

  it("leaves membresia/ultimoPago null when a student has neither payment nor membership", () => {
    const accounts = buildMemberAccounts([admin], new Map(), new Map(), new Map(), new Map());
    const student = accounts[0].estudiantes[0];
    expect(student.membresia).toBeNull();
    expect(student.ultimoPago).toBeNull();
    expect(student.activo).toBe(true);
  });

  it("returns no email field (Persona has none), and one row for EVERY persona including non-root ones", () => {
    const accounts = buildMemberAccounts([parent, child], new Map(), new Map(), new Map(), new Map());
    // Both the root and its represented persona get their own row now — this
    // used to collapse to 1 (only the root), which is exactly the bug #388
    // reports: a represented persona's own status was invisible outside the
    // group.
    expect(accounts).toHaveLength(2);
    expect(accounts[0].email).toBeUndefined();
    expect(accounts[1].email).toBeUndefined();
  });
});
