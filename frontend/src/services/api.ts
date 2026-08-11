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
 * Timeout: every request that goes through `request()` aborts after 10
 *          seconds by default. If the caller provides their own `signal`,
 *          the caller manages timeout instead — so provide one if you need
 *          timeout guarantees. `downloadBlob` (PDF report exports) is the
 *          one function that bypasses `request()` — it sets its own, longer
 *          deadline; see `PDF_DOWNLOAD_TIMEOUT_MS`.
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
  DiaSemana,
} from "@/types/domain";
import type { EnrollmentRequest, EnrollmentResponse } from "@/types/enrollment";
import type { AttendanceRecord, TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { MemberAccount } from "@/app/members/members-utils";
import { GENERIC_FAILURE } from "@/lib/error-message";

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
 * This client's own deadline elapsed before the server answered.
 *
 * It exists because the abort that enforces the deadline is indistinguishable
 * from the abort a caller triggers on a navigation or an unmount: both reach
 * the catch as an `AbortError`. `toUserMessage` reads that name as "the user
 * walked away" and answered "La operación se canceló." — the only sentence a
 * timed-out request ever produced, and a false one.
 *
 * The name is `TimeoutError` on purpose: it is what the platform itself uses
 * for `AbortSignal.timeout()`, so a caller who ever hands us a signal built
 * that way is already speaking the same vocabulary.
 *
 * It carries no `status`. Nothing in this stack sends 408 and inventing one
 * here would put a server's word on a decision the browser made alone.
 */
export class ApiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The request exceeded its ${timeoutMs} ms timeout.`);
    this.name = "TimeoutError";
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

  // Which of the two aborts fired. Without it the catch below cannot tell our
  // own deadline from a caller's cancellation: `controller.abort()` and
  // `signal.abort()` raise the same `AbortError`, and the translator can only
  // read what it is given.
  let timedOut = false;
  const timeoutId =
    controller !== undefined
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;

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
      // The default was `Request failed with status ${status}` — English, and
      // it reached real screens whenever a proxy 502 or a gateway 504 answered
      // without a JSON body. `GENERIC_FAILURE` is Spanish and safe to render
      // as-is; the status itself is on the error for anyone who needs it.
      let message = GENERIC_FAILURE;
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
  } catch (error: unknown) {
    // Only OUR timeout is renamed. An abort the caller asked for keeps its
    // `AbortError`, because "se canceló" is true for that one.
    if (timedOut && error instanceof Error && error.name === "AbortError") {
      throw new ApiTimeoutError(timeoutMs);
    }
    throw error;
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
// Types — Attendance (Fase 3)
// ---------------------------------------------------------------------------

/** One student's attendance mark, part of a `registerAttendance` batch. */
export interface AttendanceStudentMark {
  personaId: number;
  estado: EstadoAsistencia;
}

/** Request body for `POST /api/attendance/records` — registers real attendance
 * for a session. No `entrenadorId`: attendance does not record who taught the
 * session (issue #13, docs/concepto-alcance-modelo.md §4). */
export interface RegisterAttendanceRequest {
  horarioId: number;
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
// Attendance API Methods (Fase 3)
// ---------------------------------------------------------------------------

/** List real training schedules (Horario). */
export async function fetchTrainingSchedules(): Promise<TrainingSchedule[]> {
  return request<TrainingSchedule[]>(apiEndpoint("/attendance/schedules"));
}

/**
 * One entry of the live categoria catalog (`categoria_horario`), as
 * translated by `/api/attendance/categories` (see that Route Handler for the
 * backend DTO it proxies). Replaces the frontend's old static
 * `CATEGORIA_METADATA` mirror — see `@/services/categorias`, which is the
 * only consumer of `fetchCategoriasCatalogo` below.
 */
export interface CategoriaCatalogEntry {
  codigo: string;
  label: string;
  horaInicio: string;
  horaFin: string;
  dias: DiaSemana[];
}

/** Fetch the live categoria catalog (hours/label/allowed días per categoria). */
export async function fetchCategoriasCatalogo(): Promise<CategoriaCatalogEntry[]> {
  return request<CategoriaCatalogEntry[]>(apiEndpoint("/attendance/categories"));
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
 * server-derived from `categoria` (see the live categoria catalog fetched by
 * `@/services/categorias`, `GET /api/attendance/categories`) — the response
 * still carries them for display, but `CrearHorarioDTO`/`ActualizarHorarioDTO`
 * below no longer accept them as client input.
 *
 * There is no `entrenadorId` either: the club does not assign trainers to
 * schedules — whoever is available teaches the class. The backing column was
 * dropped by migration `e7c3a1b9d5f2` (issue #13).
 */
export interface Horario {
  id: number;
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
  categoria: string;
}

/** `hora_inicio`/`hora_fin` are intentionally absent: the backend derives and
 *  validates them from `categoria` + `dia_semana` (`OperacionInvalida` if
 *  `dia_semana` isn't in that categoria's allowed day-set) — the client can
 *  no longer submit them directly. */
export interface CrearHorarioDTO {
  dia_semana: string;
  categoria: string;
}

/** See `CrearHorarioDTO` — `hora_inicio`/`hora_fin` are dropped here too. */
export interface ActualizarHorarioDTO {
  dia_semana?: string;
  categoria?: string;
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

// `Entrenador`/`fetchEntrenadores` (the trainer dropdown for the horario
// form) were removed with the trainer–schedule relation (issue #13): the
// backend endpoint `GET /personas/entrenadores` no longer exists.

// ---------------------------------------------------------------------------
// Members & Groups API Methods (Fase 4)
// ---------------------------------------------------------------------------

/** Aggregated member response, including whether the upstream persona page reached its cap before accounts were grouped. */
export interface MembersResponse {
  accounts: MemberAccount[];
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

/** List every account (responsible payer + managed students), aggregated server-side — see src/lib/server/members-adapter.ts. */
export async function fetchMembers(): Promise<MembersResponse> {
  return request<MembersResponse>(apiEndpoint("/members"));
}

/**
 * Page size for roster listings paginated on the backend (issue #7):
 * asignaciones and horario rosters. 200 is the backend's hard cap (`le=200`)
 * and the same ceiling `PERSONAS_PAGE_LIMIT` already uses in
 * `src/app/api/members/route.ts` — one capped page, matching how the members
 * screen consumes `GET /personas/`.
 */
const ROSTER_PAGE_LIMIT = 200;

/** Standard backend pagination envelope (`PaginatedResponse` in FastAPI). */
interface PaginatedEnvelope<T> {
  items: T[];
  total: number;
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
 * it serialises camelCase like every other response. Reading the
 * snake_case key made every option render "Nombre (undefined)" and left the
 * "tipo de escuela" filter unable to match anything.
 */
function isPaginatedEnvelope(value: unknown): value is PaginatedEnvelope<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.items) && typeof body.total === "number";
}

function mapInstitucion(item: Record<string, unknown>): Institucion {
  return {
    id: item.id as number,
    nombre: item.nombre as string,
    tipoEscuela: item.tipoEscuela as string,
  };
}

/**
 * Drains the FULL institution catalog across every page, keeping the
 * `Promise<Institucion[]>` signature callers already rely on. The backend
 * endpoint is paginated (`{items, total, skip, limit}`, tope `le=200`), so
 * one request is no longer guaranteed to return everything.
 *
 * Three independent terminations, all required:
 *  - an empty page ends the loop even if `all.length < total` — guards
 *    against a lying/stale `total` causing an infinite re-fetch of page 1;
 *  - `all.length >= total` — the normal, expected termination;
 *  - a thrown `ApiClientError` from `request()` (e.g. a 422 on bad bounds,
 *    surfaced by the BFF as a 502) propagates up rather than looping.
 * `skip` advances by `items.length` (what was actually RECEIVED), not by
 * `ROSTER_PAGE_LIMIT`, so a short page still leaves the loop correct.
 */
export async function fetchInstituciones(): Promise<Institucion[]> {
  const all: Institucion[] = [];
  let skip = 0;
  for (;;) {
    const response: unknown = await request<unknown>(
      apiEndpoint(`/personas/instituciones?skip=${skip}&limit=${ROSTER_PAGE_LIMIT}`),
    );
    if (!isPaginatedEnvelope(response)) {
      throw new ApiClientError("Respuesta inválida de instituciones.", 502);
    }
    const { items, total } = response;
    all.push(...items.map(mapInstitucion));
    if (items.length === 0) break;
    skip += items.length;
    if (all.length >= total) break;
  }
  return all;
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
  /** Everyone on the padrón, staff included — the "Miembros" tile. */
  totalPersonas: number;
  /**
   * The population that can hold a membership: the denominator of
   * "MEMBRESÍAS ACTIVAS · X de Y". Not interchangeable with `totalPersonas`.
   */
  totalAlumnos: number;
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
 * PDF generation is the product's slowest path — legitimately so, not a
 * malfunction, so it does not reuse DEFAULT_TIMEOUT_MS (10s).
 *
 * The BFF route behind it (`proxyBackendPdfGet`, src/lib/server/backend-client.ts)
 * has no PDF-specific bound of its own: it goes through the same
 * `backendFetch` every authenticated call uses, whose own internal deadline —
 * BACKEND_TIMEOUT_MS, 10s, see src/lib/server/auth.ts — was sized for an auth
 * round-trip, not a report render. That BFF-side 10s fires regardless of what
 * this client picks, so a client timeout anywhere near 10s would race it and
 * usually win, turning what could have been a real, nameable 503 into a bare
 * client-side abort. Sitting well past that 10s floor — mirroring the margin
 * FOTO_PERFIL_UPLOAD_TIMEOUT_MS gives another slow, non-JSON transfer — lets
 * the BFF's own abort answer first when it's the one that gives up.
 *
 * The BFF-side 10s bound being too tight for real report generation is a
 * backend-adjacent gap this change does not fix — see issue #197.
 */
const PDF_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Fetch a binary PDF from a same-origin BFF route and trigger a browser
 * download via a temporary `<a download>` click. Bypasses `request<T>`
 * (which unconditionally calls `.json()`) since a PDF export needs the raw
 * bytes, not a parsed JSON body — but still aborts on its own deadline
 * (`PDF_DOWNLOAD_TIMEOUT_MS`), and still tells that abort apart from a
 * caller-initiated cancellation exactly like `request()` does, throwing
 * `ApiTimeoutError` (not a bare `AbortError`) so `toUserMessage` renders the
 * timeout sentence instead of the cancellation one. Reads the served
 * filename from the `Content-Disposition` header when present, falling back
 * to `fallbackFilename` otherwise.
 */
export async function downloadBlob(endpoint: string, fallbackFilename: string): Promise<void> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PDF_DOWNLOAD_TIMEOUT_MS);

  let response: Response;
  let blob: Blob;
  try {
    response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) {
      // The HTTP code used to be printed at the user here (`(status 504)`). It
      // told them nothing they could act on and it is already on the error.
      // Shares `GENERIC_FAILURE` with `request()` rather than its own wording:
      // both are the client's placeholder for "the body carried nothing usable",
      // and `error-message.ts` special-cases that exact string so it never beats
      // a caller's own fallback (e.g. "No se pudo generar el PDF del reporte.").
      // A second, differently-worded generic here would have re-opened that gap.
      let message = GENERIC_FAILURE;
      try {
        const errorBody: unknown = await response.json();
        if (isApiErrorBody(errorBody)) {
          message = errorBody.detail ?? errorBody.message ?? message;
        }
      } catch (parseError: unknown) {
        // A parse error is nothing to report — the status says enough. Our own
        // deadline firing mid-read is NOT one, though: this read runs under the
        // same signal, and swallowing it would ship a timeout as a server failure.
        if (timedOut && parseError instanceof Error && parseError.name === "AbortError") {
          throw parseError;
        }
      }
      throw new ApiClientError(message, response.status);
    }

    // `fetch()` settles on HEADERS; the PDF bytes stream after. Reading them
    // outside this try would run with the timer already cleared — a backend
    // that answers headers promptly and then stalls would hang forever.
    blob = await response.blob();
  } catch (error: unknown) {
    if (timedOut && error instanceof Error && error.name === "AbortError") {
      throw new ApiTimeoutError(PDF_DOWNLOAD_TIMEOUT_MS);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

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

/** Payload for registering a new pending payment — `POST /api/membresias/pagos`.
 *  `monto` is always the BASE amount: when `descuentoIds` are attached the
 *  backend resolves each discount's current value, freezes it and computes
 *  the final amount itself (frozen-value semantics, issue #12).
 *
 *  No `fechaInicio`/`fechaFin` (fix período de cobertura, PAG-5): the
 *  backend derives the coverage period from `monto` and the membership's
 *  monthly price -- the old contract let the caller hand it any range
 *  regardless of `monto`, which is exactly the hole this fix closes (see
 *  docs/fixes/06-periodo-de-cobertura.md). Callers can still PREVIEW the
 *  period client-side (`wholeMonthsFor` / `addMonthsIso`) to show the
 *  reader what they're about to pay for, but nothing here is sent. */
export interface RegistrarPagoInput {
  monto: number;
  tipoPago: "EFECTIVO" | "TRANSFERENCIA";
  personaId: number;
  membresiaId: number;
  /** Catalog discounts to apply on THIS registration (admin-only decision).
   *  Optional and default-empty so existing flows are unchanged. */
  descuentoIds?: number[];
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

// ---------------------------------------------------------------------------
// Descuentos — catálogo del club (issue #12, admin-only)
// ---------------------------------------------------------------------------

/**
 * `DescuentoResponseDTO` (backend app/presentacion/schemas/descuento_schemas.py).
 * Exactly one of `porcentaje`/`monto` is set — the catalog invariant. Decimals
 * arrive serialized as strings, same as `PagoPersona.monto`.
 */
export interface DescuentoCatalogo {
  id: number;
  nombre: string;
  porcentaje: string | null;
  monto: string | null;
  activo: boolean;
}

/** Payload for creating a catalog discount — exactly one of porcentaje/monto. */
export interface CrearDescuentoInput {
  nombre: string;
  porcentaje: number | null;
  monto: number | null;
}

/** PATCH payload: only the provided fields are applied. Explicit nulls in
 *  `porcentaje`/`monto` are meaningful — they clear the other modality. */
export interface ActualizarDescuentoInput {
  nombre?: string;
  porcentaje?: number | null;
  monto?: number | null;
  activo?: boolean;
}

/** Admin-only: full discount catalog, ACTIVE AND INACTIVE — `GET /api/descuentos`.
 *  The list is the administration view (and the road to reactivating). */
export async function fetchDescuentos(): Promise<DescuentoCatalogo[]> {
  return request<DescuentoCatalogo[]>(apiEndpoint("/descuentos"), { method: "GET" });
}

/** Admin-only: create a catalog discount — `POST /api/descuentos`. */
export async function crearDescuento(data: CrearDescuentoInput): Promise<DescuentoCatalogo> {
  return request<DescuentoCatalogo>(apiEndpoint("/descuentos"), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Admin-only: partial update / soft toggle — `PATCH /api/descuentos/:id`.
 *  There is no DELETE: deactivating is the only "removal" (history keeps
 *  referencing the discount by FK; applied values stay frozen). */
export async function actualizarDescuento(
  id: number,
  data: ActualizarDescuentoInput,
): Promise<DescuentoCatalogo> {
  return request<DescuentoCatalogo>(apiEndpoint(`/descuentos/${id}`), {
    method: "PATCH",
    body: JSON.stringify(data),
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

/**
 * Admin-only: remove a backend role from a persona.
 *
 * The role travels in the query string, not as a path segment: the BFF handler
 * is `app/api/personas/[id]/roles/route.ts` and there is no `[tipoRol]` segment
 * below it, so `/roles/ENTRENADOR` resolves to no handler and Next.js answers
 * its HTML 404 page. It is the BFF that re-shapes this into the backend's
 * `DELETE /personas/{id}/roles/{tipo_rol}`.
 */
export async function quitarRol(personaId: number, tipoRol: BackendTipoRol): Promise<RolesResponse> {
  return request<RolesResponse>(
    apiEndpoint(`/personas/${personaId}/roles?tipoRol=${encodeURIComponent(tipoRol)}`),
    { method: "DELETE" },
  );
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

/**
 * INS-2 (docs/decisiones-de-negocio-2026-08-11.md §1): representante-only
 * self-service, links a person ALREADY registered in the club (typically by
 * another representante) to `personaId`'s account by cédula alone — no
 * approval from anyone. See `POST /personas/{persona_id}/vincular-representado`.
 *
 * The backend answers every ineligible cédula (nonexistent, adult, already
 * yours, your own) with the SAME generic message and the SAME 400 — that is
 * intentional (anti-enumeration), not a bug to work around here.
 */
export async function vincularRepresentado(personaId: number, cedula: string): Promise<PersonaResponse> {
  return request<PersonaResponse>(apiEndpoint(`/personas/${personaId}/vincular-representado`), {
    method: "POST",
    body: JSON.stringify({ cedula }),
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
  tipoCuenta: "JUGADOR" | "REPRESENTANTE" | "MENOR" | "ENTRENADOR";
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

/**
 * Admin-only: update a person's medical record. `enfermedades` replaces the
 * full list.
 *
 * Sends `data` as-is (camelCase) — the BFF route is the single place that
 * converts to the backend's snake_case. Converting here too used to rename
 * `tipoSangre`/`contactoEmergencia`/`telefonoEmergencia` before the route
 * could read them, silently dropping all three.
 */
export async function actualizarFichaMedica(
  personaId: number,
  data: FichaMedicaUpdatePayload,
): Promise<FichaMedicaEditable> {
  return request<FichaMedicaEditable>(apiEndpoint(`/fichas-medicas/persona/${personaId}`), {
    method: "PATCH",
    body: JSON.stringify(data),
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

/**
 * `AsignacionAlumnoHorarioResponseDTO` on the backend
 * (`backend/app/presentacion/schemas/asistencia_schemas.py`) -- INS-6, decisión
 * de negocio #4 (2026-08-11): assigning a student with an overdue (VENCIDA)
 * membership stays allowed, so this rides alongside `asignaciones` as a
 * non-blocking warning instead of an error. `diasVencida` is `null` when the
 * membership isn't vencida, or when it is but no approved payment exists to
 * derive "since when" from.
 */
export interface AsignacionAlumnoHorarioResponse {
  asignaciones: AlumnoHorario[];
  membresiaVencida: boolean;
  diasVencida: number | null;
}

/**
 * Assign a student to the WHOLE training categoria `horario_id` belongs to.
 * The club enrolls by full month, never by a loose weekday, so the backend
 * enrolls the student into every horario row of that categoria in one
 * atomic transaction and returns one `AlumnoHorario` per row created, plus
 * the overdue-membership warning (see `AsignacionAlumnoHorarioResponse`).
 */
export async function asignarAlumnoAHorario(
  data: AsignarAlumnoHorarioDTO,
): Promise<AsignacionAlumnoHorarioResponse> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<AsignacionAlumnoHorarioResponse>(apiEndpoint("/groups/asignar-alumno"), {
    method: "POST",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

/** Unassign a student from the WHOLE training categoria `horarioId` belongs
 * to — mirror of `asignarAlumnoAHorario`, same atomic-by-categoria backend
 * behavior. */
export async function desasignarAlumnoDeHorario(personaId: number, horarioId: number): Promise<void> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  await request<unknown>(
    apiEndpoint(`/groups/desasignar-alumno?persona_id=${personaId}&horario_id=${horarioId}`),
    { method: "DELETE", headers: mockHeaders },
  );
}

/** List the students assigned to a specific schedule (one page at the backend's cap). */
export async function fetchAlumnosPorHorario(horarioId: number): Promise<AlumnoHorario[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  // Paginated (issue #7): standard `{items, total}` envelope. A single class
  // roster is bounded in practice, so one page at the cap keeps every caller
  // (groups, trainer, trainer/attendance) working unchanged.
  const { items } = await request<PaginatedEnvelope<AlumnoHorario>>(
    apiEndpoint(`/groups/horarios/${horarioId}/alumnos?limit=${ROSTER_PAGE_LIMIT}`),
    { headers: mockHeaders },
  );
  return items;
}

/**
 * Roster of EVERY training schedule, in ONE call (TRA-7). Replaces the old
 * `/groups` pattern of one `fetchAlumnosPorHorario` per horario (26 calls,
 * fixed — grows only with category count, never with the padrón) used to
 * build the "N inscriptos" card counts. Deliberately unpaginated, matching
 * the backend route.
 */
export async function fetchRosterDeTodosLosHorarios(): Promise<AlumnoHorario[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<AlumnoHorario[]>(apiEndpoint("/groups/horarios/alumnos"), { headers: mockHeaders });
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
 * Longer than DEFAULT_TIMEOUT_MS (10s) and deliberately just past the BFF's own
 * CHATBOT_TIMEOUT_MS (30s, see src/app/api/chatbot/route.ts). An LLM completion
 * routinely takes 3-6s and can take longer, so the shared 10s default aborted
 * live requests: the caller got a bare AbortError with no status, which the
 * widget could only render as the same generic "no se pudo contactar" as a dead
 * backend. Letting the BFF's own abort win means a slow answer comes back as a
 * real 504 the widget can name.
 */
const CHATBOT_TIMEOUT_MS = 33_000;

/**
 * Ask the FAQ chatbot a question. `historial` is the last few turns of the
 * conversation (the caller is responsible for capping it — see
 * ChatWidget.tsx) so the backend can keep the multi-turn context without
 * this client needing to know its cap.
 *
 * Failures surface as `ApiClientError` carrying the BFF's status: 429 (asking
 * too fast), 504 (took too long), 503 (assistant unreachable), 502 (anything
 * else). ChatWidget renders one message per class.
 */
export async function consultarChatbot(mensaje: string, historial?: ChatbotTurno[]): Promise<ChatbotRespuesta> {
  return request<ChatbotRespuesta>(
    apiEndpoint("/chatbot"),
    {
      method: "POST",
      body: JSON.stringify({ mensaje, historial }),
    },
    CHATBOT_TIMEOUT_MS,
  );
}
