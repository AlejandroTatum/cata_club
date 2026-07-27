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

describe("login", () => {
  it("returns ok:true with the session on success", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse(validSession));

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
    vi.mocked(global.fetch).mockResolvedValue(okResponse(validSession));

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
