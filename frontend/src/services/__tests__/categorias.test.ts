/**
 * Unit tests for the live categoria catalog (`@/services/categorias`),
 * fetched from `GET /api/attendance/categories` — replaces the coverage this
 * file used to have for the static `CATEGORIA_METADATA` mirror (see that
 * file's doc comment for why the mirror was removed: the same staleness bug
 * `franja_horaria` caused before it, #160).
 *
 * Covers the spec's "Each category exposes correct data" scenario: all 5
 * fixed categories expose the confirmed audience/time-range/day-set, with
 * FORMATIVO/INFANTIL/JUVENIL/ADULTOS on Lun-Vie and COMPETITIVO on Lun-Sáb.
 *
 * All network calls are mocked via vi.spyOn(global, "fetch") — same pattern
 * as src/services/__tests__/api.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cargarCategorias,
  diasPermitidos,
  horarioDe,
  type Categoria,
} from "@/services/categorias";

const CATEGORIAS_FIJAS = ["FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"];

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const LUN_VIE_BACKEND = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"];
const LUN_SAB_BACKEND = [...LUN_VIE_BACKEND, "SABADO"];

// The BFF route (`/api/attendance/categories`) returns `dias` as frontend
// `DiaSemana` codes — see its route.test.ts. `cargarCategorias` converts
// these back to the backend format `@/app/groups/page` compares against.
const LUN_VIE = ["lun", "mar", "mie", "jue", "vie"];
const LUN_SAB = [...LUN_VIE, "sab"];

const CATALOGO = [
  { codigo: "FORMATIVO", label: "Formativo", horaInicio: "15:00", horaFin: "16:00", dias: LUN_VIE, edades: "5 a 10 años" },
  { codigo: "INFANTIL", label: "Infantil", horaInicio: "16:00", horaFin: "17:00", dias: LUN_VIE, edades: "11 a 13 años" },
  { codigo: "JUVENIL", label: "Juvenil", horaInicio: "17:00", horaFin: "18:00", dias: LUN_VIE, edades: "14 a 17 años" },
  { codigo: "COMPETITIVO", label: "Competitivo", horaInicio: "18:00", horaFin: "20:00", dias: LUN_SAB, edades: "Selección" },
  { codigo: "ADULTOS", label: "Adultos", horaInicio: "20:00", horaFin: "21:15", dias: LUN_VIE, edades: null },
];

beforeEach(() => {
  vi.spyOn(global, "fetch").mockResolvedValue(okResponse(CATALOGO));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cargarCategorias", () => {
  it("fetches the live catalog from GET /api/attendance/categories", async () => {
    await cargarCategorias();
    expect(global.fetch).toHaveBeenCalledWith("/api/attendance/categories", expect.anything());
  });

  it("gives FORMATIVO the confirmed time range and Lun-Vie days", async () => {
    const categorias = await cargarCategorias();
    expect(categorias.FORMATIVO).toEqual({
      label: "Formativo",
      horaInicio: "15:00",
      horaFin: "16:00",
      dias: LUN_VIE_BACKEND,
      edades: "5 a 10 años",
    });
  });

  // #789 — the ages label is optional: a categoría without one is valid, and
  // the catalog says so with `null` rather than dropping the key.
  it("gives ADULTOS the confirmed 20:00-21:15 Lun-Vie schedule (seed-data correction)", async () => {
    const categorias = await cargarCategorias();
    expect(categorias.ADULTOS).toEqual({
      label: "Adultos",
      horaInicio: "20:00",
      horaFin: "21:15",
      dias: LUN_VIE_BACKEND,
      edades: null,
    });
  });

  it("gives COMPETITIVO Lun-Sáb (includes Sábado, unlike the other 4 categories)", async () => {
    const categorias = await cargarCategorias();
    expect(categorias.COMPETITIVO).toEqual({
      label: "Competitivo",
      horaInicio: "18:00",
      horaFin: "20:00",
      dias: LUN_SAB_BACKEND,
      edades: "Selección",
    });
  });

  it("keeps a catalog entry whose código isn't one of the 5 original categorías (M1: the set is open)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      okResponse([...CATALOGO, { codigo: "BEGINNERS", label: "Principiantes", horaInicio: "00:00", horaFin: "01:00", dias: [], edades: null }]),
    );
    const categorias = await cargarCategorias();
    expect(Object.keys(categorias).sort()).toEqual([...CATEGORIAS_FIJAS, "BEGINNERS"].sort());
    expect(categorias.BEGINNERS).toEqual({ label: "Principiantes", horaInicio: "00:00", horaFin: "01:00", dias: [], edades: null });
  });
});

describe("diasPermitidos", () => {
  it("returns Lun-Vie (5 days, no Sábado) for JUVENIL", async () => {
    const categorias = await cargarCategorias();
    const categoria: Categoria = "JUVENIL";
    expect(diasPermitidos(categorias, categoria)).toEqual(LUN_VIE_BACKEND);
  });

  it("returns Lun-Sáb (6 days, includes Sábado) for COMPETITIVO", async () => {
    const categorias = await cargarCategorias();
    const categoria: Categoria = "COMPETITIVO";
    expect(diasPermitidos(categorias, categoria)).toEqual(LUN_SAB_BACKEND);
  });

  it("returns an empty array when the catalog hasn't loaded a categoria yet", () => {
    expect(diasPermitidos({}, "FORMATIVO")).toEqual([]);
  });
});

describe("horarioDe", () => {
  it("derives INFANTIL's exact 16:00-17:00 range", async () => {
    const categorias = await cargarCategorias();
    expect(horarioDe(categorias, "INFANTIL")).toEqual({ horaInicio: "16:00", horaFin: "17:00" });
  });

  it("derives a different range for a different category (proves it's not hardcoded)", async () => {
    const categorias = await cargarCategorias();
    expect(horarioDe(categorias, "JUVENIL")).toEqual({ horaInicio: "17:00", horaFin: "18:00" });
  });

  it("returns empty strings when the catalog hasn't loaded a categoria yet", () => {
    expect(horarioDe({}, "FORMATIVO")).toEqual({ horaInicio: "", horaFin: "" });
  });
});
