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
});
