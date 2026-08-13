import { NextResponse } from "next/server";
import { backendFetch, forwardedForFrom, setAuthCookies } from "@/lib/server/auth";
import { passthroughBackendError } from "@/lib/server/backend-client";
import { buildEnrollmentCreateDTO, isBackendEnrollmentResponse } from "@/lib/server/enrollment-adapter";
import { BLOOD_TYPES, type EnrollmentRequest, type EnrollmentResponse } from "@/types/enrollment";

type JsonRecord = Record<string, unknown>;

/**
 * POST /api/enrollment — BFF proxy to the backend's public (no auth),
 * rate-limited (3/min) `POST /enrollment/`. That endpoint creates
 * Persona+Usuario(+FichaMedica+AntecedentesClub) and returns JWTs for
 * auto-login; this route sets them as HttpOnly cookies (setAuthCookies) —
 * same pattern as src/app/api/auth/login/route.ts — and never echoes tokens
 * into the JSON body sent back to client JS.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (request.method !== "POST") {
    return NextResponse.json({ detail: "Método no permitido." }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: "JSON inválido en el cuerpo de la solicitud." }, { status: 400 });
  }

  if (!isEnrollmentRequest(body)) {
    return NextResponse.json({ detail: "Los datos de inscripción son inválidos o están incompletos." }, { status: 400 });
  }

  const result = await backendFetch(
    "/enrollment/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildEnrollmentCreateDTO(body)),
    },
    { forwardedFor: forwardedForFrom(request) },
  );

  if (!result.ok) {
    const status = result.error.code === "timeout" ? 504 : 503;
    return NextResponse.json({ detail: result.error.message }, { status });
  }

  const response = result.data;
  if (!response.ok) {
    return passthroughBackendError(response, "No se pudo completar la inscripción.");
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return NextResponse.json({ detail: "Respuesta de inscripción inválida." }, { status: 502 });
  }
  if (!isBackendEnrollmentResponse(json)) {
    return NextResponse.json({ detail: "Respuesta de inscripción con forma inesperada." }, { status: 502 });
  }

  // Only { enrolled: true } ever reaches client JS — tokens live exclusively
  // in the HttpOnly cookies set below (see isEnrollmentResponse's contract
  // in src/services/api.ts, which rejects any extra field on this response).
  const enrollmentResponse: EnrollmentResponse = { enrolled: true };
  const nextResponse = NextResponse.json(enrollmentResponse, { status: 201 });
  setAuthCookies(nextResponse, { accessToken: json.access_token, refreshToken: json.refresh_token });
  return nextResponse;
}

function isEnrollmentRequest(value: unknown): value is EnrollmentRequest {
  if (!isRecord(value) || !isStudent(value.alumno) || !isMedicalRecord(value.fichaMedica)) return false;
  if (value.credencialesMenor !== undefined && !isCredentials(value.credencialesMenor)) return false;
  const hasStudentCredentials = isCredentials(value.credencialesAlumno);
  const hasRepresentative = isRepresentative(value.representante);
  return (hasStudentCredentials && value.representante === undefined) ||
    (hasRepresentative && value.credencialesAlumno === undefined);
}

function isRepresentative(value: unknown): boolean {
  return isStudent(value) && isCredentials(value) && isNonEmptyString(value.fechaNacimiento);
}

function isStudent(value: unknown): value is JsonRecord {
  return isRecord(value) &&
    isNonEmptyString(value.nombres) &&
    isNonEmptyString(value.apellidos) &&
    isCedula(value.cedula) &&
    isDate(value.fechaNacimiento) &&
    isNonEmptyString(value.telefono) &&
    isOptionalNumber(value.institucionId);
}

function isMedicalRecord(value: unknown): boolean {
  return isRecord(value) &&
    isBloodType(value.tipoSangre) &&
    isNonEmptyString(value.contactoEmergencia) &&
    isNonEmptyString(value.telefonoEmergencia) &&
    // Required by EnrollmentMedicalRecord, but "" is a legitimate value: an
    // empty condicionesSalud/alergias means "none", so the key must be present
    // and a string without being forced to carry text.
    isRequiredString(value.condicionesSalud) &&
    isRequiredString(value.alergias) &&
    isOptionalString(value.observaciones);
}

function isCredentials(value: unknown): boolean {
  return isRecord(value) && isEmail(value.correo) && isPassword(value.contrasenia);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRequiredString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isCedula(value: unknown): boolean {
  return typeof value === "string" && /^\d{10}$/.test(value);
}

function isDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isEmail(value: unknown): boolean {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPassword(value: unknown): boolean {
  return typeof value === "string" && value.length >= 8;
}

function isBloodType(value: unknown): boolean {
  return typeof value === "string" && Object.values(BLOOD_TYPES).includes(value as typeof BLOOD_TYPES[keyof typeof BLOOD_TYPES]);
}
