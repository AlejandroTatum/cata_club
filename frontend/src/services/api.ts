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
  PaginatedResponse,
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
  proofFileType: ProofFileType;
  proofPreviewUrl?: string;
  validationStatus: ValidationStatus;
  rejectionReason?: string;
  validatedAt?: string;
  validatedBy?: string;
  startDate: string;
  endDate: string;
  /** `true` when the approve/reject itself succeeded but the in-app
   *  notification to the student/guardian could not be sent — the decision
   *  above (`validationStatus`, `rejectionReason`) is still final and real.
   *  Only ever set by `PUT /api/payments/[id]`; absent elsewhere. */
  notificationDeliveryFailed?: boolean;
  /**
   * The club's OFFICIAL PDF receipt (issue #400, criterio 8) — distinct
   * from `proofPreviewUrl`, which is the voucher the payer uploaded.
   * Absent on the queue LIST (`PagoListItemDTO` never carried this field,
   * and still doesn't — deliberately not touched, see the backend PR for
   * this slice), only ever populated by `fetchPagoDetalle` for an
   * already-approved payment's own detail view.
   */
  comprobanteOficialUrl?: string;
}

/**
 * DTO for approving a payment validation request.
 *
 * No `startDate`/`endDate` here (issue #400): Administración can no longer
 * edit `fecha_inicio`/`fecha_fin` at approval time. Coverage comes only
 * from the month-based engine that runs at registration — approving just
 * confirms it.
 */
export interface ApprovePaymentDTO {
  action: "approved";
  /**
   * Required only when approving a TRANSFERENCIA with no voucher attached
   * (issue #459) — the audited exception for "the admin verified the bank
   * account directly". Omitted for every other approval (a transfer with a
   * voucher, or an efectivo payment); the backend (`PagoServicio.
   * validar_pago`) is the single source of truth for when it is actually
   * mandatory and rejects the request with a 400 if it's missing there.
   */
  exceptionReason?: string;
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
  /**
   * Whether the backend explicitly marked THIS message as safe to show a
   * member as-is (issue #355, `mensaje_seguro` in the response body — see
   * `ErrorDominio.seguro_mostrar` in `backend/app/dominio/excepciones.py`).
   * Defaults `false`: fail closed for the two synthetic call sites in this
   * file that build an `ApiClientError` from scratch, with no response body
   * to have marked anything at all.
   */
  public readonly safe: boolean;
  /**
   * The failure's machine-readable name, when the responder gave one (`code`
   * in the response body). A status is a class of failure, not a reason: one
   * route can answer `400` for a malformed body, an empty message and a
   * message that is simply too long, and a client that only sees the number
   * has to guess which — which is how "your message is 2500 characters" came
   * to be reported to the user as "we could not reach the assistant".
   * `undefined` whenever nobody said, so a caller must fall back to the status
   * rather than assume.
   */
  public readonly code: string | undefined;
  /**
   * Seconds to wait before retrying, when the responder sent `Retry-After`
   * (issue #708 — the chatbot's burst limit is the one caller that sends it
   * today; see `_manejador_limite_excedido` in `backend/main.py`, which
   * computes it from the limiter's own window rather than a guess). `undefined`
   * whenever the header is absent or not a plain non-negative number, so a
   * caller falls back deliberately instead of showing a wait that was never
   * really said.
   */
  public readonly retryAfterSeconds: number | undefined;
  /** The backend's structured validation location, when safely preserved by the BFF. */
  public readonly validationLoc: string[] | undefined;

  constructor(message: string, status: number, safe = false, code?: string, retryAfterSeconds?: number, validationLoc?: string[]) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.safe = safe;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.validationLoc = validationLoc;
  }
}

/**
 * `Retry-After` as this app's own backend ever sends it: a plain integer
 * count of seconds (see `_manejador_limite_excedido`, `backend/main.py`) —
 * never the HTTP-date form the header also allows. Anything else (absent,
 * non-numeric, negative) stays `undefined` rather than feeding a bad number
 * to a caller that would otherwise display it as-is.
 */
function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
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
      let safe = false;
      let code: string | undefined;
      let errorBody: unknown;
      let validationLoc: string[] | undefined;
      try {
        errorBody = await response.json();
        if (isApiErrorBody(errorBody)) {
          // A structured 422 detail is intentionally not rendered; only its safe location is retained.
          message = typeof errorBody.detail === "string" ? errorBody.detail : errorBody.message ?? message;
          safe = errorBody.mensaje_seguro === true;
          if (typeof errorBody.code === "string" && errorBody.code.length > 0) code = errorBody.code;
          validationLoc = parseValidationLoc(errorBody);
        }
      } catch {
        // ignore parse errors — use default message
      }
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("Retry-After"));
      throw new ApiClientError(message, response.status, safe, code, retryAfterSeconds, validationLoc);
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
 * `GET /api/payments` response shape (issue #400, criterio 4/5) — `total` is
 * the backend's real count for whatever filter was applied, independent of
 * how many `items` this particular call brought back. See
 * `fetchPaymentValidationsPage` below for why this matters.
 */
interface PaginatedPaymentValidations {
  items: PaymentValidationRequest[];
  total: number;
}

/**
 * Fetch payment validation requests, unpaginated (up to the BFF's default
 * page size) — kept for callers that only need "whatever's there" and never
 * page through it, e.g. the dashboard's activity summary
 * (`app/dashboard/page.tsx`). Do NOT use this for the `/payments` queue
 * table itself; see `fetchPaymentValidationsPage`.
 */
export async function fetchPaymentValidations(): Promise<PaymentValidationRequest[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  const result = await request<PaginatedPaymentValidations>(apiEndpoint("/payments"), {
    headers: mockHeaders,
  });
  return result.items;
}

/** Backend `EstadoPago` — the three states `/membresias/pagos` can filter by. */
export type BackendEstadoPago = "PENDIENTE_VALIDACION" | "APROBADO" | "RECHAZADO";

/**
 * Fetch ONE real page of the payment validation queue — `GET /api/payments`
 * with `skip`/`limit` (and, optionally, `estadoPago`) forwarded to the
 * backend's own paginated `GET /membresias/pagos` (issue #400, criterio
 * 4/5).
 *
 * Before this, `/payments/page.tsx` fetched a single batch of up to 200
 * requests and paginated CLIENT-SIDE over that already-truncated array — a
 * club with more than 200 historical payment requests silently lost the
 * rest, with no error and no signal. This function is the replacement: each
 * UI page is its own backend round trip, so `total` (not
 * `PAYMENTS_FETCH_LIMIT`) is the real, unbounded count.
 */
export async function fetchPaymentValidationsPage(params: {
  skip: number;
  limit: number;
  estadoPago?: BackendEstadoPago;
}): Promise<PaginatedPaymentValidations> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  const qs = new URLSearchParams({ skip: String(params.skip), limit: String(params.limit) });
  if (params.estadoPago) qs.set("estadoPago", params.estadoPago);
  return request<PaginatedPaymentValidations>(apiEndpoint(`/payments?${qs.toString()}`), {
    headers: mockHeaders,
  });
}

/**
 * Backend's own per-request ceiling on `GET /membresias/pagos`
 * (`limit: int = Query(..., le=200)`) — the largest page
 * `fetchAllPaymentValidations` can ask for per round trip.
 */
const DRAIN_PAGE_SIZE = 200;

/**
 * Hard bound on pages drained by one `fetchAllPaymentValidations` call.
 * Mirrors `MAX_PAGES_PER_SOURCE` in `lib/server/paged-fetch.ts` (same
 * reasoning: at the 200-row backend cap this is 10 000 rows, the same
 * ceiling `LIMITE_MAXIMO_REPORTE_PAGOS` puts on the backend's own pagos
 * report) — a defensive bound against a backend that misreports `total` or
 * ignores `skip`, not a limit anyone should reach in normal operation.
 */
const MAX_DRAIN_PAGES = 50;

/**
 * Drains EVERY row of the payment validation queue for a given filter,
 * making as many `fetchPaymentValidationsPage` calls as it takes (issue
 * #400, criterio 4/5 — "drena la paginación completa o pagina de forma
 * explícita; nunca corta silenciosamente en 200").
 *
 * `/payments/page.tsx`'s main table deliberately chose the OTHER strategy
 * ("pagina de forma explícita" — one real backend page per UI page,
 * `fetchPaymentValidationsPage`), which is correct for free navigation
 * through an arbitrarily large list. This function is for the two places on
 * that same screen that need the FULL set, not a window into it: the
 * pending-queue "Pendiente X de Y" prev/next navigator (which must be able
 * to reach every pending request, not just the ones on whatever page
 * happens to be open) and the search box (which must be able to find a
 * match anywhere in the active filter, not just on the currently visible
 * page).
 *
 * Stops on the first SHORT page (fewer rows than requested) or once it has
 * accumulated at least `total` rows — the real end-of-list signal, not a
 * client-guessed count. Bounded by `MAX_DRAIN_PAGES` so a backend that
 * never returns a short page cannot hang the caller forever.
 */
export async function fetchAllPaymentValidations(
  estadoPago?: BackendEstadoPago,
): Promise<PaymentValidationRequest[]> {
  const items: PaymentValidationRequest[] = [];
  let skip = 0;
  for (let page = 0; page < MAX_DRAIN_PAGES; page += 1) {
    const result = await fetchPaymentValidationsPage({ skip, limit: DRAIN_PAGE_SIZE, estadoPago });
    items.push(...result.items);
    if (result.items.length < DRAIN_PAGE_SIZE || items.length >= result.total) return items;
    skip += DRAIN_PAGE_SIZE;
  }
  // Fell out of the bound with the source still claiming more rows: what we
  // hold is a prefix. Same posture as `paged-fetch.ts`'s identical guard —
  // a degradation that would otherwise repeat silently on every request
  // while looking exactly like "that's just how many there are".
  console.warn(
    `[fetchAllPaymentValidations] exhausted ${MAX_DRAIN_PAGES} pages of ${DRAIN_PAGE_SIZE}; ` +
      `returning ${items.length} rows as a possibly-incomplete prefix`,
  );
  return items;
}

/**
 * Re-check ONE payment's REAL current state (issue #456) — `GET
 * /api/payments/{id}`.
 *
 * `/payments/page.tsx` calls this after a failed/timed-out
 * `updatePaymentValidation`, before deciding what to tell the admin: a
 * network error or timeout does not mean the write never reached the
 * server (reproduced live — the backend can commit while the client only
 * sees a dropped connection), so "it failed" can only be shown once this
 * re-check confirms the payment is still `pendiente`.
 */
export async function fetchPaymentValidationById(id: string): Promise<PaymentValidationRequest> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PaymentValidationRequest>(apiEndpoint(`/payments/${id}`), {
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
 * session (issue #13, docs/product/concepto-alcance-modelo.md §4). */
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
  /** Who took the list (issue #263), persisted by the backend — surfaced on the receipt. */
  registradoPorNombre?: string | null;
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
  /** Optional ages label (#789), e.g. "5 a 10 años" — orientation copy for the
   *  board, never a rule. `null` when the categoría publishes none, which the
   *  route normalises so absent and cleared look the same here. */
  edades: string | null;
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

/**
 * A club session (horario + fecha) with at least one Asistencia, and its
 * four counts. No author, no per-student name — see
 * `/api/attendance/recent-sessions`'s own doc comment (Fix 8 / DSH-2,
 * decisiones-de-negocio-2026-08-11.md §8).
 */
export interface RecentAttendanceSession {
  horarioId: number;
  fecha: string;
  horario: string;
  counts: Record<EstadoAsistencia, number>;
  total: number;
}

/** The club's most recent attendance sessions, most recent first. Powers the trainer panel's "Últimas listas del club". */
export async function fetchRecentAttendanceSessions(limit = 5): Promise<RecentAttendanceSession[]> {
  return request<RecentAttendanceSession[]>(apiEndpoint(`/attendance/recent-sessions?limit=${limit}`));
}

/** Persist attendance for a session (one real `POST /asistencias` per student, partial-failure-tolerant). */
export async function registerAttendance(data: RegisterAttendanceRequest): Promise<RegisterAttendanceResult> {
  return request<RegisterAttendanceResult>(apiEndpoint("/attendance/records"), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Attendance correction (issue #389, slice 4b) — the dedicated door for
// fixing an already-closed session, distinct from `registerAttendance`
// (which the backend now refuses a second time for the same row).
// ---------------------------------------------------------------------------

/** Request body for `PATCH /api/attendance/records/{id}/correct`. The three
 *  mutable fields travel together, same as the original registration —
 *  never field by field — and `motivo` is the one genuinely new, mandatory
 *  input this operation introduces. */
export interface CorrectAttendanceInput {
  estado: EstadoAsistencia;
  justificativo?: string | null;
  estadoJustificativo?: boolean | null;
  motivo: string;
}

/** Confirms the correction with the updated row plus the trace that got
 *  recorded — an admin needs to see it took, not only the new value. */
export interface CorrectAttendanceResult {
  asistencia: AttendanceRecord;
  corregidoPorId: number;
  corregidoPorNombre: string;
  corregidoEn: string;
  motivo: string;
  estadoAnterior: EstadoAsistencia;
  justificativoAnterior?: string | null;
  estadoJustificativoAnterior?: boolean | null;
}

/** One entry of a row's correction history — same shape as
 *  `CorrectAttendanceResult` minus the nested `asistencia` (the caller
 *  already has the current row). Most-recent-first, as the backend orders it. */
export interface AttendanceCorrectionEntry {
  id: number;
  corregidoPorId: number;
  corregidoPorNombre: string;
  corregidoEn: string;
  motivo: string;
  estadoAnterior: EstadoAsistencia;
  justificativoAnterior?: string | null;
  estadoJustificativoAnterior?: boolean | null;
}

/** Correct one already-filed Asistencia row — `PATCH /api/attendance/records/{id}/correct`.
 *  ADMINISTRADOR-only in the backend; a 30-day window past `fechaEntrenamiento`. */
export async function correctAttendance(
  asistenciaId: number,
  data: CorrectAttendanceInput,
): Promise<CorrectAttendanceResult> {
  return request<CorrectAttendanceResult>(apiEndpoint(`/attendance/records/${asistenciaId}/correct`), {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** List the correction history of one Asistencia row, most-recent-first —
 *  `GET /api/attendance/records/{id}/corrections`. ADMINISTRADOR-only. */
export async function fetchAttendanceCorrections(asistenciaId: number): Promise<AttendanceCorrectionEntry[]> {
  return request<AttendanceCorrectionEntry[]>(apiEndpoint(`/attendance/records/${asistenciaId}/corrections`));
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

// ---------------------------------------------------------------------------
// Categorías (docs/archive/fixes/24-abm-categorias.md) — atomic ABM
// ---------------------------------------------------------------------------

/**
 * A `categoria_horario` row as this endpoint family returns it — same
 * untranslated backend day-code space (`"LUNES"`..`"DOMINGO"`) as `Horario`
 * above, NOT the frontend `DiaSemana` codes `@/services/categorias`
 * translates for other pages (see that module's own doc comment on why the
 * two coexist).
 */
export interface CategoriaGrupo {
  codigo: string;
  label: string;
  horaInicio: string;
  horaFin: string;
  dias: string[];
  /** Optional ages label (#789) — `null` when the categoría publishes none. */
  edades?: string | null;
}

/**
 * `codigo` is intentionally absent: the server derives it from `nombre`
 * (`AsistenciaServicio._generar_codigo`) and it never changes afterwards —
 * see that method's doc comment for why (it is the FK
 * `horario_entrenamiento.categoria` relies on).
 */
export interface CrearCategoriaDTO {
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  dias: string[];
  /** Optional ages label (#789). Sent as typed — the backend
   *  (`AsistenciaServicio._normalizar_edades`) is the single normaliser that
   *  trims it and stores blank as NULL. */
  edades?: string;
}

/** `dias`, if present, REPLACES the categoria's whole day-set (not a delta)
 *  — see `AsistenciaServicio.actualizar_categoria`. */
export interface ActualizarCategoriaDTO {
  nombre?: string;
  hora_inicio?: string;
  hora_fin?: string;
  dias?: string[];
  /** Optional ages label (#789). OMIT it to leave the stored label untouched;
   *  send `""` to CLEAR it (the backend normalises blank to NULL). */
  edades?: string;
}

/** Create a categoria AND a horario per día marked, in one atomic operation
 *  (the owner's own words: "quisiera que se cree directo el horario y
 *  categoría, no diferentes"). */
export async function crearCategoria(data: CrearCategoriaDTO): Promise<CategoriaGrupo> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<CategoriaGrupo>(apiEndpoint("/groups/categorias"), {
    method: "POST",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

/** Edit a categoria's nombre/franja/días atomically — re-derives hours on
 *  the horarios that remain and backfills `alumno_horario` for any newly
 *  added día (see the backend service method's own doc comment). */
export async function actualizarCategoria(codigo: string, data: ActualizarCategoriaDTO): Promise<CategoriaGrupo> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<CategoriaGrupo>(apiEndpoint(`/groups/categorias/${encodeURIComponent(codigo)}`), {
    method: "PUT",
    body: JSON.stringify(data),
    headers: mockHeaders,
  });
}

/** Delete a categoria and every one of its horarios. Blocked server-side
 *  (400) when any of them already has `Asistencia` history — history is
 *  never deleted. */
export async function eliminarCategoria(codigo: string): Promise<void> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  await request<unknown>(apiEndpoint(`/groups/categorias/${encodeURIComponent(codigo)}`), {
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

/**
 * One row of the public, unauthenticated tariff catalog (issue #394 contract,
 * issue #331 consumer). Mirrors `TarifaPublicaDTO`
 * (`backend/app/presentacion/schemas/membresia_pago_schemas.py`) — deliberately
 * ONLY `categoria` and `precio`, no `id`/`modalidad`: those are admin editing
 * details, not what an anonymous visitor needs before enrolling.
 * `precio` stays a STRING: FastAPI/Pydantic serialise `Decimal` to a JSON
 * string, and `formatCurrency` already accepts one directly — converting to
 * `number` here would only reintroduce float rounding for no benefit.
 */
export interface TarifaPublica {
  categoria: string;
  precio: string;
}

function isTarifaPublica(value: unknown): value is TarifaPublica {
  if (typeof value !== "object" || value === null) return false;
  const tarifa = value as Record<string, unknown>;
  return typeof tarifa.categoria === "string" && typeof tarifa.precio === "string";
}

/**
 * Fetch the public membership tariff catalog (read-only, no auth) — issue
 * #331 shows this to a visitor before the enrollment wizard's first field.
 * Unlike `fetchInstituciones`, the backend endpoint is deliberately
 * unpaginated (small, low-churn catalog), so this is a single request that
 * returns the backend's FLAT array verbatim — no `{items, total}` envelope.
 */
export async function fetchTarifas(): Promise<TarifaPublica[]> {
  const response: unknown = await request<unknown>(apiEndpoint("/membresias/tarifas"));
  if (!Array.isArray(response) || !response.every(isTarifaPublica)) {
    throw new ApiClientError("Respuesta inválida de tarifas.", 502);
  }
  return response;
}

function isApiErrorBody(
  value: unknown,
): value is { message?: string; detail?: string | unknown[]; mensaje_seguro?: unknown; code?: unknown; validation_loc?: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (typeof body.message === "string" && body.message.length > 0) ||
    (typeof body.detail === "string" && body.detail.length > 0) || Array.isArray(body.detail);
}

function parseValidationLoc(value: unknown): string[] | undefined {
  if (!isApiErrorBody(value) || !Array.isArray(value.validation_loc)) return undefined;
  return value.validation_loc.every((part): part is string => typeof part === "string")
    ? value.validation_loc
    : undefined;
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
  /**
   * National ID, as the BFF's `StudentProfileView` resolves it. Optional here
   * because a client should render the row only when it has one — an absent
   * cédula is a row the carnet leaves out, never a blank one it rules.
   *
   * The one screen that reads it is the carnet, and that is deliberate: it is
   * personal data on a CARRIED object, so it belongs on the credential and on
   * the person's own ficha, and never in a table or a list.
   */
  cedula?: string | null;
  fechaNacimiento: string;
  recentSessions: StudentSessionSummary[];
  membership: MembershipSummary | null;
  representante: { nombres: string; apellidos: string } | null;
  representanteId: number | null;
  /** Profile photo URL (Cloudinary). Absent/null until someone uploads one. */
  fotoUrl?: string | null;
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
  /**
   * `MembresiaResponseDTO.es_gratuidad_familiar` (issue #400, slice 4c-a) —
   * the authoritative gratuity signal; a zero `montoAplicado` is NOT
   * necessarily gratuity (see `MembresiaPorPersona.esGratuidadFamiliar`'s
   * doc comment for the two-zero-classes rationale). Optional so the
   * hand-built fixtures in StudentPage.test.tsx / StudentPaymentsPage.test.tsx
   * / ProfilePage.test.tsx keep type-checking without every one of them
   * naming this field; `buildMembershipView` (student-adapter.ts)
   * normalizes it to `false` server-side before this ever reaches the client.
   */
  esGratuidadFamiliar?: boolean;
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
      let safe = false;
      try {
        const errorBody: unknown = await response.json();
        if (isApiErrorBody(errorBody)) {
          message = typeof errorBody.detail === "string"
            ? errorBody.detail
            : errorBody.message ?? message;
          safe = errorBody.mensaje_seguro === true;
        }
      } catch (parseError: unknown) {
        // A parse error is nothing to report — the status says enough. Our own
        // deadline firing mid-read is NOT one, though: this read runs under the
        // same signal, and swallowing it would ship a timeout as a server failure.
        if (timedOut && parseError instanceof Error && parseError.name === "AbortError") {
          throw parseError;
        }
      }
      throw new ApiClientError(message, response.status, safe);
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

/** Confirm an email address using the token from the link (issue #790). */
export async function verificarCorreo(token: string): Promise<void> {
  await request<void>(apiEndpoint('/auth/verificar-correo'), {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Ask for a fresh verification link (POST /auth/verificar-correo/reenviar).
 * Like `solicitarRecuperacion`, the backend answers the same way whether the
 * address is registered or not, and whether or not it is already verified —
 * callers must show that message as-is and never branch on it.
 */
export async function reenviarVerificacionCorreo(correo: string): Promise<{ mensaje: string }> {
  return request<{ mensaje: string }>(apiEndpoint('/auth/verificar-correo/reenviar'), {
    method: 'POST',
    body: JSON.stringify({ correo }),
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
  // "SUSPENDIDA" (issue #400, criterio 3): faltaba en esta unión aunque el
  // backend ya la devuelve desde la entrega 06 -- `suspenderMembresia`/
  // `reactivarMembresia`/`cambiarPlanMembresia` devuelven este mismo tipo, y
  // sin este valor un `estado === "SUSPENDIDA"` en la UI no compilaría.
  estado: "INACTIVA" | "ACTIVA" | "VENCIDA" | "SUSPENDIDA";
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
  /**
   * `MembresiaResponseDTO.es_gratuidad_familiar` (issue #400, slice 4c-a) —
   * the authoritative gratuity signal, not a zero `montoAplicado` (a zero
   * price with this flag false is an "unexplained zero", not gratuity — see
   * `backend/scripts/inventario_anomalias_membresias.py`). Optional: this is
   * a raw passthrough type (the `/api/membresias/...` BFF routes proxy the
   * backend JSON as-is), so an older backend simply omits the key.
   */
  esGratuidadFamiliar?: boolean;
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
  // REGULARIZACION (issue #935, backend since #284): bookkeeping-only, an
  // admin-run debt regularization that lands directly on the persona's own
  // payment history.
  tipoPago: "EFECTIVO" | "TRANSFERENCIA" | "REGULARIZACION";
  fechaRegistro: string;
  fechaValidacion: string | null;
  fechaInicio: string;
  fechaFin: string;
  personaId: number;
  membresiaId: number;
  voucherUrl: string | null;
  voucherFormato: string | null;
  /**
   * El descuento CONGELADO que el club aplicó a este pago, o `null` cuando no
   * llevó ninguno (hallazgo de QA humana del 17/08/2026: el socio veía el
   * monto ya descontado sin nada que lo explicara).
   *
   * Solo dos de las cuatro columnas `descuento_*` de `PagoResponseDTO` se
   * declaran acá, a mano y no por espejo del modelo: `descuentoId` es el id
   * del catálogo, que esta pantalla no muestra ni resuelve, y
   * `descuentoAutorizadoPorPersonaId` es auditoría interna — a quién autorizó
   * la rebaja el socio no tiene por qué leerlo, y publicarlo sería exponer un
   * identificador de persona sin ningún uso en la vista. Mismo criterio que
   * `FichaEmergenciaResponseDTO`.
   *
   * Aplicar descuentos es potestad EXCLUSIVA del administrador. Desde el
   * issue #398 ya no se elige por pago (`RegistrarPagoInput` no lleva
   * `descuentoIds`): el admin asigna o retira el beneficio de la persona con
   * `asignarBeneficio`/`retirarBeneficio`, y `registrar_pago` lo resuelve
   * solo, ignorando cualquier `descuento_ids` que todavía llegue. Acá sigue
   * viajando en un solo sentido, de lectura.
   *
   * No existe un campo con el precio de lista: `monto` ES el monto final
   * (`registrar_pago` hace `pago.monto = monto_final`) y el base se reconstruye
   * sumándole `descuentoValorAplicado` — ver `describePagoDescuento`.
   */
  descuentoValorAplicado: string | null;
  /** Porcentaje vigente al aplicarlo, o `null` si el descuento era de monto fijo. */
  descuentoPorcentajeAplicado: string | null;
  /**
   * El comprobante OFICIAL en PDF que el club genera al aprobar (issue #400,
   * criterio 8) — distinto de `voucherUrl` (la evidencia que SUBE el
   * alumno). `null`/ausente cuando el pago no fue aprobado, o cuando el PDF
   * todavía no terminó de generarse. Opcional (a diferencia de los demás
   * campos, que el backend siempre serializa): mismo criterio que
   * `MembresiaPorPersona.esGratuidadFamiliar` — así los fixtures ya
   * existentes en la suite de tests, escritos antes de este campo, siguen
   * tipando sin tener que tocarlos uno por uno.
   */
  comprobanteOficialUrl?: string | null;
  /**
   * Por qué se aprobó ESTA transferencia sin comprobante adjunto (issue
   * #459, excepción auditada) — `null`/ausente salvo en ese caso exacto.
   * Opcional por el mismo motivo que `comprobanteOficialUrl`: los fixtures
   * de test ya existentes, escritos antes de este campo, no tienen por qué
   * tocarse uno por uno.
   */
  motivoExcepcionSinComprobante?: string | null;
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

/**
 * A single pago's own detail, any status — admin-facing (issue #400,
 * criterio 7/8): `GET /api/membresias/pagos/:pagoId`, proxying the
 * backend's `GET /membresias/pagos/{pago_id}` (dueño/representante/admin
 * authorization enforced backend-side). The admin queue's list view
 * (`PagoListItemDTO`) never carried `comprobanteOficialUrl` nor a
 * correction history — this is the one extra round trip
 * `/payments/page.tsx` makes when it opens the detail of an ALREADY
 * VALIDATED payment, to fetch both.
 */
export async function fetchPagoDetalle(pagoId: number): Promise<PagoPersona> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PagoPersona>(apiEndpoint(`/membresias/pagos/${pagoId}`), {
    headers: mockHeaders,
  });
}

// ---------------------------------------------------------------------------
// Corrección financiera de pagos (issue #400, criterio 7)
// ---------------------------------------------------------------------------

/**
 * `CorreccionPagoDTO` (backend): los seis campos financieros congelados de
 * un `Pago` YA aprobado, todos opcionales -- se envía solo lo que cambia.
 * `motivo` es el único obligatorio.
 */
export interface CorreccionPagoInput {
  tarifaMensualAplicada?: string;
  mesesComprados?: number;
  montoBase?: string;
  monto?: string;
  fechaInicio?: string;
  fechaFin?: string;
  motivo: string;
}

/** `CorreccionPagoResponseDTO` — una fila de auditoría de corrección financiera. */
export interface CorreccionPago {
  id: number;
  pagoId: number;
  tarifaMensualAplicadaAnterior: string | null;
  tarifaMensualAplicadaNuevo: string | null;
  mesesCompradosAnterior: number | null;
  mesesCompradosNuevo: number | null;
  montoBaseAnterior: string | null;
  montoBaseNuevo: string | null;
  montoAnterior: string;
  montoNuevo: string;
  fechaInicioAnterior: string;
  fechaInicioNuevo: string;
  fechaFinAnterior: string;
  fechaFinNuevo: string;
  efectoCobertura: "SIN_CAMBIO" | "AMPLIADA" | "REDUCIDA";
  motivo: string;
  actorPersonaId: number;
  fechaRegistro: string;
}

/** `CorreccionPagoResultadoDTO` — el pago ya corregido + la fila de auditoría que dejó. */
export interface CorreccionPagoResultado {
  pago: PagoPersona;
  correccion: CorreccionPago;
}

/**
 * Corrige un campo financiero congelado de un pago YA aprobado —
 * `POST /api/membresias/pagos/:pagoId/corregir` (admin-only). Issue #400,
 * criterio 7: el backend deja el pago original mutado y una fila
 * `CorreccionPago` nueva con el rastro anterior/nuevo, nunca un UPDATE
 * silencioso.
 */
export async function corregirPago(
  pagoId: number,
  datos: CorreccionPagoInput,
): Promise<CorreccionPagoResultado> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<CorreccionPagoResultado>(apiEndpoint(`/membresias/pagos/${pagoId}/corregir`), {
    method: "POST",
    body: JSON.stringify(datos),
    headers: { "Content-Type": "application/json", ...mockHeaders },
  });
}

/** Historial de correcciones de un pago — `GET /api/membresias/pagos/:pagoId/correcciones` (admin-only). */
export async function fetchCorrecciones(pagoId: number): Promise<CorreccionPago[]> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<CorreccionPago[]>(apiEndpoint(`/membresias/pagos/${pagoId}/correcciones`), {
    headers: mockHeaders,
  });
}

// ---------------------------------------------------------------------------
// Suspensión y reactivación de membresía (issue #400, criterio 3)
// ---------------------------------------------------------------------------

/** `SuspensionReactivacionDTO` (backend): motivo obligatorio, fecha efectiva opcional. */
export interface SuspensionReactivacionInput {
  motivo: string;
  /** ISO datetime; omitido significa "ahora" (el backend completa `datetime.now(UTC)`). */
  fechaEfectiva?: string;
}

/**
 * Suspende una membresía ACTIVA — `POST /api/membresias/:id/suspender`
 * (admin-only). Detiene la generación de deuda futura y bloquea nuevos
 * pagos; la cobertura ya pagada no se toca.
 */
export async function suspenderMembresia(
  membresiaId: number,
  datos: SuspensionReactivacionInput,
): Promise<MembresiaPorPersona> {
  return request<MembresiaPorPersona>(apiEndpoint(`/membresias/${membresiaId}/suspender`), {
    method: "POST",
    body: JSON.stringify(datos),
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Reactiva una membresía SUSPENDIDA — `POST /api/membresias/:id/reactivar`
 * (admin-only). Resincroniza la tarifa vigente del catálogo; no otorga
 * cobertura por sí sola.
 */
export async function reactivarMembresia(
  membresiaId: number,
  datos: SuspensionReactivacionInput,
): Promise<MembresiaPorPersona> {
  return request<MembresiaPorPersona>(apiEndpoint(`/membresias/${membresiaId}/reactivar`), {
    method: "POST",
    body: JSON.stringify(datos),
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Cambio de plan de una membresía existente (issue #400, criterio 1)
// ---------------------------------------------------------------------------

/**
 * Cambia el tipo de membresía de una membresía YA existente —
 * `POST /api/membresias/:id/cambiar-plan` (admin-only). Prospectivo: la
 * cobertura ya pagada (fechas de pagos/coberturas bonificadas ya aprobados)
 * no se toca; la tarifa nueva rige recién desde el próximo pago.
 */
export async function cambiarPlanMembresia(
  membresiaId: number,
  nuevoTipoMembresiaId: number,
): Promise<MembresiaPorPersona> {
  return request<MembresiaPorPersona>(apiEndpoint(`/membresias/${membresiaId}/cambiar-plan`), {
    method: "POST",
    body: JSON.stringify({ nuevoTipoMembresiaId }),
    headers: { "Content-Type": "application/json" },
  });
}

/** Payload for registering a new pending payment — `POST /api/membresias/pagos`.
 *  `meses` replaces `monto` (issue #400): the user picks a whole number of
 *  months, never a free-form amount — the backend resolves the membership's
 *  current monthly price and computes `monto_base = tarifa_vigente * meses`
 *  itself, then resolves the persona's assigned benefit (if any — see
 *  `fetchBeneficio`/`BeneficioAsignado` below), freezes its current value
 *  and computes the final amount. Callers still collect an amount from the
 *  reader for now (the month-picker UX is a later phase) and derive `meses`
 *  from it with `wholeMonthsFor` before calling this.
 *
 *  No `descuentoIds` (issue #398): a discount used to be a per-payment
 *  choice sent here, but the backend now resolves it from the persona's
 *  ASSIGNED benefit and ignores `descuento_ids` entirely — the choice moved
 *  to `asignarBeneficio`/`retirarBeneficio`, admin-only and independent of
 *  any single payment.
 *
 *  No `fechaInicio`/`fechaFin` (fix período de cobertura, PAG-5): the
 *  backend derives the coverage period from `meses` -- the old contract let
 *  the caller hand it any range regardless of the amount, which is exactly
 *  the hole this fix closes (see docs/archive/fixes/06-periodo-de-cobertura.md).
 *  Callers can still PREVIEW the period client-side (`wholeMonthsFor` /
 *  `addMonthsIso`) to show the reader what they're about to pay for, but
 *  nothing here is sent. */
export interface RegistrarPagoInput {
  meses: number;
  tipoPago: "EFECTIVO" | "TRANSFERENCIA";
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

/**
 * `CoberturaBonificadaResponseDTO` (backend cobertura_bonificada_schemas.py).
 *
 * What `aplicarBeneficio` grants: cobertura sin ningún `Pago` -- issue #400,
 * slice 4d/06. Nested `asignacionDescuento` reuses `BeneficioAsignado` for
 * the same reason `BeneficioAsignado.descuento` is nested: the screen that
 * shows this needs to explain WITH WHICH benefit it was granted, without a
 * second read.
 */
export interface CoberturaBonificada {
  id: number;
  membresiaId: number;
  personaId: number;
  asignacionDescuento: BeneficioAsignado;
  tarifaMensualAplicada: string;
  mesesComprados: number;
  descuentoValorAplicado: string;
  descuentoPorcentajeAplicado: string | null;
  fechaInicio: string;
  fechaFin: string;
  otorgadaPorPersonaId: number;
  otorgadaEn: string;
}

/**
 * Apply the caller's active 100% benefit to a whole number of months, with
 * no `Pago` created — `POST /api/membresias/:membresiaId/aplicar-beneficio`
 * (issue #400, slice 06).
 *
 * Autoservicio: dueño o su representante, nunca un ADMINISTRADOR "por"
 * ellos (`membresia_pago_servicio.aplicar_beneficio_bonificado`). No
 * `tipoPago`, no voucher, no `monto` — a 100% benefit never creates a
 * `Pago`, so there is nothing to collect. `meses` is the same whole-number
 * month count `registrarPago` takes.
 */
export async function aplicarBeneficio(
  membresiaId: number,
  meses: number,
): Promise<CoberturaBonificada> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<CoberturaBonificada>(apiEndpoint(`/membresias/${membresiaId}/aplicar-beneficio`), {
    method: "POST",
    body: JSON.stringify({ meses }),
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
// -------------------------------------------------------------------------
// Deuda y regularización (issue #284) — admin-only
// -------------------------------------------------------------------------

/** Derived owed months of a membership (issue #284): computed from the last
 *  approved coverage to today, NO stored column. Only the admin sees it —
 *  the student/representative never does. Mirrors backend
 *  `DeudaMembresiaResponseDTO` (camelCase via `ResponseBase`). */
export interface DeudaMembresia {
  mesesAdeudados: number;
  ultimaCoberturaFin: string | null;
  montoMensual: number;
  /**
   * `DeudaMembresiaResponseDTO.es_gratuidad_familiar` (issue #400, slice
   * 4c-a) — same authoritative-gratuity-signal rationale as
   * `MembresiaPorPersona.esGratuidadFamiliar`. Optional: raw passthrough
   * type, an older backend simply omits the key.
   */
  esGratuidadFamiliar?: boolean;
}

/** Regularize (settle) owed months with explicit retroactive dates — admin
 *  bookkeeping entry (issue #284). `motivo` is mandatory (the audit trail:
 *  who/when/why). */
export interface RegularizarDeudaInput {
  monto: number;
  fechaInicio: string;
  fechaFin: string;
  motivo: string;
}

/** Fetch a membership's derived owed months — `GET /api/membresias/{id}/deuda` (admin only). */
export async function fetchMembresiaDeuda(membresiaId: number): Promise<DeudaMembresia> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<DeudaMembresia>(apiEndpoint(`/membresias/${membresiaId}/deuda`), {
    headers: mockHeaders,
  });
}

/** Register an admin regularization — `POST /api/membresias/{id}/regularizar-deuda`.
 *  The payment enters APROBADO directly (admin-operated bookkeeping, not a
 *  client payment) with explicit retroactive dates and a mandatory reason. */
export async function regularizarDeuda(
  membresiaId: number,
  datos: RegularizarDeudaInput,
): Promise<PagoPersona> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PagoPersona>(apiEndpoint(`/membresias/${membresiaId}/regularizar-deuda`), {
    method: "POST",
    body: JSON.stringify(datos),
    headers: { "Content-Type": "application/json", ...mockHeaders },
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

/** Fields an admin may change on a catalog tariff. All optional: the backend
 *  applies the update with `exclude_unset`, so only what is sent changes. */
export interface ActualizarTipoMembresiaInput {
  categoria?: string;
  precio?: string;
  modalidad?: "PERSONALIZADA" | "MENSUAL";
}

/**
 * Admin-only: edit a catalog tariff — `PATCH /api/membresias/tipos/:id`.
 *
 * `precio` is a string, not a number, deliberately: it is money, it crosses
 * the wire as a decimal string end to end (`Numeric(10,2)` in Postgres), and
 * routing it through a JS number would introduce binary-float rounding into
 * the one value the club charges with.
 *
 * There is no delete: `TipoMembresia` has no soft-delete column, so retiring
 * a plan is not available (out of scope for #394 as written).
 */
export async function actualizarTipoMembresia(
  id: number,
  data: ActualizarTipoMembresiaInput,
): Promise<TipoMembresiaCatalogo> {
  return request<TipoMembresiaCatalogo>(apiEndpoint(`/membresias/tipos/${id}`), {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/** Fields to create a new catalog tariff. All three required — unlike the
 *  PATCH payload above, there is no partial create. */
export interface CrearTipoMembresiaInput {
  categoria: string;
  precio: string;
  modalidad: "PERSONALIZADA" | "MENSUAL";
}

/**
 * Admin-only: create a catalog tariff — `POST /api/membresias/tipos`
 * (issue #507). Same `precio`-as-string contract as `actualizarTipoMembresia`
 * above: money crosses the wire as a decimal string, never a JS number.
 */
export async function crearTipoMembresia(
  data: CrearTipoMembresiaInput,
): Promise<TipoMembresiaCatalogo> {
  return request<TipoMembresiaCatalogo>(apiEndpoint("/membresias/tipos"), {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create and assign a membership to a persona — `POST /api/membresias/`.
 *
 * Deliberately carries no price. The client used to read the catalogue price
 * and send it back as `monto_aplicado`, which made the number the club
 * charges with editable in transit. The backend now resolves the current
 * `TipoMembresia.precio` from `tipoMembresiaId` alone (issue #400), so this
 * request says only WHO and WHICH PLAN — never HOW MUCH.
 */
export async function crearMembresia(data: {
  personaId: number;
  tipoMembresiaId: number;
}): Promise<MembresiaPorPersona> {
  return request<MembresiaPorPersona>(apiEndpoint("/membresias/"), {
    method: "POST",
    body: JSON.stringify({
      persona_id: data.personaId,
      tipo_membresia_id: data.tipoMembresiaId,
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

// ---------------------------------------------------------------------------
// Beneficio del club — asignación/retiro de un descuento personal (issue #398)
// ---------------------------------------------------------------------------

/**
 * `AsignacionDescuentoResponseDTO` (backend beneficio_schemas.py). The
 * discount travels NESTED, not just its id — same reasoning the backend
 * docstring gives: the "beneficio vigente" admin screen needs its
 * nombre/porcentaje/monto without a second catalog read. `descuento` reuses
 * `DescuentoCatalogo`, whose money fields are already strings.
 */
export interface BeneficioAsignado {
  id: number;
  personaId: number;
  descuento: DescuentoCatalogo;
  asignadoPorPersonaId: number;
  /**
   * The assigning admin's name, resolved backend-side (issue #714) the same
   * way `registradoPorNombre`/`corregidoPorNombre` already are. The screen
   * used to have only the id and printed it — "Asignado por persona #1".
   */
  asignadoPorNombre: string;
  asignadoEn: string;
  retiradoPorPersonaId: number | null;
  retiradoEn: string | null;
}

/**
 * The persona's active club benefit, or `null` if none — `GET
 * /api/personas/:id/beneficio`.
 *
 * No longer admin-only for this verb (issue #400, slice 06): the backend GET
 * now also authorizes the persona's owner or their representative, so the
 * student portal can show a benefit BEFORE the reader pays
 * (`RenewPaymentForm` in `/student/payments`). `POST`/`DELETE` below stay
 * admin-only — assigning/retiring a benefit is still exclusively the club's
 * call.
 */
export async function fetchBeneficio(personaId: number): Promise<BeneficioAsignado | null> {
  return request<BeneficioAsignado | null>(apiEndpoint(`/personas/${personaId}/beneficio`), {
    method: "GET",
  });
}

/** Admin-only: assign a catalog discount as the persona's benefit — `POST /api/personas/:id/beneficio`. */
export async function asignarBeneficio(personaId: number, descuentoId: number): Promise<BeneficioAsignado> {
  return request<BeneficioAsignado>(apiEndpoint(`/personas/${personaId}/beneficio`), {
    method: "POST",
    body: JSON.stringify({ descuentoId }),
  });
}

/** Admin-only: retire the persona's active benefit — `DELETE /api/personas/:id/beneficio`. */
export async function retirarBeneficio(personaId: number): Promise<BeneficioAsignado> {
  return request<BeneficioAsignado>(apiEndpoint(`/personas/${personaId}/beneficio`), {
    method: "DELETE",
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
 * INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): representante-only
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

/**
 * Fetch a person's medical record. Authorized for an ADMINISTRADOR or the
 * representative of that exact persona — the backend's
 * `PoliticaAccesoPersona.exigir_acceso` decides, this client just calls the
 * endpoint. Used by both `app/members/MedicalRecordEditor.tsx` (admin) and
 * `app/student/medical-record/page.tsx` (representante).
 */
export async function fetchFichaMedica(personaId: number): Promise<FichaMedicaEditable> {
  return request<FichaMedicaEditable>(apiEndpoint(`/fichas-medicas/persona/${personaId}`));
}

/**
 * The seven fields of issue #360's emergency card — deliberately NOT the
 * same shape as `FichaMedicaEditable`. The backend enumerates them by hand in
 * `FichaEmergenciaResponseDTO` for the same reason this type does: if
 * `FichaMedica` gains columns tomorrow, neither inherits them.
 *
 * The four medical fields are all nullable: an alumno can have no ficha
 * médica registered yet, and that is not an error (see
 * `FichaMedicaServicio.obtener_ficha_emergencia`) — the representative's
 * backup is what the trainer sees instead.
 */
export interface FichaEmergencia {
  alumnoNombreCompleto: string;
  tipoSangre: TipoSangre | null;
  alergias: string | null;
  contactoEmergencia: string | null;
  telefonoEmergencia: string | null;
  representanteNombreCompleto: string | null;
  representanteTelefono: string | null;
}

/**
 * Fetch the emergency card for one alumno — GET
 * /api/fichas-medicas/persona/[id]/emergencia. ADMINISTRADOR or ENTRENADOR
 * only; every call is audited backend-side (who consulted whom, and when).
 * Distinct endpoint from `fetchFichaMedica`: this one never opens the full
 * medical record (still 403 for ENTRENADOR), and the scope is by DATA, not
 * by which alumnos this trainer "owns" — the club does not assign trainers
 * to schedules (see the backend router's own comment).
 */
export async function fetchFichaEmergencia(personaId: number): Promise<FichaEmergencia> {
  return request<FichaEmergencia>(apiEndpoint(`/fichas-medicas/persona/${personaId}/emergencia`));
}

/**
 * Update a person's medical record — same ADMINISTRADOR-or-representative
 * authorization as `fetchFichaMedica`. `enfermedades` replaces the full list.
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

/**
 * One row of the caller's own session history.
 *
 * `dispositivo` is a LABEL the backend already derived ("Android · Chrome"),
 * never a raw user-agent, and there is no IP field because the backend does
 * not store one — see `soporte_transversal/dispositivo.py` for why.
 *
 * `vigente` and `actual` are both derived server-side: the first compares the
 * row's session epoch against the user's current one, the second against the
 * `sid` claim of the token that made the call.
 */
export interface SesionPropia {
  id: number;
  dispositivo: string;
  iniciadaEn: string;
  vigente: boolean;
  actual: boolean;
}

/** Fetch the caller's own session history — GET /api/auth/me/sesiones. */
export async function fetchMisSesiones(): Promise<SesionPropia[]> {
  return request<SesionPropia[]>(apiEndpoint("/auth/me/sesiones"));
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
export interface Sponsor {
  id: number;
  nombre: string;
  logoUrl: string;
}

/** Public logos shown on the landing page. */
export async function fetchSponsors(): Promise<Sponsor[]> {
  return request<Sponsor[]>(apiEndpoint("/sponsors"));
}

/** Admin-only: upload the sponsor's one public logo and its accessible name. */
export async function crearSponsor(nombre: string, archivo: File): Promise<Sponsor> {
  const formData = new FormData();
  formData.append("nombre", nombre);
  formData.append("archivo", archivo);
  return request<Sponsor>(apiEndpoint("/sponsors"), { method: "POST", body: formData }, 30_000);
}

/** Admin-only: remove a sponsor and its hosted logo. */
export async function eliminarSponsor(id: number): Promise<void> {
  await request<unknown>(apiEndpoint(`/sponsors/${id}`), { method: "DELETE" });
}

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

/**
 * Upload/replace a persona's photo — POST /api/personas/[personaId]/foto.
 * Same multipart contract and timeout as `subirFotoPerfil`; the backend
 * authorizes the owner, their representative, or an ADMINISTRADOR.
 */
export async function subirFotoPersona(personaId: string, archivo: File): Promise<PersonaResponse> {
  const formData = new FormData();
  formData.append("archivo", archivo);

  return request<PersonaResponse>(
    apiEndpoint(`/personas/${personaId}/foto`),
    { method: "POST", body: formData },
    FOTO_PERFIL_UPLOAD_TIMEOUT_MS,
  );
}

// ---------------------------------------------------------------------------
// Notificaciones — in-app notifications (currently membership-expiration
// notices only; the ranking-mensual/justificativo notification types were
// removed along with those features).
// ---------------------------------------------------------------------------

/** List the logged-in persona's own in-app notifications — `GET /ranking/notificaciones/mias` (paginated, issue #281). */
export async function fetchNotificaciones(): Promise<PaginatedResponse<Notificacion>> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<PaginatedResponse<Notificacion>>(apiEndpoint("/ranking/notificaciones/mias"), {
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

/** Result of marking ALL pending notifications read — the number of rows the backend actually changed. */
export interface MarcarTodasLeidasResultado {
  actualizadas: number;
}

/**
 * Mark ALL of the caller's pending notifications as read — `PATCH
 * /ranking/notificaciones/leer-todas` (issue #859). Never sends ids: scope
 * (own + active dependents') is resolved entirely server-side.
 */
export async function marcarTodasNotificacionesLeidas(): Promise<MarcarTodasLeidasResultado> {
  const mockHeaders = isMockMode() ? getMockRoleHeader() : {};
  return request<MarcarTodasLeidasResultado>(apiEndpoint("/ranking/notificaciones/leer-todas"), {
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
 * `SolapeHorarioDTO` on the backend — one schedule the student ALREADY had
 * that collides with one of the schedules just assigned (issue #731).
 *
 * `categoriaLabel` is the human name ("Competitivo"); `categoria` is the
 * código it is keyed by. The label travels from the backend rather than
 * being looked up here because `categoria_horario` is editable at runtime —
 * mirroring it client-side is the exact staleness `franja_horaria` caused
 * (#160). `horaInicio`/`horaFin` are the OLD schedule's; the new range is
 * the card the admin assigned from, already on screen.
 */
export interface SolapeHorario {
  horarioId: number;
  categoria: string;
  categoriaLabel: string;
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
}

/**
 * `AsignacionAlumnoHorarioResponseDTO` on the backend
 * (`backend/app/presentacion/schemas/asistencia_schemas.py`) -- INS-6, decisión
 * de negocio #4 (2026-08-11): assigning a student with an overdue (VENCIDA)
 * membership stays allowed, so this rides alongside `asignaciones` as a
 * non-blocking warning instead of an error. `diasVencida` is `null` when the
 * membership isn't vencida, or when it is but no approved payment exists to
 * derive "since when" from.
 *
 * `solapamientos` (issue #731) rides the same way and for the same reason: a
 * student belongs to several categorías by design, so a clash of schedules
 * is an advisory, never a rejection. Empty when nothing collides.
 */
export interface AsignacionAlumnoHorarioResponse {
  asignaciones: AlumnoHorario[];
  membresiaVencida: boolean;
  diasVencida: number | null;
  solapamientos: SolapeHorario[];
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
