/**
 * Filing the session and the receipt afterwards: submit, retry-the-failed,
 * and the counts the receipt archives with (`receiptCounts`/`receiptTotal`,
 * built from what actually SAVED, never from what the trainer marked — see
 * `buildAttendanceReceipt`'s own note).
 */

"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useToast, useToastState } from "@/contexts/ToastContext";
import {
  buildAttendanceReceipt,
  clearAttendanceDraft,
  countUnmarked,
  describeAttendanceSaveError,
  toAttendanceMarks,
  UNDO_TOAST_ACTION_LABEL,
  type SessionStudent,
  type WizardStep,
} from "./attendance-utils";
import { registerAttendance, type RegisterAttendanceResult } from "@/services/api";

const TOTAL_ORDER = ["present", "late", "sick", "competition", "absent"] as const;

interface UseAttendanceSubmissionArgs {
  selectedScheduleId: number | null;
  step: WizardStep;
  readOnly: boolean;
  students: SessionStudent[];
  sessionDate: string | null;
  requestedDate: string | null;
  draftKey: string | null;
  /** Shared with the roster hook's own load — the retry re-runs `openRoster`. */
  rosterLoading: boolean;
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

export interface AttendanceSubmission {
  submitting: boolean;
  submitError: string | null;
  confirmed: boolean;
  result: RegisterAttendanceResult | null;
  confirmedAt: Date | null;
  confirmationHeadingRef: React.RefObject<HTMLHeadingElement>;
  handleConfirm: (e: FormEvent<HTMLFormElement>) => Promise<void>;
  handleRetryFailed: () => Promise<void>;
  receiptCounts: Record<string, number>;
  receiptTotal: number;
  hasFailedRecords: boolean;
  retryButtonLabel: string;
  resetSubmission: () => void;
}

export function useAttendanceSubmission({
  selectedScheduleId,
  step,
  readOnly,
  students,
  sessionDate,
  requestedDate,
  draftKey,
  rosterLoading,
  writeWizardUrl,
  openRoster,
}: UseAttendanceSubmissionArgs): AttendanceSubmission {
  const { showError } = useToast();
  // ENT-12: the "Deshacer" offer of "marcar restantes presentes" must not outlive
  // the roll call. `showSuccess` hands back no id, so the live toasts are read
  // through a ref (a closure would see the list as of the last render).
  const { toasts, removeToast } = useToastState();
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RegisterAttendanceResult | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<Date | null>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  /**
   * ENT-05: set when a save failed and the roster could NOT be reloaded right
   * after. The save may have landed even though its answer was lost, so the
   * roster on screen is not trustworthy until it is reloaded — the next press
   * of "Confirmar" does that first instead of re-sending blind.
   */
  const rosterStale = useRef(false);

  // ENT-05: when the reload after a lost answer finds the list closed, the save
  // DID land — "No hay conexión" would contradict "ya fue registrada", so the
  // error is not surfaced at all. Derived (not cleared) so the order of the two
  // state updates cannot flash it.
  const visibleSubmitError = readOnly ? null : submitError;

  useEffect(() => {
    if (visibleSubmitError) showError(visibleSubmitError);
  }, [visibleSubmitError, showError]);

  useEffect(() => {
    if (confirmed) confirmationHeadingRef.current?.focus();
  }, [confirmed]);

  const handleConfirm = useCallback(
    async (e: FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      if (!selectedScheduleId) return;
      if (step !== "confirm") return;
      if (readOnly) return;
      // Never file a session carrying the `UNMARKED` sentinel —
      // `toAttendanceMarks` strips it, and this refuses the batch rather
      // than filing a short roster.
      if (countUnmarked(students) > 0) return;
      for (const toast of toastsRef.current) {
        if (toast.action?.label === UNDO_TOAST_ACTION_LABEL) removeToast(toast.id);
      }
      setSubmitting(true);
      setSubmitError(null);
      // Reload on the SAME step: the marks come back through the draft, and any
      // student the server already has a row for comes back filed.
      const reloadRoster = (): Promise<boolean> =>
        openRoster(selectedScheduleId, requestedDate, "confirm", (h, d, t) =>
          writeWizardUrl(h, d, t, "replace"),
        );
      if (rosterStale.current) {
        const reloaded = await reloadRoster();
        setSubmitting(false);
        if (reloaded) {
          rosterStale.current = false;
        } else {
          setSubmitError("No se pudo actualizar la lista. Revise su conexión e intente nuevamente.");
        }
        return;
      }
      try {
        const registration = await registerAttendance({
          horarioId: selectedScheduleId,
          fechaEntrenamiento: sessionDate ?? undefined,
          students: toAttendanceMarks(students),
        });
        setResult(registration);
        setConfirmedAt(new Date());
        setConfirmed(true);
        if (draftKey) clearAttendanceDraft(draftKey);
        writeWizardUrl(null, null, "select-session", "replace");
      } catch (err) {
        console.error("[trainer/attendance] registerAttendance failed", err);
        // ENT-05: the draft is KEPT. It used to be cleared here, which turned a
        // dropped connection into the loss of every mark — and the save might
        // have landed anyway. Reloading shows what the server actually has.
        rosterStale.current = !(await reloadRoster());
        setSubmitError(describeAttendanceSaveError(err));
      } finally {
        setSubmitting(false);
      }
    },
    [draftKey, openRoster, readOnly, removeToast, requestedDate, selectedScheduleId, sessionDate, step, students, writeWizardUrl],
  );

  const handleRetryFailed = useCallback(async (): Promise<void> => {
    if (selectedScheduleId === null) return;
    const opened = await openRoster(selectedScheduleId, requestedDate, "mark-attendance", (h, d, t) =>
      writeWizardUrl(h, d, t, "replace"),
    );
    if (!opened) return;
    setConfirmed(false);
    setResult(null);
    setConfirmedAt(null);
  }, [openRoster, requestedDate, selectedScheduleId, writeWizardUrl]);

  const receiptCounts = buildAttendanceReceipt(
    students,
    result?.failed.map((f) => f.personaId) ?? [],
  );
  const receiptTotal = TOTAL_ORDER.reduce((sum, state) => sum + receiptCounts[state], 0);
  const hasFailedRecords = (result?.failed.length ?? 0) > 0;
  const retryButtonLabel = (() => {
    if (rosterLoading) return "Reintentando…";
    const failedCount = result?.failed.length ?? 0;
    if (failedCount === 1) return "Reintentar con ese alumno";
    return `Reintentar con esos ${failedCount} alumnos`;
  })();

  const resetSubmission = useCallback((): void => {
    setConfirmed(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
    setConfirmedAt(null);
  }, []);

  return {
    submitting,
    submitError: visibleSubmitError,
    confirmed,
    result,
    confirmedAt,
    confirmationHeadingRef,
    handleConfirm,
    handleRetryFailed,
    receiptCounts,
    receiptTotal,
    hasFailedRecords,
    retryButtonLabel,
    resetSubmission,
  };
}
