/**
 * Route Handler Tests — GET/POST /api/attendance/records
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
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

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/attendance/records", { headers: cookie ? { cookie } : {} });
}

function postRequest(body: unknown, cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/attendance/records", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

const asistencia = {
  id: 1,
  fechaEntrenamiento: "2026-07-18",
  fechaRegistro: "2026-07-18T16:26:55.036299",
  estado: "PRESENTE",
  justificativo: null,
  estadoJustificativo: null,
  personaId: 3,
  personaNombreCompleto: "Sofia Alumna",
  horarioId: 1,
  registradoPorId: 7,
  registradoPorNombre: "Carlos Ruiz",
};
const horario = { id: 1, diaSemana: "LUNES", horaInicio: "15:00:00", horaFin: "16:30:00" };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/attendance/records", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("translates backend Asistencias into AttendanceRecord[]", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [asistencia], total: 1, skip: 0, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse([horario]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        id: "1", fecha: "2026-07-18", horario: "Lunes 15:00 — 16:30", horarioId: 1, personaId: 3,
        estudiante: "Sofia Alumna", estado: "present", registradoPorId: 7, registradoPorNombre: "Carlos Ruiz",
        justificativo: null, estadoJustificativo: null,
      },
    ]);
  });

  // ASI-4 lock: the student's name must come straight off the
  // `AsistenciaResponseDTO` field the backend now resolves in origin
  // (`personaNombreCompleto`, issue #358) — never from a per-id
  // `/personas/{id}` fallback. That fallback was the last PII leak #358
  // closed (cédula/teléfono/fecha de nacimiento of any persona, reachable by
  // any ENTRENADOR via sequential ids): the endpoint is SOLO_ADMINISTRADOR
  // now, so a trainer session that still tried that fallback would get a 403
  // and degrade every record to "Persona {id}". This test fails red against
  // the old fallback-based adapter (it expects no /personas/ call at all,
  // which the old code always made) and stays green now that the DTO alone
  // supplies the name.
  it("resolves the real student name for a trainer session straight from the DTO, without calling /personas/{id}", async () => {
    const asistenciaDePersona15 = { ...asistencia, personaId: 15, personaNombreCompleto: "Emily Moreira Pilay" };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [asistenciaDePersona15], total: 1, skip: 0, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse([horario]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0].estudiante).toBe("Emily Moreira Pilay");
    expect(body[0].estudiante).not.toBe("Persona 15");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const personaCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes("/personas"));
    expect(personaCalls).toHaveLength(0);
  });

  it("forwards fechaInicio/fechaFin as fecha_inicio/fecha_fin query params, plus skip/limit for the backend page", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, skip: 0, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse([]));

    const access = makeJwt(3600);
    const request = new NextRequest("http://localhost/api/attendance/records?fechaInicio=2026-07-18&fechaFin=2026-07-18", {
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` },
    });
    await GET(request);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/reportes?fecha_inicio=2026-07-18&fecha_fin=2026-07-18&skip=0&limit=200",
      expect.anything(),
    );
  });

  it("loops through backend pages to assemble the full, unpaginated result the rest of the app expects", async () => {
    // The regression this fix closes: GET /asistencias/reportes is now
    // paginated server-side (TRA-6), but every consumer of THIS BFF route
    // (/reports CSV+PDF-count parity, /attendance, /dashboard, /trainer*) is
    // written against "one full array for the filtered range" — see
    // reports-utils.ts's doc comment on why that parity matters. So the BFF
    // loops pages internally: the backend query stays bounded, this route's
    // own response does not.
    const page1 = Array.from({ length: 200 }, (_, i) => ({ ...asistencia, id: i + 1 }));
    const page2 = [{ ...asistencia, id: 201 }, { ...asistencia, id: 202 }];
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: page1, total: 202, skip: 0, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse({ items: page2, total: 202, skip: 200, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse([horario]));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(202);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/reportes?skip=0&limit=200",
      expect.anything(),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8000/api/v1/asistencias/reportes?skip=200&limit=200",
      expect.anything(),
    );
  });

  it("passes the backend's 422 for an inverted date range straight through", async () => {
    const detail = "La fecha de inicio debe ser anterior a la fecha de fin.";
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail, message: detail }, 422));

    const access = makeJwt(3600);
    const request = new NextRequest(
      "http://localhost/api/attendance/records?fechaInicio=2026-12-31&fechaFin=2026-01-01",
      { headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${access}` } },
    );
    const response = await GET(request);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: detail });
    // The enrichment lookups must not run once the report itself failed.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(503);
  });
});

describe("POST /api/attendance/records", () => {
  it("returns 400 for an invalid body", async () => {
    const access = makeJwt(3600);
    const response = await POST(postRequest({ horarioId: 1 }, `${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("issues one POST /asistencias/ per student and reports createdCount", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse(asistencia, 201))
      .mockResolvedValueOnce(jsonResponse({ ...asistencia, id: 2, personaId: 7 }, 201));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        {
          horarioId: 1,
          fechaEntrenamiento: "2026-07-18",
          students: [
            { personaId: 3, estado: "present" },
            { personaId: 7, estado: "absent" },
          ],
        },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ createdCount: 2, failed: [], registradoPorNombre: "Carlos Ruiz" });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/asistencias/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          fecha_entrenamiento: "2026-07-18",
          estado: "PRESENTE",
          persona_id: 3,
          horario_id: 1,
        }),
      }),
    );
  });

  it("tolerates partial failure — one bad persona doesn't fail the whole batch", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse(asistencia, 201))
      .mockResolvedValueOnce(jsonResponse({ detail: "Persona con id 99 no encontrada" }, 404));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        {
          horarioId: 1,
          students: [
            { personaId: 3, estado: "present" },
            { personaId: 99, estado: "absent" },
          ],
        },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.createdCount).toBe(1);
    expect(body.failed).toEqual([{ personaId: 99, message: "Persona con id 99 no encontrada" }]);
  });

  // Corrige el candado anterior de esta suite ("returns 502 when every
  // student fails to register"), que le había enseñado a la suite a aceptar
  // la degradación del issue #309: exigía 502 para un 404 real del backend.
  // La ruta BFF debe propagar el status real del backend, nunca inventar uno
  // propio a partir de si `createdCount` llegó a cero.
  it("propaga el status real del backend cuando todos los estudiantes fallan, en vez de inventar 502", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({ detail: "Horario no encontrado" }, 404));

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        { horarioId: 999, students: [{ personaId: 3, estado: "present" }] },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.createdCount).toBe(0);
  });

  // Candado exigido por el issue #309 (hallazgo #21 / #60): el backend
  // levanta `PermisosInsuficientes` y `main.py` ya lo mapea a 403 — la ruta
  // BFF no debe degradarlo a 502. Un 502 le dice al entrenador "el servidor
  // se cayó" para una regla de permisos que reintentar jamás resuelve.
  it("propaga un 403 del backend (regla de permisos) como 403, no como 502", async () => {
    // `mockImplementation`, no `mockResolvedValue`: dos POST concurrentes
    // (uno por estudiante) comparten el mismo mock, y un `Response` ya
    // consumido por el primer `.json()` no puede leerse dos veces — cada
    // llamada necesita su propia instancia.
    vi.mocked(global.fetch).mockImplementation(async () =>
      jsonResponse({ detail: "Solo el administrador puede corregir asistencias ya registradas." }, 403),
    );

    const access = makeJwt(3600);
    const response = await POST(
      postRequest(
        {
          horarioId: 1,
          students: [
            { personaId: 67, estado: "present" },
            { personaId: 8, estado: "present" },
          ],
        },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.createdCount).toBe(0);
    expect(body.failed).toEqual([
      { personaId: 67, message: "Solo el administrador puede corregir asistencias ya registradas." },
      { personaId: 8, message: "Solo el administrador puede corregir asistencias ya registradas." },
    ]);
  });

  it("defaults an omitted fecha_entrenamiento to the CLUB's day, not the server's", async () => {
    // The regression this guards: the default used to be
    // `new Date().toISOString().slice(0, 10)`. This route runs server-side on a
    // host that is almost certainly UTC, where 19:00 in Ecuador is already
    // tomorrow — so every evening session (COMPETITIVO runs 18:00–20:00) filed
    // without an explicit date was stored under the wrong date.
    //
    // Pinned to 01:30 UTC, which is 20:30 the PREVIOUS day at the club: the two
    // calendars disagree, so a server-clock default cannot pass this.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T01:30:00Z"));
    try {
      vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(asistencia, 201));

      const access = makeJwt(3600);
      await POST(
        postRequest(
          { horarioId: 1, students: [{ personaId: 3, estado: "present" }] },
          `${ACCESS_TOKEN_COOKIE}=${access}`,
        ),
      );

      const [, init] = vi.mocked(global.fetch).mock.calls[0];
      const sent = JSON.parse(String((init as RequestInit).body));
      expect(sent.fecha_entrenamiento).toBe("2026-07-23");
      // Belt and braces: name the value the old implementation would have sent.
      expect(sent.fecha_entrenamiento).not.toBe("2026-07-24");
    } finally {
      vi.useRealTimers();
    }
  });
});
