import { useState } from "react";
import { Calendar } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { EmptyState, InfoPanel, PAGE_RAIL } from "@/components/ui";
import { formatDay, groupSchedulesByDay, type TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";
import ResumableDraftsPanel from "./ResumableDraftsPanel";
import DayTabs from "./DayTabs";
import ScheduleDayGroup from "./ScheduleDayGroup";
import SelectedSessionPanel from "./SelectedSessionPanel";
import WeekOverview from "./WeekOverview";
import { useSchedulePreview } from "./useSchedulePreview";
import type { PendingConfirmation } from "./useLeaveGuard";
import type { StoredAttendanceDraft } from "./attendance-utils";

interface SchedulePickerStepProps {
  resumableDrafts: StoredAttendanceDraft[];
  describeSchedule: (horarioId: number) => string;
  onResumeDraft: (draft: StoredAttendanceDraft) => void;
  onDiscardDraft: (confirmation: PendingConfirmation) => void;
  rosterLoading: boolean;
  schedules: TrainingSchedule[];
  today: DiaSemana;
  selectedScheduleId: number | null;
  onSelectSchedule: (id: number) => void;
  weekRecordCounts: Map<number, number>;
  selectedListTaken: boolean;
  rosterError: string | null;
  /** The stacked commit bar ("Continuar"), hosted in the aside. */
  commitBar: React.ReactNode;
  heading: string;
}

/** Step 1: choose the horario. See `TrainerAttendancePage`'s own notes on this step. */
export default function SchedulePickerStep({
  resumableDrafts,
  describeSchedule,
  onResumeDraft,
  onDiscardDraft,
  rosterLoading,
  schedules,
  today,
  selectedScheduleId,
  onSelectSchedule,
  weekRecordCounts,
  selectedListTaken,
  rosterError,
  commitBar,
  heading,
}: SchedulePickerStepProps): React.ReactElement {
  const dayGroups = groupSchedulesByDay(schedules);
  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) ?? null;
  const preview = useSchedulePreview(selectedScheduleId);

  // One day at a time: the day the trainer picked, else the selected session's
  // day (a resumed draft), else today, else the first day that has sessions.
  const [pickedDay, setPickedDay] = useState<DiaSemana | null>(null);
  const daysWithSchedules = new Set(dayGroups.map((g) => g.day));
  const activeDay: DiaSemana | null =
    pickedDay ??
    selectedSchedule?.diaSemana ??
    (daysWithSchedules.has(today) ? today : (dayGroups[0]?.day ?? null));
  const activeGroup = dayGroups.find((g) => g.day === activeDay) ?? null;

  return (
    <div className={PAGE_RAIL}>
      <div className="card flex flex-col gap-5 p-5 sm:p-6 lg:min-h-[calc(100dvh-17rem)]">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-field">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">{heading}</h2>
            <p className="text-sm text-ink-3">
              {activeGroup
                ? `${activeDay === today ? `Horarios de hoy · ${activeGroup.label}` : `Horarios del ${activeGroup.label.toLowerCase()}`} — toque el que va a pasar`
                : "Seleccione el horario de entrenamiento:"}
            </p>
          </div>
          {activeDay && (
            <DayTabs
              daysWithSchedules={daysWithSchedules}
              active={activeDay}
              today={today}
              onSelect={setPickedDay}
            />
          )}
        </div>
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
          {activeDay !== today && daysWithSchedules.size > 0 && !daysWithSchedules.has(today) && (
            <p className="mb-3 text-xs text-ink-3">
              No hay entrenamientos hoy ({formatDay(today).toLowerCase()}). Elija otro día.
            </p>
          )}
          {schedules.length === 0 ? (
            <EmptyState
              icon={<Calendar size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
              title="No hay horarios registrados"
              description="Sin un horario no se puede tomar lista. Pida a administración que registre uno."
            />
          ) : (
            activeGroup && (
              <ScheduleDayGroup
                group={activeGroup}
                today={today}
                selectedScheduleId={selectedScheduleId}
                onSelectSchedule={onSelectSchedule}
                weekRecordCounts={weekRecordCounts}
              />
            )
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
              Puede continuar para consultarla, pero no para volver a tomarla: una vez registrada, la lista
              queda cerrada. Ante un error, consulte con administración.
            </p>
          </div>
        )}

        {rosterError && (
          <div className="alert-error" role="alert">
            {rosterError}
          </div>
        )}

        <WeekOverview
          dayGroups={dayGroups}
          today={today}
          weekRecordCounts={weekRecordCounts}
          onSelectDay={setPickedDay}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-page lg:sticky lg:top-4">
        <SelectedSessionPanel
          schedule={selectedSchedule}
          today={today}
          recordedCount={selectedSchedule ? (weekRecordCounts.get(selectedSchedule.id) ?? 0) : 0}
          preview={preview}
          commitBar={commitBar}
        />
        <InfoPanel title="Cómo pasar lista">
          <p>1. Elija el día y toque el horario que va a pasar.</p>
          <p>2. Marque a cada alumno; todos parten como presentes, revise a quien falta.</p>
          <p>3. Confirme: una vez registrada, la lista queda cerrada.</p>
        </InfoPanel>
      </div>
    </div>
  );
}
