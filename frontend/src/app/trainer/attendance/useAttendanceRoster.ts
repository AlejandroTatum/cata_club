/**
 * The roll call's own session: which step the wizard is on, whose roster is
 * loaded, and the one entrance every path into it shares — `openRoster`.
 *
 * `serverRosterRef` is a ref rather than state on purpose: it only ever
 * changes alongside `students` itself (inside `openRoster`/`resetRoster`), so
 * it needs no render of its own — see `hasUnsavedAttendanceEdits` in
 * `attendance-utils.ts` for what it is FOR.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import {
  applyAttendanceDraft,
  attendanceDraftKey,
  buildRosterFromAlumnoHorarios,
  countUnreviewed,
  loadAttendanceDraft,
  type SessionStudent,
  type WizardStep,
} from "./attendance-utils";
import { fetchAlumnosPorHorario, fetchAttendanceRecords } from "@/services/api";
import { clubIsoDate } from "@/lib/club-date";

export interface AttendanceRoster {
  step: WizardStep;
  setStep: (step: WizardStep) => void;
  students: SessionStudent[];
  setStudents: (updater: SessionStudent[] | ((prev: SessionStudent[]) => SessionStudent[])) => void;
  serverRosterRef: React.MutableRefObject<SessionStudent[]>;
  rosterLoading: boolean;
  rosterError: string | null;
  sessionDate: string | null;
  requestedDate: string | null;
  restoredFromDraft: boolean;
  setRestoredFromDraft: (value: boolean) => void;
  /** Issue #389: at least one record already exists for this (horario, fecha) — closed for everyone. */
  sessionAlreadyRegistered: boolean;
  readOnly: boolean;
  /**
   * Load a horario's roster and land on `target` — see the page's own note
   * for why every entrance to the roll call funnels through here.
   */
  openRoster: (
    horarioId: number,
    requestedDate: string | null,
    target: Exclude<WizardStep, "select-session">,
    onLoaded: (horarioId: number, requestedDate: string | null, target: WizardStep) => void,
  ) => Promise<boolean>;
  resetRoster: () => void;
}

export function useAttendanceRoster(): AttendanceRoster {
  const [step, setStep] = useState<WizardStep>("select-session");
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [students, setStudents] = useState<SessionStudent[]>([]);
  const serverRosterRef = useRef<SessionStudent[]>([]);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const [sessionAlreadyRegistered, setSessionAlreadyRegistered] = useState(false);

  const openRoster = useCallback(
    async (
      horarioId: number,
      requestedDateArg: string | null,
      target: Exclude<WizardStep, "select-session">,
      onLoaded: (horarioId: number, requestedDate: string | null, target: WizardStep) => void,
    ): Promise<boolean> => {
      setRosterLoading(true);
      setRosterError(null);
      try {
        const fecha = requestedDateArg ?? clubIsoDate();
        const [alumnoHorarios, existingRecords] = await Promise.all([
          fetchAlumnosPorHorario(horarioId),
          fetchAttendanceRecords({ fechaInicio: fecha, fechaFin: fecha, horarioId }).catch(
            (err: unknown) => {
              console.error("[trainer/attendance] fetchAttendanceRecords prefill failed", err);
              return [];
            },
          ),
        ]);

        const roster = buildRosterFromAlumnoHorarios(alumnoHorarios, existingRecords);
        serverRosterRef.current = roster;
        const draft = loadAttendanceDraft(attendanceDraftKey(horarioId, fecha));
        const withDraft = applyAttendanceDraft(roster, draft);

        setSessionAlreadyRegistered(existingRecords.length > 0);
        setSessionDate(fecha);
        setRequestedDate(requestedDateArg);
        setRestoredFromDraft(
          withDraft !== roster && countUnreviewed(withDraft) < countUnreviewed(roster),
        );
        setStudents(withDraft);
        setStep(target);
        onLoaded(horarioId, requestedDateArg, target);
        return true;
      } catch (err) {
        console.error("[trainer/attendance] fetchAlumnosPorHorario failed", err);
        setRosterError(
          "No se pudo cargar el listado de estudiantes de este horario. Revise su conexión e intente nuevamente.",
        );
        return false;
      } finally {
        setRosterLoading(false);
      }
    },
    [],
  );

  const resetRoster = useCallback((): void => {
    setStep("select-session");
    setSessionDate(null);
    setRequestedDate(null);
    setRestoredFromDraft(false);
    setStudents([]);
    serverRosterRef.current = [];
    setSessionAlreadyRegistered(false);
  }, []);

  return {
    step,
    setStep,
    students,
    setStudents,
    serverRosterRef,
    rosterLoading,
    rosterError,
    sessionDate,
    requestedDate,
    restoredFromDraft,
    setRestoredFromDraft,
    sessionAlreadyRegistered,
    readOnly: sessionAlreadyRegistered,
    openRoster,
    resetRoster,
  };
}
