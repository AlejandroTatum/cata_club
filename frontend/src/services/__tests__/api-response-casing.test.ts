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
 * That failure mode is worse than a crash. `/ranking` read `persona_id` and
 * `nivel_ranking_id` off `/ranking/alumnos-con-nivel`; every field came back
 * `undefined`, and because `undefined !== null` counted a student as ASSIGNED
 * while `undefined === nivel.id` matched no level, the page reported
 * "68 de 68 asignados" spread over eleven levels that all read "Sin
 * estudiantes". Nothing threw, nothing logged, and the numbers looked
 * plausible.
 *
 * So these tests assert against the EXACT bodies the live backend returns, and
 * assert the negative too: fed the snake_case shape, the mapper must not
 * quietly succeed with undefined fields.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchAlumnosConNivel, fetchInstituciones } from "../api";

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

describe("fetchAlumnosConNivel — GET /api/ranking/alumnos-con-nivel", () => {
  /** Verbatim from the live backend (`AlumnoConNivelDTO extends ResponseBase`). */
  const WIRE = [
    { personaId: 4, nombres: "Sofia", apellidos: "Vera Loaiza", nivelRankingId: 4 },
    { personaId: 9, nombres: "Kevin", apellidos: "Sabando", nivelRankingId: null },
  ];

  it("reads the camelCase keys the backend actually sends", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse(WIRE));

    const result = await fetchAlumnosConNivel();

    expect(result).toEqual([
      { personaId: 4, nombres: "Sofia", apellidos: "Vera Loaiza", nivelRankingId: 4 },
      { personaId: 9, nombres: "Kevin", apellidos: "Sabando", nivelRankingId: null },
    ]);
    result.forEach(expectNoUndefinedValues);
  });

  it("distinguishes an unassigned student from a missing field", async () => {
    vi.mocked(global.fetch).mockResolvedValue(okResponse(WIRE));

    const result = await fetchAlumnosConNivel();

    // `null` means "no level yet" and drives the "Sin nivel asignado" block.
    // `undefined` would mean "we failed to read the field" — and would be
    // counted as ASSIGNED by `student.nivelRankingId !== null`.
    expect(result[1].nivelRankingId).toBeNull();
    expect(result.filter((student) => student.nivelRankingId !== null)).toHaveLength(1);
  });

  it("does NOT silently accept a snake_case body", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse([{ persona_id: 4, nombres: "Sofia", apellidos: "Vera", nivel_ranking_id: 4 }]),
    );

    const [student] = await fetchAlumnosConNivel();

    // This is the shape of the bug, pinned: if the mapper were ever pointed
    // back at snake_case keys, the camelCase assertions above would fail —
    // and here the ids are unreadable, which is exactly what must not pass
    // for real data.
    expect(student.personaId).toBeUndefined();
    // The level still normalises to null rather than undefined, so a broken
    // read can never masquerade as "assigned".
    expect(student.nivelRankingId).toBeNull();
  });
});

describe("fetchInstituciones — GET /api/personas/instituciones", () => {
  it("reads `tipoEscuela`, the alias `InstitucionResponseDTO` serialises", async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      okResponse([{ id: 1, nombre: "Unidad Educativa Beatriz Cueva", tipoEscuela: "FISCAL" }]),
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
      okResponse([{ id: 1, nombre: "Unidad Educativa Beatriz Cueva", tipo_escuela: "FISCAL" }]),
    );

    const [institucion] = await fetchInstituciones();

    // The wizard filters and labels on this value; `undefined` rendered as
    // "Nombre (undefined)" and matched no filter option.
    expect(institucion.tipoEscuela).toBeUndefined();
  });
});
