/**
 * Pure utility functions and configuration for the Gestion de Grupos admin page.
 *
 * Extracted from page.tsx for testability — no React dependencies.
 * Pure functions for business logic, config maps for UI constants.
 */

import type { Grupo } from "@/types/domain";
import type {
  StudentRef,
  GroupCardData,
  HorarioGroup,
  HorarioGroupRow,
} from "@/lib/groups-utils";
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
// Categoría cards — one card per training group, not per categoría × weekday
// ---------------------------------------------------------------------------

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

/** Full weekday names, for every user-facing day label on this screen. */
export const DIA_LABELS: Record<string, string> = {
  LUNES: "Lunes",
  MARTES: "Martes",
  MIERCOLES: "Miércoles",
  JUEVES: "Jueves",
  VIERNES: "Viernes",
  SABADO: "Sábado",
  DOMINGO: "Domingo",
};

/** The Monday–Friday block the club's five business categorías are built on. */
const WEEKDAYS: readonly string[] = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"];

function diaIndex(dia: string): number {
  const index = DIA_ORDER.indexOf(dia as (typeof DIA_ORDER)[number]);
  return index === -1 ? DIA_ORDER.length : index;
}

/**
 * One training group as the club talks about it: a categoría that meets at a
 * fixed time on a set of weekdays.
 *
 * The backend stores one `HorarioEntrenamiento` row per categoría × weekday and
 * derives `hora_inicio`/`hora_fin` from `CATEGORIA_METADATA`, so a five-weekday
 * categoría is five rows describing ONE group with ONE roster. Rendering a card
 * per row produced twenty-six near-identical cards for five real groups; the
 * card is the categoría now, and the rows it is made of stay reachable through
 * `groups` (editing) and `rows` (roster/enrollment).
 */
export interface CategoriaCard {
  /** Raw backend `categoria` value — the card's identity and React key. */
  categoria: string;
  horaInicio: string;
  horaFin: string;
  /** Every weekday the categoría runs on, in week order, deduplicated. */
  dias: string[];
  /**
   * The editable units. With the trainer–schedule relation gone (issue #13)
   * a categoría's rows can only disagree on hora, so in practice this holds
   * one group per categoría.
   */
  groups: HorarioGroup[];
  /** Every underlying `HorarioEntrenamiento` row of the categoría, in week order. */
  rows: HorarioGroupRow[];
}

/**
 * Collapse día-groups into one card per categoría, ordered by start time —
 * which is also how the club's afternoon runs (Formativo 15:00 → Adultos 20:00).
 */
export function buildCategoriaCards(groups: HorarioGroup[]): CategoriaCard[] {
  const byCategoria = new Map<string, CategoriaCard>();

  for (const group of groups) {
    let card = byCategoria.get(group.categoria);
    if (!card) {
      card = {
        categoria: group.categoria,
        horaInicio: group.horaInicio,
        horaFin: group.horaFin,
        dias: [],
        groups: [],
        rows: [],
      };
      byCategoria.set(group.categoria, card);
    }
    card.groups.push(group);
    card.rows.push(...group.rows);
  }

  const cards = Array.from(byCategoria.values());
  for (const card of cards) {
    card.rows.sort((a, b) => diaIndex(a.diaSemana) - diaIndex(b.diaSemana));
    card.dias = Array.from(new Set(card.rows.map((row) => row.diaSemana)));
  }

  return cards.sort(
    (a, b) => a.horaInicio.localeCompare(b.horaInicio) || a.categoria.localeCompare(b.categoria),
  );
}

/**
 * Say what a day set actually is, derived from the rows rather than assumed.
 *
 * "Lunes a viernes" is the club's normal case, but the live data holds a
 * Saturday `COMPETITIVO` row, and a categoría whose rows drift away from the
 * week must read as the exception it is instead of being rounded to the norm.
 */
export function formatDiaSet(dias: string[]): string {
  const present = new Set(dias);
  const ordered = DIA_ORDER.filter((dia) => present.has(dia));

  if (ordered.length === 0) return "Sin días asignados";

  if (WEEKDAYS.every((dia) => present.has(dia))) {
    const extras = ordered
      .filter((dia) => !WEEKDAYS.includes(dia))
      .map((dia) => DIA_LABELS[dia].toLowerCase());
    if (extras.length === 0) return "Lunes a viernes";
    return `Lunes a viernes + ${joinWithY(extras)}`;
  }

  const labels = ordered.map((dia, index) =>
    index === 0 ? DIA_LABELS[dia] : DIA_LABELS[dia].toLowerCase(),
  );
  return joinWithY(labels);
}

/** "a, b y c" — the Spanish list separator, no Oxford comma. */
function joinWithY(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/**
 * The weekday track a categoría is read against, in week order.
 *
 * The row shows the whole week a group MAY meet (`CATEGORIA_METADATA.dias` —
 * Lunes a viernes for four of the five categorías, plus Sábado for
 * Competitivo) and marks the días it actually runs, so "Competitivo also
 * trains on Saturday" and "these rows skip Martes" are both readable at a
 * glance instead of only in prose.
 *
 * It is a union, not just the allowed set: a categoría whose rows drift
 * outside their allowed días (or one with no metadata at all, like an
 * unrecognized `categoria` value) must still show every día it really uses
 * rather than dropping it off the end of the track.
 */
export function buildDiaTrack(
  permitidos: readonly string[],
  dias: readonly string[],
): string[] {
  const present = new Set([...permitidos, ...dias]);
  return DIA_ORDER.filter((dia) => present.has(dia));
}

/**
 * Roster person-ids per `Horario.id`. A row absent from the map is a request
 * that never answered — not an empty roster.
 */
export type PersonasPorHorario = Record<number, readonly number[]>;

/**
 * How many distinct students the categoría has, counting a student once no
 * matter how many of its weekdays they are enrolled in.
 *
 * `null` when any of the categoría's rows has no roster yet: this figure is the
 * one the club plans around, so an undercount is worse than no number at all.
 */
export function countInscriptos(
  rows: readonly HorarioGroupRow[],
  personas: PersonasPorHorario,
): number | null {
  const distinct = new Set<number>();
  for (const row of rows) {
    const roster = personas[row.id];
    if (roster === undefined) return null;
    for (const personaId of roster) distinct.add(personaId);
  }
  return distinct.size;
}

/**
 * How many of the categoría's students are missing from at least one of its
 * weekdays — the club's own data has one such case (a Formativo student
 * enrolled on Monday only), and a single headcount would hide it.
 *
 * 0 while any roster is still missing: an incomplete picture must not report
 * an anomaly it cannot yet see.
 */
export function countInscriptosParciales(
  rows: readonly HorarioGroupRow[],
  personas: PersonasPorHorario,
): number {
  const rosters: ReadonlySet<number>[] = [];
  for (const row of rows) {
    const roster = personas[row.id];
    if (roster === undefined) return 0;
    rosters.push(new Set(roster));
  }
  if (rosters.length === 0) return 0;

  const distinct = new Set<number>(rosters.flatMap((roster) => Array.from(roster)));
  let parciales = 0;
  for (const personaId of distinct) {
    if (!rosters.every((roster) => roster.has(personaId))) parciales++;
  }
  return parciales;
}
