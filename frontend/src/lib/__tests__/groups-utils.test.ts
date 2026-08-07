/**
 * Unit tests for group management pure helpers.
 *
 * Pure functions — no React dependencies, easy to test.
 * Follows the same pattern as members-utils.test.ts and attendance-utils.test.ts.
 */

import { describe, it, expect } from "vitest";
import type { Horario } from "@/services/api";
import { groupHorarios, diffGroupSave, type HorarioGroup } from "../groups-utils";

// ---------------------------------------------------------------------------
// groupHorarios (PR2a — Gestión de Horarios UI fixes)
// ---------------------------------------------------------------------------

describe("groupHorarios", () => {
  const RECURRING_ROWS: Horario[] = [
    { id: 101, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 102, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
    { id: 103, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO" },
  ];

  it("collapses 3 rows sharing categoria/horario into 1 group with 3 rows sorted Mon→Sun", () => {
    const groups = groupHorarios(RECURRING_ROWS);

    expect(groups).toHaveLength(1);
    expect(groups[0].categoria).toBe("COMPETITIVO");
    expect(groups[0].horaInicio).toBe("18:00");
    expect(groups[0].horaFin).toBe("20:00");
    expect(groups[0].rows.map((r) => r.diaSemana)).toEqual(["LUNES", "MIERCOLES", "VIERNES"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual([101, 103, 102]);
  });

  it("does not carry a nivelRankingId on the group", () => {
    // The backing DB column was dropped by migration `c4d5e6f7a8b9`, so
    // `/groups/horarios` never sends one. Keeping it in the dedup key meant
    // every real row hashed on the same literal `"null"` — a key segment
    // that could not vary. See the deleted "null vs non-null nivel" case.
    const [group] = groupHorarios(RECURRING_ROWS);
    expect(group).not.toHaveProperty("nivelRankingId");
    expect(group.key).not.toMatch(/null/);
  });

  it("does not carry an entrenadorId on the group — the relation is gone (issue #13)", () => {
    const [group] = groupHorarios(RECURRING_ROWS);
    expect(group).not.toHaveProperty("entrenadorId");
    expect(group.key.split("|")).toHaveLength(3);
  });

  it("keeps rows with a different categoria in a separate group", () => {
    const rows: Horario[] = [
      RECURRING_ROWS[0],
      { ...RECURRING_ROWS[1], id: 999, categoria: "ADULTOS" },
    ];
    const groups = groupHorarios(rows);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.rows).flat()).toHaveLength(2);
    expect(groups.map((g) => g.categoria).sort()).toEqual(["ADULTOS", "COMPETITIVO"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupHorarios([])).toEqual([]);
  });
});

describe("diffGroupSave", () => {
  const EXISTING_GROUP: HorarioGroup = {
    key: "COMPETITIVO|18:00|20:00|1",
    categoria: "COMPETITIVO",
    horaInicio: "18:00",
    horaFin: "20:00",
    rows: [
      { id: 101, diaSemana: "LUNES" },
      { id: 103, diaSemana: "MIERCOLES" },
    ],
  };

  it("puts a newly ticked día with no matching existing row into toCreate", () => {
    const diff = diffGroupSave(EXISTING_GROUP, new Set(["LUNES", "MIERCOLES", "VIERNES"]));
    expect(diff.toCreate).toEqual(["VIERNES"]);
  });

  it("puts an existing row's id into toDeleteIds when its día is unticked", () => {
    const diff = diffGroupSave(EXISTING_GROUP, new Set(["LUNES"]));
    expect(diff.toDeleteIds).toEqual([103]);
  });

  it("puts an existing row's id into toUpdateIds when its día stays ticked", () => {
    const diff = diffGroupSave(EXISTING_GROUP, new Set(["LUNES", "MIERCOLES"]));
    expect(diff.toUpdateIds).toEqual([101, 103]);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toDeleteIds).toEqual([]);
  });

  it("handles a mixed create+update+delete diff in a single call", () => {
    const diff = diffGroupSave(EXISTING_GROUP, new Set(["MIERCOLES", "VIERNES"]));
    expect(diff.toCreate).toEqual(["VIERNES"]);
    expect(diff.toUpdateIds).toEqual([103]);
    expect(diff.toDeleteIds).toEqual([101]);
  });

  it("treats a group with no existing rows as an all-create diff (new group)", () => {
    const emptyGroup: HorarioGroup = { ...EXISTING_GROUP, rows: [] };
    const diff = diffGroupSave(emptyGroup, new Set(["LUNES", "MARTES"]));
    expect(diff.toCreate).toEqual(["LUNES", "MARTES"]);
    expect(diff.toUpdateIds).toEqual([]);
    expect(diff.toDeleteIds).toEqual([]);
  });
});
