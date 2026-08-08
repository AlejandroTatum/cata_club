/**
 * Unit tests for the frontend mirror of the backend's `CATEGORIA_METADATA`
 * single source of truth (see `backend/app/dominio/categoria_metadata.py`).
 *
 * Covers the spec's "Each category exposes correct data" scenario: all 5
 * fixed categories expose the confirmed audience/time-range/day-set, with
 * FORMATIVO/INFANTIL/JUVENIL/ADULTOS on Lun-Vie and COMPETITIVO on Lun-Sáb.
 */
import { describe, it, expect } from "vitest";
import {
  CATEGORIA_METADATA,
  CATEGORIA_OPTIONS,
  diasPermitidos,
  horarioDe,
  type Categoria,
} from "@/services/categorias";

const LUN_VIE = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"];
const LUN_SAB = [...LUN_VIE, "SABADO"];

describe("categorias metadata", () => {
  it("defines exactly the 5 fixed categories", () => {
    expect(CATEGORIA_OPTIONS).toEqual(["FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"]);
  });

  it("gives FORMATIVO the confirmed time range and Lun-Vie days", () => {
    expect(CATEGORIA_METADATA.FORMATIVO).toEqual({
      label: "Formativo",
      horaInicio: "15:00",
      horaFin: "16:00",
      dias: LUN_VIE,
    });
  });

  it("gives ADULTOS the confirmed 20:00-21:15 Lun-Vie schedule (seed-data correction)", () => {
    expect(CATEGORIA_METADATA.ADULTOS).toEqual({
      label: "Adultos",
      horaInicio: "20:00",
      horaFin: "21:15",
      dias: LUN_VIE,
    });
  });

  it("gives COMPETITIVO Lun-Sáb (includes Sábado, unlike the other 4 categories)", () => {
    expect(CATEGORIA_METADATA.COMPETITIVO).toEqual({
      label: "Competitivo",
      horaInicio: "18:00",
      horaFin: "20:00",
      dias: LUN_SAB,
    });
  });
});

describe("diasPermitidos", () => {
  it("returns Lun-Vie (5 days, no Sábado) for JUVENIL", () => {
    const categoria: Categoria = "JUVENIL";
    expect(diasPermitidos(categoria)).toEqual(LUN_VIE);
  });

  it("returns Lun-Sáb (6 days, includes Sábado) for COMPETITIVO", () => {
    const categoria: Categoria = "COMPETITIVO";
    expect(diasPermitidos(categoria)).toEqual(LUN_SAB);
  });
});

describe("horarioDe", () => {
  it("derives INFANTIL's exact 16:00-17:00 range", () => {
    expect(horarioDe("INFANTIL")).toEqual({ horaInicio: "16:00", horaFin: "17:00" });
  });

  it("derives a different range for a different category (proves it's not hardcoded)", () => {
    expect(horarioDe("JUVENIL")).toEqual({ horaInicio: "17:00", horaFin: "18:00" });
  });
});
