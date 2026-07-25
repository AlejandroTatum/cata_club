/**
 * Translates the wizard's `EnrollmentRequest` (camelCase, see
 * src/types/enrollment.ts) into the backend's `EnrollmentCreateDTO` (snake_case,
 * see backend app/presentacion/schemas/enrollment_schemas.py) and the
 * backend's `EnrollmentResponseDTO` back into a runtime-checked shape —
 * server-only, used by src/app/api/enrollment/route.ts. Follows the same
 * adapter pattern as payments-adapter.ts/attendance-adapter.ts/members-adapter.ts.
 *
 * Note on request DTOs vs response DTOs: unlike FastAPI's response models
 * (which run through ResponseBase's snake_case->camelCase alias_generator —
 * see backend base.py), request bodies are plain Pydantic models with no
 * alias_generator, so the backend expects snake_case exactly as declared.
 */

import type { BloodType, EnrollmentMedicalRecord, EnrollmentRequest } from "@/types/enrollment";

// ---------------------------------------------------------------------------
// Backend request DTO (mirrors EnrollmentCreateDTO)
// ---------------------------------------------------------------------------

export interface BackendEnrollmentAlumno {
  nombres: string;
  apellidos: string;
  cedula: string;
  fecha_nacimiento: string;
  telefono: string;
  /** Optional: when provided (child enrollment), a Usuario + ALUMNO is also created. */
  correo?: string;
  contrasenia?: string;
  institucion_id?: number;
}

export interface BackendEnrollmentRepresentante extends BackendEnrollmentAlumno {
  correo: string;
  contrasenia: string;
}

export interface BackendEnrollmentCredenciales {
  correo: string;
  contrasenia: string;
}

export interface BackendEnrollmentFichaMedica {
  tipo_sangre: BloodType;
  enfermedades: string[];
  alergias?: string;
  contacto_emergencia?: string;
  telefono_emergencia?: string;
}

export interface BackendEnrollmentCreateDTO {
  alumno: BackendEnrollmentAlumno;
  representante?: BackendEnrollmentRepresentante;
  credenciales_alumno?: BackendEnrollmentCredenciales;
  ficha_medica: BackendEnrollmentFichaMedica;
  // `antecedentes` is intentionally omitted: EnrollFormData has no
  // nivel_tecnico_alumno/mano_dominante/fecha_inicio_club fields — the
  // backend's own docstring says the trainer assigns these after enrollment.
}

/**
 * `EnrollmentFichaMedicaDTO` has no free-text notes field — only a
 * structured `enfermedades` list and a bounded `alergias` string.
 * `condicionesSalud` (a free-text textarea in the wizard) is split on commas
 * into discrete entries to fit `enfermedades`. `observaciones` has no
 * backend destination at all; it is intentionally dropped rather than
 * stuffed into an unrelated field.
 */
function buildFichaMedica(fichaMedica: EnrollmentMedicalRecord): BackendEnrollmentFichaMedica {
  const enfermedades = fichaMedica.condicionesSalud
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return {
    tipo_sangre: fichaMedica.tipoSangre,
    enfermedades,
    ...(fichaMedica.alergias ? { alergias: fichaMedica.alergias } : {}),
    ...(fichaMedica.contactoEmergencia ? { contacto_emergencia: fichaMedica.contactoEmergencia } : {}),
    ...(fichaMedica.telefonoEmergencia ? { telefono_emergencia: fichaMedica.telefonoEmergencia } : {}),
  };
}

export function buildEnrollmentCreateDTO(data: EnrollmentRequest): BackendEnrollmentCreateDTO {
  return {
    alumno: {
      nombres: data.alumno.nombres,
      apellidos: data.alumno.apellidos,
      cedula: data.alumno.cedula,
      fecha_nacimiento: data.alumno.fechaNacimiento,
      telefono: data.alumno.telefono,
      ...(data.alumno.institucionId ? { institucion_id: data.alumno.institucionId } : {}),
      ...(data.credencialesMenor
        ? { correo: data.credencialesMenor.correo, contrasenia: data.credencialesMenor.contrasenia }
        : {}),
    },
    ...(data.credencialesAlumno
      ? { credenciales_alumno: { correo: data.credencialesAlumno.correo, contrasenia: data.credencialesAlumno.contrasenia } }
      : {}),
    ...(data.representante
      ? {
          representante: {
            nombres: data.representante.nombres,
            apellidos: data.representante.apellidos,
            cedula: data.representante.cedula,
            fecha_nacimiento: data.representante.fechaNacimiento,
            telefono: data.representante.telefono,
            correo: data.representante.correo,
            contrasenia: data.representante.contrasenia,
          },
        }
      : {}),
    ficha_medica: buildFichaMedica(data.fichaMedica),
  };
}

// ---------------------------------------------------------------------------
// Backend response DTO (mirrors EnrollmentResponseDTO)
// ---------------------------------------------------------------------------

export interface BackendEnrollmentResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  persona_id: number;
}

export function isBackendEnrollmentResponse(value: unknown): value is BackendEnrollmentResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" && v.access_token.length > 0 &&
    typeof v.refresh_token === "string" && v.refresh_token.length > 0 &&
    typeof v.persona_id === "number"
  );
}
