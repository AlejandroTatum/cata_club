/**
 * The one rule for "who attended" (QA4 ADMA-34).
 *
 * Presente and tardanza count as attendance: whoever arrived late trained all
 * the same (the Asistencias donut says so in its «asisten» figure). Ausente,
 * enfermo and competencia do not — the last two are authorized absences, never
 * absences without notice, but nobody trained. The rate is taken over EVERY
 * record, so it reads the same wherever it is drawn.
 */

import type { EstadoAsistencia } from "@/types/domain";

const ATTENDED_STATES: readonly EstadoAsistencia[] = ["present", "late"];

export function countsAsAttended(estado: EstadoAsistencia): boolean {
  return ATTENDED_STATES.includes(estado);
}

/** Records that count as attendance in a per-state tally. Missing states count 0. */
export function attendedCount(counts: Partial<Record<EstadoAsistencia, number>>): number {
  return ATTENDED_STATES.reduce((sum, estado) => sum + (counts[estado] ?? 0), 0);
}

/** Rounded 0-100 share of attended records over all records. 0 (never NaN) when there are none. */
export function attendanceRatePercent(attended: number, total: number): number {
  return total > 0 ? Math.round((attended / total) * 100) : 0;
}
