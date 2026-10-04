/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PUT } from "../route";
import { POST as MOVER } from "../mover/route";
import { GET as ADMIN } from "../../admin/route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

const token = "eyJhbGciOiJub25lIn0.eyJleHAiOjk5OTk5OTk5OTl9.sig";
const cookie = `${ACCESS_TOKEN_COOKIE}=${token}`;
const props = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/galeria/1", { method, body, headers: { cookie, ...headers } });
const form = (extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.append("titulo", "En juego"); f.append("descripcion", "Una jugada."); f.append("visible", "true");
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};

describe("/api/galeria/[id] and friends", () => {
  beforeEach(() => { vi.spyOn(global, "fetch"); process.env.BACKEND_API_URL = "http://backend/api/v1"; });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.BACKEND_API_URL; });

  it("deletes through the authenticated proxy", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const response = await DELETE(req("DELETE"), props("1"));
    expect(response.status).toBe(204);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/1", expect.objectContaining({ method: "DELETE" }));
  });
  it("rejects a non-numeric id before contacting the backend", async () => {
    expect((await DELETE(req("DELETE"), props("abc"))).status).toBe(400);
    expect((await PUT(req("PUT", form()), props("abc"))).status).toBe(400);
    expect((await MOVER(req("POST", "{}"), props("abc"))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("updates the entry, with or without a new photo", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    const response = await PUT(req("PUT", form()), props("1"));
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/1", expect.objectContaining({ method: "PUT" }));
  });
  it("rejects an update without title or description", async () => {
    const f = new FormData(); f.append("titulo", " ");
    expect((await PUT(req("PUT", f), props("1"))).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("passes through an actionable backend 4xx on update", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ detail: "El título es obligatorio." }), { status: 422 }));
    const response = await PUT(req("PUT", form()), props("1"));
    expect(response.status).toBe(422);
    expect((await response.json()).message).toBe("El título es obligatorio.");
  });
  it("moves an entry up or down", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response("[]", { status: 200 }));
    const response = await MOVER(req("POST", JSON.stringify({ direccion: "subir" }), { "content-type": "application/json" }), props("1"));
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/1/mover", expect.objectContaining({ method: "POST", body: JSON.stringify({ direccion: "subir" }) }));
  });
  it("rejects an unknown direction", async () => {
    const response = await MOVER(req("POST", JSON.stringify({ direccion: "lado" }), { "content-type": "application/json" }), props("1"));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("lists every entry, hidden ones included, for the admin", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, visible: false }]), { status: 200 }));
    const response = await ADMIN(new NextRequest("http://localhost/api/galeria/admin", { headers: { cookie } }));
    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith("http://backend/api/v1/galeria/admin", expect.any(Object));
  });
});
