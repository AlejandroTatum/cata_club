/**
 * Pure helpers for the discount catalog and the benefit assignment picker.
 *
 * `computeMontoFinal` and its tests were removed with the per-payment
 * discount picker (issue #398) — see `../discounts-utils`'s own doc comment.
 */

import { describe, it, expect } from "vitest";
import type { DescuentoCatalogo } from "@/services/api";
import {
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
