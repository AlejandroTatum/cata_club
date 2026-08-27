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
  descuentoExcedeTarifa,
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

/**
 * Client-side mirror of the backend gate in `BeneficioServicio.asignar`
 * (issue #665): a fixed-amount discount can exceed the tarifa, a percentage
 * one never can (it is capped at 100 in the catalog schema), so this must
 * agree with that asymmetry.
 */
describe("descuentoExcedeTarifa", () => {
  it("flags a fixed amount above the monthly tarifa", () => {
    const descuento = makeDescuento({ porcentaje: null, monto: "50000.00" });
    expect(descuentoExcedeTarifa(descuento, 80)).toBe(true);
  });

  it("does not flag a fixed amount equal to the tarifa (100% is allowed)", () => {
    const descuento = makeDescuento({ porcentaje: null, monto: "80.00" });
    expect(descuentoExcedeTarifa(descuento, 80)).toBe(false);
  });

  it("does not flag a fixed amount below the tarifa", () => {
    const descuento = makeDescuento({ porcentaje: null, monto: "15.00" });
    expect(descuentoExcedeTarifa(descuento, 80)).toBe(false);
  });

  it("never flags a percentage discount, even 100% against a tiny tarifa", () => {
    const descuento = makeDescuento({ porcentaje: "100", monto: null });
    expect(descuentoExcedeTarifa(descuento, 5)).toBe(false);
  });
});
