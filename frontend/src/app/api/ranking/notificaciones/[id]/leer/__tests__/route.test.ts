/**
 * Tests for PATCH /api/ranking/notificaciones/:id/leer.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function patchRequest(cookie: string): NextRequest {
  return new NextRequest("http://localhost/api/ranking/notificaciones/1/leer", {
    method: "PATCH",
    headers: { cookie },
  });
}

const notificacionLeida = {
  id: 1,
  tipo: "MIEMBRESIA_VENCIMIENTO_PROXIMO",
  mensaje: "Tu membresía vence pronto.",
  leida: true,
  fechaCreacion: "2026-07-19T10:00:00Z",
  entidadRelacionadaId: 5,
};

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PATCH /api/ranking/notificaciones/:id/leer", () => {
  it("returns 401 when the access-token cookie is missing", async () => {
    const response = await PATCH(patchRequest(""), { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("forwards the notification id in the URL and the token as Bearer", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(notificacionLeida));

    const response = await PATCH(patchRequest(`${ACCESS_TOKEN_COOKIE}=abc123`), {
      params: Promise.resolve({ id: "1" }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/ranking/notificaciones/1/leer",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: "Bearer abc123" }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.leida).toBe(true);
  });

  it("propagates a 403 when the notification belongs to another persona", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ message: "No puede marcar como leída una notificación ajena" }, 403),
    );

    const response = await PATCH(patchRequest(`${ACCESS_TOKEN_COOKIE}=abc123`), {
      params: Promise.resolve({ id: "999" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await PATCH(patchRequest(`${ACCESS_TOKEN_COOKIE}=abc123`), {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(503);
  });
});
