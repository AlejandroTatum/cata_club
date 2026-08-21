/**
 * Unfinished roll calls, read back from `sessionStorage` and OFFERED on the
 * picker rather than restored behind the trainer's back — see the page's own
 * note on why an offer, not an automatic resume.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDay } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { clubIsoDate } from "@/lib/club-date";
import {
  listAttendanceDrafts,
  type StoredAttendanceDraft,
  type WizardStep,
} from "./attendance-utils";

interface UseResumableDraftsArgs {
  schedules: TrainingSchedule[];
  confirmed: boolean;
  step: WizardStep;
  setSelectedScheduleId: (id: number | null) => void;
  openRoster: (
    horarioId: number,
    requestedDate: string | null,
    target: Exclude<WizardStep, "select-session">,
    onLoaded: (horarioId: number, requestedDate: string | null, target: WizardStep) => void,
  ) => Promise<boolean>;
  writeWizardUrl: (
    horarioId: number | null,
    fecha: string | null,
    target: WizardStep,
    mode: "push" | "replace",
  ) => void;
}

export interface ResumableDrafts {
  resumableDrafts: StoredAttendanceDraft[];
  refreshResumableDrafts: () => void;
  describeSchedule: (horarioId: number) => string;
  handleResumeDraft: (draft: StoredAttendanceDraft) => void;
}

export function useResumableDrafts({
  schedules,
  confirmed,
  step,
  setSelectedScheduleId,
  openRoster,
  writeWizardUrl,
}: UseResumableDraftsArgs): ResumableDrafts {
  const [resumableDrafts, setResumableDrafts] = useState<StoredAttendanceDraft[]>([]);

  const refreshResumableDrafts = useCallback((): void => {
    setResumableDrafts(listAttendanceDrafts(clubIsoDate()));
  }, []);

  useEffect(() => {
    if (confirmed || step !== "select-session") {
      setResumableDrafts([]);
      return;
    }
    refreshResumableDrafts();
  }, [confirmed, step, refreshResumableDrafts]);

  const describeSchedule = useCallback(
    (horarioId: number): string => {
      const found = schedules.find((s) => s.id === horarioId);
      return found
        ? `${formatDay(found.diaSemana)} ${found.horaInicio} — ${found.horaFin}`
        : `Horario #${horarioId}`;
    },
    [schedules],
  );

  const handleResumeDraft = useCallback(
    (draft: StoredAttendanceDraft): void => {
      setSelectedScheduleId(draft.horarioId);
      // `null`, not `draft.fecha` — see the page's own note: the offer only
      // ever lists TODAY's drafts, so the two are the same date.
      void openRoster(draft.horarioId, null, "mark-attendance", (h, d, t) =>
        writeWizardUrl(h, d, t, "push"),
      );
    },
    [openRoster, setSelectedScheduleId, writeWizardUrl],
  );

  return { resumableDrafts, refreshResumableDrafts, describeSchedule, handleResumeDraft };
}
