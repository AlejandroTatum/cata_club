import { ChevronDown, Clock } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import type { DiaSemana } from "@/types/domain";
import type {
  ScheduleDayGroup as ScheduleDayGroupData,
  TrainingSchedule,
} from "@/app/attendance/attendance-utils";

interface ScheduleDayGroupProps {
  group: ScheduleDayGroupData;
  today: DiaSemana;
  isExpanded: boolean;
  onToggle: (day: DiaSemana) => void;
  selectedScheduleId: number | null;
  onSelectSchedule: (id: number) => void;
  weekRecordCounts: Map<number, number>;
}

/**
 * One day's accordion in the horario picker: the header plus the schedule
 * buttons underneath it, when expanded.
 *
 * Issue #397: a horario already taken (any day of the week, since #483) is a
 * real `disabled` card — not a "solo consulta" mode dressed up with CSS — so
 * the count doubles as the reason the card cannot be tapped.
 */
export default function ScheduleDayGroup({
  group,
  today,
  isExpanded,
  onToggle,
  selectedScheduleId,
  onSelectSchedule,
  weekRecordCounts,
}: ScheduleDayGroupProps): React.ReactElement {
  const panelId = `schedule-day-${group.day}`;
  return (
    <div className="overflow-hidden rounded-ctl border border-line bg-paper">
      <button
        type="button"
        onClick={() => onToggle(group.day)}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex min-h-[52px] w-full items-center justify-between gap-2.5 px-4 py-3 text-left transition-colors hover:bg-canvas"
      >
        <span className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-ink">{group.label}</span>
          <span className="text-xs text-ink-3">
            ({group.schedules.length} {group.schedules.length === 1 ? "horario" : "horarios"})
          </span>
        </span>
        <ChevronDown
          size={ICON.sm}
          strokeWidth={2}
          className={`shrink-0 text-ink-3 transition-transform duration-150 ${
            isExpanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>
      {isExpanded && (
        <div id={panelId} className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
          {group.schedules.map((sched: TrainingSchedule) => {
            const isActive = sched.id === selectedScheduleId;
            const recordedCount = weekRecordCounts.get(sched.id) ?? 0;
            const takenForThisUser = recordedCount > 0;
            return (
              <button
                key={sched.id}
                type="button"
                onClick={() => {
                  if (takenForThisUser) return;
                  onSelectSchedule(sched.id);
                }}
                disabled={takenForThisUser}
                aria-pressed={isActive}
                // Selection is coal + the yellow ball dot, never a red fill —
                // red is CTA and destructive only.
                className={`flex min-h-[56px] flex-col justify-center gap-1 rounded-ctl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  isActive
                    ? "border-coal bg-paper shadow-selected"
                    : "border-line-2 bg-paper hover:border-ink-3"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <Clock size={ICON.sm} strokeWidth={2} className="text-ink-3" aria-hidden="true" />
                  {sched.horaInicio} — {sched.horaFin}
                  {isActive && (
                    <span
                      aria-hidden="true"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-ball ring-2 ring-coal"
                    />
                  )}
                </span>
                {recordedCount > 0 && (
                  <span className="flex items-center gap-1 text-2xs font-bold text-ink-3">
                    {group.day === today ? "Lista tomada hoy" : "Lista tomada"} · {recordedCount}{" "}
                    {recordedCount === 1 ? "registro" : "registros"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
