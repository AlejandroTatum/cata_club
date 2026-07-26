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
 * Build the nivel student list from the lightweight alumnos-con-nivel
 * endpoint (`fetchAlumnosConNivel`), accessible to both admin and trainer.
 *
 * This is the single roster source for both nivel screens: the trainer panel
 * (`/trainer/nivel`) and the admin ladder (`/ranking`). It replaced
 * `fetchMembers()`, whose route depends on the ADMINISTRADOR-only
 * `GET /personas/` — a trainer opening `/trainer/nivel` got a real 403.
 *
 * The backend already restricts the roster to people holding the ALUMNO role,
 * so a parent who merely enrolled a child never appears here. The `activo`
 * flag is not part of this payload and defaults to `true`: the nivel screens
 * assign and move levels, they do not filter by estado.
 */
export function buildNivelStudentsFromAlumnos(
  alumnos: ReadonlyArray<{
    personaId: number;
    nombres: string;
    apellidos: string;
    nivelRankingId: number | null;
  }>,
): NivelStudentRef[] {
  return alumnos.map((a) => ({
    id: String(a.personaId),
    nombres: a.nombres,
    apellidos: a.apellidos,
    activo: true,
    nivelRankingId: a.nivelRankingId,
  }));
}
