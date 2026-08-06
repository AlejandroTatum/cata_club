/**
 * Unit tests for the add-dependent wizard's pure utility functions.
 *
 * Pure functions — no React dependencies, easy to test.
 * Covers every wizard step, valid/invalid states, edge cases, and the
 * camelCase → payload assembly matching `RepresentadoCreateDTO`.
 */

import { describe, it, expect } from "vitest";
import { ApiClientError } from "@/services/api";
import {
  validateAddDependentStep,
  validateAddDependentForm,
  buildRepresentadoPayload,
  getAddDependentErrorMessage,
  initialAddDependentFormData,
  type AddDependentFormData,
} from "../add-dependent-utils";

/**
 * The exact shape a failing call reaches the wizard as. Every failure route in
 * `services/api.ts` throws `ApiClientError(message, status)`, so an error
 * carrying a `message` and no `status` is a shape the client cannot produce.
 */
function apiError(message: string, status: number): ApiClientError {
  return new ApiClientError(message, status);
}

/** Build a valid-enough form data, with overrides. */
function validForm(overrides: Partial<AddDependentFormData> = {}): AddDependentFormData {
  return {
    ...initialAddDependentFormData,
    nombres: "Juan",
    apellidos: "Pérez",
    fechaNacimiento: "2015-06-15",
    cedula: "1712345678",
    telefono: "0991234567",
    tipoSangre: "O_POSITIVO",
    enfermedades: "",
    alergias: "",
    contactoEmergencia: "María Pérez",
    telefonoEmergencia: "0997654321",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Step: child
// ---------------------------------------------------------------------------

describe("validateAddDependentStep — child step", () => {
  it("returns no errors when all required fields are filled", () => {
    expect(validateAddDependentStep("child", validForm())).toEqual([]);
  });

  it("requires nombres", () => {
    expect(validateAddDependentStep("child", validForm({ nombres: "" })))
      .toContain("Los nombres son obligatorios.");
  });

  it("requires nombres (whitespace only)", () => {
    expect(validateAddDependentStep("child", validForm({ nombres: "   " })))
      .toContain("Los nombres son obligatorios.");
  });

  it("requires apellidos", () => {
    expect(validateAddDependentStep("child", validForm({ apellidos: "" })))
      .toContain("Los apellidos son obligatorios.");
  });

  it("requires fechaNacimiento", () => {
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: "" })))
      .toContain("La fecha de nacimiento es obligatoria.");
  });

  it("rejects a malformed fechaNacimiento", () => {
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: "2015-13-40" })))
      .toContain("La fecha de nacimiento ingresada no es válida.");
  });

  it("rejects a fechaNacimiento in the future", () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: `${nextYear}-01-01` })))
      .toContain("La fecha de nacimiento no puede ser en el futuro.");
  });

  it("accepts today as a valid fechaNacimiento (not future)", () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: iso })))
      .not.toContain("La fecha de nacimiento no puede ser en el futuro.");
  });

  it("requires cedula", () => {
    expect(validateAddDependentStep("child", validForm({ cedula: "" })))
      .toContain("La cédula de identidad es obligatoria.");
  });

  it("validates cedula has exactly 10 digits", () => {
    expect(validateAddDependentStep("child", validForm({ cedula: "12345" })))
      .toContain("La cédula debe tener 10 dígitos.");
  });

  it("validates cedula with non-digit characters", () => {
    expect(validateAddDependentStep("child", validForm({ cedula: "1712abcd78" })))
      .toContain("La cédula debe tener 10 dígitos.");
  });

  it("requires telefono", () => {
    expect(validateAddDependentStep("child", validForm({ telefono: "" })))
      .toContain("El teléfono es obligatorio.");
  });

  it("reports multiple errors at once", () => {
    const errors = validateAddDependentStep(
      "child",
      validForm({ nombres: "", apellidos: "", fechaNacimiento: "", cedula: "" }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Step: health
// ---------------------------------------------------------------------------

describe("validateAddDependentStep — health step", () => {
  it("returns no errors when all required fields are filled", () => {
    expect(validateAddDependentStep("health", validForm())).toEqual([]);
  });

  it("requires a valid tipoSangre", () => {
    expect(validateAddDependentStep("health", validForm({ tipoSangre: "" })))
      .toContain("El tipo de sangre es obligatorio.");
  });

  it("rejects an invalid tipoSangre value", () => {
    expect(
      validateAddDependentStep("health", validForm({ tipoSangre: "NOT_A_BLOOD_TYPE" as never })),
    ).toContain("El tipo de sangre es obligatorio.");
  });

  it("requires contactoEmergencia", () => {
    expect(validateAddDependentStep("health", validForm({ contactoEmergencia: "" })))
      .toContain("El nombre de contacto de emergencia es obligatorio.");
  });

  it("requires telefonoEmergencia", () => {
    expect(validateAddDependentStep("health", validForm({ telefonoEmergencia: "" })))
      .toContain("El teléfono de emergencia es obligatorio.");
  });

  it("enfermedades and alergias are optional", () => {
    expect(validateAddDependentStep("health", validForm({ enfermedades: "", alergias: "" })))
      .toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step: summary
// ---------------------------------------------------------------------------

describe("validateAddDependentStep — summary step", () => {
  it("always returns no errors for summary", () => {
    expect(validateAddDependentStep("summary", validForm())).toEqual([]);
  });

  it("summary is valid even with empty data (review step)", () => {
    expect(validateAddDependentStep("summary", initialAddDependentFormData)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateAddDependentForm (whole-form validation)
// ---------------------------------------------------------------------------

describe("validateAddDependentForm", () => {
  it("returns no errors for a fully valid form", () => {
    expect(validateAddDependentForm(validForm())).toEqual([]);
  });

  it("combines errors from both child and health steps", () => {
    const errors = validateAddDependentForm(
      validForm({ nombres: "", tipoSangre: "" }),
    );
    expect(errors).toContain("Los nombres son obligatorios.");
    expect(errors).toContain("El tipo de sangre es obligatorio.");
  });
});

// ---------------------------------------------------------------------------
// buildRepresentadoPayload
// ---------------------------------------------------------------------------

describe("buildRepresentadoPayload", () => {
  it("builds a payload matching RepresentadoCreateDTO's camelCase shape", () => {
    const payload = buildRepresentadoPayload(validForm());
    expect(payload).toEqual({
      nombres: "Juan",
      apellidos: "Pérez",
      cedula: "1712345678",
      fechaNacimiento: "2015-06-15",
      telefono: "0991234567",
      fichaMedica: {
        tipoSangre: "O_POSITIVO",
        enfermedades: [],
        contactoEmergencia: "María Pérez",
        telefonoEmergencia: "0997654321",
      },
    });
  });

  it("trims whitespace from text fields", () => {
    const payload = buildRepresentadoPayload(
      validForm({ nombres: "  Ana  ", apellidos: "  Ruiz  ", cedula: " 1712345678 ", telefono: " 0991234567 " }),
    );
    expect(payload.nombres).toBe("Ana");
    expect(payload.apellidos).toBe("Ruiz");
    expect(payload.cedula).toBe("1712345678");
    expect(payload.telefono).toBe("0991234567");
  });

  it("parses comma-separated enfermedades into a trimmed string array", () => {
    const payload = buildRepresentadoPayload(
      validForm({ enfermedades: "Asma, Diabetes ,  , Alergia al polen" }),
    );
    expect(payload.fichaMedica?.enfermedades).toEqual(["Asma", "Diabetes", "Alergia al polen"]);
  });

  it("omits alergias/contactoEmergencia/telefonoEmergencia when blank", () => {
    const payload = buildRepresentadoPayload(
      validForm({ alergias: "", contactoEmergencia: "", telefonoEmergencia: "" }),
    );
    expect(payload.fichaMedica).not.toHaveProperty("alergias");
    expect(payload.fichaMedica).not.toHaveProperty("contactoEmergencia");
    expect(payload.fichaMedica).not.toHaveProperty("telefonoEmergencia");
  });

  it("includes alergias when present", () => {
    const payload = buildRepresentadoPayload(validForm({ alergias: "  Penicilina  " }));
    expect(payload.fichaMedica?.alergias).toBe("Penicilina");
  });
});

// ---------------------------------------------------------------------------
// getAddDependentErrorMessage
// ---------------------------------------------------------------------------

describe("getAddDependentErrorMessage", () => {
  it("surfaces the backend's own message for a 400 business-rule violation (e.g. duplicate cédula)", () => {
    // 400 = EntidadDuplicada/OperacionInvalida in the backend — always a
    // single, hand-authored, user-facing Spanish string (see backend's
    // main.py _respuesta_error), safe to show as-is instead of a generic
    // message that hides which field was actually wrong.
    expect(
      getAddDependentErrorMessage(apiError("Ya existe una persona con la cédula 1712345678", 400)),
    ).toBe("Ya existe una persona con la cédula 1712345678");
  });

  it("falls back to a generic message for a 400 with no usable message", () => {
    expect(getAddDependentErrorMessage(apiError("", 400)))
      .toBe("No se pudo agregar el dependiente. Revise los datos ingresados e intente nuevamente.");
  });

  it("uses a generic message for 422 — raw pydantic validation errors aren't a single safe string", () => {
    expect(getAddDependentErrorMessage(apiError("[{...raw pydantic errors...}]", 422)))
      .toBe("No se pudo agregar el dependiente. Revise los datos ingresados e intente nuevamente.");
  });

  it("maps 403 to the one permissions sentence the product uses everywhere", () => {
    // POST /representados refuses a caller whose session is valid but whose
    // role is not allowed to add a dependent. The wording is the translator's,
    // not this screen's: a per-screen variant of "no tiene permisos" was one of
    // the 28 independent decisions the single translator exists to end.
    expect(getAddDependentErrorMessage(apiError("", 403)))
      .toBe("No tiene permisos para realizar esta acción.");
  });

  it("reports the connection, not the raw failure, when fetch never reached the backend", () => {
    // The only status-less error a call site can actually see: every failure
    // route in services/api.ts throws ApiClientError(message, status), so a
    // bare Error can only come from fetch itself rejecting.
    expect(getAddDependentErrorMessage(new TypeError("Failed to fetch")))
      .toBe("No pudimos conectar con el servidor. Revise su conexión e intente nuevamente.");
  });
});
