import { describe, expect, it } from "vitest";
import {
  coverageOfOnePayment,
  normalizePeriodicidad,
  periodSuffix,
  priceWithPeriod,
} from "../tarifa-periodo";

describe("tarifa-periodo", () => {
  it("labels each periodicity's price", () => {
    expect(periodSuffix("MENSUAL")).toBe("al mes");
    expect(periodSuffix("SEMANAL")).toBe("a la semana");
    expect(periodSuffix("DIARIA")).toBe("por día");
    expect(priceWithPeriod("$ 8,00", "SEMANAL")).toBe("$ 8,00 a la semana");
  });

  it("treats a missing or unknown periodicity as MENSUAL", () => {
    expect(normalizePeriodicidad(undefined)).toBe("MENSUAL");
    expect(normalizePeriodicidad(null)).toBe("MENSUAL");
    expect(normalizePeriodicidad("ANUAL")).toBe("MENSUAL");
    expect(periodSuffix(null)).toBe("al mes");
  });

  it("describes the coverage of one payment", () => {
    expect(coverageOfOnePayment("SEMANAL")).toBe("1 semana (7 días)");
    expect(coverageOfOnePayment("DIARIA")).toBe("el día pagado");
    expect(coverageOfOnePayment("MENSUAL")).toBe("1 mes");
  });
});
