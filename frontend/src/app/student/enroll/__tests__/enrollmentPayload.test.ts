import { describe, expect, it } from "vitest";
import { BLOOD_TYPES } from "@/types/enrollment";
import { buildEnrollmentRequest, getEnrollmentErrorMessage, initialFormData, type EnrollFormData } from "../enroll-utils";

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
    expect(getEnrollmentErrorMessage({ status: 400, message: "Ya existe una persona con la cedula 1712345678" }))
      .toBe("Ya existe una persona con la cedula 1712345678");
  });

  it("falls back to generic message for 400 without message", () => {
    expect(getEnrollmentErrorMessage({ status: 400 }))
      .toBe("No se pudo validar la inscripción. Revise sus datos e intente nuevamente.");
  });

  it("returns rate-limit message for 429", () => {
    expect(getEnrollmentErrorMessage({ status: 429 }))
      .toBe("Ha realizado demasiados intentos. Espere un momento antes de continuar.");
  });

  it("returns generic fallback for unknown errors", () => {
    expect(getEnrollmentErrorMessage(new Error("database secret")))
      .toBe("No se pudo completar la inscripción. Intente nuevamente más tarde.");
  });
});
