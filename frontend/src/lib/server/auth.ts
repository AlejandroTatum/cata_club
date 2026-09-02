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
import { toUserMessage } from "@/lib/error-message";

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
export function hasPendingActivationToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const payloadJson = base64UrlDecode(parts[1]);
  if (!payloadJson) return false;
  try {
    const payload: unknown = JSON.parse(payloadJson);
    return typeof payload === "object" && payload !== null &&
      (payload as Record<string, unknown>).activacion_completa === false;
  } catch {
    return false;
  }
}

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
  /** Activation facts from `/auth/me`; optional for explicit legacy compatibility. */
  correoVerificado?: boolean;
  altaPresencialCompletada?: boolean;
  /**
   * Issue #940: the gate DECISION itself (`GestorAutenticacion.
   * puede_acceder_modulos`), the same one the login/refresh token claims
   * carry — not re-derived from the two facts above, which stay True/False
   * per role regardless of the decision. Optional for a pre-#940 backend.
   */
  activacionCompleta?: boolean;
  // Not validated in `isBackendMeResponse` below, same as `telefono` /
  // `fechaCreacion` — this interface only names the subset of
  // `/auth/me`'s real response the client actually reads. `buildSession`
  // uses this to populate `UsuarioEstudiante.fechaNacimiento` (see
  // src/types/domain.ts), which `getNavGroupsForRoles` needs to decide whether
  // a self-managed student is an adult.
  fechaNacimiento?: string;
  /**
   * The uploaded profile photo URL (Cloudinary), or absent/null when none was
   * uploaded. `/auth/me` has always returned this (see backend
   * auth_router.py::obtener_perfil, `"foto_url": usuario.persona.foto_url` ->
   * camelCased to `fotoUrl` by `ResponseBase`'s alias_generator) — it just
   * never made it past this interface into `AuthSession.user` until issue
   * #509, which is why AppShell's avatar could only ever render initials.
   */
  fotoUrl?: string | null;
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
    Array.isArray(v.roles) && v.roles.every((r) => typeof r === "string") &&
    (v.correoVerificado === undefined || typeof v.correoVerificado === "boolean") &&
    (v.altaPresencialCompletada === undefined || typeof v.altaPresencialCompletada === "boolean") &&
    (v.activacionCompleta === undefined || typeof v.activacionCompleta === "boolean")
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

/**
 * Default abort deadline for a backend call. Sized for an auth round trip —
 * login, /auth/me, refresh: the backend either answers in well under a second
 * or something is wrong, so waiting longer only makes the failure slower.
 */
export const BACKEND_TIMEOUT_MS = 10_000;

/**
 * Abort deadline for backend PDF report generation, and ONLY for that.
 * Rendering a report is not authenticating: the backend queries a period's
 * worth of rows and lays out a document, which legitimately takes tens of
 * seconds on a large range. Under the default deadline the BFF cut those
 * reports off at 10 s and reported a timeout for a backend that was working
 * fine, just slowly (see issue #197). This budget is deliberately not the
 * default — every other route, authentication included, keeps
 * `BACKEND_TIMEOUT_MS`.
 */
export const PDF_BACKEND_TIMEOUT_MS = 60_000;

/**
 * Per-call knobs for `backendFetch`, kept deliberately out of `RequestInit`:
 * that object is forwarded verbatim to the platform `fetch`, which must not
 * receive non-standard fields, and widening its type would force every
 * existing caller's `init` through a custom alias. As a separate optional
 * argument it is purely additive — callers that don't pass it are unchanged
 * and keep `BACKEND_TIMEOUT_MS`.
 */
export interface BackendFetchOptions {
  /** Milliseconds before the call is aborted. Defaults to `BACKEND_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * Visitor IP to forward to the backend as `X-Forwarded-For`. Get it from
   * `forwardedForFrom(request)` below, which is where the value is validated
   * — see that function's doc comment for why this exists (issue #235).
   */
  forwardedFor?: string;
}

/**
 * One entry of an `X-Forwarded-For` list as a dotted-quad IPv4, or
 * `undefined` when it is not one.
 *
 * Rebuilt from the parsed octets rather than echoed back, so the returned
 * string is a value this function produced and not a slice of the request.
 */
function parseIpv4(candidate: string): string | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(candidate);
  if (match === null) return undefined;

  const raw = match.slice(1);
  // `\d{1,3}` also matches 256-999, and a leading zero ("010") is a second
  // spelling of an address that already has one — two different strings for
  // the same visitor would mean two different rate-limit buckets.
  if (raw.some((octet) => octet.length > 1 && octet.startsWith("0"))) return undefined;
  const octets = raw.map(Number);
  if (octets.some((octet) => octet > 255)) return undefined;

  return octets.join(".");
}

/**
 * One entry of an `X-Forwarded-For` list as an IPv6 address, or `undefined`
 * when it is not one. Accepts `::` zero-compression (at most one, as the
 * grammar requires) and the trailing dotted-quad form (`::ffff:192.0.2.1`).
 * Bracketed (`[::1]`) and zone-suffixed (`fe80::1%eth0`) spellings are not
 * addresses a proxy puts in this header, so they are rejected like any other
 * unparseable value.
 */
function parseIpv6(candidate: string): string | undefined {
  const lower = candidate.toLowerCase();
  const halves = lower.split("::");
  if (halves.length > 2) return undefined;

  const groups = halves.flatMap((half) => (half === "" ? [] : half.split(":")));

  // A trailing dotted-quad stands in for the last two 16-bit groups.
  let groupsFromIpv4 = 0;
  if (groups.length > 0 && groups[groups.length - 1].includes(".")) {
    if (parseIpv4(groups[groups.length - 1]) === undefined) return undefined;
    groups.pop();
    groupsFromIpv4 = 2;
  }

  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;

  const total = groups.length + groupsFromIpv4;
  // `::` must stand for at least one omitted group; without it every group
  // has to be written out.
  if (halves.length === 2 ? total > 7 : total !== 8) return undefined;

  return lower;
}

/**
 * Extract the visitor's real IP from the incoming request, so a BFF route
 * that proxies an anonymous/rate-limited backend endpoint can forward it —
 * pass the result as `backendFetch`'s `forwardedFor` option (or a
 * `backendLogin`/etc. wrapper that accepts it).
 *
 * Without this, every anonymous request the backend sees comes from the
 * SAME peer: its own TCP client is always this frontend container (the BFF
 * calls it server-side), never the real visitor. That collapsed the
 * backend's per-visitor rate limit (`clave_cliente`, keyed by IP for
 * anonymous traffic — see backend/app/soporte_transversal/rate_limit.py)
 * into one bucket shared by the entire internet: 10-11 requests/minute from
 * anywhere could exhaust it and lock out public enrollment (issue #235).
 *
 * Two layers already stand between a spoofed header and the backend, and
 * BOTH live in configuration this module cannot see. Caddy (Caddyfile's
 * `reverse_proxy frontend:3000`) is the single public entry point and the
 * only component that talks to this container, and `header_up
 * X-Forwarded-For {remote_host}` makes it overwrite whatever a visitor sent
 * with the real TCP peer. The backend's own trust boundary
 * (`--forwarded-allow-ips`, backend/Dockerfile) is the second: it
 * re-validates that whoever calls it is inside the internal network.
 *
 * Parsing the value here is the third layer, and the only one that lives in
 * this file. The other two hold as long as nobody edits a Caddyfile or a
 * Dockerfile in a way that reopens the hole — which is exactly the scenario
 * `header_up X-Forwarded-For {remote_host}` was added to defend against, and
 * exactly what a comment cannot enforce. So the value is treated as what it
 * is at this boundary: visitor-controlled input on its way into an outgoing
 * request header. Anything that is not an IP address never leaves this
 * function, and the backend falls back to its previous behaviour — keying
 * the rate limit on its direct TCP peer.
 *
 * The header's grammar allows a comma-separated list. Caddy sends a single
 * address today, but the list is tolerated and forwarded whole, because the
 * backend's uvicorn is what decides which entry to trust; handing it only
 * the first would hand it the one a client can choose. A list where ANY
 * entry fails to parse is dropped entirely rather than partially rescued: a
 * malformed value means something upstream is not what this code thinks it
 * is, and guessing which half of it to believe is worse than falling back.
 */
export function forwardedForFrom(request: Request): string | undefined {
  const header = request.headers.get("x-forwarded-for");
  if (header === null) return undefined;

  const addresses: string[] = [];
  for (const entry of header.split(",")) {
    const address = parseIpv4(entry.trim()) ?? parseIpv6(entry.trim());
    if (address === undefined) return undefined;
    addresses.push(address);
  }
  return addresses.join(", ");
}

/**
 * Extract the browser's `User-Agent` off the incoming request, so a BFF
 * route that proxies a backend call the backend labels by device (currently
 * only `backendLogin`, see issue #309) can forward it.
 *
 * Unlike `forwardedForFrom`, this is not a trust-boundary control — the
 * backend only ever uses this value for a best-effort device label on the
 * observational sessions table (`describir_dispositivo`, see
 * backend/app/soporte_transversal/dispositivo.py), never for authorization
 * or rate-limiting — so no validation beyond "is the header present" is
 * needed here.
 */
export function userAgentFrom(request: Request): string | undefined {
  return request.headers.get("user-agent") ?? undefined;
}

/**
 * The caller's headers plus `X-Forwarded-For`, without dropping any of them.
 *
 * `HeadersInit` is a union of three shapes — a plain object, a `Headers`
 * instance, and `string[][]` — and object-spreading the last two copies
 * nothing at all: `{ ...new Headers({ Authorization: "..." }) }` is `{}`,
 * silently. In a BFF that is a request leaving without its authorization
 * header. `new Headers(init)` is the one constructor that understands all
 * three, so the merge goes through it.
 */
function withForwardedFor(headers: HeadersInit | undefined, forwardedFor: string): Headers {
  const merged = new Headers(headers);
  merged.set("X-Forwarded-For", forwardedFor);
  return merged;
}

/**
 * Low-level authenticated-agnostic backend fetch — timeout handling and
 * network-failure translation only, no cookies/tokens attached. Exported so
 * `src/lib/server/backend-client.ts` can build the authenticated proxy used
 * by every protected resource's Route Handler (payments, asistencias,
 * personas, ranking, ...) on top of the same primitive `backendLogin`,
 * `backendMe`, and `backendRefresh` already use.
 */
export async function backendFetch(
  path: string,
  init: RequestInit,
  options: BackendFetchOptions = {},
): Promise<AuthResult<Response>> {
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
        message: toUserMessage(error, "Configuración del servidor inválida."),
      },
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      // Only touches headers when a caller actually has a visitor IP to
      // forward — every existing call site that doesn't pass `forwardedFor`
      // keeps sending exactly the headers it always did.
      headers: options.forwardedFor
        ? withForwardedFor(init.headers, options.forwardedFor)
        : init.headers,
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

export async function backendLogin(
  username: string,
  password: string,
  forwardedFor?: string,
  // Browser User-Agent to forward — see `userAgentFrom` above and issue
  // #309. Without this, every login through the form reached auth_router.py
  // carrying Node's own outgoing User-Agent instead of the visitor's
  // browser, so `GET /auth/me/sesiones` labeled every real login "Dispositivo
  // desconocido".
  userAgent?: string,
): Promise<AuthResult<BackendLoginResponse>> {
  const body = new URLSearchParams({ username, password }).toString();
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (userAgent) headers["User-Agent"] = userAgent;
  const result = await backendFetch(
    "/auth/login",
    {
      method: "POST",
      headers,
      body,
    },
    { forwardedFor },
  );
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

export async function backendRefresh(
  refreshToken: string,
  options: BackendFetchOptions = {},
): Promise<AuthResult<BackendRefreshResponse>> {
  // The refresh token goes in the JSON body, not an Authorization header —
  // confirmed against the real backend: a refresh token is intentionally
  // not a general-purpose bearer credential (see auth_router.py's /refresh
  // docstring). Sending it as Bearer instead gets a 422 (missing body).
  const result = await backendFetch(
    "/auth/refresh",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    options,
  );
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
 * Why a multi-role account has no answer here.
 *
 * There used to be a `ROLE_PRECEDENCE` list and a `pickPrimaryRole` that read
 * it — admin > representante > trainer > estudiante — so a `/auth/me` carrying
 * two roles still produced one. That guess is the whole of issue #762: the
 * rail was built from the role ARRAY and the route guards from the guessed
 * single value, so the same account was offered rows its own destinations then
 * refused. Precedence also decided things nobody chose, most visibly putting
 * representante above trainer, which took the attendance screens away from a
 * trainer who happened to also be a parent while his token still authorised
 * them server-side.
 *
 * Since #785 exactly one active role per account is a database invariant
 * (`trg_usuario_rol_unico_por_usuario`), so the guess has nothing left to
 * decide — and the ordering is deliberately gone rather than left unused,
 * because a precedence list sitting in this file reads as a statement that
 * multi-role accounts are still a supported shape.
 */
export type SessionRoleResolution =
  | { ok: true; role: UserRole }
  | { ok: false; reason: "multiple_roles" };

/**
 * Resolve `/auth/me`'s backend role list to the ONE frontend `UserRole` the
 * whole client gates on — nav, `ProtectedRoute`, default-route redirects.
 *
 * Unrecognized strings are dropped rather than counted: a role the backend
 * adds tomorrow grants no section here, so it cannot make an account look
 * multi-role either. The same role twice is the one role it is.
 *
 * An authenticated account with no recognized role at all resolves to
 * `"unsupported"` — a real, explicit `UserRole` (not a silent coercion into
 * `"representante"`, which is a separate, non-authenticated concept) that
 * `getDefaultRoute`/`canAccess` in src/lib/auth-utils.ts route to
 * `/unauthorized`. It is also an ordinary state, not a fault: ALUMNO is
 * granted lazily, once a membership exists, so a freshly self-enrolled person
 * genuinely holds none (see `derivePortalMode` in src/app/student/student-utils.ts).
 *
 * More than one recognized role is refused. Legacy accounts predating #785's
 * trigger still exist — its migration reports them and deliberately corrects
 * nothing, because choosing for them is the owner's decision and the supported
 * fix is `scripts/remediar_rol_multiple.py --keep-role`. Until that runs, such
 * an account gets no session at all: refusing is the answer that neither
 * invents a role nor lets one half of the UI disagree with the other.
 */
export function resolveSessionRole(roles: string[]): SessionRoleResolution {
  const recognized = new Set(
    roles
      .map((role) => BACKEND_ROLE_TO_USER_ROLE[role])
      .filter((role): role is UserRole => role !== undefined),
  );

  if (recognized.size > 1) return { ok: false, reason: "multiple_roles" };
  const [role] = recognized;
  return { ok: true, role: role ?? "unsupported" };
}

// ---------------------------------------------------------------------------
// Session building — the ONLY place that turns a backend /auth/me response
// into a token-free object safe to return to the browser.
// ---------------------------------------------------------------------------

export interface ServerSession {
  user: Usuario;
  /**
   * The account's raw backend role strings, as `/auth/me` sent them.
   *
   * Still an array because that is the shape of the response, not because it
   * can hold two grants: `resolveSessionRole` refuses that, so anything past
   * this point carries at most one recognized role. The client reads it
   * through `userRolesFromBackendRoles` (src/lib/auth-utils.ts) to draw the
   * rail, which is why it must not be allowed to disagree with `user.role`.
   */
  roles: string[];
  correoVerificado: boolean;
  altaPresencialCompletada: boolean;
  /** Issue #940: the backend's gate decision — see `BackendMeResponse.activacionCompleta`. */
  activacionCompleta: boolean;
  loggedInAt: string;
}

/**
 * The outcome of turning a `/auth/me` response into a browser session.
 *
 * Fallible on purpose. A caller cannot reach the session without answering
 * what to do when there is none, which is what stops a refused account from
 * quietly becoming a half-built identity somewhere downstream.
 */
export type SessionBuildResult =
  | { ok: true; session: ServerSession }
  | { ok: false; reason: "multiple_roles" };

export function buildSession(me: BackendMeResponse): SessionBuildResult {
  const resolution = resolveSessionRole(me.roles);
  if (!resolution.ok) return resolution;

  const role = resolution.role;
  const base = {
    id: String(me.personaId),
    name: `${me.nombres} ${me.apellidos}`.trim(),
    email: me.correo,
    // /auth/me doesn't return the representante_id graph. Left null —
    // a representante who logs in gets role "representante" via the
    // REPRESENTANTE backend role, not via this field.
    representanteId: null,
    fotoUrl: me.fotoUrl ?? null,
  };

  const user: Usuario =
    role === "estudiante"
      ? { ...base, role: "estudiante", activo: true, fechaNacimiento: me.fechaNacimiento }
      : { ...base, role };

  // Missing fields are an explicit compatibility path for a BFF talking to
  // a pre-#858 backend. The current backend always sends both booleans.
  const correoVerificado = me.correoVerificado ?? true;
  const altaPresencialCompletada = me.altaPresencialCompletada ?? true;

  return {
    ok: true,
    session: {
      user,
      roles: me.roles,
      correoVerificado,
      altaPresencialCompletada,
      // Issue #940: consume the backend's own gate decision instead of
      // recomputing it from the two facts above — that recomputation is
      // exactly what trapped an admin/trainer without a membership on
      // /login/activacion, since `puede_acceder_modulos` grants them access
      // regardless of `altaPresencialCompletada`. A pre-#940 backend that
      // doesn't send the decision yet falls back to the old two-fact rule,
      // so nothing changes until it does.
      activacionCompleta: me.activacionCompleta ?? (correoVerificado && altaPresencialCompletada),
      loggedInAt: new Date().toISOString(),
    },
  };
}
