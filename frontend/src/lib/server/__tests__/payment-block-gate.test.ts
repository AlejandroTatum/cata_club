/**
 * Shared non-payment gate (#1779 S4, #1787): who the caller is, and whether a
 * target persona is a blocked profile they must not reach.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import { gateBlockedPersona, resolveCaller } from "@/lib/server/payment-block-gate";
import { bloqueosBody, fetchedUrls, jsonResponse, meBody, routeFetch } from "./payment-block-fixtures";

function makeJwt(expSecondsFromNow: number): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "1", exp })}.sig`;
}

const request = () =>
  new NextRequest("http://localhost/api/anything", { headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}` } });

const guardian = () => jsonResponse(meBody({ personaId: 5, roles: ["REPRESENTANTE"] }));
const touchedBloqueos = () => fetchedUrls().filter((u) => u.includes("/portal/alumno/5/bloqueos"));

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("resolveCaller", () => {
  it("refuses with 401 without calling the backend when there is no session", async () => {
    const result = await resolveCaller(new NextRequest("http://localhost/api/anything"));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 401],
    [403, 403],
    [500, 500],
    [503, 503],
    [429, 502],
  ])("answers %i from /auth/me with %i: an upstream failure is never an authentication verdict", async (upstream, expected) => {
    routeFetch({ "/auth/me": jsonResponse({ detail: "x" }, upstream) });

    const result = await resolveCaller(request());

    expect(!result.ok && result.response.status).toBe(expected);
  });

  it("fails closed with 502 when /auth/me answers 200 without a usable persona", async () => {
    routeFetch({ "/auth/me": jsonResponse({ roles: [] }) });

    const result = await resolveCaller(request());

    expect(!result.ok && result.response.status).toBe(502);
  });

  it.each([
    ["ADMINISTRADOR", true],
    ["ENTRENADOR", true],
    ["REPRESENTANTE", false],
    ["ESTUDIANTE", false],
  ])("reads %s as staff=%s", async (role, isStaff) => {
    routeFetch({ "/auth/me": jsonResponse(meBody({ personaId: 5, roles: [role] })) });

    const result = await resolveCaller(request());

    expect(result.ok && result.caller.isStaff).toBe(isStaff);
  });
});

describe("gateBlockedPersona", () => {
  it.each(["ADMINISTRADOR", "ENTRENADOR"])("never restricts a %s, even with a lapsed own membership", async (role) => {
    routeFetch({ "/auth/me": jsonResponse(meBody({ personaId: 1, roles: [role], bloqueadoPorImpago: true })) });

    const gate = await gateBlockedPersona(request(), 6);

    expect(gate.ok).toBe(true);
    expect(fetchedUrls()).toHaveLength(1);
  });

  it("denies the caller's own blocked profile with the 403 + machine code, without another read", async () => {
    routeFetch({ "/auth/me": jsonResponse(meBody({ personaId: 5, bloqueadoPorImpago: true })) });

    const gate = await gateBlockedPersona(request(), 5);

    expect(!gate.ok && gate.response.status).toBe(403);
    await expect(!gate.ok && gate.response.json()).resolves.toMatchObject({ codigo: "bloqueo_impago" });
    expect(fetchedUrls()).toHaveLength(1);
  });

  it("lets the caller's own unblocked profile through", async () => {
    routeFetch({ "/auth/me": jsonResponse(meBody({ personaId: 5 })) });

    expect((await gateBlockedPersona(request(), 5)).ok).toBe(true);
  });

  it("asks the lightweight endpoint, not the rate-limited portal aggregate, about a dependent", async () => {
    routeFetch({
      "/auth/me": guardian(),
      "/portal/alumno/5/bloqueos": jsonResponse(bloqueosBody([{ id: 6 }])),
    });

    expect((await gateBlockedPersona(request(), 6)).ok).toBe(true);

    expect(fetchedUrls()).toEqual([
      "http://localhost:8000/api/v1/auth/me",
      "http://localhost:8000/api/v1/portal/alumno/5/bloqueos",
    ]);
  });

  it("denies a dependent the endpoint flags as blocked, and serves the sibling", async () => {
    routeFetch({
      "/auth/me": guardian(),
      "/portal/alumno/5/bloqueos": jsonResponse(bloqueosBody([{ id: 6, bloqueadoPorImpago: true }, { id: 7 }])),
    });

    const blocked = await gateBlockedPersona(request(), 6);
    expect(!blocked.ok && blocked.response.status).toBe(403);
    await expect(!blocked.ok && blocked.response.json()).resolves.toMatchObject({ codigo: "bloqueo_impago" });
    expect((await gateBlockedPersona(request(), 7)).ok).toBe(true);
  });

  it("denies an INACTIVE blocked dependent: the endpoint lists every dependent, not only the portal's active ones", async () => {
    // The portal aggregate omits inactive dependents, so it could never flag one.
    routeFetch({
      "/auth/me": guardian(),
      "/portal/alumno/5/bloqueos": jsonResponse(bloqueosBody([{ id: 8, bloqueadoPorImpago: true }])),
    });

    const gate = await gateBlockedPersona(request(), 8);

    expect(!gate.ok && gate.response.status).toBe(403);
  });

  it("leaves a persona that is not the caller's dependent to the backend's ownership check", async () => {
    routeFetch({
      "/auth/me": guardian(),
      "/portal/alumno/5/bloqueos": jsonResponse(bloqueosBody([{ id: 6, bloqueadoPorImpago: true }])),
    });

    expect((await gateBlockedPersona(request(), 99)).ok).toBe(true);
  });

  it("does not cache: every gated request asks the endpoint again", async () => {
    routeFetch({
      "/auth/me": guardian(),
      "/portal/alumno/5/bloqueos": jsonResponse(bloqueosBody([{ id: 6 }])),
    });

    await gateBlockedPersona(request(), 6);
    await gateBlockedPersona(request(), 6);

    expect(touchedBloqueos()).toHaveLength(2);
  });

  it.each([
    [401, 401],
    [403, 403],
    [500, 500],
    [503, 503],
    [429, 502],
  ])("fails closed with %i -> %i when the dependents endpoint answers that", async (upstream, expected) => {
    routeFetch({ "/auth/me": guardian(), "/portal/alumno/5/bloqueos": jsonResponse({ detail: "x" }, upstream) });

    const gate = await gateBlockedPersona(request(), 6);

    expect(!gate.ok && gate.response.status).toBe(expected);
  });

  it("fails closed with 502 when the dependents endpoint answers 200 with a body that is not JSON", async () => {
    routeFetch({ "/auth/me": guardian(), "/portal/alumno/5/bloqueos": new Response("nope", { status: 200 }) });

    const gate = await gateBlockedPersona(request(), 6);

    expect(!gate.ok && gate.response.status).toBe(502);
  });
});
