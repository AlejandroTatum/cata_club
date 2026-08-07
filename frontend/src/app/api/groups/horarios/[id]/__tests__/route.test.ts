/**
 * Route Handler Tests — PUT /api/groups/horarios/[id]
 *
 * PUT speaks the `categoria`-derived contract: the backend's
 * `HorarioUpdateDTO` accepts exactly `categoria`, `dia_semana` and
 * (all optional, applied with `exclude_unset`), deriving
 * `hora_inicio`/`hora_fin` from `CATEGORIA_METADATA[categoria]`.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUT } from "../route";
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

function putRequest(body: unknown, cookie = "", id = "1"): NextRequest {
  return new NextRequest(`http://localhost/api/groups/horarios/${id}`, {
    method: "PUT",
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

describe("PUT /api/groups/horarios/[id]", () => {
  it("returns 401 when no access token cookie is present", async () => {
    const response = await PUT(putRequest({ categoria: "COMPETITIVO" }), { params: { id: "1" } });
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards categoria to the backend with the bearer token", async () => {
    const actualizado = { id: 1, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(actualizado));

    const access = makeJwt(3600);
    const response = await PUT(
      putRequest({ categoria: "COMPETITIVO", dia_semana: "LUNES" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: { id: "1" } },
    );
    const body = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/asistencias/horarios/1",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
    expect(forwardedBody()).toEqual({ categoria: "COMPETITIVO", dia_semana: "LUNES" });
    expect(response.status).toBe(200);
    expect(body).toEqual(actualizado);
  });

  it("forwards only the fields present in the body (partial update)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 7 }));

    const access = makeJwt(3600);
    await PUT(putRequest({ dia_semana: "MARTES" }, `${ACCESS_TOKEN_COOKIE}=${access}`, "7"), {
      params: { id: "7" },
    });

    expect(forwardedBody()).toEqual({ dia_semana: "MARTES" });
  });

  it("does not forward fields outside the backend contract", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const access = makeJwt(3600);
    await PUT(
      putRequest(
        { categoria: "COMPETITIVO", hora_inicio: "18:00", hora_fin: "20:00", nivel_ranking_id: 3 },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: { id: "1" } },
    );

    expect(forwardedBody()).toEqual({ categoria: "COMPETITIVO" });
  });

  it("returns 400 when the payload carries no updatable field", async () => {
    const access = makeJwt(3600);
    const response = await PUT(putRequest({}, `${ACCESS_TOKEN_COOKIE}=${access}`), {
      params: { id: "1" },
    });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("propagates backend errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "No encontrado" }, 404));

    const access = makeJwt(3600);
    const response = await PUT(putRequest({ categoria: "COMPETITIVO" }, `${ACCESS_TOKEN_COOKIE}=${access}`, "999"), {
      params: { id: "999" },
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("No encontrado");
  });
});
