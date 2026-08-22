/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const request = (cookie = "") => new NextRequest("http://localhost/api/sponsors/1", { method: "DELETE", headers: cookie ? { cookie } : {} });

describe("DELETE /api/sponsors/[id]", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });
  it("rejects invalid identifiers", async () => {
    const response = await DELETE(request(`${ACCESS_TOKEN_COOKIE}=${token}`), { params: { id: "x" } });
    expect(response.status).toBe(400); expect(global.fetch).not.toHaveBeenCalled();
  });
  it("requires an authenticated session", async () => {
    const response = await DELETE(request(), { params: { id: "1" } });
    expect(response.status).toBe(401);
  });
  it("deletes the hosted logo through the backend", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await DELETE(request(`${ACCESS_TOKEN_COOKIE}=${token}`), { params: { id: "1" } });
    expect(response.status).toBe(204);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/sponsors/1", expect.objectContaining({ method: "DELETE" }));
  });
});
