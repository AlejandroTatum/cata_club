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
  describeStepBlocker,
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
