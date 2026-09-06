/**
 * Unit tests for the browser-side auth service (src/services/auth.ts).
 *
 * All network calls are mocked via vi.spyOn(global, "fetch") — no real BFF
 * or backend involved. Covers login (success + distinct failure kinds),
 * fetchSession (hydration), logout (always resolves), and the
 * isValidAuthSession runtime guard.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { login, fetchSession, logout, isValidAuthSession, authService, type AuthSession } from "../auth";
import { discardInFlightAuthRequests } from "../api";

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const validSession: AuthSession = {
  user: {
    id: "1",
    name: "Admin Cata Club",
    email: "admin@cataclub.com",
    role: "admin",
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-07-17T10:00:00.000Z",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

/**
 * A browser that keeps the cookies /api/auth/login set: the POST answers with
 * the session, and the confirming GET /api/auth/session answers with it too.
 * Two distinct `Response` objects because a body can only be read once.
 */
function mockLoginWithPersistedSession(): void {
  vi.mocked(global.fetch)
    .mockResolvedValueOnce(okResponse(validSession))
    .mockResolvedValueOnce(okResponse(validSession));
}

describe("login", () => {
  it("returns ok:true with the session on success", async () => {
    mockLoginWithPersistedSession();

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: true, session: validSession });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@cataclub.com", password: "admin123" }),
      }),
    );
  });

  /*
   * Issue: "200 but no session".
   *
   * The bug these three lock down was engine-independent, and the toast it
   * produced said "Su sesión quedó iniciada. Le llevamos a su panel." to a
   * person who was about to be left on /login with nothing to act on. It was
   * first seen in WebKit over plain http (a `Secure` cookie the browser
   * refuses to keep), but the same 200-with-no-cookie happens whenever
   * cookies are blocked for the site, a private window discards them, ITP
   * clears them, a proxy strips Set-Cookie, or clock skew invalidates them.
   *
   * The load-bearing assertion is `ok: false`: a 200 from /api/auth/login is
   * a claim about credentials, never proof of a session.
   */
  it("reports session_not_persisted when the login 200s but the browser kept no cookies", async () => {
    vi.mocked(global.fetch)
      // POST /api/auth/login — credentials fine, Set-Cookie sent.
      .mockResolvedValueOnce(okResponse(validSession))
      // GET /api/auth/session — arrives with no cookies at all, which the BFF
      // answers 200 { authenticated: false } (see src/app/api/auth/session/route.ts).
      .mockResolvedValueOnce(okResponse({ authenticated: false }));

    const result = await login("admin@cataclub.com", "admin12345");

    expect(result).toEqual({ ok: false, error: "session_not_persisted" });
  });

  it("confirms the session against /api/auth/session before reporting success", async () => {
    mockLoginWithPersistedSession();

    await login("admin@cataclub.com", "admin12345");

    expect(global.fetch).toHaveBeenNthCalledWith(1, "/api/auth/login", expect.objectContaining({ method: "POST" }));
    expect(global.fetch).toHaveBeenNthCalledWith(2, "/api/auth/session", expect.objectContaining({ method: "GET" }));
  });

  it("reports the outage, not a cookie problem, when the confirming call cannot reach the server", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(okResponse(validSession))
      .mockResolvedValueOnce(errorResponse(503, { authenticated: false, error: "backend_unavailable" }));

    const result = await login("admin@cataclub.com", "admin12345");

    // A 503 says nothing about the cookies, so it must not be blamed on the
    // browser — but it is not a success either.
    expect(result).toEqual({ ok: false, error: "backend_unavailable" });
  });

  it("surfaces a server misconfiguration as config_error, not backend_unavailable", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(500, { error: "config_error", message: "BACKEND_API_URL is not set." }),
    );

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "config_error" });
  });

  it("still reports an unlabelled 500 as unknown", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(500, {}));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("never includes a token anywhere in the resolved session", async () => {
    mockLoginWithPersistedSession();

    const result = await login("admin@cataclub.com", "admin123");

    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });

  it("returns invalid_credentials on 401", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(401, { message: "bad creds" }));

    const result = await login("admin@cataclub.com", "wrong");

    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
  });

  it("returns session_validation_failed on 401 when the BFF reports error: unauthorized (backendMe rejected the fresh token)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      errorResponse(401, { error: "unauthorized", message: "token rejected" }),
    );

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "session_validation_failed" });
  });

  it("returns backend_unavailable on 503", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(503, {}));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "backend_unavailable" });
  });

  it("returns backend_unavailable when fetch rejects with a network error", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "backend_unavailable" });
  });

  it("returns timeout when the request aborts", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("returns unknown when the response body has an invalid shape", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ not: "a session" }));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("returns unknown for an unexpected non-2xx status", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(500, {}));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "unknown" });
  });
});

// ---------------------------------------------------------------------------
// fetchSession
// ---------------------------------------------------------------------------

describe("fetchSession", () => {
  it("returns an authenticated outcome when /api/auth/session responds 200", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse(validSession));

    const result = await fetchSession();

    expect(result).toEqual({ kind: "authenticated", session: validSession });
    expect(global.fetch).toHaveBeenCalledWith("/api/auth/session", expect.objectContaining({ method: "GET" }));
  });

  it("returns unauthenticated when the session route reports 401 (genuinely invalid/expired session)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(401, { authenticated: false }));

    expect(await fetchSession()).toEqual({ kind: "unauthenticated" });
  });

  it("returns outage on a 503 (transient backend outage — must NOT be treated as logout)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(errorResponse(503, { authenticated: false }));

    expect(await fetchSession()).toEqual({ kind: "outage" });
  });

  it("returns outage on a network failure (graceful degradation, not a forced logout)", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await fetchSession()).toEqual({ kind: "outage" });
  });

  it("returns unauthenticated when the response body has an invalid shape", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ bogus: true }));

    expect(await fetchSession()).toEqual({ kind: "unauthenticated" });
  });
});

// ---------------------------------------------------------------------------
// fetchSession — descarte al cerrar sesión (issue #1053)
// ---------------------------------------------------------------------------

describe("fetchSession — descarte al cerrar sesión (issue #1053)", () => {
  /**
   * Reproduce el orden real del defecto: la petición a /api/auth/session ya
   * está en vuelo (el `fetch` salió) cuando algo dispara
   * `discardInFlightAuthRequests` — el mismo descarte que `AuthContext`'s
   * `logout()` llama antes de pedir el cierre de sesión. La respuesta con la
   * cookie re-sellada nunca debe llegar a procesarse: un `fetch` real,
   * abortado mientras está pendiente, jamás entrega sus cabeceras
   * (`Set-Cookie` incluido) al navegador.
   *
   * Antes del arreglo, `fetchSession` no exponía ningún `AbortController`
   * alcanzable desde afuera — este test falla porque la señal capturada
   * nunca se aborta y la promesa de `fetchSession` queda colgada.
   */
  it("aborta una petición de sesión en vuelo cuando se descartan las peticiones de autenticación en curso", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(global.fetch).mockImplementationOnce((_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    // La petición sale primero — todavía no hay ningún logout en curso.
    const pending = fetchSession();
    await Promise.resolve(); // deja que el `fetch` mockeado arranque y capture la señal.

    // El logout empieza recién ahora: descarta toda petición de autenticación
    // en vuelo, exactamente lo que `AuthContext`'s `logout()` hace antes de
    // pedir /api/auth/logout.
    discardInFlightAuthRequests();

    expect(capturedSignal?.aborted).toBe(true);
    // La respuesta jamás llega a procesarse — ni su cuerpo ni su Set-Cookie.
    expect(await pending).toEqual({ kind: "outage" });
  });

  it("no aborta la petición si nadie descarta peticiones en curso (la sesión resuelve con normalidad)", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse(validSession));

    expect(await fetchSession()).toEqual({ kind: "authenticated", session: validSession });
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe("logout", () => {
  it("calls POST /api/auth/logout", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse({ success: true }));

    await logout();

    expect(global.fetch).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
  });

  it("resolves even when the fetch call throws", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(logout()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isValidAuthSession
// ---------------------------------------------------------------------------

describe("isValidAuthSession", () => {
  it("accepts a well-shaped session", () => {
    expect(isValidAuthSession(validSession)).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidAuthSession(null)).toBe(false);
  });

  it("rejects a session missing the user block", () => {
    expect(isValidAuthSession({ roles: [], loggedInAt: "x" })).toBe(false);
  });

  it("rejects an invalid role", () => {
    expect(
      isValidAuthSession({
        user: { id: "1", name: "X", email: "x@x.com", role: "superadmin" },
        roles: [],
        loggedInAt: "x",
      }),
    ).toBe(false);
  });

  it("rejects a session where roles is not an array of strings", () => {
    expect(
      isValidAuthSession({
        user: { id: "1", name: "X", email: "x@x.com", role: "admin" },
        roles: "ADMINISTRADOR",
        loggedInAt: "x",
      }),
    ).toBe(false);
  });

  it("accepts a representante session", () => {
    expect(
      isValidAuthSession({
        user: { id: "1", name: "T", email: "t@t.com", role: "representante" },
        roles: ["REPRESENTANTE"],
        loggedInAt: "x",
      }),
    ).toBe(true);
  });

  it('accepts an "unsupported" session', () => {
    expect(
      isValidAuthSession({
        user: { id: "1", name: "N", email: "n@n.com", role: "unsupported" },
        roles: [],
        loggedInAt: "x",
      }),
    ).toBe(true);
  });

  it("rejects a session with a token field but otherwise treats it as an unexpected extra (not required, not rejected)", () => {
    // Defense-in-depth note: isValidAuthSession only checks required fields;
    // it doesn't reject unknown extras. Token-leak prevention is enforced by
    // the BFF never putting one in the response body (see route tests).
    expect(
      isValidAuthSession({ ...validSession, token: "leaked" }),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Issue #762 — the client's own half of the single-role invariant.
  //
  // The BFF already refuses to build a multi-role session, so nothing should
  // ever reach here carrying two roles. This guard exists precisely for the
  // "should never" cases (a stale deployment, a proxied response, a hand-rolled
  // body), and a payload with two roles is the one the rail would have drawn as
  // a union while the route guards answered from a single value.
  // -------------------------------------------------------------------------

  it("rejects a session carrying more than one recognized role", () => {
    expect(isValidAuthSession({ ...validSession, roles: ["ADMINISTRADOR", "ENTRENADOR"] })).toBe(false);
    expect(isValidAuthSession({ ...validSession, roles: ["ENTRENADOR", "ALUMNO"] })).toBe(false);
    expect(isValidAuthSession({ ...validSession, roles: ["REPRESENTANTE", "ALUMNO"] })).toBe(false);
  });

  it("accepts the shapes that are still exactly one role", () => {
    expect(isValidAuthSession({ ...validSession, roles: ["ENTRENADOR"] })).toBe(true);
    // No recognized role at all is the "unsupported" account, not a conflict.
    expect(isValidAuthSession({ ...validSession, roles: [] })).toBe(true);
    expect(isValidAuthSession({ ...validSession, roles: ["GHOST_ROLE"] })).toBe(true);
    // An unknown role beside a known one grants nothing extra, so it is not a
    // second role — same answer the BFF gives.
    expect(isValidAuthSession({ ...validSession, roles: ["GHOST_ROLE", "ALUMNO"] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// login — the multi-role refusal reaches the person who typed the password
// ---------------------------------------------------------------------------

describe("login — multi-role account (issue #762)", () => {
  it('reports "role_conflict" for the BFF 409, not the generic unknown failure', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(errorResponse(409, { error: "role_conflict" }));

    const result = await login("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: false, error: "role_conflict" });
  });
});

// ---------------------------------------------------------------------------
// fetchSession — a multi-role body is not a session
// ---------------------------------------------------------------------------

describe("fetchSession — multi-role body (issue #762)", () => {
  it("reads a 200 carrying two roles as unauthenticated rather than hydrating it", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      okResponse({ ...validSession, roles: ["ADMINISTRADOR", "ENTRENADOR"] }),
    );

    expect(await fetchSession()).toEqual({ kind: "unauthenticated" });
  });
});

// ---------------------------------------------------------------------------
// authService — object parity with previous call sites
// ---------------------------------------------------------------------------

describe("authService", () => {
  it("exposes login, logout, and getSession", () => {
    expect(authService.login).toBe(login);
    expect(authService.logout).toBe(logout);
    expect(authService.getSession).toBe(fetchSession);
  });
});
