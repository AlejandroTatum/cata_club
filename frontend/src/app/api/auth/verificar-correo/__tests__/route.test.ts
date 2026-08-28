/**
 * Tests for the two anonymous email-verification BFF routes (issue #790).
 *
 * Both proxy through the shared `anonymousAuthPost` helper, so what is worth
 * pinning here is what each route decides on its own: the shape it accepts,
 * the backend path it targets, and — for the confirm route — that a dead link
 * comes back as a 400 the visitor can read instead of a raw backend status.
 *
 * The resend route carries the anti-enumeration contract: the backend answers
 * identically whether or not the address is registered, and this layer must
 * pass that answer through untouched. A handler that reinterpreted it would
 * rebuild the oracle the backend is avoiding.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as confirmar } from "../route";
import { POST as reenviar } from "../reenviar/route";

const MENSAJE_CONSTANTE =
  "Si el correo está registrado y falta verificarlo, se envió un enlace de verificación";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

function peticion(ruta: string, body: unknown, extraHeaders?: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
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

describe("POST /api/auth/verificar-correo", () => {
  it("returns 400 with no fetch call when the token is missing", async () => {
    const response = await confirmar(peticion("/api/auth/verificar-correo", {}));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 200 with a JSON body on backend success (204), not a bare 204", async () => {
    // The shared client always calls response.json() on a 2xx, which throws on
    // an empty body — this route must never relay a raw 204.
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(204));

    const response = await confirmar(peticion("/api/auth/verificar-correo", { token: "tok" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "http://localhost:8000/api/v1/auth/verificar-correo",
    );
  });

  it("relays a dead link as a readable 400", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      jsonResponse({ detail: "El enlace de verificación es inválido o expiró" }, 401),
    );

    const response = await confirmar(peticion("/api/auth/verificar-correo", { token: "viejo" }));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("inválido o expiró");
  });

  it("forwards the visitor's X-Forwarded-For to the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(204));

    await confirmar(
      peticion("/api/auth/verificar-correo", { token: "tok" }, { "x-forwarded-for": "198.51.100.70" }),
    );

    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.70");
  });

  it("relays the rate limit as a 429", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(emptyResponse(429));

    const response = await confirmar(peticion("/api/auth/verificar-correo", { token: "tok" }));

    expect(response.status).toBe(429);
  });
});

describe("POST /api/auth/verificar-correo/reenviar", () => {
  it("returns 400 with no fetch call when the email is missing", async () => {
    const response = await reenviar(peticion("/api/auth/verificar-correo/reenviar", {}));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("passes the backend's constant message through untouched", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ mensaje: MENSAJE_CONSTANTE }));

    const response = await reenviar(
      peticion("/api/auth/verificar-correo/reenviar", { correo: "quien@example.com" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mensaje: MENSAJE_CONSTANTE });
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(
      "http://localhost:8000/api/v1/auth/verificar-correo/reenviar",
    );
  });

  it("answers identically for a registered and an unknown address", async () => {
    // The whole point of the endpoint: this layer must not become the place
    // where the two cases start to differ.
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ mensaje: MENSAJE_CONSTANTE }))
      .mockResolvedValueOnce(jsonResponse({ mensaje: MENSAJE_CONSTANTE }));

    const registrada = await reenviar(
      peticion("/api/auth/verificar-correo/reenviar", { correo: "registrada@example.com" }),
    );
    const desconocida = await reenviar(
      peticion("/api/auth/verificar-correo/reenviar", { correo: "nadie@example.com" }),
    );

    expect(registrada.status).toBe(desconocida.status);
    expect(await registrada.json()).toEqual(await desconocida.json());
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await reenviar(
      peticion("/api/auth/verificar-correo/reenviar", { correo: "quien@example.com" }),
    );

    expect(response.status).toBe(503);
  });
});
