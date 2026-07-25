/**
 * Pure utility functions and configuration for the Gestion de Grupos admin page.
 *
 * Extracted from page.tsx for testability — no React dependencies.
 * Pure functions for business logic, config maps for UI constants.
 */

import type { Grupo } from "@/types/domain";
import type { StudentRef, GroupCardData, HorarioGroup } from "@/lib/groups-utils";
import { getLevelLabel } from "@/lib/groups-utils";
import type { AlumnoHorario, NivelConOcupacion } from "@/services/api";

// ---------------------------------------------------------------------------
// Delete-confirmation student count
// ---------------------------------------------------------------------------

/**
 * Count distinct students across the día rows pending deletion. A group
 * is stored as one `HorarioEntrenamiento` row per weekday, and a student
 * enrolled in the group is assigned to every one of those rows — so a
 * plain sum of `alumnos.length` across rows counts each student once per
 * weekday instead of once per student.
 */
export function countUniqueAlumnos(
  pendingDeletions: { alumnos: AlumnoHorario[] }[],
): number {
  const personaIds = new Set<number>();
  for (const pending of pendingDeletions) {
    for (const alumno of pending.alumnos) {
      personaIds.add(alumno.personaId);
    }
  }
  return personaIds.size;
}

// ---------------------------------------------------------------------------
// Student group resolution
// ---------------------------------------------------------------------------

/**
 * Find which group a student belongs to, based on current grupos state.
 */
export function findStudentGroupId(
  studentId: string,
  grupos: Grupo[],
): string | null {
  for (const g of grupos) {
    if (g.estudiantesIds.includes(studentId)) return g.id;
  }
  return null;
}

/**
 * Build a flattened list of student references from member accounts,
 * deriving each student's current grupoId from the grupos state rather
 * than from static data. This keeps the unassigned list in sync with
 * actual group assignments.
 */
export function buildStudentRefs(
  grupos: Grupo[],
  memberAccounts: ReadonlyArray<{ estudiantes: ReadonlyArray<{ id: string; nombres: string; apellidos: string; activo: boolean }> }>,
): StudentRef[] {
  const refs: StudentRef[] = [];
  for (const account of memberAccounts) {
    for (const estudiante of account.estudiantes) {
      const grupoId = findStudentGroupId(estudiante.id, grupos);
      refs.push({
        id: estudiante.id,
        nombres: estudiante.nombres,
        apellidos: estudiante.apellidos,
        grupoId,
        activo: estudiante.activo,
      });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Level badge configuration
// ---------------------------------------------------------------------------

/**
 * CSS class sets for each technical level badge — B3 fix: `cata-*` brand
 * tokens only, no hardcoded hex/rgba. `principiante` reuses the `state-ok`
 * success token; `avanzado` reuses the brand red. There is no dedicated
 * "warning" hue declared in the `cata-*` namespace (same gap noted for the
 * Fase 1 demo-role chips), so `intermedio` reuses `cata-navy` as the third
 * distinct brand hue available, distinguished from the other two levels by
 * hue alone (red/green/navy are visually distinct).
 */
export const LEVEL_BADGE: Record<string, string> = {
  principiante: "bg-cata-state-ok/10 text-cata-state-ok ring-1 ring-cata-state-ok/30",
  intermedio: "bg-cata-navy/10 text-cata-navy ring-1 ring-cata-navy/20",
  avanzado: "bg-cata-red/10 text-cata-red ring-1 ring-cata-red/30",
};

/**
 * Get the CSS class for a level badge, with a fallback for unknown levels.
 */
export function getLevelBadgeClass(level: string): string {
  return LEVEL_BADGE[level] ?? "bg-cata-warm text-cata-gray";
}

// ---------------------------------------------------------------------------
// Capacity bar configuration
// ---------------------------------------------------------------------------

/** Thresholds for capacity bar color, as [minPercent, colorClass] tuples.
 *  Checked in descending order — the first matching threshold wins. */
const CAPACITY_THRESHOLDS: Array<{ min: number; color: string }> = [
  { min: 90, color: "bg-red-500" },
  { min: 70, color: "bg-amber-500" },
  { min: 0, color: "bg-emerald-500" },
];

/**
 * Get the Tailwind color class for a capacity bar based on the usage percent.
 *
 *   - >= 90%: red (over capacity)
 *   - >= 70%: amber (near capacity)
 *   - < 70%:  emerald (healthy)
 */
export function getCapacityBarColor(percent: number): string {
  for (const threshold of CAPACITY_THRESHOLDS) {
    if (percent >= threshold.min) return threshold.color;
  }
  return "bg-emerald-500";
}

// ---------------------------------------------------------------------------
// NivelRanking → Grupo adapter (Fase 4)
// ---------------------------------------------------------------------------

/**
 * Map a real `NivelRanking` (backend's "Grupo" — see ranking_schemas.py's
 * module docstring) into the frontend `Grupo` domain shape. `estudiantesIds`
 * is left empty here — occupancy/roster comes from a separate call
 * (`GET /ranking/niveles/{id}/tabla`, already proxied at
 * /api/ranking/niveles/[id]/tabla) since `NivelRankingConOcupacionDTO` only
 * carries counts, not the member list.
 *
 * `horariosIds` is always empty and `activo` always `true`: the backend has
 * no schedule↔nivel link (documented gap, see attendance-adapter.ts) and no
 * `activo` flag on `NivelRanking` — not fabricated, just absent.
 */
export function nivelToGrupo(nivel: NivelConOcupacion): Grupo {
  return {
    id: String(nivel.id),
    nombre: nivel.nombre ?? `Nivel ${nivel.numeroNivel}`,
    nivel: nivel.nivelCategoria,
    estudiantesIds: [],
    horariosIds: [],
    activo: true,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Build `GroupCardData` directly from real occupancy data
 * (`capacidadMaxima`/`personasActuales`) instead of the mock-era
 * schedule-derived capacity (`getGroupCapacity` in lib/groups-utils.ts,
 * which needs a schedule↔nivel link that doesn't exist in the real API —
 * see the gap noted on `nivelToGrupo` above). `scheduleCount`/
 * `scheduleLabels` are always empty for the same reason.
 */
export function buildGroupCardsFromNiveles(niveles: NivelConOcupacion[]): GroupCardData[] {
  return niveles.map((nivel) => ({
    id: String(nivel.id),
    name: nivel.nombre ?? `Nivel ${nivel.numeroNivel}`,
    level: nivel.nivelCategoria,
    levelLabel: getLevelLabel(nivel.nivelCategoria),
    studentCount: nivel.personasActuales,
    capacity: nivel.capacidadMaxima,
    capacityPercent: nivel.capacidadMaxima > 0 ? Math.round((nivel.personasActuales / nivel.capacidadMaxima) * 100) : 0,
    scheduleCount: 0,
    scheduleLabels: [],
  }));
}

// ---------------------------------------------------------------------------
// Día slots — one card per weekday session (`docs/ux/prototipos/14-horarios.html`)
// ---------------------------------------------------------------------------

/**
 * The grid used to render one card per `HorarioGroup` — a recurring weekly
 * schedule collapsed into a single card carrying "Lun · Mié · Vie" badges.
 * The approved prototype shows the opposite: one card per weekday session
 * ("Lunes 15:00 — 16:00"), all of them visible at once, filterable by day.
 * You cannot filter a merged card down to a single day without lying about
 * what it represents, so the display unit is now the individual `Horario` row.
 *
 * The GROUP is still the editing unit: the edit form manages a group's whole
 * día-set at once and enrollment is group-wide (a student belongs to every día
 * of the grupo, never to one loose weekday). `groupKey` is the link back.
 */
export interface HorarioSlot {
  id: number;
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
  categoria: string;
  entrenadorId: number;
  /** `HorarioGroup.key` of the recurring schedule this session belongs to. */
  groupKey: string;
}

/** Weekday display order. Sábado/Domingo last, as the club reads a week. */
export const DIA_ORDER = [
  "LUNES",
  "MARTES",
  "MIERCOLES",
  "JUEVES",
  "VIERNES",
  "SABADO",
  "DOMINGO",
] as const;

/** Sentinel for "no day filter applied". */
export const DIA_FILTER_ALL = "TODOS";

/**
 * Flatten día-groups back into one slot per weekday session, ordered by day
 * and then by start time — reading order matches how a week is read.
 *
 * Takes the groups rather than the raw `Horario[]` so every slot can carry the
 * `groupKey` its edit/roster actions need, without re-deriving the grouping.
 */
export function buildHorarioSlots(groups: HorarioGroup[]): HorarioSlot[] {
  const slots: HorarioSlot[] = [];
  for (const group of groups) {
    for (const row of group.rows) {
      slots.push({
        id: row.id,
        diaSemana: row.diaSemana,
        horaInicio: group.horaInicio,
        horaFin: group.horaFin,
        categoria: group.categoria,
        entrenadorId: group.entrenadorId,
        groupKey: group.key,
      });
    }
  }
  return slots.sort((a, b) => {
    const dayDelta = DIA_ORDER.indexOf(a.diaSemana as (typeof DIA_ORDER)[number]) -
      DIA_ORDER.indexOf(b.diaSemana as (typeof DIA_ORDER)[number]);
    if (dayDelta !== 0) return dayDelta;
    return a.horaInicio.localeCompare(b.horaInicio);
  });
}

/** Slots for one weekday, or all of them for `DIA_FILTER_ALL`. */
export function filterSlotsByDia(slots: HorarioSlot[], dia: string): HorarioSlot[] {
  if (dia === DIA_FILTER_ALL) return slots;
  return slots.filter((slot) => slot.diaSemana === dia);
}

/** How many sessions fall on each weekday — feeds the filter pills' counts. */
export function countSlotsByDia(slots: HorarioSlot[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of slots) {
    counts[slot.diaSemana] = (counts[slot.diaSemana] ?? 0) + 1;
  }
  return counts;
}
