/**
 * Regression guard — response CASING.
 *
 * Every backend DTO that extends `ResponseBase`
 * (backend/app/presentacion/schemas/base.py) is serialised through
 * `alias_generator=_to_camel`, so the wire shape is camelCase. TypeScript
 * cannot catch a mismatch here: the response is parsed as `unknown`/`T` from
 * `res.json()`, so declaring a snake_case field compiles perfectly and simply
 * evaluates to `undefined` at runtime.
 *
 * That failure mode is worse than a crash: a misspelled response key
 * silently evaluates to `undefined` instead of throwing, and looks plausible
 * downstream. Nothing throws, nothing logs, and the numbers look real.
 *
 * So these tests assert against the EXACT bodies the live backend returns, and
 * assert the negative too: fed the snake_case shape, the mapper must not
 * quietly succeed with undefined fields.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchInstituciones } from "../api";

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Nothing on the object may be `undefined` — the whole point of these tests. */
function expectNoUndefinedValues(value: object): void {
  for (const [key, v] of Object.entries(value)) {
    expect(v, `"${key}" is undefined — the response key was probably misspelled`).not.toBeUndefined();
  }
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchInstituciones — GET /api/personas/instituciones", () => {
  it("reads `tipoEscuela`, the alias `InstitucionResponseDTO` serialises", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse({
        items: [{ id: 1, nombre: "Unidad Educativa Beatriz Cueva", tipoEscuela: "FISCAL" }],
        total: 1,
        skip: 0,
        limit: 200,
      }),
    );

    const [institucion] = await fetchInstituciones();

    expect(institucion).toEqual({
      id: 1,
      nombre: "Unidad Educativa Beatriz Cueva",
      tipoEscuela: "FISCAL",
    });
    expectNoUndefinedValues(institucion);
  });

  it("would surface, not hide, a snake_case body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse({
        items: [{ id: 1, nombre: "Unidad Educativa Beatriz Cueva", tipo_escuela: "FISCAL" }],
        total: 1,
        skip: 0,
        limit: 200,
      }),
    );

    const [institucion] = await fetchInstituciones();

    // The wizard filters and labels on this value; `undefined` rendered as
    // "Nombre (undefined)" and matched no filter option.
    expect(institucion.tipoEscuela).toBeUndefined();
  });

  it("drains every page and terminates on an empty page even if `total` overstates the count", async () => {
    // Two real pages of 2, then a page that lies about `total` (says 5 more
    // exist) but returns nothing — the empty-page guard must end the loop
    // instead of re-requesting forever.
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        okResponse({
          items: [
            { id: 1, nombre: "Colegio A", tipoEscuela: "FISCAL" },
            { id: 2, nombre: "Colegio B", tipoEscuela: "PRIVADA" },
          ],
          total: 9,
          skip: 0,
          limit: 2,
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          items: [
            { id: 3, nombre: "Colegio C", tipoEscuela: "FISCAL" },
            { id: 4, nombre: "Colegio D", tipoEscuela: "PRIVADA" },
          ],
          total: 9,
          skip: 2,
          limit: 2,
        }),
      )
      .mockResolvedValueOnce(okResponse({ items: [], total: 9, skip: 4, limit: 2 }));

    const instituciones = await fetchInstituciones();

    expect(instituciones).toEqual([
      { id: 1, nombre: "Colegio A", tipoEscuela: "FISCAL" },
      { id: 2, nombre: "Colegio B", tipoEscuela: "PRIVADA" },
      { id: 3, nombre: "Colegio C", tipoEscuela: "FISCAL" },
      { id: 4, nombre: "Colegio D", tipoEscuela: "PRIVADA" },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("issues exactly one request for a single-page catalog", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      okResponse({
        items: [{ id: 1, nombre: "Colegio A", tipoEscuela: "FISCAL" }],
        total: 1,
        skip: 0,
        limit: 200,
      }),
    );

    const instituciones = await fetchInstituciones();

    expect(instituciones).toEqual([{ id: 1, nombre: "Colegio A", tipoEscuela: "FISCAL" }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
