import type { ScheduleDayGroup, TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";

interface WeekOverviewProps {
  dayGroups: ScheduleDayGroup[];
  today: DiaSemana;
  weekRecordCounts: Map<number, number>;
  onSelectDay: (day: DiaSemana) => void;
}

/** How many of a day's sessions already have a list this week. */
function listsTaken(schedules: TrainingSchedule[], counts: Map<number, number>): number {
  return schedules.filter((s) => (counts.get(s.id) ?? 0) > 0).length;
}

/**
 * Step 1's week at a glance: one row per day with sessions, and how many of
 * them already have a list. It answers "what is still pending?" without
 * hopping through the day tabs, and it fills the picker card with something
 * the trainer can act on instead of a void under the tiles.
 */
export default function WeekOverview({
  dayGroups,
  today,
  weekRecordCounts,
  onSelectDay,
}: WeekOverviewProps): React.ReactElement | null {
  if (dayGroups.length === 0) return null;

  return (
    <section data-testid="week-overview" aria-label="Resumen de la semana" className="flex flex-1 flex-col gap-2 border-t border-line pt-4">
      <h3 className="text-2xs font-bold uppercase tracking-wide text-ink-3">Esta semana</h3>
      <ul className="m-0 flex flex-1 list-none flex-col p-0">
        {dayGroups.map((group) => {
          const taken = listsTaken(group.schedules, weekRecordCounts);
          const total = group.schedules.length;
          const pending = total - taken;
          return (
            <li key={group.day} className="flex flex-1 border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onSelectDay(group.day)}
                aria-label={`Ver ${group.label.toLowerCase()}: ${total} ${total === 1 ? "horario" : "horarios"}, ${taken} con lista`}
                className="flex min-h-drow w-full flex-1 items-center justify-between gap-3 py-2 text-left text-sm hover:bg-ink/5"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold text-ink">
                    {group.label}
                    {group.day === today && <span className="ml-2 text-xs font-bold text-ink-3">Hoy</span>}
                  </span>
                  <span className="truncate text-xs text-ink-3">
                    {group.schedules.map((s) => s.horaInicio).join(" · ")}
                  </span>
                </span>
                <span className="text-xs text-ink-2">
                  {total} {total === 1 ? "horario" : "horarios"} ·{" "}
                  <span className={pending === 0 ? "font-bold text-state-ok" : "font-bold text-ink"}>
                    {pending === 0 ? "todas con lista" : `${pending} por tomar`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
