/**
 * Unit tests for the Gestion de Grupos page-level pure helpers.
 *
 * Pure functions — no React dependencies, easy to test.
 * Pattern follows members-utils.test.ts and attendance-utils.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  countUniqueAlumnos,
  buildCategoriaCards,
  formatDiaSet,
  countInscriptos,
  buildDiaTrack,
  DIA_ORDER,
  formatMembresiaVencidaWarning,
  formatSolapeHorarioWarning,
  buildCatalogoSinHorarios,
  findCategoriaDuplicada,
  findCodigoPorLabel,
  puedeEliminarCategoria,
} from "../groups-page-utils";
import type { AlumnoHorario, SolapeHorario } from "@/services/api";
import type { HorarioGroup } from "@/lib/groups-utils";
import type { CategoriaInfo } from "@/services/categorias";

function makeAlumno(personaId: number, horarioId: number): AlumnoHorario {
  return {
    id: personaId * 100 + horarioId,
    personaId,
    personaNombreCompleto: `Alumno ${personaId}`,
    edad: 10,
    horarioId,
    horarioDia: "LUNES",
    horarioHoraInicio: "15:00",
    horarioHoraFin: "16:00",
    fechaAsignacion: "2026-01-01",
  };
}

// ---------------------------------------------------------------------------
// countUniqueAlumnos
// ---------------------------------------------------------------------------

describe("countUniqueAlumnos", () => {
  it("counts each student once even when they appear in multiple día rows", () => {
    const pendingDeletions = [1, 2, 3, 4, 5].map((horarioId) => ({
      alumnos: [makeAlumno(101, horarioId), makeAlumno(102, horarioId), makeAlumno(103, horarioId)],
    }));
    expect(countUniqueAlumnos(pendingDeletions)).toBe(3);
  });

  it("counts students who only appear in some rows exactly once", () => {
    const pendingDeletions = [
      { alumnos: [makeAlumno(101, 1), makeAlumno(102, 1)] },
      { alumnos: [makeAlumno(101, 2)] },
    ];
    expect(countUniqueAlumnos(pendingDeletions)).toBe(2);
  });

  it("returns 0 for no pending deletions or empty rosters", () => {
    expect(countUniqueAlumnos([])).toBe(0);
    expect(countUniqueAlumnos([{ alumnos: [] }, { alumnos: [] }])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCategoriaCards / formatDiaSet / countInscriptos (categoria-card grid)
// ---------------------------------------------------------------------------

/**
 * Mirrors the shape the live database actually holds: one `HorarioEntrenamiento`
 * row per categoria × weekday, all five weekdays for four categorias and a
 * sixth Saturday row for COMPETITIVO.
 */
const CATEGORIA_GROUPS: HorarioGroup[] = [
  {
    key: "competitivo-18",
    categoria: "COMPETITIVO",
    horaInicio: "18:00",
    horaFin: "20:00",
    rows: [
      { id: 101, diaSemana: "LUNES" },
      { id: 102, diaSemana: "MIERCOLES" },
      { id: 103, diaSemana: "SABADO" },
    ],
  },
  {
    key: "formativo-15",
    categoria: "FORMATIVO",
    horaInicio: "15:00",
    horaFin: "16:00",
    rows: [
      { id: 201, diaSemana: "LUNES" },
      { id: 202, diaSemana: "MARTES" },
    ],
  },
  // Same categoria as the group above under a distinct key: `groupHorarios`
  // keeps it as its own editable unit, but it is still the SAME training
  // group in the club's eyes and must land on the same card.
  {
    key: "formativo-15-b",
    categoria: "FORMATIVO",
    horaInicio: "15:00",
    horaFin: "16:00",
    rows: [{ id: 203, diaSemana: "VIERNES" }],
  },
];

describe("buildCategoriaCards", () => {
  it("renders one card per categoria, not one per categoria × weekday", () => {
    const cards = buildCategoriaCards(CATEGORIA_GROUPS);
    expect(cards.map((card) => card.categoria)).toEqual(["FORMATIVO", "COMPETITIVO"]);
  });

  it("orders the cards by start time, the way the club's afternoon runs", () => {
    const cards = buildCategoriaCards(CATEGORIA_GROUPS);
    expect(cards.map((card) => card.horaInicio)).toEqual(["15:00", "18:00"]);
  });

  it("merges every editable group of a categoria onto its single card", () => {
    const [formativo] = buildCategoriaCards(CATEGORIA_GROUPS);
    expect(formativo.groups.map((group) => group.key)).toEqual([
      "formativo-15",
      "formativo-15-b",
    ]);
    expect(formativo.rows.map((row) => row.id)).toEqual([201, 202, 203]);
  });

  it("derives the day set from the rows, in week order, without duplicates", () => {
    const cards = buildCategoriaCards(CATEGORIA_GROUPS);
    expect(cards[0].dias).toEqual(["LUNES", "MARTES", "VIERNES"]);
    expect(cards[1].dias).toEqual(["LUNES", "MIERCOLES", "SABADO"]);
  });

  it("does not carry entrenadores on the card — the relation is gone (issue #13)", () => {
    const cards = buildCategoriaCards(CATEGORIA_GROUPS);
    expect(cards[0]).not.toHaveProperty("entrenadorIds");
  });

  it("returns an empty list for no groups", () => {
    expect(buildCategoriaCards([])).toEqual([]);
  });
});

describe("formatDiaSet", () => {
  it("collapses the full working week into 'Lunes a viernes'", () => {
    expect(formatDiaSet(["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"])).toBe(
      "Lunes a viernes",
    );
  });

  it("names the Saturday exception instead of hiding it", () => {
    expect(
      formatDiaSet(["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"]),
    ).toBe("Lunes a viernes + sábado");
  });

  it("names both weekend exceptions", () => {
    expect(
      formatDiaSet([
        "LUNES",
        "MARTES",
        "MIERCOLES",
        "JUEVES",
        "VIERNES",
        "SABADO",
        "DOMINGO",
      ]),
    ).toBe("Lunes a viernes + sábado y domingo");
  });

  it("lists the days one by one when the week is incomplete", () => {
    expect(formatDiaSet(["LUNES", "MIERCOLES", "VIERNES"])).toBe(
      "Lunes, miércoles y viernes",
    );
  });

  it("reads a single day as that day", () => {
    expect(formatDiaSet(["JUEVES"])).toBe("Jueves");
  });

  it("says so rather than inventing a week when there are no days", () => {
    expect(formatDiaSet([])).toBe("Sin días asignados");
  });

  it("ignores the order it is given and answers in week order", () => {
    expect(formatDiaSet(["VIERNES", "LUNES"])).toBe("Lunes y viernes");
  });
});

describe("countInscriptos", () => {
  const rows = [
    { id: 1, diaSemana: "LUNES" },
    { id: 2, diaSemana: "MARTES" },
  ];

  it("counts each student once across every día row of the categoria", () => {
    expect(countInscriptos(rows, { 1: [10, 11, 12], 2: [10, 11, 12] })).toBe(3);
  });

  it("counts a student enrolled in only one día of the categoria", () => {
    expect(countInscriptos(rows, { 1: [10, 11, 12], 2: [10, 11] })).toBe(3);
  });

  it("returns null rather than a lie when a row's roster never answered", () => {
    expect(countInscriptos(rows, { 1: [10, 11] })).toBeNull();
  });

  it("returns 0 for a categoria whose every día is empty", () => {
    expect(countInscriptos(rows, { 1: [], 2: [] })).toBe(0);
  });
});

describe("buildDiaTrack", () => {
  const LUN_SAB = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];

  it("lays out every día the categoría may meet, in week order", () => {
    expect(buildDiaTrack(LUN_SAB, ["LUNES", "MIERCOLES"])).toEqual(LUN_SAB);
  });

  it("keeps a día the rows actually use even when it is outside the allowed set", () => {
    expect(buildDiaTrack(["LUNES", "MARTES"], ["DOMINGO"])).toEqual([
      "LUNES",
      "MARTES",
      "DOMINGO",
    ]);
  });

  it("falls back to the días that exist when the categoría has no metadata", () => {
    expect(buildDiaTrack([], ["MARTES", "LUNES"])).toEqual(["LUNES", "MARTES"]);
  });

  it("never repeats a día present in both sets", () => {
    expect(buildDiaTrack(["LUNES"], ["LUNES"])).toEqual(["LUNES"]);
  });
});

describe("DIA_ORDER", () => {
  it("runs Lunes → Domingo, the way the club reads a week", () => {
    expect(DIA_ORDER).toEqual([
      "LUNES",
      "MARTES",
      "MIERCOLES",
      "JUEVES",
      "VIERNES",
      "SABADO",
      "DOMINGO",
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatMembresiaVencidaWarning — INS-6 non-blocking warning
// ---------------------------------------------------------------------------

describe("formatMembresiaVencidaWarning", () => {
  it("names the student and the number of overdue days", () => {
    expect(formatMembresiaVencidaWarning("Ariana Ruiz", 14)).toBe(
      "Ariana Ruiz tiene la cuota vencida hace 14 días.",
    );
  });

  it("uses the singular día for exactly one overdue day", () => {
    expect(formatMembresiaVencidaWarning("Ariana Ruiz", 1)).toBe(
      "Ariana Ruiz tiene la cuota vencida hace 1 día.",
    );
  });

  it("says 'desde hoy' when the membership expired today (0 días)", () => {
    expect(formatMembresiaVencidaWarning("Ariana Ruiz", 0)).toBe(
      "Ariana Ruiz tiene la cuota vencida desde hoy.",
    );
  });

  it("falls back to a dateless sentence when diasVencida is unknown", () => {
    expect(formatMembresiaVencidaWarning("Ariana Ruiz", null)).toBe(
      "Ariana Ruiz tiene la cuota vencida.",
    );
  });
});

// ---------------------------------------------------------------------------
// formatSolapeHorarioWarning — issue #731 non-blocking overlap warning
// ---------------------------------------------------------------------------

function makeSolape(
  categoriaLabel: string,
  diaSemana: string,
  horaInicio: string,
  horaFin: string,
): SolapeHorario {
  return {
    horarioId: 1,
    categoria: categoriaLabel.toUpperCase(),
    categoriaLabel,
    diaSemana,
    horaInicio,
    horaFin,
  };
}

describe("formatSolapeHorarioWarning", () => {
  it("names the categoría, the day and the time range it collides with", () => {
    // The whole point of the warning: an admin who only reads "se superpone"
    // has to go hunting for WHICH schedule. This sentence answers that.
    expect(
      formatSolapeHorarioWarning("Diego Vega", [
        makeSolape("Competitivo", "LUNES", "18:00:00", "20:00:00"),
      ]),
    ).toBe(
      "Diego Vega ya figura en Competitivo (Lunes de 18:00 a 20:00), " +
        "que se superpone con este horario.",
    );
  });

  it("lists every colliding schedule and agrees the verb in plural", () => {
    expect(
      formatSolapeHorarioWarning("Diego Vega", [
        makeSolape("Competitivo", "LUNES", "18:00:00", "20:00:00"),
        makeSolape("Adultos", "LUNES", "20:00:00", "21:15:00"),
      ]),
    ).toBe(
      "Diego Vega ya figura en Competitivo (Lunes de 18:00 a 20:00) y " +
        "Adultos (Lunes de 20:00 a 21:15), que se superponen con este horario.",
    );
  });

  it("returns an empty string when nothing collides, so no toast is raised", () => {
    expect(formatSolapeHorarioWarning("Diego Vega", [])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildCatalogoSinHorarios — fresh-install catalog visibility (issue #1315)
// ---------------------------------------------------------------------------

function makeCategoria(
  label: string,
  horaInicio: string,
  horaFin: string,
  dias: string[],
  edades: string | null = null,
): CategoriaInfo {
  return { label, horaInicio, horaFin, dias, edades };
}

describe("buildCatalogoSinHorarios", () => {
  const CATALOGO = {
    FORMATIVO: makeCategoria("Formativo", "15:00", "16:00", ["LUNES", "MARTES", "MIERCOLES"], "5 a 10 años"),
    INFANTIL: makeCategoria("Infantil", "16:00", "17:00", ["LUNES", "MARTES"]),
    ADULTOS: makeCategoria("Adultos", "20:00", "21:15", ["LUNES"]),
  };

  it("returns every catalog entry, with label/franja/días, when no categoría has schedules", () => {
    const result = buildCatalogoSinHorarios(CATALOGO, []);

    expect(result).toEqual([
      {
        categoria: "FORMATIVO",
        label: "Formativo",
        horaInicio: "15:00",
        horaFin: "16:00",
        dias: ["LUNES", "MARTES", "MIERCOLES"],
        edades: "5 a 10 años",
      },
      {
        categoria: "INFANTIL",
        label: "Infantil",
        horaInicio: "16:00",
        horaFin: "17:00",
        dias: ["LUNES", "MARTES"],
        edades: null,
      },
      {
        categoria: "ADULTOS",
        label: "Adultos",
        horaInicio: "20:00",
        horaFin: "21:15",
        dias: ["LUNES"],
        edades: null,
      },
    ]);
  });

  it("orders by start time, then by label — the club's afternoon run", () => {
    const result = buildCatalogoSinHorarios(CATALOGO, []);
    expect(result.map((c) => c.label)).toEqual(["Formativo", "Infantil", "Adultos"]);
  });

  it("orders labels accent/case-insensitively, so an accented label never outranks its plain counterpart", () => {
    // Plain `localeCompare()` (no locale/options) ranks "Único" AFTER "unico" —
    // reordering them away from catalog insertion order even though they are
    // the same word. `localeCompare("es", { sensitivity: "base" })` treats
    // them as equal, so the stable sort keeps insertion order instead.
    const catalogo = {
      UNICO_ACENTO: makeCategoria("Único", "15:00", "16:00", ["LUNES"]),
      UNICO_PLANO: makeCategoria("unico", "15:00", "16:00", ["LUNES"]),
    };
    const result = buildCatalogoSinHorarios(catalogo, []);
    expect(result.map((c) => c.categoria)).toEqual(["UNICO_ACENTO", "UNICO_PLANO"]);
  });

  it("omits a catalog entry that already has schedules", () => {
    const result = buildCatalogoSinHorarios(CATALOGO, ["INFANTIL"]);
    expect(result.map((c) => c.categoria)).toEqual(["FORMATIVO", "ADULTOS"]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(buildCatalogoSinHorarios({}, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findCategoriaDuplicada — duplicate-label 400 (issue #1315)
// ---------------------------------------------------------------------------

describe("findCategoriaDuplicada", () => {
  it("extracts the quoted name from the backend's duplicate-label message", () => {
    expect(findCategoriaDuplicada('Ya existe una categoría llamada "Infantil".')).toBe("Infantil");
  });

  it("returns null for a message that names no categoría", () => {
    expect(findCategoriaDuplicada("Ya existe una categoría con ese nombre.")).toBeNull();
  });

  it("returns null for an unrelated server error", () => {
    expect(findCategoriaDuplicada("La hora de inicio debe ser anterior a la hora de fin.")).toBeNull();
    expect(findCategoriaDuplicada("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findCodigoPorLabel — map the refused name back to the catalog entry
// ---------------------------------------------------------------------------

describe("findCodigoPorLabel", () => {
  const CATALOGO = {
    FORMATIVO: makeCategoria("Formativo", "15:00", "16:00", ["LUNES"]),
    INFANTIL: makeCategoria("Infantil", "16:00", "17:00", ["LUNES"]),
  };

  it("matches the label case-insensitively and trims", () => {
    expect(findCodigoPorLabel(CATALOGO, "Infantil")).toBe("INFANTIL");
    expect(findCodigoPorLabel(CATALOGO, "  infantil ")).toBe("INFANTIL");
  });

  it("returns null when no catalog label matches", () => {
    expect(findCodigoPorLabel(CATALOGO, "Preinfantil")).toBeNull();
    expect(findCodigoPorLabel({}, "Formativo")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// puedeEliminarCategoria — gates the delete-categoría zone (issue #1325)
// ---------------------------------------------------------------------------

describe("puedeEliminarCategoria", () => {
  it("hides the delete zone for a catalog-only categoría with no día rows yet", () => {
    // The v6 catalog-only edit form (#1315) has no `horario_entrenamiento`
    // row to delete until its first save creates one.
    const catalogoUnicamente: HorarioGroup = {
      key: "INFANTIL",
      categoria: "INFANTIL",
      horaInicio: "16:00",
      horaFin: "17:00",
      rows: [],
    };
    expect(puedeEliminarCategoria(catalogoUnicamente)).toBe(false);
  });

  it("shows the delete zone once the categoría has at least one día row", () => {
    const yaProgramada: HorarioGroup = {
      key: "FORMATIVO",
      categoria: "FORMATIVO",
      horaInicio: "15:00",
      horaFin: "16:00",
      rows: [{ id: 1, diaSemana: "LUNES" }],
    };
    expect(puedeEliminarCategoria(yaProgramada)).toBe(true);
  });

  it("hides the delete zone when no group is being edited", () => {
    expect(puedeEliminarCategoria(null)).toBe(false);
  });
});
