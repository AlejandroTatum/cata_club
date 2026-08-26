/**
 * Route Handler Tests — GET/PATCH /api/fichas-medicas/persona/[id]
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function getRequest(personaId: string, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/fichas-medicas/persona/${personaId}`, {
    headers: cookie ? { cookie } : {},
  });
}

function patchRequest(personaId: string, body: unknown, cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/fichas-medicas/persona/${personaId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const fichaMedica = {
  id: 10,
  personaId: 5,
  tipoSangre: "O_POSITIVO",
  enfermedades: [{ id: 1, nombreEnfermedad: "Asma" }],
  alergias: "Polen",
  contactoEmergencia: "María",
  telefonoEmergencia: "0997654321",
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/fichas-medicas/persona/[id]", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest("5"), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /fichas-medicas/persona/{id} with Authorization: Bearer", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: { id: "5" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fichaMedica);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/fichas-medicas/persona/5",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("propagates the backend's 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: { id: "5" } });

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/fichas-medicas/persona/[id]", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest("5", { tipoSangre: "A_POSITIVO" }), { params: { id: "5" } });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /fichas-medicas/persona/{id} with snake_case body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest(
        "5",
        {
          tipoSangre: "O_POSITIVO",
          enfermedades: ["Asma"],
          alergias: "Polen",
          contactoEmergencia: "María",
          telefonoEmergencia: "0997654321",
        },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: { id: "5" } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fichaMedica);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/fichas-medicas/persona/5",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          tipo_sangre: "O_POSITIVO",
          enfermedades: ["Asma"],
          alergias: "Polen",
          contacto_emergencia: "María",
          telefono_emergencia: "0997654321",
        }),
      }),
    );
  });

  it("propagates the backend's 403", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { tipoSangre: "A_POSITIVO" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(403);
  });

  it("forwards an explicit null for alergias/contactoEmergencia/telefonoEmergencia instead of dropping the key (FIC-5)", async () => {
    // Clearing a field must reach the backend as `null`, not be silently
    // omitted from the body — omitting it means "leave unchanged" server-side,
    // which is exactly the bug: the toast says success but nothing is cleared.
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    await PATCH(
      patchRequest(
        "5",
        { alergias: null, contactoEmergencia: null, telefonoEmergencia: null },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: { id: "5" } },
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/fichas-medicas/persona/5",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          alergias: null,
          contacto_emergencia: null,
          telefono_emergencia: null,
        }),
      }),
    );
  });
});

/**
 * Issue #643 — where this route does NOT enforce the rule, and why.
 *
 * The enrollment route validates its whole body because it already owned a
 * full validator for it. This one is a transport: it forwards a partial PATCH
 * and hands back what the backend says. Re-implementing "a complete medical
 * record" here would be a second definition of the rule, sitting one process
 * away from the first, free to drift from it — and the backend enforces it on
 * every caller, not just this one.
 *
 * So what has to be true here is narrower and testable: the rejection must
 * arrive intact. A rule the user never gets to read is a rule that, from the
 * screen's point of view, did not fire.
 */
describe("PATCH /api/fichas-medicas/persona/[id] — #643 rejections reach the caller", () => {
  it("passes through the backend's 422 for a DESCONOCIDO blood type", async () => {
    const detail = "El tipo de sangre es obligatorio.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail, message: detail }, 422));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { tipoSangre: "DESCONOCIDO" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining("tipo de sangre") }),
    );
  });

  it("passes through the backend's 400 when a PATCH would leave the record invalid", async () => {
    const detail = "El teléfono de emergencia es obligatorio.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail, message: detail }, 400));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { alergias: "Polen" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining("teléfono de emergencia") }),
    );
  });

  it("still forwards a complete, valid record untouched", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest(
        "5",
        { tipoSangre: "O_POSITIVO", telefonoEmergencia: "0997654321" },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: { id: "5" } },
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/fichas-medicas/persona/5",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ tipo_sangre: "O_POSITIVO", telefono_emergencia: "0997654321" }),
      }),
    );
  });
});
