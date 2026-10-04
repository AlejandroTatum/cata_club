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

  it("drops malformed entries and non-arrays", () => {
    expect(mapPublicTarifas([{ categoria: "", precio: "1" }, { categoria: "X" }, null, "x"])).toEqual([]);
    expect(mapPublicTarifas({ message: "error" })).toEqual([]);
  });
});
