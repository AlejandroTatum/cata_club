/**
 * Every way a trainer changes a mark on the open roster: the tap, the four
 * radio controls, the bulk "marcar restantes presentes", and the undo stack
 * behind all of them — plus the counts step 2 and step 3 both read off the
 * SAME roster (`confirmCounts`, `unreviewedCount`, `unmarkedCount`).
 *
 * Kept together because every one of these funnels through `commitStudents`,
 * which is also what keeps the draft in `sessionStorage` in sync — splitting
 * the counts out on their own would still need this same commit path.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import {
  countByState,
  countUnmarked,
  countUnreviewed,
  hasUnsavedAttendanceEdits,
  isReviewed,
  markRemainingPresent,
  saveAttendanceDraft,
  tapWizardAttendance,
  arrowAttendanceState,
  type SessionStudent,
} from "./attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";

/** One reversible marking action: the roster before it, and what it was. */
interface RosterUndoEntry {
  students: SessionStudent[];
  label: string;
}

/**
 * How many marking actions stay reversible. Deep enough to cover "I tapped
 * the wrong row three times in a row", shallow enough that a 40-student
 * roster never pins forty copies of itself in memory.
 */
const UNDO_DEPTH = 20;

const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

interface UseAttendanceMarkingArgs {
  students: SessionStudent[];
  setStudents: (updater: SessionStudent[] | ((prev: SessionStudent[]) => SessionStudent[])) => void;
  serverRoster: SessionStudent[];
  draftKey: string | null;
  confirmed: boolean;
  setRestoredFromDraft: (value: boolean) => void;
}

export interface AttendanceMarking {
  lastUndoable: RosterUndoEntry | null;
  handleUndo: () => void;
  handleDirectAttendanceSet: (studentIndex: number, state: EstadoAsistencia) => void;
  handleAttendanceRadioKeyDown: (
    e: React.KeyboardEvent<HTMLButtonElement>,
    studentIndex: number,
    state: EstadoAsistencia,
  ) => void;
  handleCycleAttendance: (studentIndex: number) => void;
  handleMarkRemainingPresent: () => void;
  searchFilter: string;
  setSearchFilter: (value: string) => void;
  onlyUnreviewed: boolean;
  setOnlyUnreviewed: (updater: boolean | ((prev: boolean) => boolean)) => void;
  filteredStudents: SessionStudent[];
  confirmCounts: Record<EstadoAsistencia, number>;
  unreviewedCount: number;
  unmarkedCount: number;
  reviewedCount: number;
  hasUnsavedMarks: boolean;
  resetMarking: () => void;
}

export function useAttendanceMarking({
  students,
  setStudents,
  serverRoster,
  draftKey,
  confirmed,
  setRestoredFromDraft,
}: UseAttendanceMarkingArgs): AttendanceMarking {
  const { showSuccess } = useToast();
  const [undoStack, setUndoStack] = useState<RosterUndoEntry[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);

  /**
   * Every path that changes a mark funnels through here — see the page's own
   * note for why the undo stack restores `reviewed` too, not just the value.
   */
  const commitStudents = useCallback(
    (next: SessionStudent[], undoLabel: string): void => {
      setUndoStack((stack) => {
        const grown = [...stack, { students, label: undoLabel }];
        return grown.length > UNDO_DEPTH ? grown.slice(grown.length - UNDO_DEPTH) : grown;
      });
      setStudents(next);
      setRestoredFromDraft(false);
      if (draftKey) saveAttendanceDraft(draftKey, next);
    },
    [draftKey, students, setStudents, setRestoredFromDraft],
  );

  const lastUndoable = undoStack[undoStack.length - 1] ?? null;

  const handleUndo = useCallback((): void => {
    if (!lastUndoable) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setStudents(lastUndoable.students);
    setRestoredFromDraft(false);
    if (draftKey) saveAttendanceDraft(draftKey, lastUndoable.students);
  }, [draftKey, lastUndoable, setStudents, setRestoredFromDraft]);

  const handleDirectAttendanceSet = useCallback(
    (studentIndex: number, state: EstadoAsistencia): void => {
      commitStudents(
        students.map((s, i) => (i === studentIndex ? { ...s, attendance: state, reviewed: true } : s)),
        `marcar a ${students[studentIndex]?.name ?? "un alumno"}`,
      );
    },
    [commitStudents, students],
  );

  const handleAttendanceRadioKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLButtonElement>,
      studentIndex: number,
      state: EstadoAsistencia,
    ): void => {
      if (
        e.key !== "ArrowRight" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp"
      ) {
        return;
      }
      e.preventDefault();
      const nextState = arrowAttendanceState(state, e.key);
      handleDirectAttendanceSet(studentIndex, nextState);
      const group = e.currentTarget.closest('[role="radiogroup"]');
      const next = group?.querySelector<HTMLButtonElement>(`[role="radio"][data-state="${nextState}"]`);
      next?.focus();
    },
    [handleDirectAttendanceSet],
  );

  const handleCycleAttendance = useCallback(
    (studentIndex: number): void => {
      commitStudents(
        students.map((s, i) =>
          i === studentIndex ? { ...s, attendance: tapWizardAttendance(s), reviewed: true } : s,
        ),
        `marcar a ${students[studentIndex]?.name ?? "un alumno"}`,
      );
    },
    [commitStudents, students],
  );

  const handleMarkRemainingPresent = useCallback((): void => {
    const affected = countUnreviewed(students);
    if (affected === 0) return;
    const previous = students;
    const depthBefore = undoStack.length;
    commitStudents(markRemainingPresent(students), "marcar restantes presentes");
    showSuccess(
      affected === 1 ? "1 alumno marcado presente" : `${affected} alumnos marcados presentes`,
      {
        description: "Quedaban sin revisar. Puede deshacerlo desde aquí.",
        action: {
          label: "Deshacer",
          onAction: () => {
            setUndoStack((stack) => stack.slice(0, depthBefore));
            setStudents(previous);
            setRestoredFromDraft(false);
            if (draftKey) saveAttendanceDraft(draftKey, previous);
          },
        },
      },
    );
  }, [
    commitStudents,
    draftKey,
    setStudents,
    setRestoredFromDraft,
    showSuccess,
    students,
    undoStack.length,
  ]);

  const filteredStudents = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q && !onlyUnreviewed) return students;
    return students.filter(
      (s) => (!q || s.name.toLowerCase().includes(q)) && (!onlyUnreviewed || !isReviewed(s)),
    );
  }, [students, searchFilter, onlyUnreviewed]);

  const confirmCounts = useMemo(
    () =>
      TOTAL_ORDER.reduce(
        (counts, state) => ({ ...counts, [state]: countByState(students, state) }),
        {} as Record<EstadoAsistencia, number>,
      ),
    [students],
  );
  const unreviewedCount = useMemo(() => countUnreviewed(students), [students]);
  const unmarkedCount = useMemo(() => countUnmarked(students), [students]);
  const reviewedCount = students.length - unreviewedCount;
  const hasUnsavedMarks = !confirmed && hasUnsavedAttendanceEdits(students, serverRoster);

  const resetMarking = useCallback((): void => {
    setUndoStack([]);
    setSearchFilter("");
    setOnlyUnreviewed(false);
  }, []);

  return {
    lastUndoable,
    handleUndo,
    handleDirectAttendanceSet,
    handleAttendanceRadioKeyDown,
    handleCycleAttendance,
    handleMarkRemainingPresent,
    searchFilter,
    setSearchFilter,
    onlyUnreviewed,
    setOnlyUnreviewed,
    filteredStudents,
    confirmCounts,
    unreviewedCount,
    unmarkedCount,
    reviewedCount,
    hasUnsavedMarks,
    resetMarking,
  };
}
