/**
 * Pure helpers for the discount catalog and the payment-form preview.
 *
 * `computeMontoFinal` is DISPLAY-ONLY: the backend resolves, freezes and
 * recomputes the final amount itself at registration — this mirror exists so
 * the admin sees the resulting amount before submitting, nothing more.
 */

import { describe, it, expect } from "vitest";
import type { DescuentoCatalogo } from "@/services/api";
import {
  computeMontoFinal,
  descuentosActivos,
  descuentoValorLabel,
} from "../discounts-utils";

function makeDescuento(overrides: Partial<DescuentoCatalogo> = {}): DescuentoCatalogo {
  return {
    id: 1,
    nombre: "Beca municipal",
    porcentaje: "100",
    monto: null,
    activo: true,
    ...overrides,
  };
}

describe("descuentosActivos", () => {
  it("keeps only active discounts, preserving order", () => {
    const catalogo = [
      makeDescuento({ id: 1, activo: true }),
      makeDescuento({ id: 2, activo: false }),
      makeDescuento({ id: 3, activo: true }),
    ];
    expect(descuentosActivos(catalogo).map((d) => d.id)).toEqual([1, 3]);
  });
});

describe("descuentoValorLabel", () => {
  it("labels a percentage discount without trailing zeros", () => {
    expect(descuentoValorLabel(makeDescuento({ porcentaje: "50.00", monto: null }))).toBe("50%");
    expect(descuentoValorLabel(makeDescuento({ porcentaje: "12.5", monto: null }))).toBe("12.5%");
  });

  it("labels a fixed-amount discount as currency", () => {
    const label = descuentoValorLabel(makeDescuento({ porcentaje: null, monto: "10.00" }));
    expect(label).toContain("10");
    expect(label).toMatch(/\$/);
  });
});

describe("computeMontoFinal", () => {
  it("subtracts a percentage of the BASE amount", () => {
    const media = makeDescuento({ porcentaje: "50", monto: null });
    expect(computeMontoFinal(35, [media])).toBe(17.5);
  });

  it("subtracts a fixed amount", () => {
    const convenio = makeDescuento({ porcentaje: null, monto: "10.00" });
    expect(computeMontoFinal(35, [convenio])).toBe(25);
  });

  it("combines several discounts, each percentage over the base", () => {
    const d1 = makeDescuento({ id: 1, porcentaje: "25", monto: null });
    const d2 = makeDescuento({ id: 2, porcentaje: "25", monto: null });
    const d3 = makeDescuento({ id: 3, porcentaje: null, monto: "5.00" });
    expect(computeMontoFinal(100, [d1, d2, d3])).toBe(45);
  });

  it("reaches exactly zero on a 100% scholarship", () => {
    expect(computeMontoFinal(35, [makeDescuento({ porcentaje: "100", monto: null })])).toBe(0);
  });

  it("never goes below zero (the backend rejects >100% anyway)", () => {
    const d1 = makeDescuento({ id: 1, porcentaje: "60", monto: null });
    const d2 = makeDescuento({ id: 2, porcentaje: "50", monto: null });
    expect(computeMontoFinal(35, [d1, d2])).toBe(0);
  });

  it("rounds to two decimals", () => {
    const tercio = makeDescuento({ porcentaje: "33.33", monto: null });
    expect(computeMontoFinal(10, [tercio])).toBe(6.67);
  });

  it("returns the base amount when nothing is selected", () => {
    expect(computeMontoFinal(35, [])).toBe(35);
  });
});
