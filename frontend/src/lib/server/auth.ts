/**
 * Server-only auth helpers — the BFF boundary between the browser and the
 * FastAPI backend's OAuth2 password-flow auth endpoints.
 *
 * ⚠️ Import this ONLY from server-only code (Route Handlers under
 * src/app/api/auth/**). It reads BACKEND_API_URL (server-only env var —
 * must NEVER be prefixed NEXT_PUBLIC_) and handles raw access/refresh
 * tokens. Nothing exported here may be re-exported to a client component;
 * the only thing safe to send to the browser is the `ServerSession` shape
 * built by `buildSession()`, which never contains a token.
 *
 * Backend contract (2026-07, verified against a real docker-composed
 * backend, not just mocked tests — see project docs):
 *   POST /auth/login   — application/x-www-form-urlencoded { username, password }
 *                         -> { access_token, refresh_token, token_type }
 *                         (raw OAuth2 dict, snake_case per RFC 6749 — no response_model)
 *   GET  /auth/me       — Authorization: Bearer <access_token>
 *                         -> { correo, personaId, nombres, apellidos, roles }
 *                         (camelCase — response_model=UsuarioMeResponseDTO
 *                         inherits the project-wide snake_case->camelCase
 *                         alias_generator; see backend base.py ResponseBase)
 *   POST /auth/refresh  — application/json { refresh_token } in the BODY, NOT
 *                         an Authorization header — a refresh token is
 *                         intentionally not a general bearer credential.
 *                         -> { access_token, token_type } (no refresh_token)
 *   POST /auth/logout   — informational only; does not revoke tokens server-side.
 *   Access tokens expire in 60 min, refresh tokens in 7 days.
 */

import type { NextResponse } from "next/server";
import type { UserRole, Usuario } from "@/types/domain";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/auth-cookies";

// Re-exported so existing call sites (Route Handlers under src/app/api/auth/**)
// keep importing cookie names from this file. The canonical definition lives
// in src/lib/auth-cookies.ts — a Node-free module middleware.ts (Edge
// runtime) can also import directly, without pulling in this server-only
// file's JWT/Buffer/fetch code.
export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE };

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

/**
 * Resolve the server-only backend base URL. Throws a clear error instead of
 * silently building a fetch URL against `undefined` — this must be caught
 * as an "unknown"/500 by the route handler, never leaked verbatim to the
 * browser as a raw stack trace.
 */
export function getBackendApiUrl(): string {
  const url = process.env.BACKEND_API_URL;
  if (!url) {
    throw new Error(
      "BACKEND_API_URL is not set. Configure it in .env.local as a server-only variable " +
        "(e.g. http://localhost:8000/api/v1) — it must NEVER be prefixed NEXT_PUBLIC_.",
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Cookie configuration
// ---------------------------------------------------------------------------

/** Documented backend token lifetimes — fallback when a token's own `exp` claim can't be decoded. */
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60; // 60 minutes
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

function baseCookieOptions(maxAge: number): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/**
 * Set the access (and optionally refresh) token cookies on a NextResponse.
 * Max-Age is derived from each token's own `exp` claim when decodable,
 * falling back to the documented lifetime otherwise. Tokens are never
 * echoed into the JSON body — only set as HttpOnly cookies.
 */
export function setAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken?: string },
): void {
  const accessMaxAge = maxAgeFromExp(tokens.accessToken) ?? ACCESS_TOKEN_MAX_AGE_SECONDS;
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, baseCookieOptions(accessMaxAge));

  if (tokens.refreshToken) {
    const refreshMaxAge = maxAgeFromExp(tokens.refreshToken) ?? REFRESH_TOKEN_MAX_AGE_SECONDS;
    response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, baseCookieOptions(refreshMaxAge));
  }
}

/** Clear both auth cookies (Max-Age 0). Always safe to call, even if they were never set. */
export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_TOKEN_COOKIE, "", baseCookieOptions(0));
  response.cookies.set(REFRESH_TOKEN_COOKIE, "", baseCookieOptions(0));
}

// ---------------------------------------------------------------------------
// JWT expiry (read-only, server-side only)
//
// We do NOT verify the signature here — these tokens were just received
// directly from FastAPI over our own server-to-server call (not user
// input), so the trust boundary is the network call itself. Decoding the
// `exp` claim is purely bookkeeping: it lets us set an accurate cookie
// Max-Age and decide when to proactively refresh. The raw token is never
// exposed to the browser regardless of whether decoding succeeds.
// ---------------------------------------------------------------------------

function base64UrlDecode(segment: string): string | null {
  try {
    const padLength = (4 - (segment.length % 4)) % 4;
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** Decode a JWT's `exp` claim (seconds since epoch), without verifying its signature. Returns null if malformed. */
export function decodeJwtExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const payloadJson = base64UrlDecode(parts[1]);
  if (!payloadJson) return null;
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (typeof payload !== "object" || payload === null) return null;
    const exp = (payload as Record<string, unknown>).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

function maxAgeFromExp(token: string): number | null {
  const exp = decodeJwtExpiry(token);
  if (exp === null) return null;
  const seconds = exp - Math.floor(Date.now() / 1000);
  return seconds > 0 ? seconds : null;
}

/** True when the token's `exp` is within `thresholdSeconds` of now (or is already expired/undecodable). */
export function isNearExpiry(token: string, thresholdSeconds: number): boolean {
  const exp = decodeJwtExpiry(token);
  if (exp === null) return true;
  const remaining = exp - Math.floor(Date.now() / 1000);
  return remaining <= thresholdSeconds;
}

// ---------------------------------------------------------------------------
// Backend response shapes + runtime validation
// ---------------------------------------------------------------------------

export interface BackendLoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface BackendMeResponse {
  correo: string;
  // camelCase — unlike /auth/login and /auth/refresh (raw OAuth2 dicts, not
  // run through a response_model), /auth/me is declared with
  // response_model=UsuarioMeResponseDTO, which inherits ResponseBase's
  // project-wide snake_case -> camelCase alias_generator (see backend
  // app/presentacion/schemas/base.py).
  personaId: string | number;
  nombres: string;
  apellidos: string;
  roles: string[];
}

export interface BackendRefreshResponse {
  access_token: string;
  token_type: string;
}

function isBackendLoginResponse(value: unknown): value is BackendLoginResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.access_token === "string" && v.access_token.length > 0 &&
    typeof v.refresh_token === "string" && v.refresh_token.length > 0 &&
    typeof v.token_type === "string"
  );
}

function isBackendMeResponse(value: unknown): value is BackendMeResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.correo === "string" && v.correo.length > 0 &&
    (typeof v.personaId === "string" || typeof v.personaId === "number") &&
    typeof v.nombres === "string" &&
    typeof v.apellidos === "string" &&
    Array.isArray(v.roles) && v.roles.every((r) => typeof r === "string")
  );
}

function isBackendRefreshResponse(value: unknown): value is BackendRefreshResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.access_token === "string" && v.access_token.length > 0 && typeof v.token_type === "string";
}

// ---------------------------------------------------------------------------
// Typed result — translates backend/network failures into small, typed,
// user-readable results instead of throwing raw fetch errors up to routes.
// ---------------------------------------------------------------------------

export type AuthErrorCode =
  | "invalid_credentials"
  | "config_error"
  | "backend_unavailable"
  | "timeout"
  | "invalid_response"
  | "unauthorized"
  | "unknown";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}

export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: AuthError };

const BACKEND_TIMEOUT_MS = 10_000;

/**
 * Low-level authenticated-agnostic backend fetch — timeout handling and
 * network-failure translation only, no cookies/tokens attached. Exported so
 * `src/lib/server/backend-client.ts` can build the authenticated proxy used
 * by every protected resource's Route Handler (payments, asistencias,
 * personas, ranking, ...) on top of the same primitive `backendLogin`,
 * `backendMe`, and `backendRefresh` already use.
 */
export async function backendFetch(path: string, init: RequestInit): Promise<AuthResult<Response>> {
  // Resolved OUTSIDE the try on purpose. `getBackendApiUrl()` throws when the
  // server is misconfigured, and swallowing that into the catch below would
  // report a permanent deployment fault as a transient outage — the user is
  // told to "try again in a few minutes" for something no amount of waiting
  // fixes. Config faults and network faults are different failures and must
  // stay distinguishable all the way to the UI.
  let baseUrl: string;
  try {
    baseUrl = getBackendApiUrl();
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        code: "config_error",
        message: error instanceof Error ? error.message : "Configuración del servidor inválida.",
      },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    return { ok: true, data: response };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        error: { code: "timeout", message: "La solicitud al servidor de autenticación tardó demasiado." },
      };
    }
    return {
      ok: false,
      error: { code: "backend_unavailable", message: "No se pudo contactar al servidor de autenticación." },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Backend calls
// ---------------------------------------------------------------------------

export async function backendLogin(username: string, password: string): Promise<AuthResult<BackendLoginResponse>> {
  const body = new URLSearchParams({ username, password }).toString();
  const result = await backendFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!result.ok) return result;

  const response = result.data;
  if (response.status === 401 || response.status === 400) {
    return { ok: false, error: { code: "invalid_credentials", message: "Credenciales inválidas." } };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { code: "backend_unavailable", message: `El servidor de autenticación respondió con un error (${response.status}).` },
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: { code: "invalid_response", message: "Respuesta de autenticación inválida." } };
  }
  if (!isBackendLoginResponse(json)) {
    return { ok: false, error: { code: "invalid_response", message: "Respuesta de autenticación con forma inesperada." } };
  }
  return { ok: true, data: json };
}

export async function backendMe(accessToken: string): Promise<AuthResult<BackendMeResponse>> {
  const result = await backendFetch("/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!result.ok) return result;

  const response = result.data;
  if (response.status === 401) {
    return { ok: false, error: { code: "unauthorized", message: "Sesión expirada." } };
  }
  if (!response.ok) {
    return { ok: false, error: { code: "backend_unavailable", message: `El servidor respondió con un error (${response.status}).` } };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: { code: "invalid_response", message: "Respuesta de perfil inválida." } };
  }
  if (!isBackendMeResponse(json)) {
    return { ok: false, error: { code: "invalid_response", message: "Respuesta de perfil con forma inesperada." } };
  }
  return { ok: true, data: json };
}

export async function backendRefresh(refreshToken: string): Promise<AuthResult<BackendRefreshResponse>> {
  // The refresh token goes in the JSON body, not an Authorization header —
  // confirmed against the real backend: a refresh token is intentionally
  // not a general-purpose bearer credential (see auth_router.py's /refresh
  // docstring). Sending it as Bearer instead gets a 422 (missing body).
  const result = await backendFetch("/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!result.ok) return result;

  const response = result.data;
  if (response.status === 401) {
    return { ok: false, error: { code: "unauthorized", message: "La sesión de actualización expiró." } };
  }
  if (!response.ok) {
    return { ok: false, error: { code: "backend_unavailable", message: `El servidor respondió con un error (${response.status}).` } };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: { code: "invalid_response", message: "Respuesta de actualización inválida." } };
  }
  if (!isBackendRefreshResponse(json)) {
    return { ok: false, error: { code: "invalid_response", message: "Respuesta de actualización con forma inesperada." } };
  }
  return { ok: true, data: json };
}

/**
 * Best-effort logout call — failures are swallowed by design. The backend
 * contract states logout is informational only (it does not revoke tokens
 * server-side), so client-side cookie clearing is always authoritative
 * regardless of whether this call succeeds.
 */
export async function backendLogout(accessToken: string): Promise<void> {
  try {
    await backendFetch("/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Intentionally ignored — see doc comment above.
  }
}

// ---------------------------------------------------------------------------
// Backend role -> frontend UserRole mapping
// ---------------------------------------------------------------------------

/**
 * Explicit adapter: every backend role string `/auth/me` can return, mapped
 * to its frontend `UserRole`. Any backend string not present here is
 * unrecognized.
 */
const BACKEND_ROLE_TO_USER_ROLE: Readonly<Record<string, UserRole>> = {
  ADMINISTRADOR: "admin",
  ENTRENADOR: "trainer",
  REPRESENTANTE: "representante",
  ALUMNO: "estudiante",
};

/**
 * Deterministic precedence for picking a user's *primary* frontend role when
 * `/auth/me` returns more than one backend role. Earlier entries win.
 * Administrator > representante > trainer > estudiante.
 */
const ROLE_PRECEDENCE: readonly UserRole[] = ["admin", "representante", "trainer", "estudiante"];

/**
 * Pick the primary role from a set of already-mapped frontend roles, using
 * `ROLE_PRECEDENCE`. Pure and independently testable — used by
 * `mapBackendRoleToUserRole` but doesn't itself know about backend role
 * strings.
 *
 * @returns The highest-precedence role present in `mappedRoles`, or `null`
 * if the set is empty (no recognized role at all).
 */
export function pickPrimaryRole(mappedRoles: UserRole[]): UserRole | null {
  for (const candidate of ROLE_PRECEDENCE) {
    if (mappedRoles.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Map the backend's role list to the single frontend `UserRole` most of the
 * app still gates on (nav, ProtectedRoute, default-route redirects).
 *
 * All four backend roles (ADMINISTRADOR, ENTRENADOR, REPRESENTANTE, ALUMNO)
 * map explicitly via `BACKEND_ROLE_TO_USER_ROLE`. Multi-role users resolve
 * to a single primary role via `pickPrimaryRole`'s deterministic precedence.
 *
 * An authenticated user whose roles are empty or entirely unrecognized maps
 * to `"unsupported"` — a real, explicit `UserRole` value (not a silent
 * coercion into `"representante"`, which is a separate, non-authenticated
 * concept — see the adapter map above). `"unsupported"` is handled centrally
 * by `getDefaultRoute`/`canAccess` in src/lib/auth-utils.ts, which routes
 * these users to `/unauthorized` instead of any real role's pages.
 */
export function mapBackendRoleToUserRole(roles: string[]): UserRole {
  const mapped = roles
    .map((role) => BACKEND_ROLE_TO_USER_ROLE[role])
    .filter((role): role is UserRole => role !== undefined);
  return pickPrimaryRole(mapped) ?? "unsupported";
}

// ---------------------------------------------------------------------------
// Session building — the ONLY place that turns a backend /auth/me response
// into a token-free object safe to return to the browser.
// ---------------------------------------------------------------------------

export interface ServerSession {
  user: Usuario;
  /** Raw backend role strings, preserved for multi-role handling (see `pickPrimaryRole`) and for any future UI that needs the full set, not just the primary role. */
  roles: string[];
  loggedInAt: string;
}

export function buildSession(me: BackendMeResponse): ServerSession {
  const role = mapBackendRoleToUserRole(me.roles);
  const base = {
    id: String(me.personaId),
    name: `${me.nombres} ${me.apellidos}`.trim(),
    email: me.correo,
    // /auth/me doesn't return the representante_id graph. Left null —
    // a representante who logs in gets role "representante" via the
    // REPRESENTANTE backend role, not via this field.
    representanteId: null,
  };

  const user: Usuario =
    role === "estudiante"
      ? { ...base, role: "estudiante", grupoId: null, activo: true }
      : { ...base, role };

  return {
    user,
    roles: me.roles,
    loggedInAt: new Date().toISOString(),
  };
}
