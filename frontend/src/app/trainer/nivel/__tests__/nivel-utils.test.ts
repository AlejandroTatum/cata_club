/**
 * Unit tests for the Nivel trainer page's pure utility functions.
 * No React dependencies required.
 */

import { describe, it, expect } from "vitest";
import {
  isValidPeriodo,
  currentPeriodo,
  parsePeriodo,
  buildNivelStudents,
} from "../nivel-utils";
import type { AlumnoParaNivel } from "@/services/api";

describe("isValidPeriodo", () => {
  it("accepts a well-formed YYYY-MM period", () => {
    expect(isValidPeriodo("2026-07")).toBe(true);
    expect(isValidPeriodo("2026-01")).toBe(true);
    expect(isValidPeriodo("2026-12")).toBe(true);
  });

  it("rejects month 00 and month 13", () => {
    expect(isValidPeriodo("2026-00")).toBe(false);
    expect(isValidPeriodo("2026-13")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidPeriodo("2026/07")).toBe(false);
    expect(isValidPeriodo("26-07")).toBe(false);
    expect(isValidPeriodo("")).toBe(false);
  });
});

describe("currentPeriodo", () => {
  it("formats a given date as YYYY-MM", () => {
    expect(currentPeriodo(new Date(2026, 6, 15))).toBe("2026-07");
  });

  it("pads single-digit months", () => {
    expect(currentPeriodo(new Date(2026, 0, 1))).toBe("2026-01");
  });
});

describe("parsePeriodo", () => {
  it("splits a YYYY-MM period into numeric anio/mes", () => {
    expect(parsePeriodo("2026-07")).toEqual({ anio: 2026, mes: 7 });
  });

  it("does not zero-pad the parsed mes", () => {
    expect(parsePeriodo("2026-01").mes).toBe(1);
  });
});

describe("buildNivelStudents", () => {
  const roster: AlumnoParaNivel[] = [
    { personaId: 1, nombres: "Sofía", apellidos: "Martínez", activo: true, representanteId: null, nivelRankingId: 4 },
    { personaId: 2, nombres: "Mateo", apellidos: "Martínez", activo: false, representanteId: null, nivelRankingId: null },
    { personaId: 3, nombres: "Ana", apellidos: "López", activo: true, representanteId: null, nivelRankingId: null },
  ];

  it("maps every person in the roster to a student ref", () => {
    const result = buildNivelStudents(roster);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toEqual(["1", "2", "3"]);
  });

  it("passes nivelRankingId through, keeping unassigned students as null", () => {
    const result = buildNivelStudents(roster);
    expect(result.find((s) => s.id === "1")?.nivelRankingId).toBe(4);
    expect(result.find((s) => s.id === "2")?.nivelRankingId).toBeNull();
  });

  it("preserves each student's activo flag", () => {
    const result = buildNivelStudents(roster);
    expect(result.find((s) => s.id === "2")?.activo).toBe(false);
  });

  it("drops a person who only appears as somebody's representante", () => {
    // A parent who enrolled a child is a Persona too, but is not a student —
    // `/api/members` used to hide them by listing an account's children
    // instead of its holder. Same rule, applied to the flat roster.
    const conRepresentante: AlumnoParaNivel[] = [
      { personaId: 10, nombres: "Laura", apellidos: "Vera", activo: true, representanteId: null, nivelRankingId: null },
      { personaId: 11, nombres: "Sofía", apellidos: "Vera", activo: true, representanteId: 10, nivelRankingId: 3 },
    ];

    const result = buildNivelStudents(conRepresentante);

    expect(result.map((s) => s.id)).toEqual(["11"]);
  });

  it("keeps an adult who represents nobody", () => {
    const soloAdulto: AlumnoParaNivel[] = [
      { personaId: 20, nombres: "María", apellidos: "Torres", activo: true, representanteId: null, nivelRankingId: null },
    ];

    expect(buildNivelStudents(soloAdulto).map((s) => s.id)).toEqual(["20"]);
  });
});
