/**
 * Group management pure helpers for Cata Club.
 *
 * These are the canonical helpers for building `Horario` grouping/diffing
 * views for the /groups admin page.
 *
 * No React dependencies — pure functions for testability.
 */

import type { Horario } from "@/services/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A lightweight student reference for group operations. */
export interface StudentRef {
  id: string;
  nombres: string;
  apellidos: string;
  activo: boolean;
}

/** One underlying `HorarioEntrenamiento` row (a single día) inside a `HorarioGroup`. */
export interface HorarioGroupRow {
  id: number;
  diaSemana: string;
}

/**
 * A visual grouping of `Horario` rows that share categoria, horaInicio and
 * horaFin — the "same weekly schedule, recurring on N días" case. Built by
 * `groupHorarios()`.
 */
export interface HorarioGroup {
  key: string;
  categoria: string;
  horaInicio: string;
  horaFin: string;
  rows: HorarioGroupRow[];
}

// ---------------------------------------------------------------------------
// Horario grouping (Gestión de Horarios UI fixes — PR2a)
// ---------------------------------------------------------------------------

/** Monday→Sunday order used to sort a `HorarioGroup`'s rows. */
const DIA_SEMANA_ORDER = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];

/** Composite grouping key: same categoria + horario = same weekly schedule. */
function horarioGroupKey(h: Horario): string {
  return `${h.categoria}|${h.horaInicio}|${h.horaFin}`;
}

/**
 * Group flat `Horario` rows (one per día) that share (categoria, horaInicio,
 * horaFin) into a single `HorarioGroup`, collecting each row's día into
 * `rows`, sorted Monday→Sunday.
 *
 * Rows that differ in ANY of the 3 grouping fields land in separate groups,
 * even if the rest match. A 4th segment used to hash `entrenadorId`, dropped
 * with the trainer–schedule relation (issue #13, migration `e7c3a1b9d5f2`);
 * a 5th used to hash `nivelRankingId`, dropped by migration `c4d5e6f7a8b9`.
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
