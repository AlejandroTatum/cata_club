/**
 * Unit tests for server-only auth helpers (src/lib/server/auth.ts).
 *
 * All backend calls are mocked via vi.spyOn(global, "fetch") — no live
 * FastAPI backend involved. Covers env validation, form-encoding, JWT exp
 * decoding, cookie building, backend error-code mapping, role mapping, and
 * session building.
 *
 * @vitest-environment node
 */

import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBackendApiUrl,
  backendFetch,
  forwardedForFrom,
  backendLogin,
  backendMe,
  backendRefresh,
  backendLogout,
  buildSession,
  mapBackendRoleToUserRole,
  pickPrimaryRole,
  decodeJwtExpiry,
  isNearExpiry,
  setAuthCookies,
  clearAuthCookies,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
  type AuthResult,
  type BackendLoginResponse,
} from "../auth";
import type { UserRole } from "@/types/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Build a syntactically valid (unsigned) JWT with the given `exp` claim. */
function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

// ---------------------------------------------------------------------------
// getBackendApiUrl
// ---------------------------------------------------------------------------

describe("getBackendApiUrl", () => {
  it("returns the configured URL", () => {
    expect(getBackendApiUrl()).toBe("http://localhost:8000/api/v1");
  });

  it("throws a clear error when BACKEND_API_URL is missing", () => {
    delete process.env.BACKEND_API_URL;
    expect(() => getBackendApiUrl()).toThrow(/BACKEND_API_URL/);
  });
});

// ---------------------------------------------------------------------------
// backendFetch — misconfiguration must not masquerade as an outage
// ---------------------------------------------------------------------------

describe("backendFetch", () => {
  it("reports a missing BACKEND_API_URL as config_error, not backend_unavailable", async () => {
    delete process.env.BACKEND_API_URL;

    const result = await backendFetch("/auth/login", { method: "POST" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("config_error");
  });

  it("does not put the env var name in the message the route handler sends to the browser", async () => {
    // `error.message` is not a log line: every route handler under
    // src/app/api/ writes it straight into the JSON response body (see
    // auth/login/route.ts, auth/refresh/route.ts). `getBackendApiUrl()`
    // throws an English sentence naming BACKEND_API_URL and telling the
    // reader to edit .env.local — a deployment detail, addressed to whoever
    // runs the server, that no member of the club can act on. The operator
    // still gets it: the thrown Error is unchanged and reaches the server log.
    delete process.env.BACKEND_API_URL;

    const result = await backendFetch("/auth/login", { method: "POST" });

    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).not.toMatch(/BACKEND_API_URL|\.env\.local|NEXT_PUBLIC_/);
    expect(result.error.message).toBe("Configuración del servidor inválida.");
  });

  it("never attempts a network call when the backend URL is missing", async () => {
    delete process.env.BACKEND_API_URL;

    await backendFetch("/auth/login", { method: "POST" });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("still reports a genuine network failure as backend_unavailable", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const result = await backendFetch("/auth/login", { method: "POST" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("backend_unavailable");
  });
});

// ---------------------------------------------------------------------------
// forwardedForFrom + backendFetch's forwardedFor option (issue #235) — the
// backend's anonymous rate limiter is keyed by IP (clave_cliente), but its
// only view of a caller's IP is its own TCP peer, which is ALWAYS this BFF
// container. Without forwarding the real visitor's IP, every anonymous
// request from anywhere on the internet shares one rate-limit bucket.
// ---------------------------------------------------------------------------

describe("forwardedForFrom", () => {
  it("reads the visitor IP Caddy already set on X-Forwarded-For", () => {
    const request = new Request("http://localhost/api/enrollment", {
      headers: { "x-forwarded-for": "198.51.100.7" },
    });
    expect(forwardedForFrom(request)).toBe("198.51.100.7");
  });

  it("returns undefined when the header is absent", () => {
    const request = new Request("http://localhost/api/enrollment");
    expect(forwardedForFrom(request)).toBeUndefined();
  });
});

describe("backendFetch — forwardedFor", () => {
  it("sends X-Forwarded-For to the backend when forwardedFor is provided", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await backendFetch("/enrollment/", { method: "POST" }, { forwardedFor: "203.0.113.9" });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/enrollment/",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Forwarded-For": "203.0.113.9" }) }),
    );
  });

  it("does not add X-Forwarded-For when forwardedFor is not provided (existing call sites unchanged)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await backendFetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" } });

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(Object.keys((init as RequestInit).headers as Record<string, string>)).not.toContain("X-Forwarded-For");
  });
});

describe("backendLogin — forwardedFor", () => {
  it("forwards the visitor IP to POST /auth/login", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "a", refresh_token: "r", token_type: "bearer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await backendLogin("admin@cataclub.com", "admin123", "198.51.100.20");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/login",
      expect.objectContaining({ headers: expect.objectContaining({ "X-Forwarded-For": "198.51.100.20" }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// backendFetch — the deadline, and who gets to change it (issue #197)
//
// The deadlines are written here as literal milliseconds on purpose, not
// imported from ../auth: a test that reads the same constant the code reads
// moves with it and can never notice it changed. These numbers are the
// contract — 10 s for everything, and only what asks for it gets more.
// ---------------------------------------------------------------------------

/**
 * A backend that never answers on its own: the returned promise settles only
 * when the `AbortSignal` `backendFetch` handed to `fetch` actually fires.
 * Everything these tests observe about a deadline is therefore a real abort
 * reaching the caller, not a timer inspected from the inside.
 */
function backendQueSoloRespondeAlAbort(): void {
  vi.mocked(global.fetch).mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (!signal) {
          reject(new Error("backendFetch dejó de pasar un AbortSignal — no hay plazo que observar."));
          return;
        }
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  );
}

const TIMEOUT_ESPERADO = { ok: false, error: { code: "timeout", message: expect.any(String) } };

describe("backendFetch — plazo por llamada", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backendQueSoloRespondeAlAbort();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborta a los 10 s cuando no se le pasa plazo, y ni un milisegundo antes", async () => {
    const observado: AuthResult<Response>[] = [];
    const pendiente = backendFetch("/auth/login", { method: "POST" }).then((r) => observado.push(r));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(observado).toHaveLength(1);
    await pendiente;
    expect(observado[0]).toEqual(TIMEOUT_ESPERADO);
  });

  it("respeta el plazo explícito en vez del default", async () => {
    const observado: AuthResult<Response>[] = [];
    const pendiente = backendFetch("/reportes/pdf", { method: "GET" }, { timeoutMs: 60_000 }).then((r) =>
      observado.push(r),
    );

    // El default habría cortado acá. No es este el plazo de esta llamada.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50_000);
    expect(observado).toHaveLength(1);
    await pendiente;
    expect(observado[0]).toEqual(TIMEOUT_ESPERADO);
  });

  it("mantiene el default de 10 s para la autenticación aunque exista el plazo largo", async () => {
    const observado: AuthResult<BackendLoginResponse>[] = [];
    const pendiente = backendLogin("admin@cataclub.com", "admin123").then((r) => observado.push(r));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(observado).toHaveLength(1);
    await pendiente;
    expect(observado[0]).toEqual(TIMEOUT_ESPERADO);
  });
});

// ---------------------------------------------------------------------------
// backendLogin — form encoding + error mapping
// ---------------------------------------------------------------------------

describe("backendLogin", () => {
  it("POSTs application/x-www-form-urlencoded with username + password", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }),
    );

    await backendLogin("admin@cataclub.com", "admin123");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "username=admin%40cataclub.com&password=admin123",
      }),
    );
  });

  it("returns ok:true with the parsed tokens on success", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ access_token: "a", refresh_token: "r", token_type: "bearer" }),
    );

    const result = await backendLogin("admin@cataclub.com", "admin123");

    expect(result).toEqual({ ok: true, data: { access_token: "a", refresh_token: "r", token_type: "bearer" } });
  });

  it("maps 401 to invalid_credentials", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ detail: "bad" }, 401));

    const result = await backendLogin("x@x.com", "wrong");

    expect(result).toEqual({ ok: false, error: { code: "invalid_credentials", message: expect.any(String) } });
  });

  it("maps 400 to invalid_credentials", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, 400));

    const result = await backendLogin("x@x.com", "wrong");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_credentials");
  });

  it("maps a network error to backend_unavailable", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new TypeError("fetch failed"));

    const result = await backendLogin("x@x.com", "y");

    expect(result).toEqual({ ok: false, error: { code: "backend_unavailable", message: expect.any(String) } });
  });

  it("maps an aborted request to timeout", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const result = await backendLogin("x@x.com", "y");

    expect(result).toEqual({ ok: false, error: { code: "timeout", message: expect.any(String) } });
  });

  it("maps a malformed success body to invalid_response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ access_token: "a" }));

    const result = await backendLogin("x@x.com", "y");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });

  it("maps an unexpected 5xx to backend_unavailable", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, 500));

    const result = await backendLogin("x@x.com", "y");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("backend_unavailable");
  });
});

// ---------------------------------------------------------------------------
// backendMe
// ---------------------------------------------------------------------------

describe("backendMe", () => {
  it("sends the Authorization bearer header", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      jsonResponse({ correo: "a@a.com", personaId: 1, nombres: "A", apellidos: "B", roles: ["ALUMNO"] }),
    );

    await backendMe("access-token-123");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/me",
      expect.objectContaining({ headers: { Authorization: "Bearer access-token-123" } }),
    );
  });

  it("maps 401 to unauthorized", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, 401));

    const result = await backendMe("expired");

    expect(result).toEqual({ ok: false, error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("rejects a response missing required fields as invalid_response", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ correo: "a@a.com" }));

    const result = await backendMe("token");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_response");
  });
});

// ---------------------------------------------------------------------------
// backendRefresh
// ---------------------------------------------------------------------------

describe("backendRefresh", () => {
  it("sends the refresh token in the JSON body, not as a bearer header, and returns the new access token", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ access_token: "new-access", token_type: "bearer" }));

    const result = await backendRefresh("refresh-token-abc");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/auth/refresh",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: "refresh-token-abc" }),
      }),
    );
    expect(result).toEqual({ ok: true, data: { access_token: "new-access", token_type: "bearer" } });
  });

  it("maps 401 (rejected/expired refresh token) to unauthorized", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, 401));

    const result = await backendRefresh("bad-refresh");

    expect(result).toEqual({ ok: false, error: { code: "unauthorized", message: expect.any(String) } });
  });
});

// ---------------------------------------------------------------------------
// backendLogout — always resolves
// ---------------------------------------------------------------------------

describe("backendLogout", () => {
  it("resolves even when fetch throws", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));

    await expect(backendLogout("token")).resolves.toBeUndefined();
  });

  it("resolves on a normal 200", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}));

    await expect(backendLogout("token")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapBackendRoleToUserRole
// ---------------------------------------------------------------------------

describe("mapBackendRoleToUserRole", () => {
  it("maps ADMINISTRADOR to admin", () => {
    expect(mapBackendRoleToUserRole(["ADMINISTRADOR"])).toBe("admin");
  });

  it("maps ENTRENADOR to trainer", () => {
    expect(mapBackendRoleToUserRole(["ENTRENADOR"])).toBe("trainer");
  });

  it("maps REPRESENTANTE to representante", () => {
    expect(mapBackendRoleToUserRole(["REPRESENTANTE"])).toBe("representante");
  });

  it("maps ALUMNO to estudiante", () => {
    expect(mapBackendRoleToUserRole(["ALUMNO"])).toBe("estudiante");
  });

  it('maps an empty roles array to "unsupported"', () => {
    expect(mapBackendRoleToUserRole([])).toBe("unsupported");
  });

  it('maps unrecognized role strings to "unsupported"', () => {
    expect(mapBackendRoleToUserRole(["SUPERADMIN"])).toBe("unsupported");
    expect(mapBackendRoleToUserRole(["", "GHOST_ROLE"])).toBe("unsupported");
  });

  it("prioritizes ADMINISTRADOR when multiple roles are present", () => {
    expect(mapBackendRoleToUserRole(["ALUMNO", "ADMINISTRADOR"])).toBe("admin");
  });

  it("resolves REPRESENTANTE + ALUMNO to representante (representante outranks student)", () => {
    expect(mapBackendRoleToUserRole(["REPRESENTANTE", "ALUMNO"])).toBe("representante");
    expect(mapBackendRoleToUserRole(["ALUMNO", "REPRESENTANTE"])).toBe("representante");
  });

  it("resolves all four backend roles at once to admin", () => {
    expect(
      mapBackendRoleToUserRole(["ALUMNO", "REPRESENTANTE", "ENTRENADOR", "ADMINISTRADOR"]),
    ).toBe("admin");
  });

  it("ignores unrecognized roles mixed in with a recognized one", () => {
    expect(mapBackendRoleToUserRole(["GHOST_ROLE", "ENTRENADOR"])).toBe("trainer");
  });
});

// ---------------------------------------------------------------------------
// pickPrimaryRole — deterministic multi-role precedence
// ---------------------------------------------------------------------------

describe("pickPrimaryRole", () => {
  it("returns null for an empty set", () => {
    expect(pickPrimaryRole([])).toBeNull();
  });

  it("returns the sole role when only one is present", () => {
    expect(pickPrimaryRole(["estudiante"])).toBe("estudiante");
    expect(pickPrimaryRole(["representante"])).toBe("representante");
  });

  it("prioritizes admin over every other role", () => {
    const combos: UserRole[][] = [
      ["admin", "representante"],
      ["admin", "trainer"],
      ["admin", "estudiante"],
      ["admin", "representante", "trainer", "estudiante"],
    ];
    for (const combo of combos) {
      expect(pickPrimaryRole(combo)).toBe("admin");
    }
  });

  it("prioritizes representante over trainer and estudiante (but not admin)", () => {
    expect(pickPrimaryRole(["representante", "trainer"])).toBe("representante");
    expect(pickPrimaryRole(["representante", "estudiante"])).toBe("representante");
    expect(pickPrimaryRole(["trainer", "estudiante", "representante"])).toBe("representante");
  });

  it("prioritizes trainer over estudiante", () => {
    expect(pickPrimaryRole(["trainer", "estudiante"])).toBe("trainer");
  });

  it("is order-independent — same set, any input order, same result", () => {
    expect(pickPrimaryRole(["estudiante", "trainer", "representante", "admin"])).toBe("admin");
    expect(pickPrimaryRole(["admin", "representante", "trainer", "estudiante"])).toBe("admin");
  });

  it("ignores unsupported (outside the precedence list)", () => {
    expect(pickPrimaryRole(["unsupported"])).toBeNull();
    expect(pickPrimaryRole(["unsupported", "estudiante"])).toBe("estudiante");
  });
});

// ---------------------------------------------------------------------------
// buildSession
// ---------------------------------------------------------------------------

describe("buildSession", () => {
  it("builds a token-free session for a staff role", () => {
    const session = buildSession({
      correo: "admin@cataclub.com",
      personaId: 42,
      nombres: "Ana",
      apellidos: "Torres",
      roles: ["ADMINISTRADOR"],
    });

    expect(session.user).toEqual({
      id: "42",
      name: "Ana Torres",
      email: "admin@cataclub.com",
      role: "admin",
      representanteId: null,
    });
    expect(session.roles).toEqual(["ADMINISTRADOR"]);
    expect(JSON.stringify(session)).not.toMatch(/token/i);
  });

  it("builds an estudiante session with the extra discriminated fields", () => {
    const session = buildSession({
      correo: "alumno@cataclub.com",
      personaId: "7",
      nombres: "Luis",
      apellidos: "Perez",
      roles: ["ALUMNO"],
    });

    expect(session.user).toMatchObject({ role: "estudiante", activo: true });
  });

  // getNavLinksForRole (src/lib/auth-utils.ts) needs the estudiante's own
  // birth date to decide whether the Ficha médica nav entry belongs — this
  // is the field that carries it from /auth/me's `fechaNacimiento` through
  // to the client session.
  it("carries fechaNacimiento through for an estudiante session", () => {
    const session = buildSession({
      correo: "alumno2@cataclub.com",
      personaId: "8",
      nombres: "Marta",
      apellidos: "Ruiz",
      roles: ["ALUMNO"],
      fechaNacimiento: "1990-05-20",
    });

    expect(session.user).toMatchObject({ role: "estudiante", fechaNacimiento: "1990-05-20" });
  });

  it("builds a representante session", () => {
    const session = buildSession({
      correo: "representante@cataclub.com",
      personaId: "9",
      nombres: "Carla",
      apellidos: "Diaz",
      roles: ["REPRESENTANTE"],
    });

    expect(session.user).toMatchObject({ role: "representante" });
    expect(session.roles).toEqual(["REPRESENTANTE"]);
  });

  it('builds an "unsupported" session for an empty roles array, never "representante"', () => {
    const session = buildSession({
      correo: "ghost@cataclub.com",
      personaId: "10",
      nombres: "Nadie",
      apellidos: "Reconocido",
      roles: [],
    });

    expect(session.user.role).toBe("unsupported");
    expect(session.user.role).not.toBe("representante");
  });

  it('builds an "unsupported" session when only unrecognized roles are present', () => {
    const session = buildSession({
      correo: "ghost2@cataclub.com",
      personaId: "11",
      nombres: "Otro",
      apellidos: "Desconocido",
      roles: ["SUPERADMIN"],
    });

    expect(session.user.role).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
// JWT exp decoding
// ---------------------------------------------------------------------------

describe("decodeJwtExpiry / isNearExpiry", () => {
  it("decodes a valid token's exp claim", () => {
    const token = makeJwt(3600);
    const exp = decodeJwtExpiry(token);
    expect(exp).toBeCloseTo(Math.floor(Date.now() / 1000) + 3600, -1);
  });

  it("returns null for a malformed token", () => {
    expect(decodeJwtExpiry("not-a-jwt")).toBeNull();
  });

  it("treats a malformed token as near expiry", () => {
    expect(isNearExpiry("not-a-jwt", 300)).toBe(true);
  });

  it("is not near expiry when exp is far in the future", () => {
    expect(isNearExpiry(makeJwt(3600), 300)).toBe(false);
  });

  it("is near expiry when exp is within the threshold", () => {
    expect(isNearExpiry(makeJwt(60), 300)).toBe(true);
  });

  it("is near expiry when the token is already expired", () => {
    expect(isNearExpiry(makeJwt(-60), 300)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

describe("setAuthCookies / clearAuthCookies", () => {
  it("sets both cookies as HttpOnly, SameSite=Lax, with Max-Age derived from exp", () => {
    const response = NextResponse.json({});
    const accessToken = makeJwt(3600);
    const refreshToken = makeJwt(7 * 24 * 60 * 60);

    setAuthCookies(response, { accessToken, refreshToken });

    const access = response.cookies.get(ACCESS_TOKEN_COOKIE);
    const refresh = response.cookies.get(REFRESH_TOKEN_COOKIE);

    expect(access?.value).toBe(accessToken);
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe("lax");
    expect(access?.path).toBe("/");
    expect(access?.maxAge).toBeGreaterThan(0);
    expect(access?.maxAge).toBeLessThanOrEqual(3600);

    expect(refresh?.value).toBe(refreshToken);
    expect(refresh?.httpOnly).toBe(true);
  });

  it("falls back to the documented Max-Age when the token can't be decoded", () => {
    const response = NextResponse.json({});
    setAuthCookies(response, { accessToken: "not-a-jwt" });

    const access = response.cookies.get(ACCESS_TOKEN_COOKIE);
    expect(access?.maxAge).toBe(ACCESS_TOKEN_MAX_AGE_SECONDS);
  });

  it("does not set a refresh cookie when none is provided", () => {
    const response = NextResponse.json({});
    setAuthCookies(response, { accessToken: makeJwt(60) });

    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  it("clearAuthCookies sets both cookies to empty with Max-Age 0", () => {
    const response = NextResponse.json({});
    clearAuthCookies(response);

    const access = response.cookies.get(ACCESS_TOKEN_COOKIE);
    const refresh = response.cookies.get(REFRESH_TOKEN_COOKIE);

    expect(access?.value).toBe("");
    expect(access?.maxAge).toBe(0);
    expect(refresh?.value).toBe("");
    expect(refresh?.maxAge).toBe(0);
  });

  it("REFRESH_TOKEN_MAX_AGE_SECONDS matches the documented 7-day lifetime", () => {
    expect(REFRESH_TOKEN_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});
