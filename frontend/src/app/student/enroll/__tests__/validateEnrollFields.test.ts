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
    cedula: "1712345678",
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
    telefonoEmergencia: "0991234567",
    ...overrides,
  };
}

describe("STEP_SHORT_LABELS", () => {
  it("names every step in the wizard order", () => {
    expect(STEP_ORDER.map((step) => STEP_SHORT_LABELS[step])).toEqual([
      "Tipo",
      "Estudiante",
      "Contacto",
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
  it("adds the representante's identity to the student step for a child enrollment", () => {
    expect(fieldsForStep("personal", "child")).toContain("nombreRepresentante");
    expect(fieldsForStep("personal", "child")).toContain("cedulaRepresentante");
  });

  it("never blames a representante field on a self enrollment", () => {
    expect(fieldsForStep("personal", "self")).not.toContain("nombreRepresentante");
    expect(fieldsForStep("club", "self")).toEqual(["correo", "contrasenia"]);
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
    expect(errors.cedula).toBe("La cédula debe tener 10 dígitos.");
    expect(errors.apellidos).toBeUndefined();
  });

  it("accepts a phone typed with spaces but rejects a short one", () => {
    expect(validateEnrollFields("personal", validForm({ telefono: "0981 000 010" })).telefono)
      .toBeUndefined();
    expect(validateEnrollFields("personal", validForm({ telefono: "0981000" })).telefono)
      .toBe("El teléfono debe tener 10 dígitos.");
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

  it("validates the representante contact fields on the contact step of a child enrollment", () => {
    const errors = validateEnrollFields(
      "club",
      validForm({ enrollmentType: "child", correoRepresentante: "no-es-correo" }),
    );
    expect(errors.correoRepresentante).toBe("El correo del representante no es válido.");
  });

  it("validates the health step's blood type and emergency contact", () => {
    const errors = validateEnrollFields(
      "health",
      validForm({ tipoSangre: "", telefonoEmergencia: "123" }),
    );
    expect(errors.tipoSangre).toBe("El tipo de sangre es obligatorio.");
    expect(errors.telefonoEmergencia).toBe("El teléfono de emergencia debe tener 10 dígitos.");
  });
});

describe("isStepComplete", () => {
  it("gates a step with a missing field", () => {
    expect(isStepComplete("personal", validForm({ cedula: "" }))).toBe(false);
  });

  it("opens a step once every field on it is valid", () => {
    expect(isStepComplete("personal", validForm())).toBe(true);
    expect(isStepComplete("club", validForm())).toBe(true);
    expect(isStepComplete("health", validForm())).toBe(true);
  });

  it("never blocks the type or summary steps", () => {
    expect(isStepComplete("type", initialFormData)).toBe(true);
    expect(isStepComplete("summary", initialFormData)).toBe(true);
  });
});
