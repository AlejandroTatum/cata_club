/**
 * Unit tests for the Nivel trainer page's pure utility functions.
 * No React dependencies required.
 */

import { describe, it, expect } from "vitest";
import {
  isValidPeriodo,
  currentPeriodo,
  parsePeriodo,
  buildNivelStudentsFromAlumnos,
} from "../nivel-utils";

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

describe("buildNivelStudentsFromAlumnos", () => {
  const alumnos = [
    { personaId: 1, nombres: "Sofía", apellidos: "Martínez", nivelRankingId: 4 },
    { personaId: 2, nombres: "Mateo", apellidos: "Martínez", nivelRankingId: null },
    { personaId: 3, nombres: "Ana", apellidos: "López", nivelRankingId: null },
  ];

  it("maps every alumno in the roster to a student ref", () => {
    const result = buildNivelStudentsFromAlumnos(alumnos);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.id)).toEqual(["1", "2", "3"]);
  });

  it("passes nivelRankingId through, keeping unassigned students as null", () => {
    const result = buildNivelStudentsFromAlumnos(alumnos);
    expect(result.find((s) => s.id === "1")?.nivelRankingId).toBe(4);
    expect(result.find((s) => s.id === "2")?.nivelRankingId).toBeNull();
  });

  it("defaults activo to true — the payload carries no estado", () => {
    const result = buildNivelStudentsFromAlumnos(alumnos);
    expect(result.every((s) => s.activo)).toBe(true);
  });
});
