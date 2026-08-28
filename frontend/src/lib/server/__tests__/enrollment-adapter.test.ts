/**
 * Issue #643 — what the enrollment adapter puts on the wire for the two
 * emergency fields.
 *
 * The adapter used to spread them conditionally (`...(x ? { k: x } : {})`), so
 * a blank emergency phone was OMITTED rather than sent. That is not a harmless
 * optimisation: `EnrollmentFichaMedicaDTO.telefono_emergencia` is ALREADY
 * required on the current backend, so omitting turns "you typed a blank phone"
 * into "field missing" — a different Pydantic error about a different problem,
 * and the one a person reads is the wrong one.
 *
 * These tests are written against TODAY's backend contract, before the backend
 * half of #643 exists. Nothing here depends on that half landing.
 */

import { describe, it, expect } from "vitest";
import { buildEnrollmentCreateDTO } from "../enrollment-adapter";
import { BLOOD_TYPES } from "@/types/enrollment";
import type { EnrollmentRequest } from "@/types/enrollment";

function request(medical: Partial<EnrollmentRequest["fichaMedica"]> = {}): EnrollmentRequest {
  return {
    alumno: {
      nombres: "Ana",
      apellidos: "Pérez",
      cedula: "1712345678",
      fechaNacimiento: "2000-01-15",
      telefono: "0991234567",
    },
    credencialesAlumno: { correo: "ana@example.com", contrasenia: "password8" },
    aceptaConsentimientos: true,
    fichaMedica: {
      tipoSangre: BLOOD_TYPES.O_POSITIVO,
      condicionesSalud: "",
      alergias: "",
      contactoEmergencia: "María Pérez",
      telefonoEmergencia: "0997654321",
      ...medical,
    },
  };
}

describe("buildEnrollmentCreateDTO — emergency fields (#643)", () => {
  it("sends the emergency phone and contact of a complete record", () => {
    const dto = buildEnrollmentCreateDTO(request());
    expect(dto.ficha_medica.telefono_emergencia).toBe("0997654321");
    expect(dto.ficha_medica.contacto_emergencia).toBe("María Pérez");
  });

  it("sends a blank emergency phone instead of dropping the key", () => {
    const dto = buildEnrollmentCreateDTO(request({ telefonoEmergencia: "" }));
    expect("telefono_emergencia" in dto.ficha_medica).toBe(true);
    expect(dto.ficha_medica.telefono_emergencia).toBe("");
  });

  it("sends a blank emergency contact instead of dropping the key", () => {
    const dto = buildEnrollmentCreateDTO(request({ contactoEmergencia: "" }));
    expect("contacto_emergencia" in dto.ficha_medica).toBe(true);
    expect(dto.ficha_medica.contacto_emergencia).toBe("");
  });

  it("leaves alergias genuinely optional — a blank one is still omitted", () => {
    // The asymmetry is the point: `alergias` is optional in the backend DTO,
    // and an omitted optional means "nothing to record". Only the two REQUIRED
    // fields must always be present so their blankness is what gets reported.
    const dto = buildEnrollmentCreateDTO(request({ alergias: "" }));
    expect("alergias" in dto.ficha_medica).toBe(false);
  });

  it("keeps splitting condicionesSalud into the optional enfermedades list", () => {
    const dto = buildEnrollmentCreateDTO(request({ condicionesSalud: "Asma, Diabetes" }));
    expect(dto.ficha_medica.enfermedades).toEqual(["Asma", "Diabetes"]);
  });

  it("sends an empty enfermedades list when no condition was declared", () => {
    expect(buildEnrollmentCreateDTO(request()).ficha_medica.enfermedades).toEqual([]);
  });
});
