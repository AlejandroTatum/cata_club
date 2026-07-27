import { describe, it, expect } from "vitest";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";

describe("isDuplicateIdentityError", () => {
  it.each([
    "Ya existe una persona con la cédula 1712345678",
    "Ya existe una persona con la cedula 1712345678",
    "YA EXISTE UNA PERSONA CON LA CÉDULA 1712345678",
    "El correo ya está en uso por otra cuenta",
    "El correo del representante ya está en uso",
    "El correo ya está en uso",
  ])("detects %s as an already-registered identity", (message) => {
    expect(isDuplicateIdentityError(message)).toBe(true);
  });

  it.each([
    "La fecha de inicio debe ser anterior a la fecha de fin.",
    "Esta persona ya tiene el rol ADMINISTRADOR",
    "No se pudo completar la inscripción. Intente nuevamente más tarde.",
    "",
  ])("does not misread %s as an already-registered identity", (message) => {
    expect(isDuplicateIdentityError(message)).toBe(false);
  });

  it("tolerates non-string input", () => {
    expect(isDuplicateIdentityError(undefined)).toBe(false);
    expect(isDuplicateIdentityError(null)).toBe(false);
  });
});
