/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const cookie = `${ACCESS_TOKEN_COOKIE}=${token}`;
const props = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest("http://localhost/api/galeria/1", { method: "DELETE", headers: { cookie } });

describe("DELETE /api/galeria/[id]", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });

  it("deletes through the authenticated proxy", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await DELETE(req(), props("1"));
    expect(response.status).toBe(204);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/1", expect.objectContaining({ method: "DELETE" }));
  });
  it("rejects a non-numeric id before contacting the backend", async () => {
    expect((await DELETE(req(), props("abc"))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("passes through an actionable backend error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Entrada de galería con id 1 no encontrada" }), { status: 404 }));
    const response = await DELETE(req(), props("1"));
    expect(response.status).toBe(404);
  });
  it("reports an unauthenticated delete as 401", async () => {
    const sinSesion = new NextRequest("http://localhost/api/galeria/1", { method: "DELETE" });
    expect((await DELETE(sinSesion, props("1"))).status).toBe(401);
  });
});
