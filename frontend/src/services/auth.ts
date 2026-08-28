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
import { userRolesFromBackendRoles } from "@/lib/auth-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A token-free authenticated session, as returned by the BFF. */
export interface AuthSession {
  /** The authenticated user profile. */
  user: Usuario;
  /**
   * The account's raw backend role strings (ADMINISTRADOR, ENTRENADOR,
   * REPRESENTANTE, ALUMNO), as `/auth/me` sent them. At most one of them is
   * recognized: exactly one active role per account is a database invariant
   * (#785), and `resolveSessionRole` in src/lib/server/auth.ts refuses to
   * build a session out of anything else. `user.role` is that same role, read
   * through the frontend's own vocabulary.
   */
  roles: string[];
  /** ISO timestamp of the login/hydration event. */
  loggedInAt: string;
}

export type AuthErrorKind =
  | "invalid_credentials"
  /**
   * The BFF itself could not validate the token it had just been issued —
   * /api/auth/login answered 401 with `error: "unauthorized"`. Server-side
   * failure; the browser never got as far as storing anything.
   */
  | "session_validation_failed"
  /**
   * Credentials were accepted and cookies were sent, but the browser did not
   * keep them: a following same-origin request arrived with no session. See
   * `login` for why a 200 is not, on its own, proof of a session.
   */
  | "session_not_persisted"
  /**
   * The account holds more than one active role, so the BFF refused to build a
   * session for it — /api/auth/login answered 409 with `error: "role_conflict"`
   * (issue #762). Nothing the person typed is wrong and nothing is down;
   * retrying cannot help until the club leaves the account one role.
   */
  | "role_conflict"
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

  // Issue #762: at most ONE recognized role, or this is not a session.
  //
  // The BFF already refuses to build a multi-role session, so a payload with
  // two of them should not exist — which is exactly the kind of thing this
  // guard is here for (a stale deployment answering a fresh client, a proxied
  // or hand-rolled body). It matters more than an ordinary shape check: two
  // roles is the one payload the rail would draw as a union while every route
  // guard answered from a single value, and the two disagreeing IS the bug.
  // Unrecognized strings are dropped by the same table the rail reads, so a
  // role the backend adds tomorrow is not a second role here either.
  if (new Set(userRolesFromBackendRoles(candidate.roles as string[])).size > 1) return false;

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
 *
 * A 200 from /api/auth/login is NOT a session. The session lives entirely in
 * the two HttpOnly cookies that response carries; the JSON body is only a
 * profile the BFF built server-side. Whenever the browser declines to keep
 * those cookies — cookies blocked for the site, a private-window quirk,
 * Safari's ITP, a proxy stripping Set-Cookie, a clock skew rejecting them, or
 * a `Secure` cookie arriving over plain http — the body still says 200 and
 * the person is not logged in. This function therefore confirms the session
 * actually round-trips before reporting success, by asking the same
 * "who am I" route the rest of the app already hydrates from
 * (`fetchSession` → GET /api/auth/session). Only cookies the browser really
 * stored can answer it.
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
  // Issue #762: the account holds more than one active role and the BFF
  // refused to guess between them. A distinct kind, because every other
  // failure here is either the person's typing or something that will come
  // back on its own, and this is neither.
  if (response.status === 409 && hasErrorCode(json) && json.error === "role_conflict") {
    return { ok: false, error: "role_conflict" };
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

  // The credentials were right; now find out whether the browser kept the
  // cookies that response set.
  const confirmed = await fetchSession();
  if (confirmed.kind === "authenticated") {
    // Return the round-tripped session rather than the login body: they are
    // the same profile, but only this one is proof that a later request will
    // be authenticated too.
    return { ok: true, session: confirmed.session };
  }
  if (confirmed.kind === "outage") {
    // A 503 or a network failure on the confirmation says nothing about the
    // cookies — `SessionOutcome` is explicit that an outage must never be
    // read as "unauthenticated". Report the outage for what it is instead of
    // blaming the browser, and instead of claiming a success we cannot see.
    return { ok: false, error: "backend_unavailable" };
  }
  return { ok: false, error: "session_not_persisted" };
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
