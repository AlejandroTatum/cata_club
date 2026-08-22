/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const request = (method: string, body?: FormData, cookie = "") => new NextRequest("http://localhost/api/sponsors", { method, body, headers: cookie ? { cookie } : {} });

describe("/api/sponsors", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });
  it("lists public logos without a session", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, nombre: "Municipio", logoUrl: "https://cdn/logo.png" }])));
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/sponsors/", expect.any(Object));
  });
  it("rejects incomplete upload before contacting the backend", async () => {
    const response = await POST(request("POST", new FormData(), `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("uploads the logo through the authenticated backend proxy", async () => {
    const body = new FormData(); body.append("nombre", "Municipio"); body.append("archivo", new File(["logo"], "logo.png", { type: "image/png" }));
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1, nombre: "Municipio", logoUrl: "https://cdn/logo.png" }), { status: 201 }));
    const response = await POST(request("POST", body, `${ACCESS_TOKEN_COOKIE}=${token}`));
    expect(response.status).toBe(201);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/sponsors/", expect.objectContaining({ method: "POST" }));
  });
});
