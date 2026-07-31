/**
 * Route Handler Tests — GET/POST /api/groups/horarios
 *
 * POST speaks the `categoria`-derived contract: the backend's
 * `HorarioCreateDTO` accepts exactly `categoria`, `dia_semana` and
 * deriving `hora_inicio`/`hora_fin` from
 * `CATEGORIA_METADATA[categoria]`.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "../route";
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

function getRequest(query = "", cookie = ""): NextRequest {
  return new NextRequest(`http://localhost/api/groups/horarios${query}`, {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/groups/horarios", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** The JSON body the handler forwarded to FastAPI on its Nth fetch. */
function forwardedBody(callIndex = 0): Record<string, unknown> {
  const init = vi.mocked(global.fetch).mock.calls[callIndex]?.[1];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/groups/horarios", () => {
  it("returns 401 when no access token cookie is present", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("proxies GET /asistencias/horarios with the bearer token", async () => {
    const horarios = [{ id: 1, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", nivelRankingId: null }];
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(horarios));

    const access = makeJwt(3600);
    const response = await GET(getRequest("", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(horarios);
  });

  it("forwards ?categoria= as a query param (triangulation)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse([]));

    const access = makeJwt(3600);
    await GET(getRequest("?categoria=FORMATIVO", `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios?categoria=FORMATIVO",
      expect.anything(),
    );
  });

  it("propagates backend errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "Error interno" }, 500));

    const access = makeJwt(3600);
    const response = await GET(getRequest("", `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).toBe("Error interno");
  });
});

describe("POST /api/groups/horarios", () => {
  const validBody = { categoria: "COMPETITIVO", dia_semana: "LUNES" };

  it("returns 401 when no access token cookie is present", async () => {
    const response = await POST(postRequest(validBody));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards exactly categoria and dia_semana with the bearer token", async () => {
    const creado = { id: 1, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", nivelRankingId: null };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creado, 201));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validBody, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
    expect(forwardedBody()).toEqual(validBody);
    expect(response.status).toBe(201);
    expect(body).toEqual(creado);
  });

  it("returns 400 when categoria is missing", async () => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest({ dia_semana: "LUNES" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when dia_semana is not a string (triangulation)", async () => {
    const access = makeJwt(3600);
    const response = await POST(
      postRequest({ ...validBody, dia_semana: 5 }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not forward a stale entrenador_id — the relation is gone (issue #13)", async () => {
    const creado = { id: 1, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", nivelRankingId: null };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(creado, 201));

    const access = makeJwt(3600);
    await POST(
      postRequest({ ...validBody, entrenador_id: 5 }, `${ACCESS_TOKEN_COOKIE}=${access}`),
    );

    expect(forwardedBody()).toEqual(validBody);
  });

  it("propagates backend errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "Ya existe un horario para ese día." }, 409));

    const access = makeJwt(3600);
    const response = await POST(postRequest(validBody, `${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toBe("Ya existe un horario para ese día.");
  });
});
