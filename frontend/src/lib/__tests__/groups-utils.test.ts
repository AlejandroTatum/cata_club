/**
 * Unit tests for group management pure helpers.
 *
 * Pure functions — no React dependencies, easy to test.
 * Follows the same pattern as members-utils.test.ts and attendance-utils.test.ts.
 */

import { describe, it, expect } from "vitest";
import type { Grupo, NivelTecnico } from "@/types/domain";
import type { ScheduleSlot } from "@/app/attendance/attendance-utils";
import type { Horario } from "@/services/api";
import {
  assignStudentToGroup,
  removeStudentFromAllGroups,
  getStudentsByGroup,
  getSchedulesByGroup,
  getUnassignedStudents,
  getAssignedStudents,
  getGroupCapacity,
  buildGroupCards,
  buildTrainingSessions,
  getLevelLabel,
  getLevelBadgeTokens,
  groupHorarios,
  diffGroupSave,
  type StudentRef,
  type HorarioGroup,
} from "../groups-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_GRUPOS: Grupo[] = [
  {
    id: "grupo-001",
    nombre: "Principiantes",
    nivel: "principiante",
    estudiantesIds: ["stu-001", "stu-002"],
    horariosIds: ["hor-001", "hor-004"],
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "grupo-002",
    nombre: "Intermedios",
    nivel: "intermedio",
    estudiantesIds: ["stu-003"],
    horariosIds: ["hor-002"],
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "grupo-003",
    nombre: "Avanzados",
    nivel: "avanzado",
    estudiantesIds: [],
    horariosIds: [],
    activo: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const MOCK_STUDENTS: StudentRef[] = [
  { id: "stu-001", nombres: "Sofia", apellidos: "Martinez", grupoId: "grupo-001", activo: true },
  { id: "stu-002", nombres: "Mateo", apellidos: "Rodriguez", grupoId: "grupo-001", activo: true },
  { id: "stu-003", nombres: "Valentina", apellidos: "Lopez", grupoId: "grupo-002", activo: true },
  { id: "stu-004", nombres: "Camila", apellidos: "Flores", grupoId: null, activo: true },
  { id: "stu-005", nombres: "Nicolas", apellidos: "Acosta", grupoId: null, activo: true },
];

const MOCK_SCHEDULES: ScheduleSlot[] = [
  { id: "hor-001", diaSemana: "lun", horaInicio: "15:00", horaFin: "16:30", cancha: "Cancha 1", cupoMaximo: 12, activo: true },
  { id: "hor-002", diaSemana: "mie", horaInicio: "16:45", horaFin: "18:15", cancha: "Cancha 2", cupoMaximo: 10, activo: true },
  { id: "hor-003", diaSemana: "vie", horaInicio: "15:00", horaFin: "16:30", cancha: "Cancha 1", cupoMaximo: 12, activo: false },
  { id: "hor-004", diaSemana: "vie", horaInicio: "15:00", horaFin: "16:30", cancha: "Cancha 1", cupoMaximo: 12, activo: true },
];

// ---------------------------------------------------------------------------
// getLevelLabel
// ---------------------------------------------------------------------------

describe("getLevelLabel", () => {
  it("returns correct label for each level", () => {
    expect(getLevelLabel("principiante")).toBe("Principiante");
    expect(getLevelLabel("intermedio")).toBe("Intermedio");
    expect(getLevelLabel("avanzado")).toBe("Avanzado");
  });
});

// ---------------------------------------------------------------------------
// getLevelBadgeTokens (Fase 4 — trainer light-theme badge tokens)
// ---------------------------------------------------------------------------

describe("getLevelBadgeTokens", () => {
  it("returns the cata-state-ok token for Principiante", () => {
    expect(getLevelBadgeTokens("Principiante")).toBe(
      "bg-cata-state-ok/10 text-cata-state-ok",
    );
  });

  it("returns the cata-navy token for Intermedio", () => {
    expect(getLevelBadgeTokens("Intermedio")).toBe(
      "bg-cata-navy/10 text-cata-navy",
    );
  });

  it("returns the cata-red token for Avanzado", () => {
    expect(getLevelBadgeTokens("Avanzado")).toBe(
      "bg-cata-red/15 text-cata-red",
    );
  });

  it("returns a neutral fallback for unknown level labels — never throws", () => {
    expect(getLevelBadgeTokens("Desconocido")).toBe(
      "bg-cata-border/40 text-cata-text/65",
    );
  });

  it("never returns a dark-theme (900/opacity or bare white) token — regression guard", () => {
    for (const label of ["Principiante", "Intermedio", "Avanzado", "Desconocido"]) {
      const tokens = getLevelBadgeTokens(label);
      expect(tokens).not.toMatch(/900|text-white|bg-white/);
    }
  });
});

// ---------------------------------------------------------------------------
// assignStudentToGroup
// ---------------------------------------------------------------------------

describe("assignStudentToGroup", () => {
  it("assigns an unassigned student to a group", () => {
    const result = assignStudentToGroup("stu-004", "grupo-001", MOCK_GRUPOS);
    expect(result.success).toBe(true);
    expect(result.message).toContain("asignado");

    const updated = result.updatedGrupos.find((g) => g.id === "grupo-001")!;
    expect(updated.estudiantesIds).toContain("stu-004");
    expect(updated.estudiantesIds).toContain("stu-001"); // existing kept
  });

  it("removes student from previous group when reassigning", () => {
    const result = assignStudentToGroup("stu-001", "grupo-002", MOCK_GRUPOS);
    expect(result.success).toBe(true);

    const grupo1 = result.updatedGrupos.find((g) => g.id === "grupo-001")!;
    const grupo2 = result.updatedGrupos.find((g) => g.id === "grupo-002")!;

    expect(grupo1.estudiantesIds).not.toContain("stu-001");
    expect(grupo2.estudiantesIds).toContain("stu-001");
  });

  it("returns success=false when target group does not exist", () => {
    const result = assignStudentToGroup("stu-004", "grupo-unknown", MOCK_GRUPOS);
    expect(result.success).toBe(false);
    expect(result.message).toContain("no encontrado");
  });

  it("returns success=false when student is already in target group", () => {
    const result = assignStudentToGroup("stu-001", "grupo-001", MOCK_GRUPOS);
    expect(result.success).toBe(false);
    expect(result.message).toContain("ya pertenece");
  });

  it("makes student appear in exactly one group's estudiantesIds after assignment", () => {
    // Simulates the C1 fix: after assigning a student, they should appear
    // in exactly one group's estudiantesIds, ensuring getUnassignedStudents
    // (which checks derived grupoId from grupos) would correctly exclude them.
    const result = assignStudentToGroup("stu-004", "grupo-001", MOCK_GRUPOS);
    expect(result.success).toBe(true);

    const groupsWithStudent = result.updatedGrupos.filter((g) =>
      g.estudiantesIds.includes("stu-004"),
    );
    expect(groupsWithStudent).toHaveLength(1);
    expect(groupsWithStudent[0].id).toBe("grupo-001");
  });

  it("does not mutate the original grupos array", () => {
    const original = MOCK_GRUPOS.map((g) => ({ ...g, estudiantesIds: [...g.estudiantesIds] }));
    assignStudentToGroup("stu-004", "grupo-001", MOCK_GRUPOS);

    expect(MOCK_GRUPOS[0].estudiantesIds).toEqual(["stu-001", "stu-002"]);
  });
});

// ---------------------------------------------------------------------------
// removeStudentFromAllGroups
// ---------------------------------------------------------------------------

describe("removeStudentFromAllGroups", () => {
  it("removes student from all groups", () => {
    const updated = removeStudentFromAllGroups("stu-001", MOCK_GRUPOS);
    expect(updated.every((g) => !g.estudiantesIds.includes("stu-001"))).toBe(true);
  });

  it("does not mutate the original", () => {
    removeStudentFromAllGroups("stu-001", MOCK_GRUPOS);
    expect(MOCK_GRUPOS[0].estudiantesIds).toContain("stu-001");
  });

  it("returns unchanged array when student is not in any group", () => {
    const updated = removeStudentFromAllGroups("stu-999", MOCK_GRUPOS);
    expect(updated).toEqual(MOCK_GRUPOS);
  });

  it("removed student is present in zero groups (C1 — unassigned consistency)", () => {
    const updated = removeStudentFromAllGroups("stu-001", MOCK_GRUPOS);
    const inAnyGroup = updated.some((g) =>
      g.estudiantesIds.includes("stu-001"),
    );
    expect(inAnyGroup).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getStudentsByGroup
// ---------------------------------------------------------------------------

describe("getStudentsByGroup", () => {
  it("returns students that belong to the group", () => {
    const students = getStudentsByGroup(MOCK_GRUPOS[0], MOCK_STUDENTS);
    expect(students).toHaveLength(2);
    expect(students.map((s) => s.id)).toEqual(["stu-001", "stu-002"]);
  });

  it("returns empty array for a group with no students", () => {
    const students = getStudentsByGroup(MOCK_GRUPOS[2], MOCK_STUDENTS);
    expect(students).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getSchedulesByGroup
// ---------------------------------------------------------------------------

describe("getSchedulesByGroup", () => {
  it("returns schedules linked to the group", () => {
    const schedules = getSchedulesByGroup(MOCK_GRUPOS[0], MOCK_SCHEDULES);
    expect(schedules).toHaveLength(2);
    expect(schedules.map((s) => s.id)).toEqual(["hor-001", "hor-004"]);
  });

  it("returns empty array when group has no horariosIds", () => {
    const grupo: Grupo = {
      id: "g-empty",
      nombre: "Empty",
      nivel: "principiante",
      estudiantesIds: [],
      activo: true,
      createdAt: "",
      updatedAt: "",
    };
    expect(getSchedulesByGroup(grupo, MOCK_SCHEDULES)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getUnassignedStudents / getAssignedStudents
// ---------------------------------------------------------------------------

describe("getUnassignedStudents", () => {
  it("finds students without a group", () => {
    const unassigned = getUnassignedStudents(MOCK_STUDENTS);
    expect(unassigned).toHaveLength(2);
    expect(unassigned.map((s) => s.id)).toEqual(["stu-004", "stu-005"]);
  });

  it("returns empty array when all students have groups", () => {
    const allAssigned = MOCK_STUDENTS.map((s) => ({
      ...s,
      grupoId: s.grupoId ?? "grupo-001",
    }));
    expect(getUnassignedStudents(allAssigned)).toHaveLength(0);
  });

  it("includes inactive unassigned students (does NOT filter by activo)", () => {
    const withInactive: StudentRef[] = [
      ...MOCK_STUDENTS,
      { id: "stu-inactive", nombres: "Inactive", apellidos: "Student", grupoId: null, activo: false },
    ];
    const unassigned = getUnassignedStudents(withInactive);
    expect(unassigned.find((s) => s.id === "stu-inactive")).toBeDefined();
    expect(unassigned.find((s) => s.id === "stu-inactive")!.activo).toBe(false);
  });
});

describe("getAssignedStudents", () => {
  it("finds students with a group", () => {
    const assigned = getAssignedStudents(MOCK_STUDENTS);
    expect(assigned).toHaveLength(3);
  });

  it("includes inactive assigned students (does NOT filter by activo)", () => {
    const withInactive: StudentRef[] = [
      ...MOCK_STUDENTS,
      { id: "stu-inactive", nombres: "Inactive", apellidos: "Assigned", grupoId: "grupo-001", activo: false },
    ];
    const assigned = getAssignedStudents(withInactive);
    expect(assigned.find((s) => s.id === "stu-inactive")).toBeDefined();
    expect(assigned.find((s) => s.id === "stu-inactive")!.activo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getGroupCapacity
// ---------------------------------------------------------------------------

describe("getGroupCapacity", () => {
  it("calculates capacity from linked schedules (minimum cupoMaximo, not sum)", () => {
    // grupo-001 has hor-001 (cupo 12) + hor-004 (cupo 12) = min 12 total
    // Effective capacity is the minimum across linked schedules since the
    // group roster attends EVERY linked session with the same students.
    // It has 2 students
    const cap = getGroupCapacity(MOCK_GRUPOS[0], MOCK_SCHEDULES);
    expect(cap.total).toBe(12);
    expect(cap.available).toBe(10);
    expect(cap.percent).toBe(17); // 2/12 ≈ 17%
  });

  it("returns zero total when no schedules linked", () => {
    // grupo-003 has no horariosIds
    const cap = getGroupCapacity(MOCK_GRUPOS[2], MOCK_SCHEDULES);
    expect(cap.total).toBe(0);
    expect(cap.percent).toBe(0);
  });

  it("ignores inactive linked schedules when computing effective capacity (JDC2)", () => {
    // grupo with hor-001 (active, cupo=12) + custom inactive slot (cupo=3)
    // The inactive slot with lower cupo should be IGNORED — effective capacity should be 12
    const groupWithInactive: Grupo = {
      id: "grupo-cap-test",
      nombre: "Capacidad Test",
      nivel: "principiante",
      estudiantesIds: ["stu-001"],
      horariosIds: ["hor-001", "inactive-low-cap"],
      activo: true,
      createdAt: "",
      updatedAt: "",
    };
    const schedulesWithInactive: ScheduleSlot[] = [
      ...MOCK_SCHEDULES,
      {
        id: "inactive-low-cap",
        diaSemana: "sab",
        horaInicio: "09:00",
        horaFin: "10:00",
        cancha: "Cancha 1",
        cupoMaximo: 3,
        activo: false,
      },
    ];
    const cap = getGroupCapacity(groupWithInactive, schedulesWithInactive);
    // inactive-low-cap (cupo=3) is inactive, should not cap capacity
    // Only hor-001 (cupo=12, active) counts
    expect(cap.total).toBe(12);
    expect(cap.available).toBe(11); // 1 student
    expect(cap.percent).toBe(8); // 1/12 ≈ 8%
  });

  it("uses minimum cupoMaximo across active linked schedules (mixed fixture)", () => {
    // grupo with 2 active schedules: cupo=12 and cupo=8
    // Effective capacity should be min(12, 8) = 8
    const groupMixed: Grupo = {
      id: "grupo-mixed",
      nombre: "Mixed",
      nivel: "principiante",
      estudiantesIds: ["stu-001", "stu-002"],
      horariosIds: ["hor-001", "lower-active"],
      activo: true,
      createdAt: "",
      updatedAt: "",
    };
    const schedulesMixed: ScheduleSlot[] = [
      ...MOCK_SCHEDULES,
      {
        id: "lower-active",
        diaSemana: "sab",
        horaInicio: "10:00",
        horaFin: "11:00",
        cancha: "Cancha 2",
        cupoMaximo: 8,
        activo: true,
      },
    ];
    const cap = getGroupCapacity(groupMixed, schedulesMixed);
    expect(cap.total).toBe(8); // min(12, 8)
    expect(cap.available).toBe(6); // 2 students
    expect(cap.percent).toBe(25); // 2/8 = 25%
  });
});

// ---------------------------------------------------------------------------
// buildGroupCards
// ---------------------------------------------------------------------------

describe("buildGroupCards", () => {
  it("builds card data for all groups", () => {
    const cards = buildGroupCards(MOCK_GRUPOS, MOCK_SCHEDULES);
    expect(cards).toHaveLength(3);

    const principiantes = cards.find((c) => c.id === "grupo-001")!;
    expect(principiantes.name).toBe("Principiantes");
    expect(principiantes.levelLabel).toBe("Principiante");
    expect(principiantes.studentCount).toBe(2);
    expect(principiantes.scheduleCount).toBe(2);
    expect(principiantes.capacity).toBe(12);
    expect(principiantes.capacityPercent).toBe(17);
  });

  it("returns empty array when grupos is empty", () => {
    expect(buildGroupCards([], MOCK_SCHEDULES)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildTrainingSessions
// ---------------------------------------------------------------------------

describe("buildTrainingSessions", () => {
  const studentNameMap: Record<string, string> = {
    "stu-001": "Sofia Martinez",
    "stu-002": "Mateo Rodriguez",
    "stu-003": "Valentina Lopez",
  };

  it("builds sessions from groups and schedules", () => {
    const sessions = buildTrainingSessions(MOCK_GRUPOS, MOCK_SCHEDULES, studentNameMap);

    // Active schedules only: grupo-001 has hor-001 (lun, active) + hor-004 (vie, active) = 2
    // grupo-002 has hor-002 (mie, active) = 1
    // grupo-003 has no schedules = 0
    expect(sessions).toHaveLength(3);

    const first = sessions[0];
    expect(first.groupName).toContain("Principiantes");
    expect(first.students).toHaveLength(2);
    expect(first.students[0].name).toBe("Sofia Martinez");
    expect(first.students.every((s) => s.attendance === "absent")).toBe(true);
  });

  it("skips inactive schedules", () => {
    // hor-003 is inactive, should not appear in training sessions
    // Active sessions at "Cancha 1" "15:00—16:30": hor-001 (lun, linked to grupo-001)
    // and hor-004 (vie, linked to grupo-001) = exactly 2
    const sessions = buildTrainingSessions(MOCK_GRUPOS, MOCK_SCHEDULES, studentNameMap);
    const activeAtSlot = sessions.filter(
      (s) => s.court === "Cancha 1" && s.time === "15:00 — 16:30",
    );
    expect(activeAtSlot).toHaveLength(2);
    // Total sessions: 3 (hor-001, hor-004 for grupo-001, hor-002 for grupo-002)
    expect(sessions).toHaveLength(3);
  });

  it("handles empty inputs gracefully", () => {
    expect(buildTrainingSessions([], MOCK_SCHEDULES, {})).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// groupHorarios (PR2a — Gestión de Horarios UI fixes)
// ---------------------------------------------------------------------------

describe("groupHorarios", () => {
  const RECURRING_ROWS: Horario[] = [
    { id: 101, diaSemana: "LUNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
    { id: 102, diaSemana: "VIERNES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
    { id: 103, diaSemana: "MIERCOLES", horaInicio: "18:00", horaFin: "20:00", categoria: "COMPETITIVO", entrenadorId: 1, nivelRankingId: 2 },
  ];

  it("collapses 3 rows sharing categoria/horario/entrenador/nivel into 1 group with 3 rows sorted Mon→Sun", () => {
    const groups = groupHorarios(RECURRING_ROWS);

    expect(groups).toHaveLength(1);
    expect(groups[0].categoria).toBe("COMPETITIVO");
    expect(groups[0].horaInicio).toBe("18:00");
    expect(groups[0].horaFin).toBe("20:00");
    expect(groups[0].entrenadorId).toBe(1);
    expect(groups[0].nivelRankingId).toBe(2);
    expect(groups[0].rows.map((r) => r.diaSemana)).toEqual(["LUNES", "MIERCOLES", "VIERNES"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual([101, 103, 102]);
  });

  it("keeps rows with a different entrenadorId in a separate group", () => {
    const rows: Horario[] = [
      RECURRING_ROWS[0],
      { ...RECURRING_ROWS[1], id: 999, entrenadorId: 2 },
    ];
    const groups = groupHorarios(rows);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.rows).flat()).toHaveLength(2);
    const entrenadorIds = groups.map((g) => g.entrenadorId).sort();
    expect(entrenadorIds).toEqual([1, 2]);
  });

  it("treats null nivelRankingId as its own group key distinct from a non-null nivel", () => {
    const rows: Horario[] = [
      { id: 201, diaSemana: "LUNES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 5, nivelRankingId: null },
      { id: 202, diaSemana: "MARTES", horaInicio: "15:00", horaFin: "16:00", categoria: "FORMATIVO", entrenadorId: 5, nivelRankingId: 3 },
    ];
    const groups = groupHorarios(rows);

    expect(groups).toHaveLength(2);
    const withNull = groups.find((g) => g.nivelRankingId === null)!;
    expect(withNull.rows).toHaveLength(1);
    expect(withNull.rows[0].id).toBe(201);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupHorarios([])).toEqual([]);
  });
});

describe("diffGroupSave", () => {
  const EXISTING_GROUP: HorarioGroup = {
    key: "COMPETITIVO|18:00|20:00|1|2",
    categoria: "COMPETITIVO",
    horaInicio: "18:00",
    horaFin: "20:00",
    entrenadorId: 1,
    nivelRankingId: 2,
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
