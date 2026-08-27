/**
 * Route Handler Tests — POST /api/chatbot
 *
 * The backend no longer collapses every upstream failure into one 502: it maps
 * the provider's rate limit to 429, its timeout to 504 and a connection failure
 * to 503 (see backend/app/servicios_negocio/chatbot_servicio.py). That only
 * helps the user if this proxy forwards the status verbatim instead of
 * flattening it, so the widget can pick the right message.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function postRequest(body: unknown = { mensaje: "¿Cómo veo mis pagos?" }, extraHeaders?: Record<string, string>): Request {
  return new Request("http://localhost/api/chatbot", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chatbot", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("relays the assistant's reply on success", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ respuesta: "En Mi Cuenta." }));

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: "En Mi Cuenta." });
  });

  it("rejects messages over the bounded input size before contacting the backend", async () => {
    const response = await POST(postRequest({ mensaje: "x".repeat(2001) }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  /*
   * A status is a class of failure, not a reason. This route answers 400 for a
   * body that is not JSON, for a message that is empty or the wrong shape, AND
   * for a message that is simply too long — and the client used to see only
   * the number, so it reported all three as a failure to reach the assistant
   * ("No se pudo contactar a CATA-BOT"). The name is what tells them apart.
   */
  it("names the over-length rejection so the client can report it honestly", async () => {
    const response = await POST(postRequest({ mensaje: "x".repeat(2001) }));

    expect(await response.json()).toEqual({
      message: "El mensaje supera el límite de 2.000 caracteres. Acórtelo e inténtelo de nuevo.",
      code: "chatbot_mensaje_demasiado_largo",
    });
  });

  it("leaves the other 400s unnamed, so nothing borrows the length message", async () => {
    const response = await POST(postRequest({ mensaje: "   " }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.code).toBeUndefined();
    expect(body.message).toBe("El mensaje del chat es inválido o está vacío.");
  });

  it("accepts a message at the bounded input size", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ respuesta: "En Mi Cuenta." }));

    const response = await POST(postRequest({ mensaje: "x".repeat(2000) }));

    expect(response.status).toBe(200);
  });

  it("forwards the visitor's X-Forwarded-For to the backend (issue #235)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ respuesta: "En Mi Cuenta." }));

    await POST(postRequest(undefined, { "x-forwarded-for": "198.51.100.40" }));

    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/v1/chatbot/consultar");
    expect(new Headers((init as RequestInit).headers).get("x-forwarded-for")).toBe("198.51.100.40");
  });

  it.each([
    [429, "El asistente está recibiendo demasiadas consultas."],
    [504, "El asistente tardó demasiado en responder."],
    [503, "El asistente no está disponible en este momento."],
    [502, "No se pudo contactar al asistente."],
  ])("forwards the backend's %i and its message untouched", async (status, detail) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail }, status));

    const response = await POST(postRequest());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: detail, mensaje_seguro: false });
  });

  /*
   * Issue #708: the burst limit's 429 carries `Retry-After` (set by the
   * backend's own handler, see `_manejador_limite_excedido` in
   * `backend/main.py`) so the visitor can be told the REAL wait instead of a
   * constant. `passthroughBackendError` only relays the JSON body — the
   * header itself has to be forwarded here or the client never sees it.
   */
  it("forwards Retry-After on a 429 so the client can show the real wait (issue #708)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Demasiadas solicitudes. Espere un momento e intente nuevamente." }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "27" },
      }),
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("27");
  });

  it("does not invent a Retry-After header when the backend sent none", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "El asistente no está disponible en este momento." }, 503));

    const response = await POST(postRequest());

    expect(response.headers.get("Retry-After")).toBeNull();
  });
});
