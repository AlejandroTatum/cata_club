import { describe, expect, it } from "vitest";
import {
  describeAlergias,
  describeEnfermedades,
  enfermedadesInputValue,
  hasEnfermedadesInput,
  requiredFichaTextError,
} from "../ficha-declaration";

describe("ficha declaration helpers (#1574)", () => {
  it("tells a declared «none» apart from an undeclared field", () => {
    expect(describeAlergias("Ninguna")).toBe("Ninguna");
    expect(describeAlergias("Polen")).toBe("Polen");
    expect(describeAlergias(null)).toBe("Sin declarar");
    expect(describeAlergias("  ")).toBe("Sin declarar");
  });

  it("reads empty illnesses as «Ninguna» only when alergias were declared", () => {
    expect(describeEnfermedades([], "Ninguna")).toBe("Ninguna");
    expect(describeEnfermedades([], null)).toBe("Sin declarar");
    expect(describeEnfermedades(["Asma", "Diabetes"], null)).toBe("Asma, Diabetes");
  });

  it("prefills the editor so a declared ficha can be re-saved untouched", () => {
    expect(enfermedadesInputValue([], "Ninguna")).toBe("Ninguno");
    expect(enfermedadesInputValue([], null)).toBe("");
    expect(enfermedadesInputValue(["Asma"], "Polen")).toBe("Asma");
  });

  it("flags blank values and accepts «Ninguno»", () => {
    expect(requiredFichaTextError("  ", "falta")).toBe("falta");
    expect(requiredFichaTextError("Ninguno", "falta")).toBeNull();
    expect(hasEnfermedadesInput(" , ,")).toBe(false);
    expect(hasEnfermedadesInput("Ninguno")).toBe(true);
  });
});
