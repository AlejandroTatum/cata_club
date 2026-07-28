/**
 * Route Handler Tests — PATCH /api/personas/[id]/nivel
 *
 * Replaces the tests of `POST /api/groups/assign` and `PATCH /api/groups/move`:
 * assigning a student to a level is ONE idempotent operation now, so there is
 * one handler and one set of tests.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PATCH } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

const ACCESS = makeJwt(3600);

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/personas/3/nivel", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS}` },
    body: JSON.stringify(body),
  });
}

/** The JSON body the handler forwarded to FastAPI. */
function forwardedToBackend(): Record<string, unknown> {
  const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
  return JSON.parse(String(init?.body));
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("PATCH /api/personas/[id]/nivel", () => {
  it("returns 400 when the id in the URL is not a number", async () => {
    const response = await PATCH(patchRequest({ nivelRankingId: 2 }), { params: { id: "abc" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when nivelRankingId is absent", async () => {
    const response = await PATCH(patchRequest({}), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when nivelRankingId is neither a number nor null", async () => {
    const response = await PATCH(patchRequest({ nivelRankingId: "2" }), { params: { id: "3" } });

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls PATCH /personas/{id}/nivel with the snake_case field the backend DTO declares", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 1, personaId: 3, nivelRankingId: 2 }));

    await PATCH(patchRequest({ nivelRankingId: 2 }), { params: { id: "3" } });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/personas/3/nivel",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: `Bearer ${ACCESS}` }),
      }),
    );
    expect(forwardedToBackend()).toEqual({ nivel_ranking_id: 2 });
  });

  it("forwards an explicit null as the unassign instruction", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 1, personaId: 3, nivelRankingId: null }));

    const response = await PATCH(patchRequest({ nivelRankingId: null }), { params: { id: "3" } });

    expect(response.status).toBe(200);
    expect(forwardedToBackend()).toEqual({ nivel_ranking_id: null });
  });

  it("forwards ONLY the allowlisted field, never the raw body", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ id: 1 }));

    await PATCH(
      patchRequest({ nivelRankingId: 2, personaId: 99, estaEnRanking: true }),
      { params: { id: "3" } },
    );

    expect(Object.keys(forwardedToBackend())).toEqual(["nivel_ranking_id"]);
  });

  it("propagates backend errors", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No encontrado" }, 404));

    const response = await PATCH(patchRequest({ nivelRankingId: 2 }), { params: { id: "3" } });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.message).toBe("No encontrado");
  });
});
