/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../route";

describe("GET /api/schedules", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = "http://backend/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("returns the public grouped catalog without a session", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ category: "Adultos", blocks: [] }]), { status: 200 }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ category: "Adultos", blocks: [] }]);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://backend/api/v1/asistencias/horarios-publicos",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns an empty public catalog", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("[]", { status: 200 }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("maps an upstream failure to a degraded response", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "No se pudieron cargar los horarios." });
  });

  it("does not expose malformed upstream data", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("{broken", { status: 200 }));

    const response = await GET();

    expect(response.status).toBe(502);
  });

  it("passes through an upstream HTTP error", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Unavailable" }), { status: 502 }),
    );

    const response = await GET();

    expect(response.status).toBe(502);
  });
});
