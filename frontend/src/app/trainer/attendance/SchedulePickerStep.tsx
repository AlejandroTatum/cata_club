import { Calendar } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { EmptyState } from "@/components/ui";
import { MIN_TARGET_CLASS } from "@/lib/target-size";
import {
  formatDay,
  groupSchedulesByDay,
  type TrainingSchedule,
  type VisibleSchedules,
} from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";
import ResumableDraftsPanel from "./ResumableDraftsPanel";
import ScheduleDayGroup from "./ScheduleDayGroup";
import type { PendingConfirmation } from "./useLeaveGuard";
import type { StoredAttendanceDraft } from "./attendance-utils";

interface SchedulePickerStepProps {
  resumableDrafts: StoredAttendanceDraft[];
  describeSchedule: (horarioId: number) => string;
  onResumeDraft: (draft: StoredAttendanceDraft) => void;
  onDiscardDraft: (confirmation: PendingConfirmation) => void;
  rosterLoading: boolean;
  schedules: TrainingSchedule[];
  visible: VisibleSchedules;
  today: DiaSemana;
  showAllDays: boolean;
  onToggleShowAllDays: () => void;
  expandedDays: Set<DiaSemana>;
  onToggleDay: (day: DiaSemana) => void;
  selectedScheduleId: number | null;
  onSelectSchedule: (id: number) => void;
  weekRecordCounts: Map<number, number>;
  selectedListTaken: boolean;
  rosterError: string | null;
}

/** Step 1: choose the horario. See `TrainerAttendancePage`'s own notes on this step. */
export default function SchedulePickerStep({
  resumableDrafts,
  describeSchedule,
  onResumeDraft,
  onDiscardDraft,
  rosterLoading,
  schedules,
  visible,
  today,
  showAllDays,
  onToggleShowAllDays,
  expandedDays,
  onToggleDay,
  selectedScheduleId,
  onSelectSchedule,
  weekRecordCounts,
  selectedListTaken,
  rosterError,
}: SchedulePickerStepProps): React.ReactElement {
  const dayGroups = groupSchedulesByDay(visible.schedules);

  return (
    <div className="flex flex-col gap-5">
      {resumableDrafts.length > 0 && (
        <ResumableDraftsPanel
          resumableDrafts={resumableDrafts}
          describeSchedule={describeSchedule}
          onResumeDraft={onResumeDraft}
          onDiscardDraft={onDiscardDraft}
          rosterLoading={rosterLoading}
        />
      )}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-field">
          <p className="text-sm text-ink-3">
            {visible.narrowedToToday
              ? `Horarios de hoy · ${formatDay(today)}`
              : "Seleccione el horario de entrenamiento:"}
          </p>
          {/* The escape hatch. Hidden when today is empty: the list is
              already the full week and the hint below says why. */}
          {schedules.length > 0 && !visible.emptyToday && (
            <button
              type="button"
              onClick={onToggleShowAllDays}
              // `MIN_TARGET_CLASS` (issue #818, WCAG 2.5.8 AA): the button
              // used to be exactly its text, 99 × 18.8px.
              className={`inline-flex items-center text-xs font-semibold text-ink-2 underline underline-offset-2 transition-colors hover:text-ink ${MIN_TARGET_CLASS}`}
            >
              {showAllDays ? "Ver solo hoy" : "Ver todos los días"}
            </button>
          )}
        </div>
        {visible.emptyToday && (
          <p className="mb-3 text-xs text-ink-3">
            No hay entrenamientos hoy ({formatDay(today).toLowerCase()}). Mostrando la semana
            completa.
          </p>
        )}
        {schedules.length === 0 ? (
          <EmptyState
            icon={<Calendar size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
            title="No hay horarios registrados"
            description="Sin un horario no se puede tomar lista. Pida a administración que registre uno."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {dayGroups.map((group) => (
              <ScheduleDayGroup
                key={group.day}
                group={group}
                today={today}
                isExpanded={expandedDays.has(group.day)}
                onToggle={onToggleDay}
                selectedScheduleId={selectedScheduleId}
                onSelectSchedule={onSelectSchedule}
                weekRecordCounts={weekRecordCounts}
              />
            ))}
          </div>
        )}
      </div>

      {/*
       * El aviso del #368, pegado al mismo control que el error de roster —
       * ver la nota de la página sobre por qué esto solo se dispara al volver
       * "Atrás" con una selección todavía viva.
       */}
      {selectedListTaken && (
        <div
          role="status"
          className="rounded-ctl border border-state-warn/30 bg-state-warn-bg p-4 text-sm text-state-warn"
        >
          <p className="font-semibold">Esta lista ya fue tomada.</p>
          <p>
            Puede continuar para consultarla, pero no para volver a tomarla: una vez registrada,
            la lista queda cerrada. Ante un error, consulte con administración.
          </p>
        </div>
      )}

      {rosterError && (
        <div className="alert-error" role="alert">
          {rosterError}
        </div>
      )}
    </div>
  );
}
