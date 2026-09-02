import { describe, expect, it } from "vitest";
import { BLOOD_TYPES } from "@/types/enrollment";
import { ApiClientError } from "@/services/api";
import { buildEnrollmentRequest, getEnrollmentErrorMessage, initialFormData, type EnrollFormData } from "../enroll-utils";

/**
 * The exact shape a failing call reaches the wizard as — every failure route in
 * `services/api.ts` throws `ApiClientError(message, status)`.
 */
function apiError(message: string, status: number, validationLoc?: string[]): ApiClientError {
  return new ApiClientError(message, status, false, undefined, undefined, validationLoc);
}

function form(overrides: Partial<EnrollFormData> = {}): EnrollFormData {
  return { ...initialFormData, nombres: " Ana ", apellidos: " Pérez ", fechaNacimiento: "2000-01-15", cedula: "1712345678", telefono: "0991234567", correo: "ana@example.com", contrasenia: "password8", tipoSangre: BLOOD_TYPES.O_POSITIVO, contactoEmergencia: "María", telefonoEmergencia: "0997654321", ...overrides };
}

describe("buildEnrollmentRequest", () => {
  it("builds the self contract with student credentials", () => {
    const request = buildEnrollmentRequest(form());
    expect(request.alumno.nombres).toBe("Ana");
    expect(request.credencialesAlumno).toEqual({ correo: "ana@example.com", contrasenia: "password8" });
    expect(request.representante).toBeUndefined();
  });

  it("builds the child contract with representative credentials", () => {
    const request = buildEnrollmentRequest(form({ enrollmentType: "child", fechaNacimiento: "2015-06-15", nombreRepresentante: "Marta", apellidosRepresentante: "Pérez", cedulaRepresentante: "0998765432", fechaNacimientoRepresentante: "1985-04-10", telefonoRepresentante: "0991234567", correoRepresentante: "marta@example.com", contraseniaRepresentante: "password8" }));
    expect(request.credencialesAlumno).toBeUndefined();
    expect(request.representante).toEqual(expect.objectContaining({ cedula: "0998765432", correo: "marta@example.com" }));
  });

  it("includes credencialesMenor when student credentials are provided for child enrollment", () => {
    const request = buildEnrollmentRequest(form({
      enrollmentType: "child", fechaNacimiento: "2015-06-15",
      correo: "lucas@example.com", contrasenia: "password8",
      nombreRepresentante: "Marta", apellidosRepresentante: "Pérez",
      cedulaRepresentante: "0998765432", fechaNacimientoRepresentante: "1985-04-10",
      telefonoRepresentante: "0991234567", correoRepresentante: "marta@example.com",
      contraseniaRepresentante: "password8",
    }));
    expect(request.credencialesMenor).toEqual({ correo: "lucas@example.com", contrasenia: "password8" });
  });

  /** Issue #876: the confirmation is strictly a UI field — it never reaches the request built for the backend. */
  it("never includes the confirmation fields in the built request", () => {
    const request = buildEnrollmentRequest(form({
      contraseniaConfirmacion: "password8",
      enrollmentType: "child", fechaNacimiento: "2015-06-15",
      correo: "lucas@example.com", contrasenia: "password8",
      nombreRepresentante: "Marta", apellidosRepresentante: "Pérez",
      cedulaRepresentante: "0998765432", fechaNacimientoRepresentante: "1985-04-10",
      telefonoRepresentante: "0991234567", correoRepresentante: "marta@example.com",
      contraseniaRepresentante: "password8", contraseniaRepresentanteConfirmacion: "password8",
    }));
    expect(JSON.stringify(request)).not.toContain("Confirmacion");
    expect(request.credencialesMenor).toEqual({ correo: "lucas@example.com", contrasenia: "password8" });
    expect(request.representante).not.toHaveProperty("contraseniaRepresentanteConfirmacion");
  });

  it("omits credencialesMenor when student credentials are empty for child enrollment", () => {
    const request = buildEnrollmentRequest(form({
      enrollmentType: "child", fechaNacimiento: "2015-06-15",
      correo: "", contrasenia: "",
      nombreRepresentante: "Marta", apellidosRepresentante: "Pérez",
      cedulaRepresentante: "0998765432", fechaNacimientoRepresentante: "1985-04-10",
      telefonoRepresentante: "0991234567", correoRepresentante: "marta@example.com",
      contraseniaRepresentante: "password8",
    }));
    expect(request.credencialesMenor).toBeUndefined();
  });
});

describe("getEnrollmentErrorMessage", () => {
  it("surfaces backend message for 400 when present", () => {
    expect(getEnrollmentErrorMessage(apiError("Ya existe una persona con la cedula 1712345678", 400)))
      .toBe("Ya existe una persona con la cedula 1712345678");
  });

  it("names the email field for an identifiable backend 422", () => {
    const error = apiError("No se pudo completar la inscripción.", 422, ["body", "credenciales_alumno", "correo"]);
    expect(getEnrollmentErrorMessage(error)).toBe("Revise el correo electrónico e intente nuevamente.");
  });

  it("names the representative email field for an identifiable backend 422", () => {
    const error = apiError("No se pudo completar la inscripción.", 422, ["body", "representante", "correo"]);
    expect(getEnrollmentErrorMessage(error)).toBe("Revise el correo electrónico del representante e intente nuevamente.");
  });

  it("falls back to generic message for an unidentifiable 422", () => {
    expect(getEnrollmentErrorMessage(apiError("", 422)))
      .toBe("No se pudo validar la inscripción. Revise sus datos e intente nuevamente.");
  });

  it("returns the one rate-limit sentence for 429", () => {
    // POST /inscripciones is rate-limited on the public form. The wording is
    // the translator's: this screen no longer keeps a private variant of it.
    expect(getEnrollmentErrorMessage(apiError("", 429)))
      .toBe("Demasiados intentos. Espere un momento e intente nuevamente.");
  });

  it("reports the connection when fetch never reached the backend", () => {
    // Every failure route in services/api.ts throws ApiClientError(message,
    // status), so the only status-less error this catch can see is fetch
    // itself rejecting — and its message is the browser's, not the product's.
    expect(getEnrollmentErrorMessage(new TypeError("Failed to fetch")))
      .toBe("No pudimos conectar. Revise su conexión a internet e intente nuevamente.");
  });
});
