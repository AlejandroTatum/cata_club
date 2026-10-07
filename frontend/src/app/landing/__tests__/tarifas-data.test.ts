import { describe, expect, it } from "vitest";
import { formatTarifaPrice, mapPublicTarifas } from "../tarifas-data";

describe("formatTarifaPrice", () => {
  it.each([
    ["25.00", "$25,00"],
    ["40", "$40,00"],
    ["12.5", "$12,50"],
    [30, "$30,00"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatTarifaPrice(input)).toBe(expected);
  });

  it.each(["", "abc", "-5", "1,50", "1.234", null, undefined, {}])("rejects %j", (input) => {
    expect(formatTarifaPrice(input)).toBeNull();
  });
});

describe("mapPublicTarifas", () => {
  it("maps the public catalog without restating any plan", () => {
    expect(mapPublicTarifas([
      { categoria: "Mensual Infantil", precio: "25.00" },
      { categoria: " Mensual Adultos ", precio: "40.00" },
    ])).toEqual([
      { name: "Mensual Infantil", price: "$25,00" },
      { name: "Mensual Adultos", price: "$40,00" },
    ]);
  });

  it("carries the period of weekly and daily plans, and nothing for monthly ones", () => {
    expect(mapPublicTarifas([
      { categoria: "Mensual", precio: "40.00", periodicidad: "MENSUAL" },
      { categoria: "Semana", precio: "8.00", periodicidad: "SEMANAL" },
      { categoria: "Día", precio: "3.00", periodicidad: "DIARIA" },
    ])).toEqual([
      { name: "Mensual", price: "$40,00" },
      { name: "Semana", price: "$8,00", period: "a la semana" },
      { name: "Día", price: "$3,00", period: "por día" },
    ]);
  });

  it("drops malformed entries and non-arrays", () => {
    expect(mapPublicTarifas([{ categoria: "", precio: "1" }, { categoria: "X" }, null, "x"])).toEqual([]);
    expect(mapPublicTarifas({ message: "error" })).toEqual([]);
  });
});
