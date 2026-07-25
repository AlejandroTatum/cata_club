/**
 * Pure utility functions and configuration for the Nivel trainer page.
 *
 * Extracted from page.tsx for testability — no React dependencies. Not part
 * of the original file list in the ticket; added following this repo's
 * established page.tsx + page-utils.ts convention (see
 * src/app/groups/groups-page-utils.ts, src/app/attendance/attendance-utils.ts).
 *
 * The "nivel category" a student is assigned to IS the same `nivel_ranking`
 * record used by `NivelTecnico`/Grupo (src/app/groups/page.tsx) — the backend
 * has only one such table. There is no separate nivel-category taxonomy.
 */

import type { AlumnoParaNivel } from "@/services/api";

// ---------------------------------------------------------------------------
// Period ("YYYY-MM") validation and derivation
// ---------------------------------------------------------------------------

const PERIODO_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True when `value` matches the "YYYY-MM" nivel period format. */
export function isValidPeriodo(value: string): boolean {
  return PERIODO_PATTERN.test(value);
}

/** The current period ("YYYY-MM"), for defaulting form inputs. */
export function currentPeriodo(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Split a validated "YYYY-MM" period into its numeric año/mes parts for the backend. */
export function parsePeriodo(periodo: string): { anio: number; mes: number } {
  const [anio, mes] = periodo.split("-").map(Number);
  return { anio, mes };
}

// ---------------------------------------------------------------------------
// Student list derivation
// ---------------------------------------------------------------------------

/** A lightweight student reference for nivel operations. */
export interface NivelStudentRef {
  id: string;
  nombres: string;
  apellidos: string;
  activo: boolean;
  /** The student's current nivel_ranking id (null if not yet assigned). */
  nivelRankingId: number | null;
}

/**
 * Build the nivel student list from the roster returned by
 * `fetchAlumnosParaNivel()` (`GET /ranking/alumnos`).
 *
 * Previously derived from `fetchMembers()`, which a trainer cannot call — its
 * route depends on the ADMINISTRADOR-only `GET /personas/`, so
 * `/trainer/nivel` answered 403. See `AlumnoParaNivel` in src/services/api.ts.
 *
 * `/api/members` grouped people into accounts and listed an account's
 * children *instead of* its holder, which kept parents out of the student
 * list. The flat roster needs that rule stated explicitly: anyone who is
 * somebody else's `representanteId` is a parent, not a student.
 */
export function buildNivelStudents(
  roster: ReadonlyArray<AlumnoParaNivel>,
): NivelStudentRef[] {
  const representanteIds = new Set(
    roster
      .map((alumno) => alumno.representanteId)
      .filter((id): id is number => id !== null),
  );
  return roster
    .filter((alumno) => !representanteIds.has(alumno.personaId))
    .map((alumno) => ({
      id: String(alumno.personaId),
      nombres: alumno.nombres,
      apellidos: alumno.apellidos,
      activo: alumno.activo,
      nivelRankingId: alumno.nivelRankingId,
    }));
}
