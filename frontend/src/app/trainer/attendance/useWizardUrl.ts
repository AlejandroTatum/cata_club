/**
 * The wizard's address: writing the step into the query string with the
 * History API, and the two moves that write it — Back and Next.
 *
 * `ownedHistoryEntries` counts history entries THIS wizard pushed, so `Back`
 * can tell "walk the real history" apart from "there is nothing of ours back
 * there, rewrite this entry instead" — see `handleBack`'s own note.
 */

"use client";

import { useCallback, useRef } from "react";
import { buildWizardQuery, WIZARD_STEP_ORDER as STEP_ORDER, type WizardStep } from "./attendance-utils";

export interface WizardUrl {
  writeWizardUrl: (
    horarioId: number | null,
    fecha: string | null,
    target: WizardStep,
    mode: "push" | "replace",
  ) => void;
  ownedHistoryEntries: React.MutableRefObject<number>;
  resetUrl: () => void;
  handleBack: (
    step: WizardStep,
    selectedScheduleId: number | null,
    requestedDate: string | null,
    setStep: (step: WizardStep) => void,
  ) => void;
  handleNext: (
    step: WizardStep,
    selectedScheduleId: number | null,
    requestedDate: string | null,
    setStep: (step: WizardStep) => void,
  ) => void;
}

export function useWizardUrl(): WizardUrl {
  const ownedHistoryEntries = useRef(0);

  const writeWizardUrl = useCallback(
    (
      horarioId: number | null,
      fecha: string | null,
      target: WizardStep,
      mode: "push" | "replace",
    ): void => {
      if (typeof window === "undefined") return;
      const url = `${window.location.pathname}${buildWizardQuery(horarioId, fecha, target)}`;
      if (mode === "push") {
        window.history.pushState(null, "", url);
        ownedHistoryEntries.current += 1;
        return;
      }
      window.history.replaceState(null, "", url);
    },
    [],
  );

  const resetUrl = useCallback((): void => {
    writeWizardUrl(null, null, "select-session", "replace");
    ownedHistoryEntries.current = 0;
  }, [writeWizardUrl]);

  const handleBack = useCallback(
    (
      step: WizardStep,
      selectedScheduleId: number | null,
      requestedDate: string | null,
      setStep: (step: WizardStep) => void,
    ): void => {
      const currentIndex = STEP_ORDER.indexOf(step);
      const previous = STEP_ORDER[currentIndex - 1];
      if (!previous) return;
      if (ownedHistoryEntries.current > 0) {
        window.history.back();
        return;
      }
      writeWizardUrl(selectedScheduleId, requestedDate, previous, "replace");
      setStep(previous);
    },
    [writeWizardUrl],
  );

  const handleNext = useCallback(
    (
      step: WizardStep,
      selectedScheduleId: number | null,
      requestedDate: string | null,
      setStep: (step: WizardStep) => void,
    ): void => {
      const currentIndex = STEP_ORDER.indexOf(step);
      const next = STEP_ORDER[currentIndex + 1];
      if (!next) return;
      setStep(next);
      writeWizardUrl(selectedScheduleId, requestedDate, next, "push");
    },
    [writeWizardUrl],
  );

  return { writeWizardUrl, ownedHistoryEntries, resetUrl, handleBack, handleNext };
}
