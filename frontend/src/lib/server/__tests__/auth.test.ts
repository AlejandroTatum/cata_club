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
    expect(result.error.message).toMatch(/BACKEND_API_URL/);
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

    expect(session.user).toMatchObject({ role: "estudiante", grupoId: null, activo: true });
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
