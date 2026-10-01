/**
 * Route Handler Tests — GET /api/auth/me/sesiones
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sesionesRequest(search = ""): NextRequest {
  return new NextRequest(`http://localhost/api/auth/me/sesiones${search}`, {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=tok` },
  });
}

function backendUrl(): string {
  return String((global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
}

beforeEach(() => {
  vi.spyOn(global, "fetch").mockImplementation(async () => jsonResponse([]));
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/auth/me/sesiones", () => {
  it("forwards no query when none is given", async () => {
    await GET(sesionesRequest());

    expect(backendUrl()).toBe("http://localhost:8000/api/v1/auth/me/sesiones");
  });

  it("forwards numeric limite and desplazamiento", async () => {
    await GET(sesionesRequest("?limite=3&desplazamiento=2"));

    expect(backendUrl()).toBe("http://localhost:8000/api/v1/auth/me/sesiones?limite=3&desplazamiento=2");
  });

  it("drops anything that is not a plain non-negative integer, and unknown params", async () => {
    await GET(sesionesRequest("?limite=abc&desplazamiento=-1&usuario_id=7"));

    expect(backendUrl()).toBe("http://localhost:8000/api/v1/auth/me/sesiones");
  });
});
