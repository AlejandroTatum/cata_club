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
  validateDependentPayment,
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
describe("dependent payment validation", () => {
  const voucher = new File(["ok"], "receipt.png", { type: "image/png" });

  it("requires a valid plan and payment period", () => {
    expect(validateDependentPayment("", 1, "EFECTIVO", null)).toContain("Selecciona un plan.");
    expect(validateDependentPayment("2", 0, "EFECTIVO", null)).toContain("Selecciona entre 1 y 12 meses.");
  });

  it("requires a valid voucher only for transfers", () => {
    expect(validateDependentPayment("2", 1, "EFECTIVO", null)).toEqual([]);
    expect(validateDependentPayment("2", 1, "TRANSFERENCIA", null)).toContain("Adjunta el comprobante de transferencia.");
    expect(validateDependentPayment("2", 1, "TRANSFERENCIA", voucher)).toEqual([]);
    expect(validateDependentPayment("2", 1, "TRANSFERENCIA", new File(["x"], "a.txt", { type: "text/plain" }))).toHaveLength(1);
  });
});

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
    cedula: "1798765432",
    tipoSangre: "O_POSITIVO",
    enfermedades: "Ninguno",
    alergias: "Ninguno",
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
      .toContainEqual(expect.stringMatching(/^Indica la fecha de nacimiento del jugador\.$/));
  });

  it("rejects a malformed fechaNacimiento", () => {
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: "2015-13-40" })))
      .toContainEqual(expect.stringMatching(/^La fecha de nacimiento no existe\. Revisa el día, el mes y el año\.$/));
  });

  it("rejects a fechaNacimiento in the future", () => {
    const nextYear = new Date().getFullYear() + 1;
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: `${nextYear}-01-01` })))
      .toContainEqual(expect.stringMatching(/^La fecha de nacimiento no puede ser posterior a hoy\. Revisa el año\.$/));
  });

  it("accepts today as a valid fechaNacimiento (not future)", () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(validateAddDependentStep("child", validForm({ fechaNacimiento: iso })))
      .not.toContainEqual(expect.stringMatching(/^La fecha de nacimiento no puede ser posterior a hoy\. Revisa el año\.$/));
  });

  it("rejects an impossible age on step 1 instead of letting the wizard reach the backend (INS-8)", () => {
    // The audited case: a typo'd year (1800) computes a 226-year-old and
    // used to sail through all four steps before the backend's 400 threw it
    // out, losing everything the person had already typed.
    const errors = validateAddDependentStep("child", validForm({ fechaNacimiento: "1800-01-01" }));
    expect(errors.some((message) => message.includes("debe estar entre 3 y 95 años"))).toBe(true);
  });

  it("rejects a fechaNacimiento below the minimum domain age (EDAD_MINIMA_ALUMNO = 3)", () => {
    const today = new Date();
    const twoYearsAgo = `${today.getFullYear() - 2}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const errors = validateAddDependentStep("child", validForm({ fechaNacimiento: twoYearsAgo }));
    expect(errors.some((message) => message.includes("debe estar entre 3 y 95 años"))).toBe(true);
  });

  it("requires cedula", () => {
    expect(validateAddDependentStep("child", validForm({ cedula: "" })))
      .toContain("La cédula de identidad es obligatoria.");
  });

  it("validates cedula has exactly 10 digits", () => {
    expect(validateAddDependentStep("child", validForm({ cedula: "12345" })))
      .toContain("La cédula de identidad debe tener 10 dígitos.");
  });

  it("validates cedula with non-digit characters", () => {
    expect(validateAddDependentStep("child", validForm({ cedula: "1712abcd78" })))
      .toContain("La cédula de identidad debe tener 10 dígitos.");
  });

  /**
   * A represented minor has no phone of their own (issue #1197, same rule
   * the public wizard's child branch applies): the field no longer exists
   * on this form, so no phone rule can ever block the step.
   */
  it("has no telefono field at all — a represented minor has no phone of their own", () => {
    expect("telefono" in initialAddDependentFormData).toBe(false);
    expect(validateAddDependentStep("child", validForm())).toEqual([]);
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

  /**
   * Issue #643: `DESCONOCIDO` is in the enum for the sake of rows written
   * before the rule existed, so the old "is it in the enum?" check waved it
   * through. A dependent being registered here gets a complete record.
   */
  it("rejects DESCONOCIDO as if the blood type had been left blank", () => {
    expect(
      validateAddDependentStep("health", validForm({ tipoSangre: "DESCONOCIDO" })),
    ).toContain("El tipo de sangre es obligatorio.");
  });

  // Issue #1574: both are required; «Ninguno» is the answer for "none".
  it("requires alergias and enfermedades, naming «Ninguno» as the way out", () => {
    const errors = validateAddDependentStep("health", validForm({ alergias: " ", enfermedades: "" }));
    expect(errors).toContain('Escribe tus alergias o "Ninguno" si no tienes.');
    expect(errors).toContain('Escribe tus enfermedades o "Ninguno" si no tienes.');
  });

  it("accepts «Ninguno» for both", () => {
    expect(
      validateAddDependentStep("health", validForm({ alergias: "Ninguno", enfermedades: "Ninguno" })),
    ).toEqual([]);
  });

  /**
   * Issue #1138: a dependent created through this endpoint is always a
   * represented minor — no emergency-contact fields exist on the health
   * step. `tipoSangre` alone must be enough for the step to be valid.
   */
  it("does not require an emergency contact — it no longer exists as a field", () => {
    expect("contactoEmergencia" in initialAddDependentFormData).toBe(false);
    expect("telefonoEmergencia" in initialAddDependentFormData).toBe(false);
    expect(validateAddDependentStep("health", validForm())).toEqual([]);
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
      cedula: "1798765432",
      fechaNacimiento: "2015-06-15",
      fichaMedica: {
        tipoSangre: "O_POSITIVO",
        enfermedades: ["Ninguno"],
        alergias: "Ninguno",
      },
    });
  });

  /**
   * Omitting the key — not sending `""` or a placeholder — is how the
   * payload says "no phone": the BFF forwards only present keys and the
   * backend's `RepresentadoCreateDTO.telefono` defaults to NULL.
   */
  it("never includes telefono — the payload's way to say the minor has none", () => {
    const payload = buildRepresentadoPayload(validForm());
    expect(payload).not.toHaveProperty("telefono");
  });

  it("trims whitespace from text fields", () => {
    const payload = buildRepresentadoPayload(
      validForm({ nombres: "  Ana  ", apellidos: "  Ruiz  ", cedula: " 1712345678 " }),
    );
    expect(payload.nombres).toBe("Ana");
    expect(payload.apellidos).toBe("Ruiz");
    expect(payload.cedula).toBe("1712345678");
  });

  it("parses comma-separated enfermedades into a trimmed string array", () => {
    const payload = buildRepresentadoPayload(
      validForm({ enfermedades: "Asma, Diabetes ,  , Alergia al polen" }),
    );
    expect(payload.fichaMedica?.enfermedades).toEqual(["Asma", "Diabetes", "Alergia al polen"]);
  });

  it("includes alergias when present", () => {
    const payload = buildRepresentadoPayload(validForm({ alergias: "  Penicilina  " }));
    expect(payload.fichaMedica?.alergias).toBe("Penicilina");
  });

  /** Issue #1138: never build a payload carrying the removed fields. */
  it("never includes contactoEmergencia/telefonoEmergencia — the backend rejects them (422)", () => {
    const payload = buildRepresentadoPayload(validForm());
    expect(payload.fichaMedica).not.toHaveProperty("contactoEmergencia");
    expect(payload.fichaMedica).not.toHaveProperty("telefonoEmergencia");
  });

  /**
   * Issue #1246: an iOS/macOS keyboard (or text pasted from WhatsApp or
   * Contacts) can emit "ñ" in decomposed form (NFD) — the payload sent to
   * the backend must carry the canonical NFC form regardless.
   */
  it("normalizes an NFD dependent name to NFC in the built payload", () => {
    const payload = buildRepresentadoPayload(
      validForm({ nombres: "José".normalize("NFD"), apellidos: "Muñoz".normalize("NFD") }),
    );
    expect(payload.nombres).toBe("José");
    expect(payload.apellidos).toBe("Muñoz");
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
      .toBe("No se pudo agregar el jugador. Revisa los datos ingresados e intenta nuevamente.");
  });

  it("uses a generic message for 422 — raw pydantic validation errors aren't a single safe string", () => {
    expect(getAddDependentErrorMessage(apiError("[{...raw pydantic errors...}]", 422)))
      .toBe("No se pudo agregar el jugador. Revisa los datos ingresados e intenta nuevamente.");
  });

  it("maps 403 to the one permissions sentence the product uses everywhere", () => {
    // POST /representados refuses a caller whose session is valid but whose
    // role is not allowed to add a dependent. The wording is the translator's,
    // not this screen's: a per-screen variant of "no tiene permisos" was one of
    // the 28 independent decisions the single translator exists to end.
    expect(getAddDependentErrorMessage(apiError("", 403)))
      .toBe("No tienes permisos para realizar esta acción.");
  });

  it("reports the connection, not the raw failure, when fetch never reached the backend", () => {
    // The only status-less error a call site can actually see: every failure
    // route in services/api.ts throws ApiClientError(message, status), so a
    // bare Error can only come from fetch itself rejecting.
    expect(getAddDependentErrorMessage(new TypeError("Failed to fetch")))
      .toMatch(/^No pudimos conectar\. Revisa tu conexión a internet e intenta nuevamente\.$/);
  });
});
