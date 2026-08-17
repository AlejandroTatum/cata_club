/**
 * Contract tests for the seam between the API client and the BFF route tree.
 *
 * The handler tests under `src/app/api/**\/__tests__` exercise each Route
 * Handler directly, so they stay green even when nobody can reach the handler:
 * `quitarRol` used to request `/api/personas/2/roles/ENTRENADOR` while the only
 * handler is `/api/personas/[id]/roles` (role in the query string). Next.js
 * answered that URL with its HTML 404 page and every handler test still passed.
 *
 * These tests close that gap: they capture the URL each client function
 * actually builds and resolve it against the real App Router file tree on
 * disk. A future drift on either side — a client URL gaining a path segment,
 * or a route directory being renamed/removed — fails here.
 *
 * @vitest-environment node
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/groups/horarios/route";
import { PUT } from "@/app/api/groups/horarios/[id]/route";
import { POST as POST_PAGO } from "@/app/api/membresias/pagos/route";
import { PATCH as PATCH_FICHA_MEDICA } from "@/app/api/fichas-medicas/persona/[id]/route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import {
  obtenerRolesDePersona,
  asignarRol,
  quitarRol,
  cambiarEstadoCuenta,
  actualizarPersona,
  crearRepresentado,
  independizarPersona,
  fetchFichaMedica,
  actualizarFichaMedica,
  fetchFichaEmergencia,
  marcarNotificacionLeida,
  fetchAlumnosPorHorario,
  fetchHorariosPorAlumno,
  fetchRecentAttendanceSessions,
  fetchMembresiasPorPersona,
  fetchPagosDePersona,
  desasignarAlumnoDeHorario,
  actualizarHorario,
  crearHorario,
  eliminarHorario,
  updatePaymentValidation,
  fetchStudentPortal,
  searchStudents,
  subirVoucherPago,
  registrarPago,
  fetchDescuentos,
  crearDescuento,
  actualizarDescuento,
} from "../api";

const API_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../app/api",
);

/**
 * Collect every App Router handler under `src/app/api` as a matcher.
 *
 * `[id]` becomes a single-segment wildcard and `[...rest]` a catch-all, which
 * is exactly how Next.js resolves an incoming pathname to a `route.ts`.
 */
function collectRouteMatchers(): { pattern: string; regex: RegExp }[] {
  const matchers: { pattern: string; regex: RegExp }[] = [];

  function walk(dir: string, segments: string[]): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(path.join(dir, entry.name), [...segments, entry.name]);
      } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
        const pattern = `/api/${segments.join("/")}`;
        const body = segments
          .map((segment) => {
            if (/^\[\.\.\..+\]$/.test(segment)) return ".+";
            if (/^\[.+\]$/.test(segment)) return "[^/]+";
            return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("/");
        matchers.push({ pattern, regex: new RegExp(`^/api/${body}/?$`) });
      }
    }
  }

  walk(API_ROOT, []);
  return matchers;
}

const ROUTE_MATCHERS = collectRouteMatchers();

/** A non-expired access token the BFF handlers accept as the auth cookie. */
function makeSeamJwt(): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "1", exp })}.sig`;
}

/** The pathname (query stripped) of the single fetch a client call performs. */
async function capturePathname(call: () => Promise<unknown>): Promise<string> {
  const fetchSpy = vi
    .spyOn(global, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

  await call().catch(() => undefined);

  expect(fetchSpy).toHaveBeenCalled();
  const requested = String(fetchSpy.mock.calls[0]?.[0]);
  return new URL(requested, "http://localhost").pathname;
}

describe("API client URLs resolve to a real BFF route handler", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_USE_MOCKS = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_USE_MOCKS;
  });

  it("discovers the route tree it validates against", () => {
    expect(ROUTE_MATCHERS.length).toBeGreaterThan(20);
  });

  const CASES: [string, () => Promise<unknown>][] = [
    ["obtenerRolesDePersona", () => obtenerRolesDePersona(2)],
    ["asignarRol", () => asignarRol(2, "ENTRENADOR")],
    ["quitarRol", () => quitarRol(2, "ENTRENADOR")],
    ["cambiarEstadoCuenta", () => cambiarEstadoCuenta(2, false)],
    ["actualizarPersona", () => actualizarPersona(2, { telefono: "0999999999" })],
    [
      "crearRepresentado",
      () =>
        crearRepresentado(2, {
          nombres: "Ana",
          apellidos: "Perez",
          cedula: "0102030405",
          fechaNacimiento: "2015-01-01",
          telefono: "0999999999",
        }),
    ],
    ["independizarPersona", () => independizarPersona(2, "secreto")],
    ["fetchFichaMedica", () => fetchFichaMedica(2)],
    ["actualizarFichaMedica", () => actualizarFichaMedica(2, { tipoSangre: "DESCONOCIDO" })],
    ["fetchFichaEmergencia", () => fetchFichaEmergencia(2)],
    ["marcarNotificacionLeida", () => marcarNotificacionLeida(7)],
    ["fetchAlumnosPorHorario", () => fetchAlumnosPorHorario(3)],
    ["fetchHorariosPorAlumno", () => fetchHorariosPorAlumno(2)],
    ["fetchRecentAttendanceSessions", () => fetchRecentAttendanceSessions()],
    ["fetchMembresiasPorPersona", () => fetchMembresiasPorPersona(2)],
    ["fetchPagosDePersona", () => fetchPagosDePersona("2")],
    ["desasignarAlumnoDeHorario", () => desasignarAlumnoDeHorario(2, 3)],
    ["eliminarHorario", () => eliminarHorario(3)],
    [
      "actualizarHorario",
      () => actualizarHorario(3, { dia_semana: "LUNES" }),
    ],
    ["updatePaymentValidation", () => updatePaymentValidation("9", { action: "approved" })],
    ["fetchStudentPortal", () => fetchStudentPortal("2")],
    ["searchStudents", () => searchStudents("ana")],
    [
      "subirVoucherPago",
      () => subirVoucherPago(4, new File(["x"], "voucher.png", { type: "image/png" })),
    ],
    ["fetchDescuentos", () => fetchDescuentos()],
    ["crearDescuento", () => crearDescuento({ nombre: "Beca", porcentaje: 50, monto: null })],
    ["actualizarDescuento", () => actualizarDescuento(3, { activo: false })],
  ];

  it.each(CASES)("%s targets an existing route handler", async (_name, call) => {
    const pathname = await capturePathname(call);
    const matched = ROUTE_MATCHERS.find((matcher) => matcher.regex.test(pathname));
    expect(
      matched?.pattern,
      `${pathname} matches no route.ts under src/app/api — Next.js would answer its HTML 404 page`,
    ).toBeDefined();
  });

  it("quitarRol passes the role in the query string the DELETE handler reads", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await quitarRol(2, "ENTRENADOR");

    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]), "http://localhost");
    expect(url.pathname).toBe("/api/personas/2/roles");
    expect(url.searchParams.get("tipoRol")).toBe("ENTRENADOR");
  });
});

/**
 * Body seam — the client's payload must be accepted by the handler it targets.
 *
 * The block above proves each client URL resolves to a real `route.ts`; the
 * handler tests prove each handler works. Neither proves the client and the
 * handler agree on the *body*: handler tests build their own request body, so
 * a client that sends a different shape stays invisible to them. That is the
 * same failure class as the `quitarRol` 404 documented at the top of this
 * file, one layer deeper — the request reaches the handler and is rejected
 * with a 400 instead of vanishing into a 404.
 *
 * These tests take the body `crearHorario`/`actualizarHorario` actually build
 * and run it through the real POST/PUT handlers, then assert the payload the
 * handler forwards matches the backend's `HorarioCreateDTO`/`HorarioUpdateDTO`
 * key set exactly.
 */
describe("API client bodies are accepted by the BFF handler they target", () => {
  const ACCESS = makeSeamJwt();

  beforeEach(() => {
    process.env.NEXT_PUBLIC_USE_MOCKS = "true";
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_USE_MOCKS;
    delete process.env.BACKEND_API_URL;
  });

  /** The JSON body of the single fetch a client call performs. */
  async function captureBody(call: () => Promise<unknown>): Promise<unknown> {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await call().catch(() => undefined);

    expect(fetchSpy).toHaveBeenCalled();
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    vi.restoreAllMocks();
    return JSON.parse(String(body));
  }

  /** The JSON body the handler forwarded to FastAPI. */
  function forwardedToBackend(): Record<string, unknown> {
    const init = vi.mocked(global.fetch).mock.calls[0]?.[1];
    return JSON.parse(String(init?.body));
  }

  it("crearHorario's body is accepted by POST /api/groups/horarios", async () => {
    // Shape identical to the DTO `groups/page.tsx` builds on submit. The UI
    // no longer sends `nivel_ranking_id` (dropped column, `c4d5e6f7a8b9`),
    // but a stale client still could, so it is injected raw below to keep
    // pinning that the route strips unknown keys instead of forwarding them.
    const clientBody = {
      ...((await captureBody(() =>
        crearHorario({
          dia_semana: "LUNES",
          categoria: "COMPETITIVO",
        }),
      )) as Record<string, unknown>),
      nivel_ranking_id: 3,
    };

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/groups/horarios", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS}` },
        body: JSON.stringify(clientBody),
      }),
    );

    expect(response.status).not.toBe(400);
    expect(Object.keys(forwardedToBackend()).sort()).toEqual([
      "categoria",
      "dia_semana",
    ]);
  });

  it("actualizarHorario's body is accepted by PUT /api/groups/horarios/[id]", async () => {
    // `groups/page.tsx` reuses the same `shared` object for updates. Same
    // stale-client injection as the POST case above.
    const clientBody = {
      ...((await captureBody(() =>
        actualizarHorario(3, {
          categoria: "COMPETITIVO",
        }),
      )) as Record<string, unknown>),
      nivel_ranking_id: 3,
    };

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await PUT(
      new NextRequest("http://localhost/api/groups/horarios/3", {
        method: "PUT",
        headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS}` },
        body: JSON.stringify(clientBody),
      }),
      { params: { id: "3" } },
    );

    expect(response.status).not.toBe(400);
    expect(Object.keys(forwardedToBackend()).sort()).toEqual(["categoria"]);
  });

  /**
   * The discount seam (issue #12): the client sends camelCase `descuentoIds`
   * and the pago handler is the only thing translating it into the backend's
   * `descuento_ids`. A drift on either side would silently register the pago
   * WITHOUT its discounts — no 400, just a wrong (undiscounted) amount.
   */
  it("registrarPago's descuentoIds are accepted and translated by POST /api/membresias/pagos", async () => {
    const clientBody = await captureBody(() =>
      registrarPago({
        monto: 35,
        tipoPago: "EFECTIVO",
        personaId: 9,
        membresiaId: 4,
        descuentoIds: [1, 2],
      }),
    );

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await POST_PAGO(
      new NextRequest("http://localhost/api/membresias/pagos", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS}` },
        body: JSON.stringify(clientBody),
      }),
    );

    expect(response.status).not.toBe(400);
    expect(forwardedToBackend().descuento_ids).toEqual([1, 2]);
  });

  /**
   * The medical record seam: `actualizarFichaMedica` used to translate its
   * camelCase payload into snake_case itself, then the handler tried to
   * translate the (already snake_case) body a second time by reading its
   * camelCase keys — which no longer existed. `tipoSangre`,
   * `contactoEmergencia` and `telefonoEmergencia` silently vanished;
   * `enfermedades`/`alergias` only survived because they are spelled the
   * same in both cases. All five fields must reach the backend.
   */
  it("actualizarFichaMedica's five fields are accepted and translated by PATCH /api/fichas-medicas/persona/[id]", async () => {
    const clientBody = await captureBody(() =>
      actualizarFichaMedica(2, {
        tipoSangre: "O_POSITIVO",
        enfermedades: ["Asma"],
        alergias: "Ninguna",
        contactoEmergencia: "María Pérez",
        telefonoEmergencia: "0997654321",
      }),
    );

    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const response = await PATCH_FICHA_MEDICA(
      new NextRequest("http://localhost/api/fichas-medicas/persona/2", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: `${ACCESS_TOKEN_COOKIE}=${ACCESS}` },
        body: JSON.stringify(clientBody),
      }),
      { params: { id: "2" } },
    );

    expect(response.status).not.toBe(400);
    expect(forwardedToBackend()).toEqual({
      tipo_sangre: "O_POSITIVO",
      enfermedades: ["Asma"],
      alergias: "Ninguna",
      contacto_emergencia: "María Pérez",
      telefono_emergencia: "0997654321",
    });
  });
});
