/**
 * Route Handler Tests — GET /api/dashboard
 *
 * The dashboard must obtain membership totals from the backend aggregate and
 * never make a request for every membership referenced by payment records.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: "1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.sig`;
}

function getRequest(): NextRequest {
  return new NextRequest("http://localhost/api/dashboard", {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt()}` },
  });
}

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("uses the aggregate membership count without requesting individual memberships", async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/personas/?limit=1")) return jsonResponse({ items: [], total: 12 });
      if (url.endsWith("/membresias/estadisticas")) return jsonResponse({ activeMemberships: 7 });
      if (url.includes("/membresias/pagos?estado_pago=PENDIENTE_VALIDACION")) return jsonResponse({ items: [], total: 3 });
      if (url.endsWith("/asistencias/horarios")) return jsonResponse([]);
      throw new Error(`Unexpected backend request: ${url}`);
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ totalPersonas: 12, activeMemberships: 7, pendingPayments: 3, todaySchedules: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(vi.mocked(global.fetch).mock.calls.map(([url]) => String(url))).not.toContainEqual(
      expect.stringMatching(/\/membresias\/\d+$/),
    );
  });
});
