/**
 * Unit tests for the wizard's per-field validation layer — the one that puts
 * the message beside the field and decides whether "Siguiente" may be enabled.
 */

import { describe, it, expect } from "vitest";
import {
  digitsOf,
  fieldsForStep,
  initialFormData,
  isStepComplete,
  validateEnrollFields,
  STEP_SHORT_LABELS,
  STEP_ORDER,
  type EnrollFormData,
} from "../enroll-utils";
import { BLOOD_TYPES } from "@/types/enrollment";

function validForm(overrides: Partial<EnrollFormData> = {}): EnrollFormData {
  return {
    ...initialFormData,
    nombres: "Juan",
    apellidos: "Pérez",
    fechaNacimiento: "2000-01-15",
    cedula: "1798765432",
    telefono: "0991234567",
    correo: "juan@example.com",
    contrasenia: "password8",
    nombreRepresentante: "María",
    apellidosRepresentante: "Rodríguez",
    cedulaRepresentante: "0998765432",
    fechaNacimientoRepresentante: "1980-01-15",
    telefonoRepresentante: "0991234567",
    correoRepresentante: "maria@example.com",
    contraseniaRepresentante: "password8",
    tipoSangre: BLOOD_TYPES.O_POSITIVO,
    contactoEmergencia: "María Pérez",
    // Issue #860: has to differ from `telefono` above — see the same note in
    // validateEnrollStep.test.ts's `validForm`.
    telefonoEmergencia: "0987654321",
    ...overrides,
  };
}

describe("STEP_SHORT_LABELS", () => {
  it("names every step in the wizard order", () => {
    expect(STEP_ORDER.map((step) => STEP_SHORT_LABELS[step])).toEqual([
      "Tipo",
      "Estudiante",
      "Representante",
      "Salud",
      "Confirmar",
    ]);
  });
});

describe("digitsOf", () => {
  it("keeps only digits so a spaced phone still counts", () => {
    expect(digitsOf("0981 000 010")).toBe("0981000010");
    expect(digitsOf("099-123-4567")).toBe("0991234567");
    expect(digitsOf("")).toBe("");
  });
});

describe("fieldsForStep", () => {
  it("puts every representante field on the representante step of a child enrollment", () => {
    expect(fieldsForStep("representative", "child")).toContain("nombreRepresentante");
    expect(fieldsForStep("representative", "child")).toContain("cedulaRepresentante");
    expect(fieldsForStep("personal", "child")).not.toContain("nombreRepresentante");
  });

  it("never blames a representante field on a self enrollment", () => {
    expect(fieldsForStep("personal", "self")).not.toContain("nombreRepresentante");
    // A self enrollment signs in as the student, so its credentials belong to
    // the student step; the representante step is skipped entirely.
    expect(fieldsForStep("personal", "self")).toContain("correo");
    expect(fieldsForStep("personal", "self")).toContain("contrasenia");
    expect(fieldsForStep("representative", "self")).toEqual([]);
  });

  it("has nothing to validate on the type and summary steps", () => {
    expect(fieldsForStep("type", "self")).toEqual([]);
    expect(fieldsForStep("summary", "child")).toEqual([]);
  });
});

describe("validateEnrollFields", () => {
  it("returns nothing for a complete step", () => {
    expect(validateEnrollFields("personal", validForm())).toEqual({});
  });

  it("keys each message to the field that owns it", () => {
    const errors = validateEnrollFields("personal", validForm({ nombres: "", cedula: "13100456" }));
    expect(errors.nombres).toBe("Los nombres son obligatorios.");
    expect(errors.cedula).toBe("La cédula de identidad debe tener 10 dígitos.");
    expect(errors.apellidos).toBeUndefined();
  });

  it("accepts a phone typed with spaces but rejects a short one", () => {
    expect(validateEnrollFields("personal", validForm({ telefono: "0981 000 010" })).telefono)
      .toBeUndefined();
    expect(validateEnrollFields("personal", validForm({ telefono: "09810" })).telefono)
      .toBe(
        "El teléfono debe ser un celular (09 y 8 dígitos más) o un fijo (0, código de área y 7 dígitos, 9 en total).",
      );
  });

  it("blames the birth date for the minors rule on a self enrollment", () => {
    const errors = validateEnrollFields(
      "personal",
      validForm({ enrollmentType: "self", fechaNacimiento: "2015-06-15" }),
    );
    expect(errors.fechaNacimiento).toMatch(/menores de edad no pueden autoinscribirse/);
  });

  it("does not apply the minors rule to the student of a child enrollment", () => {
    const errors = validateEnrollFields(
      "personal",
      validForm({ enrollmentType: "child", fechaNacimiento: "2015-06-15" }),
    );
    expect(errors.fechaNacimiento).toBeUndefined();
  });

  it("validates the representante's contact details on the representante step", () => {
    const errors = validateEnrollFields(
      "representative",
      validForm({ enrollmentType: "child", correoRepresentante: "no-es-correo" }),
    );
    expect(errors.correoRepresentante).toBe("El correo del representante no es válido.");
  });

  it("rejects an underage representante's birth date", () => {
    const errors = validateEnrollFields(
      "representative",
      validForm({ enrollmentType: "child", fechaNacimientoRepresentante: "2015-01-15" }),
    );
    expect(errors.fechaNacimientoRepresentante).toMatch(/entre 18 y 74/);
  });

  /**
   * The fourth hole the root-cause fix closes: the representante's floor
   * (>= 18) was already checked, but never the ceiling. An implausible
   * birth year (the audited pattern: 1800) used to pass here in total
   * silence — `calculateAge` returned NaN for it, and `NaN >= 18` is
   * `false`, so the OLD code read that as "not a valid adult" only by
   * accident of the floor check failing too. Once `calculateAge` stopped
   * capping its own output (see its docstring), the missing ceiling became
   * a plain, visible gap instead of hiding behind a coincidence.
   */
  it("rejects an implausibly old representante birth date instead of letting it through", () => {
    const errors = validateEnrollFields(
      "representative",
      validForm({ enrollmentType: "child", fechaNacimientoRepresentante: "1800-01-15" }),
    );
    expect(errors.fechaNacimientoRepresentante).toMatch(/entre 18 y 74 años \(calculado: \d+\)/);
  });

  it("validates the health step's blood type and emergency contact", () => {
    const errors = validateEnrollFields(
      "health",
      validForm({ tipoSangre: "", telefonoEmergencia: "123" }),
    );
    expect(errors.tipoSangre).toBe("El tipo de sangre es obligatorio.");
    expect(errors.telefonoEmergencia).toBe(
      "El teléfono de emergencia debe ser un celular (09 y 8 dígitos más) o un fijo (0, código de área y 7 dígitos, 9 en total).",
    );
  });

  /**
   * Issue #643. `DESCONOCIDO` used to pass this gate because `isBloodType`
   * asked "is it in the enum?", and the enum still contains it for the sake
   * of legacy rows. A record being CREATED here is a complete one, so "No lo
   * sé" is not an answer — it is the absence of one wearing a valid value's
   * clothes.
   */
  it("rejects DESCONOCIDO as if the blood type had been left blank", () => {
    const errors = validateEnrollFields("health", validForm({ tipoSangre: BLOOD_TYPES.DESCONOCIDO }));
    expect(errors.tipoSangre).toBe("El tipo de sangre es obligatorio.");
  });

  it("leaves the optional medical details optional", () => {
    // Alergias and condicionesSalud are not health-step gates and never were;
    // #643 must not quietly promote them while tightening the two that matter.
    const errors = validateEnrollFields("health", validForm({ alergias: "", condicionesSalud: "" }));
    expect(errors.tipoSangre).toBeUndefined();
    expect(errors.telefonoEmergencia).toBeUndefined();
    expect(errors.alergias).toBeUndefined();
    expect(errors.condicionesSalud).toBeUndefined();
  });

  /**
   * Issue #860: the emergency phone must differ from the student's own —
   * otherwise the contact of emergency cannot reach anyone the student
   * cannot reach themselves. The message lands on `telefonoEmergencia`,
   * the field the visitor is actually looking at.
   */
  describe("telefonoEmergencia must differ from telefono (#860)", () => {
    it("rejects the same number, keyed to telefonoEmergencia", () => {
      const errors = validateEnrollFields(
        "health",
        validForm({ telefono: "0991234567", telefonoEmergencia: "0991234567" }),
      );
      expect(errors.telefonoEmergencia).toBe(
        "El teléfono de emergencia debe ser diferente del teléfono del estudiante.",
      );
    });

    it.each([
      ["the +593 form of the same number", "0991234567", "+593991234567"],
      ["the 593 form of the same number (no plus sign)", "0991234567", "593991234567"],
    ])("rejects %s as equivalent to the student's own", (_description, telefono, telefonoEmergencia) => {
      const errors = validateEnrollFields("health", validForm({ telefono, telefonoEmergencia }));
      expect(errors.telefonoEmergencia).toBe(
        "El teléfono de emergencia debe ser diferente del teléfono del estudiante.",
      );
    });

    it("accepts a different valid emergency phone", () => {
      const errors = validateEnrollFields(
        "health",
        validForm({ telefono: "0991234567", telefonoEmergencia: "0987654321" }),
      );
      expect(errors.telefonoEmergencia).toBeUndefined();
    });

    it("still reports a malformed number first, even when it happens to differ from telefono", () => {
      // `phoneRule` is chained BEFORE this rule: a malformed value never
      // reaches the equality check.
      const errors = validateEnrollFields(
        "health",
        validForm({ telefono: "0991234567", telefonoEmergencia: "123" }),
      );
      expect(errors.telefonoEmergencia).toMatch(/celular.*fijo/);
    });
  });
});

describe("isStepComplete", () => {
  it("gates a step with a missing field", () => {
    expect(isStepComplete("personal", validForm({ cedula: "" }))).toBe(false);
  });

  it("opens a step once every field on it is valid", () => {
    expect(isStepComplete("personal", validForm())).toBe(true);
    expect(isStepComplete("representative", validForm({ enrollmentType: "child" }))).toBe(true);
    expect(isStepComplete("health", validForm())).toBe(true);
  });

  it("never blocks the type or summary steps", () => {
    expect(isStepComplete("type", initialFormData)).toBe(true);
    expect(isStepComplete("summary", initialFormData)).toBe(true);
  });

  /**
   * Root-cause fix for #226: `validateOptionalStudentCredentials` used to run
   * only from `validateEnrollStep` (on click), never from the field-level
   * rules that gate "Siguiente" — so the button stayed enabled with half-filled
   * optional credentials and only failed once clicked. `validateEnrollFields`
   * now applies the same both-or-neither rule the personal step's flat
   * validation already enforced.
   */
  it("blocks a child enrollment's personal step when the optional student account is half-filled (#226)", () => {
    const halfFilled = validForm({
      enrollmentType: "child",
      correo: "lucas@example.com",
      contrasenia: "",
    });
    expect(isStepComplete("personal", halfFilled)).toBe(false);
    expect(validateEnrollFields("personal", halfFilled).contrasenia).toBe(
      "La contraseña del estudiante es obligatoria si se desea crear una cuenta.",
    );
  });
});
