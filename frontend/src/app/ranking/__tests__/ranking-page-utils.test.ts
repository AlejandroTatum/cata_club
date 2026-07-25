/**
 * Unit tests for the Niveles ladder's pure helpers.
 */

import { describe, it, expect } from "vitest";
import type { NivelStudentRef } from "@/app/trainer/nivel/nivel-utils";
import {
  searchStudents,
  sortStudentsByName,
  studentFullName,
  unassignedStudents,
} from "../ranking-page-utils";

function student(
  id: string,
  nombres: string,
  apellidos: string,
  nivelRankingId: number | null,
): NivelStudentRef {
  return { id, nombres, apellidos, activo: true, nivelRankingId };
}

const ROSTER: NivelStudentRef[] = [
  student("1", "Juan", "Pérez", 3),
  student("2", "Ana", "Castro", 1),
  student("3", "Juan Carlos", "Andrade", null),
  student("4", "Elena", "Bermúdez", null),
  student("5", "Luis", "Álvarez", 3),
];

describe("studentFullName", () => {
  it("reads nombres then apellidos, the way the club says a name", () => {
    expect(studentFullName(ROSTER[0])).toBe("Juan Pérez");
  });
});

describe("sortStudentsByName", () => {
  it("orders by surname first, so a roster reads like a class list", () => {
    expect(sortStudentsByName(ROSTER).map((s) => s.apellidos)).toEqual([
      "Álvarez",
      "Andrade",
      "Bermúdez",
      "Castro",
      "Pérez",
    ]);
  });

  it("does not mutate the list it was given", () => {
    const original = [...ROSTER];
    sortStudentsByName(ROSTER);
    expect(ROSTER).toEqual(original);
  });
});

describe("searchStudents", () => {
  it("finds a student by first name", () => {
    expect(searchStudents(ROSTER, "juan").map(studentFullName)).toEqual([
      "Juan Carlos Andrade",
      "Juan Pérez",
    ]);
  });

  it("finds a student by surname", () => {
    expect(searchStudents(ROSTER, "castro").map(studentFullName)).toEqual(["Ana Castro"]);
  });

  it("ignores accents, so 'perez' finds Pérez", () => {
    expect(searchStudents(ROSTER, "perez").map(studentFullName)).toEqual(["Juan Pérez"]);
  });

  it("matches across the whole name, not just its start", () => {
    expect(searchStudents(ROSTER, "carlos and").map(studentFullName)).toEqual([
      "Juan Carlos Andrade",
    ]);
  });

  it("matches nobody for an empty or whitespace term — 'no search' is not 'everyone'", () => {
    expect(searchStudents(ROSTER, "")).toEqual([]);
    expect(searchStudents(ROSTER, "   ")).toEqual([]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchStudents(ROSTER, "zzz")).toEqual([]);
  });

  it("finds unassigned students too — they are the ones being looked for", () => {
    expect(searchStudents(ROSTER, "elena").map((s) => s.nivelRankingId)).toEqual([null]);
  });
});

describe("unassignedStudents", () => {
  it("returns only the students with no level, surname-ordered", () => {
    expect(unassignedStudents(ROSTER).map(studentFullName)).toEqual([
      "Juan Carlos Andrade",
      "Elena Bermúdez",
    ]);
  });

  it("returns an empty list when everyone is placed", () => {
    expect(unassignedStudents(ROSTER.filter((s) => s.nivelRankingId !== null))).toEqual([]);
  });
});
