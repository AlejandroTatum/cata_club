/**
 * Route Handler Tests — GET/PATCH /api/fichas-medicas/persona/[id]
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import {
  fetchedUrls,
  jsonResponse,
  meBody,
  bloqueosBody,
  routeFetch,
} from "@/lib/server/__tests__/payment-block-fixtures";

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

/** An admin caller (staff are never gated) and the record endpoint answering `record`. */
function asAdminServing(record: Response): void {
  routeFetch({
    "/auth/me": jsonResponse(meBody({ personaId: 1, roles: ["ADMINISTRADOR"] })),
    "/fichas-medicas/persona/": record,
  });
}

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
    const response = await GET(getRequest("5"), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /fichas-medicas/persona/{id} with Authorization: Bearer", async () => {
    asAdminServing(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "5" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fichaMedica);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/fichas-medicas/persona/5",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${access}` }),
      }),
    );
  });

  it("propagates the backend's 403", async () => {
    asAdminServing(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await GET(getRequest("5", `${ACCESS_TOKEN_COOKIE}=${access}`), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(403);
  });
});

describe("PATCH /api/fichas-medicas/persona/[id]", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await PATCH(patchRequest("5", { tipoSangre: "A_POSITIVO" }), { params: Promise.resolve({ id: "5" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /fichas-medicas/persona/{id} with snake_case body", async () => {
    asAdminServing(jsonResponse(fichaMedica));

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
      { params: Promise.resolve({ id: "5" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(fichaMedica);
    expect(global.fetch).toHaveBeenCalledWith(
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
    asAdminServing(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { tipoSangre: "A_POSITIVO" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(403);
  });

  it("forwards an explicit null for alergias/contactoEmergencia/telefonoEmergencia instead of dropping the key (FIC-5)", async () => {
    // Clearing a field must reach the backend as `null`, not be silently
    // omitted from the body — omitting it means "leave unchanged" server-side,
    // which is exactly the bug: the toast says success but nothing is cleared.
    asAdminServing(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    await PATCH(
      patchRequest(
        "5",
        { alergias: null, contactoEmergencia: null, telefonoEmergencia: null },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(global.fetch).toHaveBeenCalledWith(
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
    asAdminServing(jsonResponse({ detail, message: detail }, 422));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { tipoSangre: "DESCONOCIDO" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining("tipo de sangre") }),
    );
  });

  it("passes through the backend's 400 when a PATCH would leave the record invalid", async () => {
    const detail = "El teléfono de emergencia es obligatorio.";
    asAdminServing(jsonResponse({ detail, message: detail }, 400));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest("5", { alergias: "Polen" }, `${ACCESS_TOKEN_COOKIE}=${access}`),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ message: expect.stringContaining("teléfono de emergencia") }),
    );
  });

  it("still forwards a complete, valid record untouched", async () => {
    asAdminServing(jsonResponse(fichaMedica));

    const access = makeJwt(3600);
    const response = await PATCH(
      patchRequest(
        "5",
        { tipoSangre: "O_POSITIVO", telefonoEmergencia: "0997654321" },
        `${ACCESS_TOKEN_COOKIE}=${access}`,
      ),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/fichas-medicas/persona/5",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ tipo_sangre: "O_POSITIVO", telefono_emergencia: "0997654321" }),
      }),
    );
  });
});

/**
 * #1779 S4 — the medical record of a profile blocked for non-payment is behind
 * Payments on the server too, for reads and for edits.
 */
describe("/api/fichas-medicas/persona/[id] — non-payment block (#1779 S4)", () => {
  const access = () => `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`;
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const record = () => jsonResponse(fichaMedica);
  const touchedRecord = () => fetchedUrls().some((u) => u.includes("/fichas-medicas/"));

  it("denies a blocked adult player their own record: 403 + codigo, record never read", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["ESTUDIANTE"], bloqueadoPorImpago: true })),
      "/fichas-medicas/": record,
    });

    const response = await GET(getRequest("5", access()), params("5"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ codigo: "bloqueo_impago" });
    expect(touchedRecord()).toBe(false);
  });

  it("denies editing it too", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["ESTUDIANTE"], bloqueadoPorImpago: true })),
      "/fichas-medicas/": record,
    });

    const response = await PATCH(patchRequest("5", { tipoSangre: "A_POSITIVO" }, access()), params("5"));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ codigo: "bloqueo_impago" });
    expect(touchedRecord()).toBe(false);
  });

  it("denies a guardian the record of the dependent flagged as blocked, and serves the sibling's", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
      "/portal/alumno/5/bloqueos": jsonResponse(bloqueosBody([{ id: 6, bloqueadoPorImpago: true }, { id: 7 }])),
      "/fichas-medicas/": record,
    });

    const blocked = await GET(getRequest("6", access()), params("6"));
    expect(blocked.status).toBe(403);
    expect(touchedRecord()).toBe(false);

    const sibling = await GET(getRequest("7", access()), params("7"));
    expect(sibling.status).toBe(200);
    expect(touchedRecord()).toBe(true);
  });

  it("never restricts a trainer whose own membership lapsed, for reads or edits", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 2, roles: ["ENTRENADOR"], bloqueadoPorImpago: true })),
      "/fichas-medicas/": record,
    });

    expect((await GET(getRequest("6", access()), params("6"))).status).toBe(200);
    expect((await PATCH(patchRequest("6", { tipoSangre: "A_POSITIVO" }, access()), params("6"))).status).toBe(200);
    expect(fetchedUrls().some((u) => u.includes("/bloqueos"))).toBe(false);
  });

  it.each([
    ["the caller cannot be resolved (/auth/me 500)", { "/auth/me": jsonResponse({ detail: "boom" }, 500) }, 500],
    [
      "/auth/me answers without a usable persona",
      { "/auth/me": jsonResponse({ roles: ["REPRESENTANTE"] }) },
      502,
    ],
    [
      "the dependents endpoint fails (500)",
      {
        "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
        "/portal/alumno/5/bloqueos": jsonResponse({ detail: "boom" }, 500),
      },
      500,
    ],
    [
      "the dependents endpoint is rate limited (429)",
      {
        "/auth/me": jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] })),
        "/portal/alumno/5/bloqueos": jsonResponse({ detail: "slow down" }, 429),
      },
      502,
    ],
  ])("fails closed when %s: the same status for a read and an edit, record untouched", async (_name, routes, status) => {
    routeFetch({ ...routes, "/fichas-medicas/": record });

    const read = await GET(getRequest("6", access()), params("6"));
    const edit = await PATCH(patchRequest("6", { tipoSangre: "A_POSITIVO" }, access()), params("6"));

    expect([read.status, edit.status]).toEqual([status, status]);
    expect(touchedRecord()).toBe(false);
  });

  it("never restricts an admin whose own membership lapsed", async () => {
    routeFetch({
      "/auth/me": jsonResponse(meBody({ personaId: 1, roles: ["ADMINISTRADOR"], bloqueadoPorImpago: true })),
      "/fichas-medicas/": record,
    });

    expect((await GET(getRequest("6", access()), params("6"))).status).toBe(200);
    expect((await PATCH(patchRequest("6", { tipoSangre: "A_POSITIVO" }, access()), params("6"))).status).toBe(200);
  });
});
