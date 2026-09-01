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

  /**
   * `ages` is the optional orientation label the backend's
   * `PublicScheduleCategoryDTO` publishes (#913). The landing derives its
   * category "Edad" fact from it, so a validator that dropped or rejected it
   * would silently take the label away from every visitor.
   */
  it("passes the optional age label through untouched", async () => {
    const upstream = [
      { category: "Formativo", ages: "5 a 10 años", blocks: [{ days: ["LUNES"], startTime: "15:00", endTime: "16:00" }] },
      { category: "Juego Libre", ages: null, blocks: [{ days: ["SABADO"], startTime: "15:00", endTime: "18:00" }] },
    ];
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify(upstream), { status: 200 }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(upstream);
  });

  it("still accepts a category that publishes no age label at all", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ category: "Adultos", blocks: [] }]), { status: 200 }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("rejects an age label that is not text", async () => {
    // Tolerating `ages` is not the same as tolerating anything: the contract
    // says string or null, and a number here means the upstream shape moved.
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ category: "Adultos", ages: 18, blocks: [] }]), { status: 200 }),
    );

    const response = await GET();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ message: "La respuesta de horarios no es válida." });
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
