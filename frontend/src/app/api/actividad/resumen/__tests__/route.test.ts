/**
 * Route Handler Tests — GET /api/actividad/resumen
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import { jsonResponse, fetchCall, stubBackendFetch } from "../../../__tests__/bff-route-harness";

function makeJwt(): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function getRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/actividad/resumen${query}`, {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt()}` },
  });
}

describe("GET /api/actividad/resumen", () => {
  stubBackendFetch();

  it.each(["24h", "7d", "30d"])("forwards the validated rango %s to the backend", async (rango) => {
    const body = { range: rango, periods: [] };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(body));

    const response = await GET(getRequest(`?rango=${rango}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    const [url] = fetchCall();
    const target = new URL(url);
    expect(target.pathname).toBe("/api/v1/actividad/resumen");
    expect(target.searchParams.get("rango")).toBe(rango);
  });

  it("omits rango when none is given, so the backend default applies", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}));
    await GET(getRequest());
    expect(new URL(fetchCall()[0]).searchParams.has("rango")).toBe(false);
  });

  it.each(["1h", "90d", "", "7d&x=1", "../etc"])("rejects rango %j without reaching the backend", async (rango) => {
    const response = await GET(getRequest(`?rango=${encodeURIComponent(rango)}`));
    expect(response.status).toBe(422);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not forward unknown query parameters", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}));
    await GET(getRequest("?rango=7d&admin=1"));
    expect(new URL(fetchCall()[0]).searchParams.has("admin")).toBe(false);
  });

  it("passes a 403 from the backend through", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));
    const response = await GET(getRequest("?rango=7d"));
    expect(response.status).toBe(403);
  });

  it("answers 401 when there is no session", async () => {
    const response = await GET(new NextRequest("http://localhost/api/actividad/resumen?rango=7d"));
    expect(response.status).toBe(401);
  });
});
