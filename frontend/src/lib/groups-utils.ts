/**
 * Group management pure helpers for Cata Club.
 *
 * These are the canonical helpers for group assignment, student-group mapping,
 * capacity checks, and building UI card data. They reconcile data across
 * multiple mock sources (members-utils, attendance-utils) and produce
 * derived views for the /groups admin page, /attendance, and trainer flow.
 *
 * No React dependencies — pure functions for testability.
 */

import type { Grupo, NivelTecnico, EstadoAsistencia } from "@/types/domain";
import type { ScheduleSlot } from "@/app/attendance/attendance-utils";
import type { Horario } from "@/services/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of an assignment operation. */
export interface AssignmentResult {
  updatedGrupos: Grupo[];
  success: boolean;
  message: string;
}

/** A lightweight student reference for group operations. */
export interface StudentRef {
  id: string;
  nombres: string;
  apellidos: string;
  grupoId: string | null;
  activo: boolean;
}

/** A student in a trainer session roster. */
export interface SessionStudent {
  id: string;
  name: string;
  attendance: EstadoAsistencia;
}

/** A training session for attendance registration, derived from schedule + group. */
export interface DerivedTrainingSession {
  id: string;
  groupName: string;
  time: string;
  court: string;
  level: string;
  studentCount: number;
  students: SessionStudent[];
}

/** Group card data for the admin UI. */
export interface GroupCardData {
  id: string;
  name: string;
  level: NivelTecnico;
  levelLabel: string;
  studentCount: number;
  capacity: number;
  capacityPercent: number;
  scheduleCount: number;
  scheduleLabels: string[];
}

/** One underlying `HorarioEntrenamiento` row (a single día) inside a `HorarioGroup`. */
export interface HorarioGroupRow {
  id: number;
  diaSemana: string;
}

/**
 * A visual grouping of `Horario` rows that share categoria, horaInicio,
 * horaFin and entrenadorId — the "same weekly schedule, recurring on N días"
 * case. Built by `groupHorarios()`.
 */
export interface HorarioGroup {
  key: string;
  categoria: string;
  horaInicio: string;
  horaFin: string;
  entrenadorId: number;
  rows: HorarioGroupRow[];
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

const DIA_SEMANA_LABELS: Record<string, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

const NIVEL_LABELS: Record<NivelTecnico, string> = {
  principiante: "Principiante",
  intermedio: "Intermedio",
  avanzado: "Avanzado",
};

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Get human-readable label for a technical level. */
export function getLevelLabel(nivel: NivelTecnico): string {
  return NIVEL_LABELS[nivel] ?? capitalize(nivel);
}

// ---------------------------------------------------------------------------
// Level badge color tokens (Fase 4 — trainer light-theme migration)
// ---------------------------------------------------------------------------

/**
 * Light-theme badge color tokens for a technical-level label.
 *
 * Keyed by the human-readable label (as returned by `getLevelLabel`) since
 * callers (e.g. the trainer session roster) commonly work with the derived
 * label rather than the raw `NivelTecnico` enum once sessions are built.
 * Mirrors the `cata-*`-only palette established by `groups-page-utils.ts`'s
 * `LEVEL_BADGE` (B3 fix) — `principiante` uses the `state-ok` success token,
 * `intermedio` reuses `cata-navy` (no dedicated "warning" hue exists in the
 * brand namespace), `avanzado` reuses the brand red. Keep these two maps in
 * sync; do not reintroduce plain Tailwind `green-*`/`amber-*` here.
 */
const NIVEL_BADGE_TOKENS: Record<string, string> = {
  Principiante: "bg-cata-state-ok/10 text-cata-state-ok",
  Intermedio: "bg-cata-navy/10 text-cata-navy",
  Avanzado: "bg-cata-red/15 text-cata-red",
};

/** Neutral fallback token for an unrecognized level label at runtime. */
const FALLBACK_NIVEL_BADGE_TOKENS = "bg-cata-border/40 text-cata-text/65";

/**
 * Get the light-theme badge color classes for a technical-level label.
 *
 * Returns a neutral fallback for unknown/unexpected labels — never throws,
 * avoids rendering an unstyled badge for bad runtime data.
 */
export function getLevelBadgeTokens(levelLabel: string): string {
  return NIVEL_BADGE_TOKENS[levelLabel] ?? FALLBACK_NIVEL_BADGE_TOKENS;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Assign a student to a group.
 *
 * If the student was assigned to a different group, they are removed from it
 * first. Returns the updated grupos array (immutable — no mutation).
 */
export function assignStudentToGroup(
  estudianteId: string,
  targetGrupoId: string,
  grupos: Grupo[],
): AssignmentResult {
  const targetIdx = grupos.findIndex((g) => g.id === targetGrupoId);
  if (targetIdx === -1) {
    return {
      updatedGrupos: grupos,
      success: false,
      message: `Grupo "${targetGrupoId}" no encontrado.`,
    };
  }

  // Student already in target?
  if (grupos[targetIdx].estudiantesIds.includes(estudianteId)) {
    return {
      updatedGrupos: grupos,
      success: false,
      message: "El estudiante ya pertenece a este grupo.",
    };
  }

  // Remove from all groups, add to target (immutable)
  const working = grupos.map((g) => ({
    ...g,
    estudiantesIds: g.estudiantesIds.filter((id) => id !== estudianteId),
  }));

  const updatedGrupos = working.map((g) =>
    g.id === targetGrupoId
      ? { ...g, estudiantesIds: [...g.estudiantesIds, estudianteId] }
      : g,
  );

  return {
    updatedGrupos,
    success: true,
    message: "Estudiante asignado al grupo correctamente.",
  };
}

/**
 * Remove a student from all groups.
 * Returns the updated grupos array (immutable).
 */
export function removeStudentFromAllGroups(
  estudianteId: string,
  grupos: Grupo[],
): Grupo[] {
  return grupos.map((g) => ({
    ...g,
    estudiantesIds: g.estudiantesIds.filter((id) => id !== estudianteId),
  }));
}

/**
 * Get all student references that belong to a specific group.
 */
export function getStudentsByGroup(
  grupo: Grupo,
  allStudents: StudentRef[],
): StudentRef[] {
  return allStudents.filter((s) => grupo.estudiantesIds.includes(s.id));
}

/**
 * Get all schedules linked to a group via horariosIds.
 */
export function getSchedulesByGroup(
  grupo: Grupo,
  schedules: ScheduleSlot[],
): ScheduleSlot[] {
  if (!grupo.horariosIds || grupo.horariosIds.length === 0) return [];
  return schedules.filter((s) => grupo.horariosIds!.includes(s.id));
}

/**
 * Find students not assigned to any group.
 *
 * NOTE: This function does NOT filter by `activo`. Inactive students ARE
 * included in the returned pool. If the caller wants to exclude inactive
 * students from assignment pools, they should pre-filter `allStudents`.
 */
export function getUnassignedStudents(
  allStudents: StudentRef[],
): StudentRef[] {
  return allStudents.filter((s) => !s.grupoId);
}

/**
 * Find students who ARE assigned to at least one group.
 *
 * NOTE: This function does NOT filter by `activo`. Inactive students with
 * a grupoId ARE included in the returned pool.
 */
export function getAssignedStudents(
  allStudents: StudentRef[],
): StudentRef[] {
  return allStudents.filter((s) => s.grupoId);
}

/**
 * Check capacity for a group using the minimum linked ACTIVE schedule cupoMaximo.
 *
 * A group roster attends EVERY linked schedule session (same students attend
 * all sessions), so effective capacity is the MINIMUM cupoMaximo across
 * linked ACTIVE schedules — not the sum. Inactive schedule slots should not
 * cap capacity because the group does not attend them.
 *
 * Returns { available, total, percent } where available < 0 means overbooked.
 */
export function getGroupCapacity(
  grupo: Grupo,
  schedules: ScheduleSlot[],
): { total: number; available: number; percent: number } {
  const groupSchedules = getSchedulesByGroup(grupo, schedules).filter(
    (s) => s.activo,
  );
  const total =
    groupSchedules.length > 0
      ? Math.min(...groupSchedules.map((s) => s.cupoMaximo))
      : 0;
  const assigned = grupo.estudiantesIds.length;
  const available = total - assigned;
  const percent = total > 0 ? Math.round((assigned / total) * 100) : 0;
  return { total, available, percent };
}

/**
 * Build group card data from raw data for the admin UI.
 */
export function buildGroupCards(
  grupos: Grupo[],
  schedules: ScheduleSlot[],
): GroupCardData[] {
  return grupos.map((grupo) => {
    const groupSchedules = getSchedulesByGroup(grupo, schedules);
    const { total, available, percent } = getGroupCapacity(grupo, schedules);

    return {
      id: grupo.id,
      name: grupo.nombre,
      level: grupo.nivel,
      levelLabel: getLevelLabel(grupo.nivel),
      studentCount: grupo.estudiantesIds.length,
      capacity: total,
      capacityPercent: percent,
      scheduleCount: groupSchedules.length,
      scheduleLabels: groupSchedules.map(
        (s) =>
          `${DIA_SEMANA_LABELS[s.diaSemana] ?? s.diaSemana} ${s.horaInicio} — ${s.horaFin}`,
      ),
    };
  });
}

/**
 * Derive training sessions from group + schedule data.
 *
 * This replaces the hardcoded AVAILABLE_SESSIONS in the trainer attendance
 * flow, tying session rosters to Grupo.estudiantesIds so the relationship is
 * explicit and tested.
 *
 * @param grupos — All groups with estudiantesIds linking them to students.
 * @param schedules — All schedule slots (Horario), keyed by id.
 * @param studentNameMap — A map of studentId → display name, built from
 *   the mock member accounts or any student list.
 * @param groupScheduleMap — A map of groupId → scheduleId[] if not using
 *   Grupo.horariosIds directly. When omitted, uses Grupo.horariosIds.
 * @returns Derived training sessions, one per (group, schedule) pair.
 */
export function buildTrainingSessions(
  grupos: Grupo[],
  schedules: ScheduleSlot[],
  studentNameMap: Record<string, string>,
  groupScheduleMap?: Record<string, string[]>,
): DerivedTrainingSession[] {
  const sessions: DerivedTrainingSession[] = [];
  let sessionCounter = 0;

  for (const grupo of grupos) {
    const scheduleIds =
      groupScheduleMap?.[grupo.id] ??
      grupo.horariosIds ??
      [];

    // Group schedules by (diaSemana, approximate time range) to create
    // meaningful session names. For mock simplicity, group by schedule.
    for (const horarioId of scheduleIds) {
      const schedule = schedules.find((s) => s.id === horarioId);
      if (!schedule || !schedule.activo) continue;

      sessionCounter++;
      const diaLabel = DIA_SEMANA_LABELS[schedule.diaSemana] ?? schedule.diaSemana;
      const shortDia = diaLabel.slice(0, 3); // "Lun", "Mar", etc.

      // Derive roster from grupo.estudiantesIds
      const students: SessionStudent[] = grupo.estudiantesIds.map((estudianteId) => ({
        id: estudianteId,
        name: studentNameMap[estudianteId] ?? `Estudiante ${estudianteId}`,
        attendance: "absent" as EstadoAsistencia,
      }));

      sessions.push({
        id: `s${sessionCounter}`,
        groupName: `${grupo.nombre} — ${shortDia}/${diaLabel}`,
        time: `${schedule.horaInicio} — ${schedule.horaFin}`,
        court: schedule.cancha,
        level: getLevelLabel(grupo.nivel),
        studentCount: students.length,
        students,
      });
    }
  }

  return sessions;
}

// ---------------------------------------------------------------------------
// Horario grouping (Gestión de Horarios UI fixes — PR2a)
// ---------------------------------------------------------------------------

/** Monday→Sunday order used to sort a `HorarioGroup`'s rows. */
const DIA_SEMANA_ORDER = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];

/** Composite grouping key: same categoria + horario + entrenador = same weekly schedule. */
function horarioGroupKey(h: Horario): string {
  return `${h.categoria}|${h.horaInicio}|${h.horaFin}|${h.entrenadorId}`;
}

/**
 * Group flat `Horario` rows (one per día) that share (categoria, horaInicio,
 * horaFin, entrenadorId) into a single `HorarioGroup`, collecting each row's
 * día into `rows`, sorted Monday→Sunday.
 *
 * Rows that differ in ANY of the 4 grouping fields land in separate groups
 * (e.g. a different entrenadorId), even if the rest match. A 5th segment
 * used to hash `nivelRankingId`, but the backend dropped that column
 * (migration `c4d5e6f7a8b9`) and never sends it, so it was a constant.
 */
export function groupHorarios(horarios: Horario[]): HorarioGroup[] {
  const groupsByKey = new Map<string, HorarioGroup>();

  for (const h of horarios) {
    const key = horarioGroupKey(h);
    let group = groupsByKey.get(key);
    if (!group) {
      group = {
        key,
        categoria: h.categoria,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        entrenadorId: h.entrenadorId,
        rows: [],
      };
      groupsByKey.set(key, group);
    }
    group.rows.push({ id: h.id, diaSemana: h.diaSemana });
  }

  for (const group of groupsByKey.values()) {
    group.rows.sort(
      (a, b) => DIA_SEMANA_ORDER.indexOf(a.diaSemana) - DIA_SEMANA_ORDER.indexOf(b.diaSemana),
    );
  }

  return Array.from(groupsByKey.values());
}

/** Result of diffing a `HorarioGroup`'s ticked días against its existing rows. */
export interface GroupSaveDiff {
  /** Días ticked in the checklist with no matching existing row — create a new row for each. */
  toCreate: string[];
  /** Ids of existing rows whose día is still ticked — update shared fields on each. */
  toUpdateIds: number[];
  /** Ids of existing rows whose día was unticked — delete each (after student safety check). */
  toDeleteIds: number[];
}

/**
 * Diff a `HorarioGroup`'s currently ticked días (`selectedDias`) against its
 * existing `rows` to determine which underlying `HorarioEntrenamiento` rows
 * must be created, updated (shared fields only, día unchanged) or deleted.
 *
 * A `group` with empty `rows` (e.g. creating a brand-new group) yields an
 * all-`toCreate` diff — every ticked día becomes a create.
 */
export function diffGroupSave(group: HorarioGroup, selectedDias: Set<string>): GroupSaveDiff {
  const existingByDia = new Map(group.rows.map((row) => [row.diaSemana, row.id]));

  const toCreate = DIA_SEMANA_ORDER.filter(
    (dia) => selectedDias.has(dia) && !existingByDia.has(dia),
  );
  const toUpdateIds = group.rows
    .filter((row) => selectedDias.has(row.diaSemana))
    .map((row) => row.id);
  const toDeleteIds = group.rows
    .filter((row) => !selectedDias.has(row.diaSemana))
    .map((row) => row.id);

  return { toCreate, toUpdateIds, toDeleteIds };
}
