/**
 * Fetchers of "Actividad del club" (#1314): each asks its BFF route for the
 * chosen range and hands back the typed body untouched.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, fetchActividadAvanzadas, fetchActividadResumen } from "../api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("activity fetchers", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
  });
  afterEach(() => vi.restoreAllMocks());

  it("fetchActividadResumen requests /api/actividad/resumen with the range", async () => {
    const body = { range: "30d", periods: [] };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchActividadResumen("30d")).resolves.toEqual(body);

    const url = new URL(String(vi.mocked(global.fetch).mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toBe("/api/actividad/resumen");
    expect(url.searchParams.get("rango")).toBe("30d");
  });

  it("fetchActividadAvanzadas requests /api/actividad/avanzadas with the range and keeps nulls", async () => {
    const body = { range: "1h", service: null, host: null, runtime: null, users: null };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(body));

    await expect(fetchActividadAvanzadas("1h")).resolves.toEqual(body);

    const url = new URL(String(vi.mocked(global.fetch).mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toBe("/api/actividad/avanzadas");
    expect(url.searchParams.get("rango")).toBe("1h");
  });

  it("surfaces a 403 as an ApiClientError carrying the status", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ message: "No autorizado" }, 403));
    const failure = await fetchActividadResumen("7d").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).status).toBe(403);
  });
});
