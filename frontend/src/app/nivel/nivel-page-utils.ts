/**
 * Pure helpers for the Niveles ladder screen.
 *
 * Extracted from page.tsx for testability — no React dependencies, following
 * this repo's page.tsx + page-utils.ts convention (see
 * `src/app/groups/groups-page-utils.ts`).
 *
 * The screen's two real tasks are "where is Juan?" and "move Juan up a level",
 * and both are name lookups over a 67-student roster — so name matching, the
 * unassigned population and the roster ordering all live here.
 */

import { normalizeText } from "@/app/members/members-utils";
import type { NivelStudentRef } from "@/app/trainer/nivel/nivel-utils";

/** A student's display name, as the club writes it. */
export function studentFullName(student: NivelStudentRef): string {
  return `${student.nombres} ${student.apellidos}`.trim();
}

/** Surname-first ordering, so a roster reads like a class list. */
export function sortStudentsByName(
  students: readonly NivelStudentRef[],
): NivelStudentRef[] {
  return [...students].sort(
    (a, b) =>
      a.apellidos.localeCompare(b.apellidos, "es") ||
      a.nombres.localeCompare(b.nombres, "es"),
  );
}

/**
 * Students matching a free-text name search, accent- and case-insensitive.
 *
 * An empty (or whitespace-only) term matches NOBODY rather than everybody: the
 * results block only exists while a search is running, and "no term" is not a
 * request to list all 67 students.
 */
export function searchStudents(
  students: readonly NivelStudentRef[],
  term: string,
): NivelStudentRef[] {
  const needle = normalizeText(term.trim());
  if (needle === "") return [];
  return sortStudentsByName(
    students.filter((student) => normalizeText(studentFullName(student)).includes(needle)),
  );
}

/**
 * The students with no level yet — the actionable population of this screen,
 * and the one the previous design left invisible behind a "59 de 67" stat.
 */
export function unassignedStudents(
  students: readonly NivelStudentRef[],
): NivelStudentRef[] {
  return sortStudentsByName(students.filter((student) => student.nivelRankingId === null));
}

/**
 * The students already holding a level — one rung's roster.
 *
 * Derived from the SAME roster payload (`GET /ranking/alumnos-con-nivel`) that
 * feeds `unassignedStudents` and the ladder's headcounts. The other candidate
 * source, `personasActuales` on `GET /ranking/niveles`, disagrees with it by
 * one student in live data, so the screen never reads that field: a rung that
 * says "9 estudiantes" above eight names is a screen contradicting itself.
 */
export function studentsOnNivel(
  students: readonly NivelStudentRef[],
  nivelId: number,
): NivelStudentRef[] {
  return sortStudentsByName(students.filter((student) => student.nivelRankingId === nivelId));
}

/**
 * A name filter for an already-scoped list, accent- and case-insensitive.
 *
 * Unlike `searchStudents`, an empty term matches EVERYBODY: this filters a
 * column that exists whether or not anything was typed, rather than producing
 * a result set that only exists because a search is running.
 */
export function filterStudentsByName(
  students: readonly NivelStudentRef[],
  term: string,
): NivelStudentRef[] {
  const needle = normalizeText(term.trim());
  if (needle === "") return [...students];
  return students.filter((student) =>
    normalizeText(studentFullName(student)).includes(needle),
  );
}
