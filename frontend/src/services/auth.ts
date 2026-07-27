/**
 * Auth service — browser-side.
 *
 * Talks ONLY to the same-origin BFF Route Handlers under /api/auth/**
 * (src/app/api/auth/**). Never touches localStorage/sessionStorage and
 * never sees a raw access or refresh token — those live in HttpOnly
 * cookies set by the BFF. The session shape here is exactly what
 * /api/auth/login and /api/auth/session return: a token-free profile
 * built server-side from the backend's /auth/me.
 *
 * Replaces the previous MockAuthService (demo personas + localStorage
 * persistence) now that Route Handlers talk to the real FastAPI backend.
 */

import type { UserRole, Usuario } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A token-free authenticated session, as returned by the BFF. */
export interface AuthSession {
  /** The authenticated user profile. */
  user: Usuario;
  /** Raw backend role strings (ADMINISTRADOR, ENTRENADOR, REPRESENTANTE, ALUMNO), preserved for callers that need the full multi-role set. `user.role` is the single primary role (see `pickPrimaryRole` in src/lib/server/auth.ts) used for current UI gating. */
  roles: string[];
  /** ISO timestamp of the login/hydration event. */
  loggedInAt: string;
}

export type AuthErrorKind =
  | "invalid_credentials"
  | "session_validation_failed"
  | "timeout"
  | "backend_unavailable"
  | "config_error"
  | "unknown";

export interface LoginSuccess {
  ok: true;
  session: AuthSession;
}

export interface LoginFailure {
  ok: false;
  error: AuthErrorKind;
}

export type LoginResult = LoginSuccess | LoginFailure;

// ---------------------------------------------------------------------------
// Runtime type guard — protects consumers from a malformed /api/auth/*
// response (defense in depth; the BFF already validates the backend shape,
// but never trust JSON blindly on the client either).
// ---------------------------------------------------------------------------

const VALID_ROLES: readonly UserRole[] = [
  "admin",
  "trainer",
  "representante",
  "estudiante",
  "unsupported",
] as const;

export function isValidAuthSession(data: unknown): data is AuthSession {
  if (data === null || typeof data !== "object") return false;

  const candidate = data as Record<string, unknown>;

  const user = candidate.user;
  if (user === null || typeof user !== "object") return false;

  const u = user as Record<string, unknown>;
  if (typeof u.id !== "string" || u.id.length === 0) return false;
  if (typeof u.name !== "string" || u.name.length === 0) return false;
  if (typeof u.email !== "string" || u.email.length === 0) return false;
  if (!VALID_ROLES.includes(u.role as UserRole)) return false;

  if (!Array.isArray(candidate.roles) || !candidate.roles.every((r) => typeof r === "string")) return false;
  if (typeof candidate.loggedInAt !== "string") return false;

  return true;
}

/** True when `value` is a JSON error body carrying a string `error` code (see route handlers under src/app/api/auth/**). */
function hasErrorCode(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).error === "string";
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 10_000;

interface NetworkFailure {
  networkError: true;
  timedOut: boolean;
}

function isNetworkFailure(value: Response | NetworkFailure): value is NetworkFailure {
  return (value as Partial<NetworkFailure>).networkError === true;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | NetworkFailure> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: unknown) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return { networkError: true, timedOut };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

/**
 * Authenticate via the BFF's /api/auth/login route.
 *
 * Distinguishes invalid credentials, timeout, backend-unavailable, and
 * unknown failures so the login page can show a distinct message for each.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
  const response = await fetchWithTimeout("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (isNetworkFailure(response)) {
    return { ok: false, error: response.timedOut ? "timeout" : "backend_unavailable" };
  }

  if (response.status === 503) {
    return { ok: false, error: "backend_unavailable" };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }

  if (response.status === 401) {
    // The BFF's /api/auth/login also returns 401 when the freshly-issued
    // access token fails its own /auth/me validation right after login
    // ({ error: "unauthorized" } — see src/app/api/auth/login/route.ts).
    // That is a distinct failure from bad credentials and must not be
    // mislabeled as such.
    const isSessionValidationFailure = hasErrorCode(json) && json.error === "unauthorized";
    return { ok: false, error: isSessionValidationFailure ? "session_validation_failed" : "invalid_credentials" };
  }
  // A misconfigured BFF (missing BACKEND_API_URL and friends) is a permanent
  // fault, not a blip. It must never be folded into the retry-flavoured
  // copy the outage kinds get — see loginErrorFeedback in src/app/login/page.tsx.
  if (response.status === 500 && hasErrorCode(json) && json.error === "config_error") {
    return { ok: false, error: "config_error" };
  }
  if (!response.ok) {
    return { ok: false, error: "unknown" };
  }
  if (!isValidAuthSession(json)) {
    return { ok: false, error: "unknown" };
  }
  return { ok: true, session: json };
}

// ---------------------------------------------------------------------------
// fetchSession — session hydration on app start
// ---------------------------------------------------------------------------

/**
 * Discriminated outcome of a session fetch — critically distinguishes a
 * transient backend outage (503, or a network failure) from a genuinely
 * invalid/expired session (401 or a malformed body). The BFF's
 * /api/auth/session route deliberately returns 503 WITHOUT clearing cookies
 * on an outage so a network blip doesn't log the user out; callers (see
 * AuthContext) must honor that distinction and keep the current session on
 * "outage" instead of clearing it.
 */
export type SessionOutcome =
  | { kind: "authenticated"; session: AuthSession }
  | { kind: "unauthenticated" }
  | { kind: "outage" };

/**
 * Fetch the current session from the BFF's /api/auth/session route.
 *
 * The route itself attempts a refresh when the access token is missing or
 * near expiry. See `SessionOutcome` for how outage vs. unauthenticated is
 * distinguished.
 */
export async function fetchSession(): Promise<SessionOutcome> {
  const response = await fetchWithTimeout("/api/auth/session", { method: "GET" });

  if (isNetworkFailure(response) || response.status === 503) {
    return { kind: "outage" };
  }
  if (!response.ok) {
    return { kind: "unauthenticated" };
  }

  try {
    const json: unknown = await response.json();
    return isValidAuthSession(json) ? { kind: "authenticated", session: json } : { kind: "unauthenticated" };
  } catch {
    return { kind: "unauthenticated" };
  }
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

/**
 * Log out via the BFF's /api/auth/logout route.
 *
 * Always resolves (never throws) — the server clears cookies regardless of
 * whether its own upstream logout call to FastAPI succeeds, and the caller
 * must always end up logged out locally even if this fetch itself errors.
 */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    // Network failure — the caller (AuthContext) still clears local state.
  }
}

/** Namespaced object for call-site parity with the previous mock service. */
export const authService = {
  login,
  logout,
  getSession: fetchSession,
};
