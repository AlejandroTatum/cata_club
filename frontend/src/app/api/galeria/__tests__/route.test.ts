/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const request = (method: string, body?: FormData, cookie = "") => new NextRequest("http://localhost/api/galeria", { method, body, headers: cookie ? { cookie } : {} });

describe("/api/galeria", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });
  it("lists published entries without a session", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, titulo: "En juego", descripcion: "Una jugada", imagenUrl: "https://cdn/foto.png" }])));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/", expect.any(Object));
  });
  it("rejects an incomplete upload before contacting the backend", async () => {
    const response = await POST(request("POST", new FormData(), `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("publishes the photo through the authenticated backend proxy", async () => {
    const body = new FormData();
    body.append("titulo", "En juego");
    body.append("descripcion", "Una jugada frente al público.");
    body.append("archivo", new File(["foto"], "foto.png", { type: "image/png" }));
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, titulo: "En juego", descripcion: "Una jugada", imagenUrl: "https://cdn/foto.png" }), { status: 201 }));
    const response = await POST(request("POST", body, `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/", expect.objectContaining({ method: "POST" }));
  });
  it("passes through an actionable backend 4xx validation message", async () => {
    const body = new FormData();
    body.append("titulo", "En juego");
    body.append("descripcion", "Una jugada frente al público.");
    body.append("archivo", new File(["foto"], "foto.png", { type: "image/png" }));
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "La imagen no puede superar 5 MB." }), { status: 400 }));
    const response = await POST(request("POST", body, `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe("La imagen no puede superar 5 MB.");
  });
  it("reports an unreachable backend as an honest service error, not a size error", async () => {
    const body = new FormData();
    body.append("titulo", "En juego");
    body.append("descripcion", "Una jugada frente al público.");
    body.append("archivo", new File(["foto"], "foto.png", { type: "image/png" }));
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    const response = await POST(request("POST", body, `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.message).toMatch(/servicio de publicación no está disponible/);
    expect(json.message).not.toMatch(/5 MB|JPG|PNG/);
  });
});
