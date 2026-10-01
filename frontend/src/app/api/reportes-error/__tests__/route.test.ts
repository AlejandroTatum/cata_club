/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const request = (method: string, body?: FormData, requestId?: string) => new NextRequest("http://localhost/api/reportes-error", {
  method, body, headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${token}`, ...(requestId ? { "X-Request-ID": requestId } : {}) },
});

describe("/api/reportes-error", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });
  it("rejects missing description before forwarding", async () => {
    expect((await POST(request("POST", new FormData()))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("rejects screenshot without consent before forwarding", async () => {
    const form = new FormData();
    form.set("descripcion", "Falla");
    form.set("captura", new File(["bytes"], "foto.png", { type: "image/png" }));
    expect((await POST(request("POST", form))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("forwards an explicit screenshot and request id", async () => {
    const form = new FormData();
    form.set("descripcion", "Se cerró la pantalla");
    form.set("captura", new File(["bytes"], "foto.png", { type: "image/png" }));
    form.set("consentimiento_captura", "true");
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    expect((await POST(request("POST", form, "req-123"))).status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/reportes-error/", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "X-Request-ID": "req-123" }) }));
  });
  it("forwards the browser User-Agent so the inbox shows the real device", async () => {
    const form = new FormData();
    form.set("descripcion", "Falla");
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 2 }), { status: 201 }));
    const req = new NextRequest("http://localhost/api/reportes-error", {
      method: "POST", body: form, headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${token}`, "user-agent": "Mozilla/5.0 Chrome/153" },
    });
    await POST(req);
    const init = vi.mocked(global.fetch).mock.calls[0][1] as { headers: Record<string, string> };
    expect(new Headers(init.headers).get("user-agent")).toBe("Mozilla/5.0 Chrome/153");
  });
  it("preserves the failed backend request ID", async () => {
    const form = new FormData();
    form.set("descripcion", "Error");
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Falló" }), {
      status: 500, headers: { "X-Request-ID": "req-backend-1401" },
    }));
    const response = await POST(request("POST", form));
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-ID")).toBe("req-backend-1401");
  });
  it("requires backend admin authorization for the inbox", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Forbidden" }), { status: 403 }));
    expect((await GET(request("GET"))).status).toBe(403);
  });
});
