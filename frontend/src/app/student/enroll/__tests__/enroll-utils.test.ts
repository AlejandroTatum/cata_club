/**
 * Unit tests for `describeStepBlocker` — the sentence that explains a disabled
 * "Siguiente" (#312 / hallazgo #10).
 *
 * #1027 redraws WHERE that sentence renders (`WizardNavigation`'s footer), but
 * its DYNAMICS are the contract the footer depends on: nothing pending means no
 * sentence, one pending field names that field, and many pending fields keep
 * the wizard's own field order with the Spanish "y" before the last one. These
 * tests lock that behavior so the layout work cannot drift it.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalStudentPhone,
  describeStepBlocker,
  enrollStudentPhoneRule,
  initialFormData,
  validateEnrollFields,
  type EnrollFieldErrors,
} from "../enroll-utils";

describe("describeStepBlocker", (): void => {
  it("returns null when nothing is pending — no reason, no line", (): void => {
    expect(describeStepBlocker({})).toBeNull();
  });

  it("names the one pending field", (): void => {
    expect(describeStepBlocker({ telefono: "required" })).toBe(
      "Para continuar, revise: Teléfono.",
    );
  });

  it("joins two pending fields with 'y'", (): void => {
    expect(
      describeStepBlocker({ fechaNacimiento: "required", cedula: "required" }),
    ).toBe("Para continuar, revise: Fecha de nacimiento y Cédula de identidad.");
  });

  it("keeps the wizard's field order and puts 'y' before the last of many", (): void => {
    const errors: EnrollFieldErrors = {
      nombres: "required",
      apellidos: "required",
      fechaNacimiento: "required",
      cedula: "required",
      telefono: "required",
    };
    expect(describeStepBlocker(errors)).toBe(
      "Para continuar, revise: Nombres, Apellidos, Fecha de nacimiento, Cédula de identidad y Teléfono.",
    );
  });

  it("ignores fields without a human-readable label", (): void => {
    // The exact screenshot case from #1027: the three personal-data fields.
    const errors: EnrollFieldErrors = {
      fechaNacimiento: "required",
      cedula: "required",
      telefono: "required",
    };
    const sentence = describeStepBlocker(errors);
    expect(sentence).toContain("Fecha de nacimiento");
    expect(sentence).toContain("Cédula de identidad");
    expect(sentence).toContain("Teléfono");
    expect(sentence).toMatch(/\.$/);
  });
});

// ---------------------------------------------------------------------------
// #1028, review round 3 — the public self-service enrollment's phone shows
// 🇪🇨 + a fixed `+593`, and the editable value is ONLY the nine mobile digits
// that follow. The shared `phoneRule` (which every other phone field keeps)
// still takes `593`/`+593` forms and landlines, and the masking layer still
// normalizes an autofilled international value — so this scoped rule exists
// precisely to reject BOTH mistake shapes in this flow, each with a message
// that names it, while `canonicalStudentPhone` restores the local `09…` form
// for the wire contract.
// ---------------------------------------------------------------------------
describe("enrollStudentPhoneRule — step 2 takes only the 9 digits after +593", (): void => {
  it("accepts the nine mobile digits, with or without typing separators", (): void => {
    expect(enrollStudentPhoneRule("991234567")).toBeNull();
    expect(enrollStudentPhoneRule("987654321")).toBeNull();
    expect(enrollStudentPhoneRule("991 234 567")).toBeNull();
  });

  it("requires a value", (): void => {
    expect(enrollStudentPhoneRule("")).toBe("El teléfono es obligatorio.");
    expect(enrollStudentPhoneRule("   ")).toBe("El teléfono es obligatorio.");
  });

  it("rejects a leading 0 by name — the trunk digit is not the visitor's job", (): void => {
    expect(enrollStudentPhoneRule("0991234567")).toBe(
      "No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593.",
    );
  });

  it.each([
    ["the 593 form without the plus", "593991234567"],
    ["the +593 form", "+593991234567"],
  ])("rejects %s as a repeated country code", (_description, value): void => {
    expect(enrollStudentPhoneRule(value)).toBe(
      "No repita el 593: ya está en el campo. Escriba solo los 9 dígitos de su celular.",
    );
  });

  it.each([
    ["a too-short entry", "99123456"],
    ["a too-long entry", "9912345678"],
    ["a landline-shaped entry", "2234567"],
  ])("rejects %s with the format message", (_description, value): void => {
    expect(enrollStudentPhoneRule(value)).toBe(
      "Escriba los 9 dígitos de su celular después del +593 (por ejemplo, 991234567).",
    );
  });

  it("canonicalizes the 9-digit entry to the local 09XXXXXXXX wire form", (): void => {
    expect(canonicalStudentPhone("991234567")).toBe("0991234567");
    expect(canonicalStudentPhone("991 234 567")).toBe("0991234567");
    // Anything else passes through untouched — validation blocks it first.
    expect(canonicalStudentPhone("0991234567")).toBe("0991234567");
  });

  it("is the rule the wizard's personal step applies to telefono", (): void => {
    const errors = validateEnrollFields("personal", {
      ...initialFormData,
      nombres: "Juan",
      apellidos: "Pérez",
      fechaNacimiento: "2000-01-15",
      cedula: "1798765432",
      telefono: "0991234567",
      correo: "juan@example.com",
      contrasenia: "password8",
      contraseniaConfirmacion: "password8",
    });
    expect(errors.telefono).toBe(
      "No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593.",
    );
    const valid = validateEnrollFields("personal", {
      ...initialFormData,
      nombres: "Juan",
      apellidos: "Pérez",
      fechaNacimiento: "2000-01-15",
      cedula: "1798765432",
      telefono: "991234567",
      correo: "juan@example.com",
      contrasenia: "password8",
      contraseniaConfirmacion: "password8",
    });
    expect(valid.telefono).toBeUndefined();
  });
});
