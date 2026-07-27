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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  marcarNotificacionLeida,
  fetchAlumnosPorHorario,
  fetchHorariosPorAlumno,
  fetchMembresiasPorPersona,
  fetchPagosDePersona,
  desasignarAlumnoDeHorario,
  actualizarHorario,
  eliminarHorario,
  updatePaymentValidation,
  fetchStudentPortal,
  searchStudents,
  subirVoucherPago,
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
    ["marcarNotificacionLeida", () => marcarNotificacionLeida(7)],
    ["fetchAlumnosPorHorario", () => fetchAlumnosPorHorario(3)],
    ["fetchHorariosPorAlumno", () => fetchHorariosPorAlumno(2)],
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
