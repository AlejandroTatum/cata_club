import { NextResponse } from "next/server";
import { backendFetch, forwardedForFrom, setAuthCookies } from "@/lib/server/auth";
import { passthroughBackendError } from "@/lib/server/backend-client";
import { buildEnrollmentCreateDTO, isBackendEnrollmentResponse } from "@/lib/server/enrollment-adapter";
import { isSelectableBloodType, type EnrollmentRequest, type EnrollmentResponse } from "@/types/enrollment";
import { isValidEcuadorianPhone } from "@/lib/identity-validation";
import { ENROLLMENT_ATTEMPT_COOKIE } from "@/lib/server/enrollment-constants";

type JsonRecord = Record<string, unknown>;

/**
 * Cookie that persists the current enrollment attempt's idempotency key
 * (enrollment-idempotency). The BFF mints a key per attempt (when the client
 * does not send its own `Idempotency-Key`), forwards it to the backend, and
 * keeps it here so a RETRY of the same attempt reuses the same key — the
 * backend then replays the original result instead of enrolling twice. The
 * cookie lives only on this route's path and is cleared once the attempt is
 * consumed (201) or dies terminally (400/409/422).
 */

const ATTEMPT_COOKIE_PATH = "/api/enrollment";
// Alineado con el TTL de 24h de `inscripcion_idempotencia.vence_en` (backend).
const ATTEMPT_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

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

  // --- Idempotencia: clave del intento (enrollment-idempotency) ---------------
  // Preferencia: header del cliente (el wizard la obtiene del `sessionStorage`
  // vía `src/lib/enrollment-session.ts`); si no, la cookie de UN intento en
  // curso (reintento del mismo intento tras un timeout/5xx); si no, se acuña
  // una nueva para este intento.
  const attemptKey = resolveAttemptKey(request);

  const result = await backendFetch(
    "/enrollment/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": attemptKey,
      },
      body: JSON.stringify(buildEnrollmentCreateDTO(body)),
    },
    { forwardedFor: forwardedForFrom(request) },
  );

  if (!result.ok) {
    // Timeout/red: el intento PUEDE haber llegado al backend. El reintento
    // debe reutilizar la misma clave (replay en vez de duplicado).
    const status = result.error.code === "timeout" ? 504 : 503;
    return persistAttemptKey(NextResponse.json({ detail: result.error.message }, { status }), attemptKey);
  }

  const response = result.data;
  if (!response.ok) {
    const passthrough = await passthroughBackendError(response, "No se pudo completar la inscripción.");
    // 425/429/5xx son retryables: misma clave en el reintento. Un 4xx terminal
    // (400/409/422) significa intento no consumido o clave muerta: clave nueva.
    return keepAttemptKeyFor(response.status)
      ? persistAttemptKey(passthrough, attemptKey)
      : clearAttemptKey(passthrough);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    // 2xx pero body inválido: el backend SÍ enroló. Misma clave en el retry
    // para que el reintento haga replay y no duplique la inscripción.
    return persistAttemptKey(NextResponse.json({ detail: "Respuesta de inscripción inválida." }, { status: 502 }), attemptKey);
  }
  if (!isBackendEnrollmentResponse(json)) {
    return persistAttemptKey(NextResponse.json({ detail: "Respuesta de inscripción con forma inesperada." }, { status: 502 }), attemptKey);
  }

  // Only { enrolled: true } ever reaches client JS — tokens live exclusively
  // in the HttpOnly cookies set below (see isEnrollmentResponse's contract
  // in src/services/api.ts, which rejects any extra field on this response).
  const enrollmentResponse: EnrollmentResponse = { enrolled: true };
  const nextResponse = NextResponse.json(enrollmentResponse, { status: 201 });
  setAuthCookies(nextResponse, { accessToken: json.access_token, refreshToken: json.refresh_token });
  // El intento se consumió: el próximo alumno arranca con clave nueva.
  return clearAttemptKey(nextResponse);
}

/** A terminal (non-retryable) response ends the attempt: the key must not be reused. */
function keepAttemptKeyFor(status: number): boolean {
  return status === 425 || status === 429 || status >= 500;
}

function resolveAttemptKey(request: Request): string {
  const clientKey = request.headers.get("idempotency-key");
  if (clientKey !== null && clientKey.trim() !== "") return clientKey;

  const stored = attemptKeyFromCookie(request.headers.get("cookie"));
  if (stored !== undefined) return stored;

  return crypto.randomUUID();
}

function attemptKeyFromCookie(cookieHeader: string | null): string | undefined {
  if (cookieHeader === null) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === ENROLLMENT_ATTEMPT_COOKIE) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

function persistAttemptKey(response: NextResponse, key: string): NextResponse {
  response.cookies.set(ENROLLMENT_ATTEMPT_COOKIE, key, {
    path: ATTEMPT_COOKIE_PATH,
    httpOnly: true,
    sameSite: "lax",
    maxAge: ATTEMPT_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

function clearAttemptKey(response: NextResponse): NextResponse {
  response.cookies.set(ENROLLMENT_ATTEMPT_COOKIE, "", {
    path: ATTEMPT_COOKIE_PATH,
    maxAge: 0,
  });
  return response;
}

function isEnrollmentRequest(value: unknown): value is EnrollmentRequest {
  if (!isRecord(value) || !isStudent(value.alumno) || !isMedicalRecord(value.fichaMedica)) return false;
  if (value.credencialesMenor !== undefined && !isCredentials(value.credencialesMenor)) return false;
  if (value.aceptaConsentimientos !== true) return false;
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
    // #643: non-empty was never enough for a phone number. The wizard already
    // validates it with `phoneRule`; this is the same rule at the boundary,
    // from the same module, so a body that skips the wizard cannot enroll a
    // student whose emergency contact is `123`.
    isNonEmptyString(value.telefonoEmergencia) &&
    isValidEcuadorianPhone(value.telefonoEmergencia) &&
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

/**
 * Issue #643: the gate is "may this be CHOSEN", not "is it in the enum".
 * `DESCONOCIDO` stays in the enum so records written before the rule still
 * parse, but an enrollment writes a new complete record, so it dies here —
 * at the BFF, without spending a backend round-trip on a body whose rejection
 * is already certain.
 */
function isBloodType(value: unknown): boolean {
  return isSelectableBloodType(value);
}