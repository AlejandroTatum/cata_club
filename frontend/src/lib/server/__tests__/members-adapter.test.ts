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
      esGratuidadFamiliar: false,
    });
    expect(student?.ultimoPago?.estado).toBe("aprobado");
    expect(student?.ultimoPago?.monto).toBe(50);
  });

  // Issue #400 (slice 4c-a): the flag has to survive the pago/membresia/tipo
  // resolution chain unchanged, not just default to false.
  it("passes esGratuidadFamiliar through when the backend membership is flagged", () => {
    const accounts = buildMemberAccounts(
      [parent, child],
      new Map([[3, pago]]),
      new Map([[100, { ...membresia, esGratuidadFamiliar: true }]]),
      new Map(),
      new Map([[5, tipo]]),
    );

    const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
    expect(student?.membresia?.esGratuidadFamiliar).toBe(true);
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
      // `membresia` fixture above carries no `esGratuidadFamiliar` — this
      // proves the adapter defaults an absent backend flag to `false`
      // instead of leaving it `undefined` (issue #400, slice 4c-a).
      esGratuidadFamiliar: false,
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

  // Issue #362: "sin datos de emergencia" — no representative at all AND no
  // ficha médica.
  describe("sinDatosEmergencia", () => {
    it("flags a root persona with no representative and no ficha médica", () => {
      const accounts = buildMemberAccounts(
        [admin],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Set(), // nobody has a ficha médica
      );

      const account = accounts.find((a) => a.id === "1");
      expect(account?.sinDatosEmergencia).toBe(true);
    });

    it("does NOT flag a represented persona (has representanteId), even with no ficha médica of their own", () => {
      // Sofia (child) has `representanteId: 2` (Carlos) and no ficha médica
      // recorded — the gap is "no representative at all", never "the
      // representative's own contact fields are blank" (that's
      // EmergencyCardDialog.tsx's estaCompletamenteVacia, a different,
      // wider question this feature deliberately does not ask).
      const accounts = buildMemberAccounts(
        [parent, child],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Set(), // nobody has a ficha médica
      );

      const sofia = accounts.find((a) => a.id === "3");
      expect(sofia?.sinDatosEmergencia).toBe(false);
    });

    it("does NOT flag a root persona who has a ficha médica on file", () => {
      const accounts = buildMemberAccounts(
        [admin],
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        new Set([admin.id]), // admin has a ficha médica
      );

      const account = accounts.find((a) => a.id === "1");
      expect(account?.sinDatosEmergencia).toBe(false);
    });

    it("defaults to an empty ficha set when the parameter is omitted, so every root reads as flagged", () => {
      const accounts = buildMemberAccounts([admin], new Map(), new Map(), new Map(), new Map());
      expect(accounts[0].sinDatosEmergencia).toBe(true);
    });
  });

  // Issue #326: overdue amount + months on the members list, for VENCIDA
  // memberships only — sourced from `GET /membresias/deuda/bulk` (resolved
  // server-side in route.ts), never recomputed on the frontend beyond the
  // pure `mesesAdeudados * montoMensual` presentation multiplication.
  describe("deuda en bloque (mesesAdeudados / montoAdeudado)", () => {
    const membresiaVencida: BackendMembresia = { ...membresia, estado: "VENCIDA" };

    it("attaches mesesAdeudados and the multiplied montoAdeudado for a VENCIDA membership present in the bulk map", () => {
      const accounts = buildMemberAccounts(
        [parent, child],
        new Map([[3, pago]]),
        new Map([[100, membresiaVencida]]),
        new Map(),
        new Map([[5, tipo]]),
        new Set(),
        new Map([[100, { mesesAdeudados: 3, montoMensual: 30 }]]),
      );

      const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
      expect(student?.membresia?.mesesAdeudados).toBe(3);
      // Pure presentation arithmetic on backend-provided numbers, not a
      // reimplementation of the day-boundary debt formula.
      expect(student?.membresia?.montoAdeudado).toBe(90);
    });

    it("omits debt fields for a VENCIDA membership missing from the bulk map (fetch failure/degrade)", () => {
      const accounts = buildMemberAccounts(
        [parent, child],
        new Map([[3, pago]]),
        new Map([[100, membresiaVencida]]),
        new Map(),
        new Map([[5, tipo]]),
        new Set(),
        new Map(), // bulk lookup failed or didn't resolve this id — degrade, don't fabricate
      );

      const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
      expect(student?.membresia?.mesesAdeudados).toBeUndefined();
      expect(student?.membresia?.montoAdeudado).toBeUndefined();
    });

    /*
     * Issue #713. An INACTIVA membership is EMITTED as `estado: "vencida"`
     * (`MEMBERSHIP_STATUS_BY_ESTADO` folds both backend estados into that one
     * bucket), so it must be treated as a vencida HERE too. Attaching on
     * `=== "VENCIDA"` while emitting the wider bucket is what made the Pagos
     * dialog say "Estado de deuda no disponible" for 29 of the 45 rows it
     * showed as vencidas on QA — every one of them a membership whose debt
     * `GET /membresias/{id}/deuda` answers `200 {"mesesAdeudados":0}`.
     */
    const membresiaInactiva: BackendMembresia = { ...membresia, estado: "INACTIVA" };

    it("attaches debt for an INACTIVA membership, which is emitted as vencida too", () => {
      const accounts = buildMemberAccounts(
        [parent, child],
        new Map([[3, pago]]),
        new Map([[100, membresiaInactiva]]),
        new Map(),
        new Map([[5, tipo]]),
        new Set(),
        new Map([[100, { mesesAdeudados: 0, montoMensual: 25 }]]),
      );

      const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
      // The row reads as vencida to the screen…
      expect(student?.membresia?.estado).toBe("vencida");
      // …so the debt it reads must be present, and zero is a REAL answer here
      // (never paid, no coverage yet) — not the absence that means "unknown".
      expect(student?.membresia?.mesesAdeudados).toBe(0);
      expect(student?.membresia?.montoAdeudado).toBe(0);
    });

    it("does NOT attach debt fields for an ACTIVA membership even if present in the bulk map", () => {
      // The bulk map is keyed by membresiaId and could in principle carry a
      // stale/irrelevant entry; only a VENCIDA membership ever shows debt.
      const accounts = buildMemberAccounts(
        [parent, child],
        new Map([[3, pago]]),
        new Map([[100, membresia]]), // ACTIVA
        new Map(),
        new Map([[5, tipo]]),
        new Set(),
        new Map([[100, { mesesAdeudados: 3, montoMensual: 30 }]]),
      );

      const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
      expect(student?.membresia?.mesesAdeudados).toBeUndefined();
      expect(student?.membresia?.montoAdeudado).toBeUndefined();
    });

    it("defaults to an empty debt map when the parameter is omitted", () => {
      const accounts = buildMemberAccounts(
        [parent, child],
        new Map([[3, pago]]),
        new Map([[100, membresiaVencida]]),
        new Map(),
        new Map([[5, tipo]]),
      );

      const student = accounts.find((a) => a.id === "3")?.estudiantes[0];
      expect(student?.membresia?.montoAdeudado).toBeUndefined();
    });
  });
});
