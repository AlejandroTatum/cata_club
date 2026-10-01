import { DIA_SEMANA_LABELS } from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";

const WEEK = Object.keys(DIA_SEMANA_LABELS) as DiaSemana[];

interface DayTabsProps {
  /** Days that have at least one schedule; the rest are disabled. */
  daysWithSchedules: ReadonlySet<DiaSemana>;
  active: DiaSemana;
  today: DiaSemana;
  onSelect: (day: DiaSemana) => void;
}

/** The week as a day switcher: one day is shown at a time, today is marked. */
export default function DayTabs({
  daysWithSchedules,
  active,
  today,
  onSelect,
}: DayTabsProps): React.ReactElement {
  return (
    <div role="group" aria-label="Día de la semana" className="flex flex-wrap gap-1.5">
      {WEEK.map((day) => {
        const enabled = daysWithSchedules.has(day);
        const selected = day === active;
        return (
          <button
            key={day}
            type="button"
            disabled={!enabled}
            aria-pressed={selected}
            aria-label={`${DIA_SEMANA_LABELS[day]}${day === today ? " (hoy)" : ""}`}
            title={DIA_SEMANA_LABELS[day]}
            onClick={() => onSelect(day)}
            className={`relative inline-flex h-9 min-w-[3.25rem] items-center justify-center gap-1.5 rounded-ctl border px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? "border-coal bg-coal text-white"
                : "border-line-2 bg-paper text-ink-2 hover:border-ink-3"
            }`}
          >
            {DIA_SEMANA_LABELS[day].slice(0, 3)}
            {day === today && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ball" />}
          </button>
        );
      })}
    </div>
  );
}
