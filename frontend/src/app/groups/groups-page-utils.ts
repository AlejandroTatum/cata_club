/**
 * Pure utility functions and configuration for the Gestion de Grupos admin page.
 *
 * Extracted from page.tsx for testability — no React dependencies.
 * Pure functions for business logic, config maps for UI constants.
 */

import type { HorarioGroup, HorarioGroupRow } from "@/lib/groups-utils";
import type { AlumnoHorario } from "@/services/api";

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
