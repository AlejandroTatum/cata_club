/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import { GET, POST } from "../route";
import { DELETE, PUT } from "../[id]/route";
import { POST as AVISAR } from "../[id]/avisar/route";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const cookie = `${ACCESS_TOKEN_COOKIE}=${token}`;
const request = (method: string, path = "", body?: unknown) =>
  new NextRequest(`http://localhost/api/dias-sin-clase${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const props = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/dias-sin-clase", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });

  it("forwards the date filter on the authenticated list", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("[]"));
    const response = await GET(request("GET", "?desde=2029-07-01"));
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/dias-sin-clase/?desde=2029-07-01", expect.any(Object));
  });

  it("does not list without a session", async () => {
    const response = await GET(new NextRequest("http://localhost/api/dias-sin-clase"));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a create without date or reason before contacting the backend", async () => {
    const response = await POST(request("POST", "", { fecha_inicio: "2029-07-04" }));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("creates through the backend and passes a 403 through for non-admins", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    const ok = await POST(request("POST", "", { fecha_inicio: "2029-07-04", motivo: "Feriado" }));
    expect(ok.status).toBe(201);

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Permisos insuficientes para esta operación" }), { status: 403 }));
    const denied = await POST(request("POST", "", { fecha_inicio: "2029-07-04", motivo: "Feriado" }));
    expect(denied.status).toBe(403);
  });

  it("edits and deletes by numeric id only", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 3 })));
    const put = await PUT(request("PUT", "/3", { fecha_inicio: "2029-07-05", motivo: "Otro" }), props("3"));
    expect(put.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/dias-sin-clase/3", expect.objectContaining({ method: "PUT" }));

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await DELETE(request("DELETE", "/3"), props("3"))).status).toBe(204);

    expect((await DELETE(request("DELETE", "/abc"), props("abc"))).status).toBe(400);
    expect((await PUT(request("PUT", "/x", {}), props("x"))).status).toBe(400);
  });

  it("resends the notice through the backend, passing a 403 or 409 through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ encolado: true }), { status: 202 }));
    const ok = await AVISAR(request("POST", "/3/avisar"), props("3"));
    expect(ok.status).toBe(202);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/dias-sin-clase/3/avisar", expect.objectContaining({ method: "POST" }));

    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Ese día sin clase ya terminó." }), { status: 409 }));
    expect((await AVISAR(request("POST", "/3/avisar"), props("3"))).status).toBe(409);
    expect((await AVISAR(request("POST", "/x/avisar"), props("x"))).status).toBe(400);
  });
});
