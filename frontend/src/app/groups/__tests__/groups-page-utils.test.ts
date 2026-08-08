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
} from "../groups-page-utils";
import type { AlumnoHorario } from "@/services/api";
import type { HorarioGroup } from "@/lib/groups-utils";

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
