/**
 * API Client — Cata Club Admin Frontend
 *
 * Centralised HTTP client. Every call goes same-origin to a Next.js Route
 * Handler under /api/* (see `getBaseUrl`/`apiEndpoint` below for why this
 * client never talks to the backend directly). Each resource's Route
 * Handler independently decides whether it's still backed by mock data or
 * already proxies to the real FastAPI backend — that's tracked per screen,
 * not by a single global flag here anymore.
 *
 * `NEXT_PUBLIC_USE_MOCKS` still exists only to pick the `x-mock-role`
 * header (see `isMockMode`/`getMockRoleHeader`) for the Route Handlers that
 * are still mock-backed. It no longer affects which URL this client calls.
 *
 * Timeout: every request aborts after 10 seconds by default (see `request`).
 *          If the caller provides their own `signal`, the caller manages
 *          timeout instead — so provide one if you need timeout guarantees.
 */

import type {
  UserRole,
  EstadoAsistencia,
  RolesResponse,
  BackendTipoRol,
  FichaMedicaEditable,
  FichaMedicaUpdatePayload,
  TipoSangre,
  PersonaReporte,
  PersonaResponse,
  PersonaBusqueda,
  Notificacion,
  PerfilPropio,
  ActualizarPerfilPropioPayload,
} from "@/types/domain";
import type { EnrollmentRequest, EnrollmentResponse } from "@/types/enrollment";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { MemberAccount } from "@/app/members/members-utils";

// ---------------------------------------------------------------------------
// Types — Membership Payment Validation (CU012)
// ---------------------------------------------------------------------------

/**
 * Membership lifecycle status — aligns with `EstadoMembresia` in domain.ts.
 * Membership is created/activated only after payment is approved.
 */
export type MembershipStatus =
  | "activa"
  | "vencida"
  | "suspendida";

/**
 * Payment proof validation status — aligns with `EstadoValidacion` in domain.ts.
 */
export type ValidationStatus = "pendiente" | "validado" | "rechazado";

export type ProofFileType = "image" | "pdf";

/**
 * PaymentValidationRequest — Represents a membership payment proof
 * submitted by a responsible payer (representative or self-managed student),
 * awaiting admin validation.
 *
 * Maps to CU012: "Validar o rechazar comprobante de pago".
 */
export interface PaymentValidationRequest {
  id: string;
  studentName: string;
  /** Name of the account owner / responsible payer who submitted this proof.
   *  Replaces the old `representativeName` concept. */
  responsablePagoName?: string;
  /** @deprecated Use `responsablePagoName` instead. */
  representativeName?: string;
  membershipPeriod: string;
  membershipType: string;
  expectedAmount: number;
  paymentMethod: string;
  uploadedAt: string;
  currentMembershipStatus: MembershipStatus;
  proofFileName: string;
  proofFileType: ProofFileType;
  proofPreviewUrl?: string;
  validationStatus: ValidationStatus;
  rejectionReason?: string;
  validatedAt?: string;
  validatedBy?: string;
  startDate: string;
  endDate: string;
}

/** DTO for approving a payment validation request. */
export interface ApprovePaymentDTO {
  action: "approved";
  startDate?: string;
  endDate?: string;
}

/** DTO for rejecting a payment validation request. */
export interface RejectPaymentDTO {
  action: "rejected";
  rejectionReason: string;
}

export type UpdatePaymentValidationDTO = ApprovePaymentDTO | RejectPaymentDTO;

export interface ApiError {
  message: string;
  status: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Every request goes same-origin, to a Next.js Route Handler under /api/*
 * — never directly to the backend from the browser.
 *
 * The access/refresh tokens live only in HttpOnly cookies set by the BFF
 * (see src/lib/server/auth.ts). Those cookies are invisible to browser JS
 * and scoped to this origin, so a cross-origin fetch straight to
 * NEXT_PUBLIC_API_URL (the old "direct backend" mode this used to support)
 * could never carry auth — it would 401/404 regardless of path. Protected
 * data must be proxied server-side: the Route Handler reads the cookie and
 * attaches `Authorization: Bearer` itself (see
 * src/lib/server/backend-client.ts's `backendFetchAuthed`).
 */
function getBaseUrl(): string {
  return "";
}

/**
 * Resolve the endpoint path — always a same-origin Route Handler under /api/.
 *
 * @param resource — the resource path, e.g. "/payments" or "/payments/:id"
 */
function apiEndpoint(resource: string): string {
  return `/api${resource}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merge one or more HeadersInit sources into a plain object.
 *
 * Handles every valid HeadersInit type:
 *  - Record<string, string>
 *  - [string, string][]   (tuples)
 *  - Headers instance
 *  - undefined (skipped)
 */
function toPlainHeaders(...sources: (HeadersInit | undefined)[]): Record<string, string> {
  const merged = new Headers();
  for (const source of sources) {
    if (!source) continue;
    const headers = new Headers(source);
    for (const [key, value] of headers.entries()) {
      merged.set(key, value);
    }
  }
  const result: Record<string, string> = {};
  merged.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export class ApiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

/**
 * Current auth role, mirrored here from AuthContext (see `setCurrentMockRole`)
 * whenever the session changes. Replaces a prior localStorage-based read —
 * nothing has persisted a session to localStorage since auth moved to the
 * BFF/HttpOnly-cookie model, so that read always came back empty.
 */
let currentMockRole: UserRole | null = null;

/**
 * Called by AuthContext whenever its session changes, so the mock-mode
 * `x-mock-role` header reflects the real, current auth session instead of a
 * dead localStorage key.
 */
export function setCurrentMockRole(role: UserRole | null): void {
  currentMockRole = role;
}

function getMockRoleHeader(): Record<string, string> {
  if (currentMockRole) return { "x-mock-role": currentMockRole };
  return {};
}

function isMockMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCKS !== "false";
}

const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// 401 refresh-and-retry (Phase 4)
// ---------------------------------------------------------------------------

/**
 * Methods considered safe to silently retry after a refreshed access token.
 * GET/HEAD have no side effects; PUT is idempotent by HTTP semantics (a full
 * resource replace — repeating it is safe). POST/PATCH are NOT retried
 * automatically since a generic client can't guarantee the original request
 * had no side effect yet — replaying it could double it (e.g. resubmitting
 * a payment action). A caller needing a retryable POST should special-case
 * it explicitly rather than relying on this generic client.
 */
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

function isRetryableMethod(method: string | undefined): boolean {
  return RETRYABLE_METHODS.has((method ?? "GET").toUpperCase());
}

let refreshPromise: Promise<boolean> | null = null;
let refreshController: AbortController | null = null;

/**
 * De-duplicated refresh: concurrent 401s across requests share one
 * in-flight /api/auth/refresh call instead of each independently
 * triggering a refresh (avoids a refresh storm).
 */
function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshController = new AbortController();
    refreshPromise = fetch("/api/auth/refresh", { method: "POST", signal: refreshController.signal })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
        refreshController = null;
      });
  }
  return refreshPromise;
}

/**
 * Abort any in-flight refresh so it can never land a Set-Cookie after an
 * explicit logout has cleared the access-token cookie (Max-Age=0) — call
 * this right before POSTing /api/auth/logout. This only closes the race on
 * the client; a full server-side guarantee would need session versioning,
 * which is out of scope here.
 */
export function discardInFlightRefresh(): void {
  refreshController?.abort();
  refreshPromise = null;
}

type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

/**
 * Subscribe to "the session could not be recovered" notifications — used by
 * AuthContext to clear local session state (trigger logout/redirect-to-login)
 * when a refresh-and-retry ultimately fails. Returns an unsubscribe function.
 */
export function subscribeAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

function notifyAuthFailure(): void {
  authFailureListeners.forEach((listener) => listener());
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  isRetry = false,
): Promise<T> {
  const url = `${getBaseUrl()}${endpoint}`;

  // Timeout handling: if the caller provides their own AbortSignal they are
  // responsible for timeout; otherwise we set a default 10 s timeout.
  let controller: AbortController | undefined;
  let signal: AbortSignal;

  if (options.signal) {
    signal = options.signal;
  } else {
    controller = new AbortController();
    signal = controller.signal;
  }

  const timeoutId = controller !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  // FormData (multipart file uploads, e.g. `subirFotoPerfil`) must NOT get a
  // manual Content-Type: the browser needs to set its own multipart boundary
  // — forcing "application/json" (or any fixed value) here would break the
  // upload server-side.
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = toPlainHeaders(
    isFormDataBody ? {} : { "Content-Type": "application/json" },
    options.headers,
  );

  try {
    const response = await fetch(url, {
      ...options,
      signal,
      headers,
    });

    if (response.status === 401) {
      if (!isRetry) {
        const refreshed = await refreshAccessToken();
        if (refreshed && isRetryableMethod(options.method)) {
          return request<T>(endpoint, options, timeoutMs, true);
        }
        if (!refreshed) {
          notifyAuthFailure();
        }
        // else: refresh succeeded but this method isn't safe to auto-retry —
        // let THIS call fail below; the session itself is fine going forward.
      } else {
        // Already retried once with a refreshed token and still 401 — give up.
        notifyAuthFailure();
      }
    }

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const errorBody: unknown = await response.json();
        if (isApiErrorBody(errorBody)) {
          message = errorBody.detail ?? errorBody.message ?? message;
        }
      } catch {
        // ignore parse errors — use default message
      }
      throw new ApiClientError(message, response.status);
    }

    // 204 No Content never carries a body — calling response.json() on it
    // throws ("Unexpected end of JSON input"). Callers expecting no data
    // (Promise<void>, e.g. eliminarHorario/desasignarAlumnoDeHorario) get
    // undefined instead of a spurious parse error.
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

// ---------------------------------------------------------------------------
// Membership Payment Validation API Methods
// ---------------------------------------------------------------------------

/**
 * Fetch all payment validation requests.
 */
export async function fetchPaymentValidations(): Promise<PaymentValidationRequest[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PaymentValidationRequest[]>(apiEndpoint("/payments"), {
    headers: mockHeaders,
  });
}

/**
 * Update a payment validation request (approve or reject).
 *
 * - Approve: `{ action: "approved" }`
 * - Reject:  `{ action: "rejected", rejectionReason: "..." }`
 */
export async function updatePaymentValidation(
  id: string,
  data: UpdatePaymentValidationDTO,
): Promise<PaymentValidationRequest> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PaymentValidationRequest>(apiEndpoint(`/payments/${id}`), {
    method: "PUT",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

// ---------------------------------------------------------------------------
// Types — Attendance & Ranking (Fase 3)
// ---------------------------------------------------------------------------

/**
 * A ranking level with current occupancy — `GET /ranking/niveles`.
 * `NivelRanking` IS the "Grupo" concept for the frontend (see backend's
 * ranking_schemas.py module docstring); already camelCase, passed through
 * unmodified by the Route Handler.
 */
export interface NivelConOcupacion {
  id: number;
  numeroNivel: number;
  nombre: string | null;
  capacidadMinima: number;
  capacidadMaxima: number;
  personasActuales: number;
  cuposDisponibles: number;
  necesitaRevision: boolean;
  nivelCategoria: "principiante" | "intermedio" | "avanzado";
}

/** A row of a nivel's roster — `GET /ranking/niveles/:id/tabla`. No longer
 * carries `posicionActual`/`puntajeAcumulado` (backend stopped exposing
 * them — frozen forever since `cerrar_mes()` was removed, slice E of
 * `limpieza-asistencia-y-nivel-entrenador`); this endpoint now serves
 * purely as a roster (attendance roster + members nivel-mapping). */
export interface TablaRankingItem {
  personaId: number;
  personaNombreCompleto: string;
  estaEnRanking: boolean;
}

/** One student's attendance mark, part of a `registerAttendance` batch. */
export interface AttendanceStudentMark {
  personaId: number;
  estado: EstadoAsistencia;
}

/** Request body for `POST /api/attendance/records` — registers real attendance for a session. */
export interface RegisterAttendanceRequest {
  horarioId: number;
  entrenadorId: number;
  /** ISO "YYYY-MM-DD"; defaults to today (server clock) when omitted. */
  fechaEntrenamiento?: string;
  students: AttendanceStudentMark[];
}

/** Result of a `registerAttendance` batch — tolerates partial failure (one POST per student). */
export interface RegisterAttendanceResult {
  createdCount: number;
  failed: { personaId: number; message: string }[];
}

// ---------------------------------------------------------------------------
// Attendance & Ranking API Methods (Fase 3)
// ---------------------------------------------------------------------------

/** List real training schedules (Horario). */
export async function fetchTrainingSchedules(): Promise<TrainingSchedule[]> {
  return request<TrainingSchedule[]>(apiEndpoint("/attendance/schedules"));
}

/** Fetch attendance records (Asistencia), optionally filtered by date range/horario/persona. */
export async function fetchAttendanceRecords(params?: {
  fechaInicio?: string;
  fechaFin?: string;
  horarioId?: number;
  personaId?: number;
}): Promise<AttendanceRecord[]> {
  const qs = new URLSearchParams();
  if (params?.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
  if (params?.fechaFin) qs.set("fechaFin", params.fechaFin);
  if (params?.horarioId !== undefined) qs.set("horarioId", String(params.horarioId));
  if (params?.personaId !== undefined) qs.set("personaId", String(params.personaId));
  const query = qs.toString();
  return request<AttendanceRecord[]>(apiEndpoint(`/attendance/records${query ? `?${query}` : ""}`));
}

/** List ranking levels (Grupo) with current occupancy. */
export async function fetchNivelesConOcupacion(): Promise<NivelConOcupacion[]> {
  return request<NivelConOcupacion[]>(apiEndpoint("/ranking/niveles"));
}

/** Persist attendance for a session (one real `POST /asistencias` per student, partial-failure-tolerant). */
export async function registerAttendance(data: RegisterAttendanceRequest): Promise<RegisterAttendanceResult> {
  return request<RegisterAttendanceResult>(apiEndpoint("/attendance/records"), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Horarios (Training Schedules) CRUD
// ---------------------------------------------------------------------------

/**
 * A persisted training schedule. `horaInicio`/`horaFin` are always
 * server-derived from `categoria` (see `CATEGORIA_METADATA` in
 * `@/services/categorias`) — the response still carries them for display,
 * but `CrearHorarioDTO`/`ActualizarHorarioDTO` below no longer accept them
 * as client input.
 */
export interface Horario {
  id: number;
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
  categoria: string;
  entrenadorId: number;
  nivelRankingId: number | null;
}

/** `hora_inicio`/`hora_fin` are intentionally absent: the backend derives and
 *  validates them from `categoria` + `dia_semana` (`OperacionInvalida` if
 *  `dia_semana` isn't in that categoria's allowed day-set) — the client can
 *  no longer submit them directly. */
export interface CrearHorarioDTO {
  dia_semana: string;
  categoria: string;
  entrenador_id: number;
  nivel_ranking_id?: number | null;
}

/** See `CrearHorarioDTO` — `hora_inicio`/`hora_fin` are dropped here too. */
export interface ActualizarHorarioDTO {
  dia_semana?: string;
  categoria?: string;
  entrenador_id?: number;
  nivel_ranking_id?: number | null;
}

/** Fetch all training schedules. */
export async function fetchHorarios(): Promise<Horario[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<Horario[]>(apiEndpoint("/groups/horarios"), {
    headers: mockHeaders,
  });
}

/** Create a new training schedule. */
export async function crearHorario(data: CrearHorarioDTO): Promise<Horario> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<Horario>(apiEndpoint("/groups/horarios"), {
    method: "POST",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

/** Update an existing training schedule. */
export async function actualizarHorario(id: number, data: ActualizarHorarioDTO): Promise<Horario> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<Horario>(apiEndpoint(`/groups/horarios/${id}`), {
    method: "PUT",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

/** Delete a training schedule. */
export async function eliminarHorario(id: number): Promise<void> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  await request<unknown>(apiEndpoint(`/groups/horarios/${id}`), {
    method: "DELETE",
    headers: mockHeaders,
  });
}

/** A persona with rol ENTRENADOR — feeds the entrenador dropdown when
 *  creating/editing a `Horario` (real name, not a raw ID). */
export interface Entrenador {
  id: number;
  nombreCompleto: string;
}

/** Fetch all personas with rol ENTRENADOR. */
export async function fetchEntrenadores(): Promise<Entrenador[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<Entrenador[]>(apiEndpoint("/personas/entrenadores"), {
    headers: mockHeaders,
  });
}

// ---------------------------------------------------------------------------
// Members & Groups API Methods (Fase 4)
// ---------------------------------------------------------------------------

/** Aggregated member response, including whether the upstream persona page reached its cap before accounts were grouped. */
export interface MembersResponse {
  accounts: MemberAccount[];
  niveles: NivelConOcupacion[];
  personasCapped: boolean;
  /**
   * `true` when at least one membership could not be resolved upstream, so
   * `estudiante.membresia` is `null` for reasons that are NOT "this student has
   * no membership". Counting those as zero is what let `/members` claim
   * "Membresías activas · 0" while `/dashboard` and the student portals showed
   * active memberships — see the note in src/app/api/members/route.ts.
   */
  membresiasDegraded?: boolean;
}

/** List every account (responsible payer + managed students) and ranking niveles with occupancy, aggregated server-side — see src/lib/server/members-adapter.ts. */
export async function fetchMembers(): Promise<MembersResponse> {
  return request<MembersResponse>(apiEndpoint("/members"));
}

/** Lightweight student row from GET /api/ranking/alumnos-con-nivel — accessible to admin and trainer. */
export interface AlumnoConNivel {
  personaId: number;
  nombres: string;
  apellidos: string;
  nivelRankingId: number | null;
}

/**
 * List all students (rol ALUMNO) with their current `nivelRankingId` (null if
 * unassigned). Available to both admin and trainer; replaces `fetchMembers`
 * for the nivel-asignation panel because `/personas/` is admin-only.
 */
export async function fetchAlumnosConNivel(): Promise<AlumnoConNivel[]> {
  // camelCase, NOT snake_case: `AlumnoConNivelDTO` extends `ResponseBase`,
  // which sets `alias_generator=_to_camel` (backend schemas/base.py:45), and
  // the BFF passes the body through untouched. Reading `persona_id` /
  // `nivel_ranking_id` yielded `undefined` for every field, which is worse than
  // a crash: `undefined !== null` counted every student as assigned while
  // `undefined === nivel.id` matched no level, so /ranking reported "68 de 68
  // asignados" over eleven levels that all read "Sin estudiantes".
  const items = await request<{ personaId: number; nombres: string; apellidos: string; nivelRankingId: number | null }[]>(
    apiEndpoint("/ranking/alumnos-con-nivel"),
  );
  return items.map((it) => ({
    personaId: it.personaId,
    nombres: it.nombres,
    apellidos: it.apellidos,
    nivelRankingId: it.nivelRankingId ?? null,
  }));
}

/**
 * Assign a student with no prior nivel/group (`grupoId === null`) to one —
 * `POST /ranking/asignar-nivel-inicial`. Backend-role-restricted to
 * ENTRENADOR; an admin caller gets a real 403 here (see
 * src/app/api/groups/assign/route.ts's doc comment) — this is not a client
 * bug, it reflects the actual backend authorization rule.
 */
export async function assignStudentToNivel(personaId: number, nivelRankingId: number): Promise<void> {
  await request<unknown>(apiEndpoint("/groups/assign"), {
    method: "POST",
    body: JSON.stringify({ personaId, nivelRankingId }),
  });
}

/** Move an already-ranked student to a different nivel/group — `PATCH /ranking/{id}/mover-de-nivel`. Works for admin and entrenador. */
export async function moveStudentToNivel(personaId: number, nivelRankingId: number): Promise<void> {
  await request<unknown>(apiEndpoint("/groups/move"), {
    method: "PATCH",
    body: JSON.stringify({ personaId, nivelRankingId }),
  });
}

/** Submit one public, backend-transactional enrollment request. */
export async function enrollStudent(data: EnrollmentRequest): Promise<EnrollmentResponse> {
  const response: unknown = await request<unknown>(apiEndpoint("/enrollment/"), {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!isEnrollmentResponse(response)) {
    throw new ApiClientError("La respuesta de inscripción no es válida.", 502);
  }
  return { enrolled: true };
}

/** Institution for the school selector dropdown. */
export interface Institucion {
  id: number;
  nombre: string;
  tipoEscuela: string;
}

/**
 * Fetch all institutions for the school selector (read-only, any auth).
 *
 * `tipoEscuela`, NOT `tipo_escuela`: `InstitucionResponseDTO` extends
 * `ResponseBase` (backend/app/presentacion/schemas/persona_schemas.py:17), so
 * it serialises camelCase like every other response — see
 * `fetchAlumnosConNivel` for the same bug and what it cost. Reading the
 * snake_case key made every option render "Nombre (undefined)" and left the
 * "tipo de escuela" filter unable to match anything.
 */
export async function fetchInstituciones(): Promise<Institucion[]> {
  const response: unknown = await request<unknown>(apiEndpoint("/personas/instituciones"));
  if (!Array.isArray(response)) {
    throw new ApiClientError("Respuesta inválida de instituciones.", 502);
  }
  return response.map((item: Record<string, unknown>) => ({
    id: item.id as number,
    nombre: item.nombre as string,
    tipoEscuela: item.tipoEscuela as string,
  }));
}

function isApiErrorBody(value: unknown): value is { message?: string; detail?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (typeof body.message === "string" && body.message.length > 0) ||
    (typeof body.detail === "string" && body.detail.length > 0);
}

function isEnrollmentResponse(value: unknown): value is EnrollmentResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  return Object.keys(response).length === 1 && response.enrolled === true;
}

// ---------------------------------------------------------------------------
// Types & API Methods — Student Portal (Fase 6)
// ---------------------------------------------------------------------------

/**
 * Ranking profile for one student — `GET /ranking/{id}/perfil` is
 * ownership-checked server-side (self, or ADMINISTRADOR/ENTRENADOR), so a
 * representante viewing a represented child's profile legitimately gets
 * `"unavailable"/"forbidden"` instead of data. See
 * src/lib/server/student-adapter.ts for the full gap writeup.
 */
export type StudentRankingSummary =
  | {
      status: "available";
      nivelNombre: string | null;
      estaEnRanking: boolean;
    }
  | { status: "unavailable"; reason: "forbidden" | "error" };

/** One real past attendance record — shown as "recent activity" in place of a future schedule the API can't derive per-student (see student-adapter.ts). */
export interface StudentSessionSummary {
  fecha: string;
  horario: string;
  estado: EstadoAsistencia;
}

/** One student's own profile — used both for the logged-in persona (`self`) and for each `representado`. */
export interface StudentProfileSummary {
  personaId: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  ranking: StudentRankingSummary;
  recentSessions: StudentSessionSummary[];
  membership: MembershipSummary | null;
  representante: { nombres: string; apellidos: string } | null;
  representanteId: number | null;
}

export interface MembershipSummary {
  id: number;
  estado: string;
  personaId: number;
  montoAplicado: string | null;
  categoria: string | null;
  modalidad: string | null;
  franjaHoraria: string | null;
  /** Activation date, i.e. "socio desde". Null when the backend omits it. */
  fechaActivacion: string | null;
  /** End of the paid period — drives the "Vigente hasta"/"Venció" state. */
  fechaFin: string | null;
}

/** A real `TipoMembresia` catalog entry (`GET /membresias/tipos`) — replaces the old hardcoded `membershipPlans` array. */
export interface MembershipPlanSummary {
  id: string;
  nombre: string;
  precio: number;
  franjaHoraria: string;
  modalidad: string;
}

export interface StudentPortalSummary {
  self: StudentProfileSummary | null;
  representados: StudentProfileSummary[];
  membershipPlans: MembershipPlanSummary[];
}

/** Fetch the logged-in persona's own portal data — `GET /api/student`. */
export async function fetchStudentPortal(personaId: string): Promise<StudentPortalSummary> {
  return request<StudentPortalSummary>(apiEndpoint(`/student?personaId=${encodeURIComponent(personaId)}`));
}

// ---------------------------------------------------------------------------
// Dashboard API Methods (Fase 7)
// ---------------------------------------------------------------------------

/** Aggregate counts for the admin overview — see src/app/api/dashboard/route.ts for how each is composed. */
export interface DashboardStats {
  totalPersonas: number;
  activeMemberships: number;
  pendingPayments: number;
  todaySchedules: number;
  personasSinMembresia: number;
}

/** Fetch aggregate dashboard stats, composed server-side from `/personas`, `/membresias/pagos*` and `/asistencias/horarios` — `GET /api/dashboard`. */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  return request<DashboardStats>(apiEndpoint("/dashboard"));
}

// ---------------------------------------------------------------------------
// Ranking Data Fetching (GET endpoints — replace mock data)
// ---------------------------------------------------------------------------

/**
 * `AsignacionRankingResponseDTO` extends `ResponseBase`
 * (backend/app/presentacion/schemas/ranking_schemas.py:113), so the wire shape
 * is camelCase — this interface was declared snake_case, which would have made
 * every field `undefined` at runtime. Nothing renders it today, so the bug was
 * latent rather than visible; it is corrected here so the next caller does not
 * inherit it.
 *
 * NOTE: `GET /ranking/asignaciones` currently answers 500 on the live backend.
 * Verify it before building anything on this.
 */
export interface AsignacionRanking {
  personaId: number;
  personaNombreCompleto: string;
  nivelRankingId: number;
  nivelRankingNombre: string | null;
  nivelRankingNumero: number;
  estaEnRanking: boolean;
}

export async function fetchAsignacionesRanking(): Promise<AsignacionRanking[]> {
  return request<AsignacionRanking[]>(apiEndpoint("/ranking/asignaciones"));
}

// ---------------------------------------------------------------------------
// Reports API Methods
// ---------------------------------------------------------------------------

/** Fetch new personas registered within a given date range. */
export async function fetchNuevosPorPeriodo(
  fechaInicio: string,
  fechaFin: string,
): Promise<PersonaReporte[]> {
  const qs = new URLSearchParams({
    fecha_inicio: fechaInicio,
    fecha_fin: fechaFin,
  });
  return request<PersonaReporte[]>(apiEndpoint(`/personas/reportes/nuevos-por-periodo?${qs.toString()}`));
}

// ---------------------------------------------------------------------------
// Report PDF exports
// ---------------------------------------------------------------------------

/**
 * Fetch a binary PDF from a same-origin BFF route and trigger a browser
 * download via a temporary `<a download>` click. Bypasses `request<T>`
 * (which unconditionally calls `.json()`) since a PDF export needs the raw
 * bytes, not a parsed JSON body. Reads the served filename from the
 * `Content-Disposition` header when present, falling back to
 * `fallbackFilename` otherwise.
 */
export async function downloadBlob(endpoint: string, fallbackFilename: string): Promise<void> {
  const response = await fetch(endpoint);

  if (!response.ok) {
    let message = `No se pudo generar el PDF (status ${response.status}).`;
    try {
      const errorBody: unknown = await response.json();
      if (isApiErrorBody(errorBody)) {
        message = errorBody.detail ?? errorBody.message ?? message;
      }
    } catch {
      // ignore parse errors — use default message
    }
    throw new ApiClientError(message, response.status);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+?)"?(?:;|$)/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Export the "nuevos por período" persona report as a PDF and trigger its download. */
export async function exportNuevosPorPeriodoPdf(fechaInicio: string, fechaFin: string): Promise<void> {
  const qs = new URLSearchParams({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
  await downloadBlob(apiEndpoint(`/personas/reportes/nuevos-por-periodo/pdf?${qs.toString()}`), "reporte-periodo.pdf");
}

/** Export the attendance report as a PDF and trigger its download. */
export async function exportAsistenciaReportePdf(params?: {
  fechaInicio?: string;
  fechaFin?: string;
  horarioId?: number;
  personaId?: number;
}): Promise<void> {
  const qs = new URLSearchParams();
  if (params?.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
  if (params?.fechaFin) qs.set("fechaFin", params.fechaFin);
  if (params?.horarioId !== undefined) qs.set("horarioId", String(params.horarioId));
  if (params?.personaId !== undefined) qs.set("personaId", String(params.personaId));
  const query = qs.toString();
  const queryString = query ? `?${query}` : "";
  await downloadBlob(apiEndpoint(`/asistencias/reportes/pdf${queryString}`), "reporte-asistencia.pdf");
}

/** Fetch the payments report (Reportes "Pagos" tab), optionally filtered by date range/status. */
export async function fetchPagosReporte(params?: {
  fechaInicio?: string;
  fechaFin?: string;
  estadoPago?: string;
}): Promise<PaymentValidationRequest[]> {
  const qs = new URLSearchParams();
  if (params?.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
  if (params?.fechaFin) qs.set("fechaFin", params.fechaFin);
  if (params?.estadoPago) qs.set("estadoPago", params.estadoPago);
  const query = qs.toString();
  return request<PaymentValidationRequest[]>(apiEndpoint(`/payments/reportes${query ? `?${query}` : ""}`));
}

/** Export the payments report as a PDF and trigger its download. */
export async function exportPagosReportePdf(params?: {
  fechaInicio?: string;
  fechaFin?: string;
  estadoPago?: string;
}): Promise<void> {
  const qs = new URLSearchParams();
  if (params?.fechaInicio) qs.set("fechaInicio", params.fechaInicio);
  if (params?.fechaFin) qs.set("fechaFin", params.fechaFin);
  if (params?.estadoPago) qs.set("estadoPago", params.estadoPago);
  const query = qs.toString();
  const queryString = query ? `?${query}` : "";
  await downloadBlob(apiEndpoint(`/payments/reportes/pdf${queryString}`), "reporte-pagos.pdf");
}

/** Search persons by name (autocomplete). */
export async function searchStudents(
  query: string,
  opts?: { rol?: string; limit?: number },
): Promise<PersonaBusqueda[]> {
  const params = new URLSearchParams({ q: query });
  if (opts?.rol) params.set("rol", opts.rol);
  if (opts?.limit) params.set("limit", String(opts.limit));
  return request<PersonaBusqueda[]>(apiEndpoint(`/personas/buscar?${params}`));
}


/**
 * Request a password-recovery link (POST /auth/recuperar-contrasenia).
 * The backend deliberately returns the same success message whether or not
 * the email is registered (anti-enumeration) — callers should show a
 * generic "check your email" message regardless of the response content.
 */
export async function solicitarRecuperacion(correo: string): Promise<{ mensaje: string }> {
  return request<{ mensaje: string }>(apiEndpoint('/auth/recuperar-contrasenia'), {
    method: 'POST',
    body: JSON.stringify({ correo }),
  });
}

/** Reset password using a recovery token (POST /auth/restablecer-contrasenia). */
export async function restablecerContrasenia(
  token: string,
  nuevaContrasenia: string,
): Promise<void> {
  await request<void>(apiEndpoint('/auth/restablecer-contrasenia'), {
    method: 'POST',
    body: JSON.stringify({ token, nueva_contrasenia: nuevaContrasenia }),
  });
}

// ---------------------------------------------------------------------------
// Types & API Methods — Memberships, Roles & Medical Record (Grupo B)
// ---------------------------------------------------------------------------

/**
 * Memberships owned by a persona — used by the admin create-membership flow.
 */
export interface MembresiaPorPersona {
  id: number;
  estado: "INACTIVA" | "ACTIVA" | "VENCIDA";
  montoAplicado: string;
  fechaActivacion: string;
  personaId: number;
  tipoMembresiaId: number;
  tipo?: {
    id: number;
    categoria: string;
    franjaHoraria: string;
    precio: string;
    modalidad: "PERSONALIZADA" | "MENSUAL";
  };
}

/**
 * Fetch a persona's memberships — `GET /api/membresias/persona/[id]`.
 * Available to the owner, their representative, or an administrator.
 */
export async function fetchMembresiasPorPersona(personaId: number): Promise<MembresiaPorPersona[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<MembresiaPorPersona[]>(apiEndpoint(`/membresias/persona/${personaId}`), {
    headers: mockHeaders,
  });
}

/** JWT-derived membership read for the student portal and represented dependents. */
export async function fetchMisMembresias(personaId?: number): Promise<MembresiaPorPersona[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  const query = personaId === undefined ? "" : `?persona_id=${encodeURIComponent(personaId)}`;
  return request<MembresiaPorPersona[]>(apiEndpoint(`/membresias/mias${query}`), { headers: mockHeaders });
}

/**
 * `PagoResponseDTO` (see backend app/presentacion/schemas/membresia_pago_schemas.py)
 * — a persona's own payment, any status. Distinct from `PaymentValidationRequest`
 * (the enriched admin-only validation queue shape): this is a lean passthrough
 * for the student's own read-only history.
 */
export interface PagoPersona {
  id: number;
  monto: string;
  motivoRechazo: string | null;
  estadoPago: "PENDIENTE_VALIDACION" | "APROBADO" | "RECHAZADO";
  tipoPago: "EFECTIVO" | "TRANSFERENCIA";
  fechaRegistro: string;
  fechaValidacion: string | null;
  fechaInicio: string;
  fechaFin: string;
  personaId: number;
  membresiaId: number;
  voucherUrl: string | null;
  voucherFormato: string | null;
}

/**
 * A persona's own payment history, any status — always real, not mock-gated
 * (mock mode only adds the `x-mock-role` header) — `GET
 * /membresias/pagos/persona/:personaId`.
 */
export async function fetchPagosDePersona(personaId: string): Promise<PagoPersona[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PagoPersona[]>(apiEndpoint(`/membresias/pagos/persona/${personaId}`), {
    headers: mockHeaders,
  });
}

/** Payload for registering a new pending payment — `POST /api/membresias/pagos`. */
export interface RegistrarPagoInput {
  monto: number;
  tipoPago: "EFECTIVO" | "TRANSFERENCIA";
  fechaInicio: string;
  fechaFin: string;
  personaId: number;
  membresiaId: number;
}

/** Register a new pending payment (PENDIENTE_VALIDACION) — `POST /api/membresias/pagos`.
 *  Works for both admin-created payments and student/representante renewals:
 *  the backend enforces authorization at the service layer (owner, their
 *  representative, or ADMINISTRADOR). */
export async function registrarPago(data: RegistrarPagoInput): Promise<PagoPersona> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PagoPersona>(apiEndpoint("/membresias/pagos"), {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json", ...mockHeaders },
  });
}

/** Upload a payment voucher (comprobante) — `POST /api/membresias/pagos/{pagoId}/voucher`. */
export async function subirVoucherPago(pagoId: number, archivo: File): Promise<PagoPersona> {
  const formData = new FormData();
  formData.append("archivo", archivo);
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PagoPersona>(apiEndpoint(`/membresias/pagos/${pagoId}/voucher`), {
    method: "POST",
    body: formData,
    headers: { ...mockHeaders },
  });
}

/** Catalog entry for a membership plan type. */
export interface TipoMembresiaCatalogo {
  id: number;
  categoria: string;
  franjaHoraria: string;
  precio: string;
  modalidad: "PERSONALIZADA" | "MENSUAL";
}

/** List all available membership plan types — `GET /api/membresias/tipos`. */
export async function fetchTiposMembresia(): Promise<TipoMembresiaCatalogo[]> {
  return request<TipoMembresiaCatalogo[]>(apiEndpoint("/membresias/tipos"));
}

/** Create and assign a membership to a persona — `POST /api/membresias/`. */
export async function crearMembresia(data: {
  personaId: number;
  tipoMembresiaId: number;
  montoAplicado: number;
}): Promise<MembresiaPorPersona> {
  return request<MembresiaPorPersona>(apiEndpoint("/membresias/"), {
    method: "POST",
    body: JSON.stringify({
      persona_id: data.personaId,
      tipo_membresia_id: data.tipoMembresiaId,
      monto_aplicado: data.montoAplicado,
    }),
  });
}

/** Admin-only: read a persona's current roles + activo without mutating anything. */
export async function obtenerRolesDePersona(personaId: number): Promise<RolesResponse> {
  return request<RolesResponse>(apiEndpoint(`/personas/${personaId}/roles`), {
    method: "GET",
  });
}

/** Admin-only: assign a backend role to a persona. */
export async function asignarRol(personaId: number, tipoRol: BackendTipoRol): Promise<RolesResponse> {
  return request<RolesResponse>(apiEndpoint(`/personas/${personaId}/roles`), {
    method: "POST",
    body: JSON.stringify({ tipoRol }),
  });
}

/** Admin-only: remove a backend role from a persona. */
export async function quitarRol(personaId: number, tipoRol: BackendTipoRol): Promise<RolesResponse> {
  return request<RolesResponse>(apiEndpoint(`/personas/${personaId}/roles/${tipoRol}`), {
    method: "DELETE",
  });
}

/** Admin-only: activate or deactivate a person's account. */
export async function cambiarEstadoCuenta(personaId: number, activo: boolean): Promise<RolesResponse> {
  return request<RolesResponse>(apiEndpoint(`/personas/${personaId}/cuenta/estado`), {
    method: "PATCH",
    body: JSON.stringify({ activo }),
  });
}

export interface PersonaUpdatePayload {
  nombres?: string;
  apellidos?: string;
  telefono?: string;
  telefonoContacto?: string;
  fotoUrl?: string;
  direccionId?: number;
  institucionId?: number;
}

/** Admin-only: update a person's basic data. */
export async function actualizarPersona(
  personaId: number,
  data: PersonaUpdatePayload,
): Promise<PersonaResponse> {
  const body: Record<string, unknown> = {};
  if (data.nombres !== undefined) body.nombres = data.nombres;
  if (data.apellidos !== undefined) body.apellidos = data.apellidos;
  if (data.telefono !== undefined) body.telefono = data.telefono;
  if (data.telefonoContacto !== undefined) body.telefono_contacto = data.telefonoContacto;
  if (data.fotoUrl !== undefined) body.foto_url = data.fotoUrl;
  if (data.direccionId !== undefined) body.direccion_id = data.direccionId;
  if (data.institucionId !== undefined) body.institucion_id = data.institucionId;

  return request<PersonaResponse>(apiEndpoint(`/personas/${personaId}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Representados (Portal Autoservicio) — a representante adding a dependent
// ---------------------------------------------------------------------------

/** Ficha médica payload for a new dependent — mirrors the backend's
 *  `EnrollmentFichaMedicaDTO` (reused as-is by `RepresentadoCreateDTO`). */
export interface RepresentadoFichaMedicaPayload {
  tipoSangre: TipoSangre;
  enfermedades?: string[];
  alergias?: string;
  contactoEmergencia?: string;
  telefonoEmergencia?: string;
}

/** Payload for the self-service "add a dependent" endpoint. Deliberately
 *  narrow — no admin-only fields (e.g. `representanteId`) are accepted here;
 *  the backend always derives `representante_id` from the caller's own
 *  token, never from the request body.
 *  If `correo` + `contrasenia` are provided, a Usuario with rol ALUMNO is
 *  also created for the minor (Option B: minors with own account). */
export interface RepresentadoCreatePayload {
  nombres: string;
  apellidos: string;
  cedula: string;
  fechaNacimiento: string;
  telefono: string;
  fichaMedica?: RepresentadoFichaMedicaPayload;
  correo?: string;
  contrasenia?: string;
  institucionId?: number;
}

/**
 * Representante-only self-service: add a second/third dependent (child)
 * from the authenticated portal. If `correo`/`contrasenia` are provided,
 * also creates a `Usuario` + ALUMNO for the minor (Option B).
 * See `POST /personas/{persona_id}/representados`.
 */
export async function crearRepresentado(
  personaId: number,
  payload: RepresentadoCreatePayload,
): Promise<PersonaResponse> {
  return request<PersonaResponse>(apiEndpoint(`/personas/${personaId}/representados`), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Aging Up / Independizar (Flow 4)
// ---------------------------------------------------------------------------

/** Independizar a persona de su representante legal (POST /personas/{id}/independizar). */
export async function independizarPersona(personaId: number, contrasenia: string): Promise<PersonaResponse> {
  return request<PersonaResponse>(apiEndpoint(`/personas/${personaId}/independizar`), {
    method: "POST",
    body: JSON.stringify({ contrasenia }),
  });
}

// ---------------------------------------------------------------------------
// Admin Account Creation (Flow 1)
// ---------------------------------------------------------------------------

/** Medical record payload for admin account creation (optional). */
export interface AdminFichaMedicaPayload {
  tipoSangre?: string;
  enfermedades?: string[];
  alergias?: string;
  contactoEmergencia?: string;
  telefonoEmergencia?: string;
}

/** Payload for admin creating a full account (Persona + Usuario + Rol) in one request. */
export interface AdminCrearCuentaPayload {
  tipoCuenta: "JUGADOR" | "REPRESENTANTE" | "MENOR";
  nombres: string;
  apellidos: string;
  cedula: string;
  fechaNacimiento: string;
  telefono: string;
  telefonoContacto?: string;
  correo: string;
  contrasenia: string;
  representanteId?: number;
  institucionId?: number;
  fichaMedica?: AdminFichaMedicaPayload;
}

/** Admin-only: create a full account (Persona + Usuario + Rol) in one step.
 *  Returns tokens for auto-login. */
export async function crearCuentaAdmin(data: AdminCrearCuentaPayload): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: string;
  persona_id: number;
}> {
  const payload: Record<string, unknown> = {
    tipo_cuenta: data.tipoCuenta,
    nombres: data.nombres,
    apellidos: data.apellidos,
    cedula: data.cedula,
    fecha_nacimiento: data.fechaNacimiento,
    telefono: data.telefono,
    correo: data.correo,
    contrasenia: data.contrasenia,
  };
  if (data.telefonoContacto) payload.telefono_contacto = data.telefonoContacto;
  if (data.representanteId) payload.representante_id = data.representanteId;
  if (data.institucionId) payload.institucion_id = data.institucionId;
  if (data.fichaMedica) {
    const fm = data.fichaMedica;
    payload.ficha_medica = {
      ...(fm.tipoSangre ? { tipo_sangre: fm.tipoSangre } : {}),
      ...(fm.enfermedades ? { enfermedades: fm.enfermedades } : {}),
      ...(fm.alergias ? { alergias: fm.alergias } : {}),
      ...(fm.contactoEmergencia ? { contacto_emergencia: fm.contactoEmergencia } : {}),
      ...(fm.telefonoEmergencia ? { telefono_emergencia: fm.telefonoEmergencia } : {}),
    };
  }

  return request<{
    access_token: string;
    refresh_token: string;
    token_type: string;
    persona_id: number;
  }>(apiEndpoint("/personas/admin/cuentas"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Admin-only: fetch a person's medical record. */
export async function fetchFichaMedica(personaId: number): Promise<FichaMedicaEditable> {
  return request<FichaMedicaEditable>(apiEndpoint(`/fichas-medicas/persona/${personaId}`));
}

/** Admin-only: update a person's medical record. `enfermedades` replaces the full list. */
export async function actualizarFichaMedica(
  personaId: number,
  data: FichaMedicaUpdatePayload,
): Promise<FichaMedicaEditable> {
  const body: Record<string, unknown> = {};
  if (data.tipoSangre !== undefined) body.tipo_sangre = data.tipoSangre;
  if (data.enfermedades !== undefined) body.enfermedades = data.enfermedades;
  if (data.alergias !== undefined) body.alergias = data.alergias;
  if (data.contactoEmergencia !== undefined) body.contacto_emergencia = data.contactoEmergencia;
  if (data.telefonoEmergencia !== undefined) body.telefono_emergencia = data.telefonoEmergencia;

  return request<FichaMedicaEditable>(apiEndpoint(`/fichas-medicas/persona/${personaId}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Perfil propio (Issue #36) — dedicated self-profile fetch/mutate, distinct
// from the global session (AuthContext). Only the staff /profile view uses
// this — see PerfilPropio's doc comment in types/domain.ts for why.
// ---------------------------------------------------------------------------

/** Fetch the logged-in user's own profile — GET /api/auth/me (includes telefono and fechaCreacion). */
export async function fetchMiPerfil(): Promise<PerfilPropio> {
  return request<PerfilPropio>(apiEndpoint("/auth/me"));
}

/** Update the logged-in user's own telefono — PATCH /api/auth/me. Correo is not editable (see `ActualizarPerfilPropioPayload`). */
export async function actualizarMiPerfil(data: ActualizarPerfilPropioPayload): Promise<PerfilPropio> {
  const body: Record<string, unknown> = {};
  if (data.telefono !== undefined) body.telefono = data.telefono;

  return request<PerfilPropio>(apiEndpoint("/auth/me"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/**
 * Close every OTHER session for the logged-in user — POST
 * /api/auth/sesiones/invalidar. The backend bumps the caller's session
 * epoch (`version_sesion`) and reissues a fresh token pair as HttpOnly
 * cookies in the same response, so THIS device stays authenticated while
 * any token minted before this call (any other device/tab) is rejected on
 * its next request. The BFF route never echoes a token in the JSON body —
 * only this confirmation message.
 */
export async function invalidarOtrasSesiones(): Promise<{ mensaje: string }> {
  return request<{ mensaje: string }>(apiEndpoint("/auth/sesiones/invalidar"), {
    method: "POST",
  });
}

/** Longer than DEFAULT_TIMEOUT_MS (10s) — subirFotoPerfil is the only caller
 * that uploads a binary body (up to the backend's 5MB cap), which can take
 * longer than a small JSON payload on a slow connection. */
const FOTO_PERFIL_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Upload/replace the logged-in user's own profile photo — POST /api/auth/me/foto.
 * Sends `multipart/form-data` (a `FormData` body, NOT `JSON.stringify`) — see
 * `request()`'s FormData branch, which skips the default
 * `Content-Type: application/json` header so the browser sets its own
 * multipart boundary. Only JPG/PNG are accepted server-side.
 */
export async function subirFotoPerfil(archivo: File): Promise<PerfilPropio> {
  const formData = new FormData();
  formData.append("archivo", archivo);

  return request<PerfilPropio>(
    apiEndpoint("/auth/me/foto"),
    { method: "POST", body: formData },
    FOTO_PERFIL_UPLOAD_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Notificaciones — in-app notifications (currently membership-expiration
// notices only; the ranking-mensual/justificativo notification types were
// removed along with those features).
// ---------------------------------------------------------------------------

/** List the logged-in persona's own in-app notifications — `GET /ranking/notificaciones/mias`. */
export async function fetchNotificaciones(): Promise<Notificacion[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<Notificacion[]>(apiEndpoint("/ranking/notificaciones/mias"), {
    headers: mockHeaders,
  });
}

/** Mark one of the caller's own notifications as read — `PATCH /ranking/notificaciones/:id/leer`. */
export async function marcarNotificacionLeida(id: number): Promise<Notificacion> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<Notificacion>(apiEndpoint(`/ranking/notificaciones/${id}/leer`), {
    method: "PATCH",
    headers: mockHeaders,
  });
}

// ---------------------------------------------------------------------------
// Asignación directa Alumno ↔ Horario
// ---------------------------------------------------------------------------

/**
 * `AlumnoHorarioDetalleDTO` on the backend
 * (`backend/app/presentacion/schemas/asistencia_schemas.py`) inherits
 * `ResponseBase`, so the real JSON response is serialized camelCase via
 * `alias_generator=_to_camel` (`backend/app/presentacion/schemas/base.py`) —
 * same convention documented at `frontend/src/lib/server/auth.ts` for
 * `BackendMeResponse`. This was previously mistyped snake_case, which
 * compiled fine but made every `persona_nombre_completo` access `undefined`
 * at runtime (roster count worked via `.length`, but each row rendered
 * blank).
 */
export interface AlumnoHorario {
  id: number;
  personaId: number;
  personaNombreCompleto: string;
  edad: number;
  horarioId: number;
  horarioDia: string;
  horarioHoraInicio: string;
  horarioHoraFin: string;
  fechaAsignacion: string;
}

export interface AsignarAlumnoHorarioDTO {
  persona_id: number;
  horario_id: number;
}

/** Assign a student directly to a schedule. */
export async function asignarAlumnoAHorario(data: AsignarAlumnoHorarioDTO): Promise<AlumnoHorario> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<AlumnoHorario>(apiEndpoint("/groups/asignar-alumno"), {
    method: "POST",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

/** Unassign a student from a schedule. */
export async function desasignarAlumnoDeHorario(personaId: number, horarioId: number): Promise<void> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  await request<unknown>(
    apiEndpoint(`/groups/desasignar-alumno?persona_id=${personaId}&horario_id=${horarioId}`),
    { method: "DELETE", headers: mockHeaders },
  );
}

/** List all students assigned to a specific schedule. */
export async function fetchAlumnosPorHorario(horarioId: number): Promise<AlumnoHorario[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<AlumnoHorario[]>(apiEndpoint(`/groups/horarios/${horarioId}/alumnos`), {
    headers: mockHeaders,
  });
}

/** List all schedules assigned to a specific student. */
export async function fetchHorariosPorAlumno(personaId: number): Promise<AlumnoHorario[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<AlumnoHorario[]>(apiEndpoint(`/asistencias/alumnos/${personaId}/horarios`), {
    headers: mockHeaders,
  });
}

// ---------------------------------------------------------------------------
// Chatbot (FAQ helper widget)
// ---------------------------------------------------------------------------

/** One prior turn of the chatbot conversation, kept client-side (no server-side persistence). */
export interface ChatbotTurno {
  rol: "usuario" | "asistente";
  texto: string;
}

export interface ChatbotRespuesta {
  reply: string;
}

/**
 * Ask the FAQ chatbot a question. `historial` is the last few turns of the
 * conversation (the caller is responsible for capping it — see
 * ChatWidget.tsx) so the backend can keep the multi-turn context without
 * this client needing to know its cap.
 */
export async function consultarChatbot(mensaje: string, historial?: ChatbotTurno[]): Promise<ChatbotRespuesta> {
  return request<ChatbotRespuesta>(apiEndpoint("/chatbot"), {
    method: "POST",
    body: JSON.stringify({ mensaje, historial }),
  });
}
