/**
 * Parity with the backend discount rule. `backend/tests/test_paridad_descuentos.py`
 * runs the same table against `BeneficioServicio._valor_potencial` and the
 * payment-time freeze; the base is `monto_aplicado` on both sides (the
 * frontend's `membresia.monto`, the per-period price for weekly/daily tariffs).
 * Keep the two tables identical.
 */
import { describe, it, expect } from "vitest";
import { descuentoExcedeTarifa } from "@/app/discounts/discounts-utils";
import type { DescuentoCatalogo } from "@/services/api";

// [case, tarifa, porcentaje, monto, backend valor, excede la tarifa]
const CASOS: Array<[string, string, string | null, string | null, string, boolean]> = [
  ["mensual 100%", "10.00", "100", null, "10.00", false],
  ["mensual 50%", "25.00", "50", null, "12.50", false],
  ["mensual 100% con centavos", "19.99", "100", null, "19.99", false],
  ["porcentaje fraccionario", "0.10", "33.33", null, "0.03", false],
  ["semanal monto igual a la tarifa", "7.00", null, "7.00", "7.00", false],
  ["semanal monto 1 centavo por encima", "7.00", null, "7.01", "7.01", true],
  ["diaria monto por encima", "2.50", null, "2.51", "2.51", true],
  ["mensual monto menor", "25.00", null, "10.00", "10.00", false],
];

function descuento(porcentaje: string | null, monto: string | null): DescuentoCatalogo {
  return { id: 1, nombre: "paridad", porcentaje, monto, activo: true, enUso: false };
}

describe("descuentoExcedeTarifa — parity with the backend rule", () => {
  it.each(CASOS)("%s", (_nombre, tarifa, porcentaje, monto, _valor, excede) => {
    expect(descuentoExcedeTarifa(descuento(porcentaje, monto), Number(tarifa))).toBe(excede);
  });

  it("never flags a percentage discount, at any two-decimal tarifa", () => {
    for (let centavos = 1; centavos <= 20000; centavos++) {
      expect(descuentoExcedeTarifa(descuento("100", null), centavos / 100)).toBe(false);
    }
  });
});
