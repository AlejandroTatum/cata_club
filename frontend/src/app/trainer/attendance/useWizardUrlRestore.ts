/**
 * Reading the wizard's address back: on arrival, and on every Back/Forward.
 *
 * A horario the URL names but the schedules list does not have (deleted, or
 * hand-typed) falls back to the picker rather than to a roll call for
 * nobody — see `TrainerAttendancePage`'s own note on `openRoster`.
 */

"use client";

import { useEffect, useState } from "react";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { parseWizardQuery, type SessionStudent, type WizardLocation, type WizardStep } from "./attendance-utils";

interface UseWizardUrlRestoreArgs {
  schedules: TrainingSchedule[];
  loading: boolean;
  loadError: string | null;
  confirmed: boolean;
  selectedScheduleId: number | null;
  requestedDate: string | null;
  students: SessionStudent[];
  setSelectedScheduleId: (id: number | null) => void;
  setStep: (step: WizardStep) => void;
  ownedHistoryEntries: React.MutableRefObject<number>;
  writeWizardUrl: (
    horarioId: number | null,
    fecha: string | null,
    target: WizardStep,
    mode: "push" | "replace",
  ) => void;
  openRoster: (
    horarioId: number,
    requestedDate: string | null,
    target: Exclude<WizardStep, "select-session">,
    onLoaded: (horarioId: number, requestedDate: string | null, target: WizardStep) => void,
  ) => Promise<boolean>;
}

export function useWizardUrlRestore({
  schedules,
  loading,
  loadError,
  confirmed,
  selectedScheduleId,
  requestedDate,
  students,
  setSelectedScheduleId,
  setStep,
  ownedHistoryEntries,
  writeWizardUrl,
  openRoster,
}: UseWizardUrlRestoreArgs): void {
  const [pendingRestore, setPendingRestore] = useState<WizardLocation | null>(null);

  /** Restore the position the URL asks for once the schedules it refers to are loaded. */
  useEffect(() => {
    if (!pendingRestore || loading || loadError) return;
    const { horarioId, fecha, step: target } = pendingRestore;
    setPendingRestore(null);
    if (horarioId === null || target === "select-session") return;
    if (!schedules.some((s) => s.id === horarioId)) {
      writeWizardUrl(null, null, "select-session", "replace");
      return;
    }
    setSelectedScheduleId(horarioId);
    void openRoster(horarioId, fecha, target, (h, d, t) => writeWizardUrl(h, d, t, "replace"));
  }, [
    pendingRestore,
    loading,
    loadError,
    schedules,
    openRoster,
    writeWizardUrl,
    setSelectedScheduleId,
  ]);

  /** The Back button's own arrival read — a client-only fact, read after mount. */
  useEffect(() => {
    const entry = parseWizardQuery(window.location.search);
    if (entry.step !== "select-session") setPendingRestore(entry);
  }, []);

  useEffect(() => {
    function handlePopState(): void {
      // A filed session is not a step anyone can walk back into.
      if (confirmed) return;
      ownedHistoryEntries.current = Math.max(0, ownedHistoryEntries.current - 1);
      const entry = parseWizardQuery(window.location.search);
      if (entry.step === "select-session" || entry.horarioId === null) {
        setStep("select-session");
        return;
      }
      if (
        entry.horarioId === selectedScheduleId &&
        entry.fecha === requestedDate &&
        students.length > 0
      ) {
        setStep(entry.step);
        return;
      }
      setPendingRestore(entry);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [confirmed, selectedScheduleId, requestedDate, students.length, setStep, ownedHistoryEntries]);
}
