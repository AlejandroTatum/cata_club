/**
 * WeekPlan — "Esta semana" as a compact week instead of one full-width row per
 * session.
 *
 * A student who trains five days at the same hour used to read the same
 * "20:00 — 21:15" five times down a tall list. Here the week is seven fixed
 * days (the order and letters `WeekStrip` uses), the days that train are lit
 * and carry their date, and the time is stated ONCE — in the next-session line
 * — when every session shares it; only when sessions differ does each day carry
 * its own start time. The
 * next session is spelled out above the strip, because "when do I go next" is
 * the question the panel exists to answer.
 *
 * The strip is ONE calendar week, Monday to Sunday, of the club's timezone:
 * every cell carries its own date, today is ringed, days already gone are
 * muted, and the training days are lit. "Próximo" is the only place that may
 * name a date beyond Sunday — the next session can be next week.
 *
 * Each day's accessible name is the whole sentence ("Jueves 01/10/2026,
 * 20:00 – 21:15") — the letter and the number are the drawing, not the label.
 */

import { cn } from "@/components/ui";
import { calendarIsoDate, clubToday } from "@/lib/club-date";
import { formatDate } from "@/lib/format-utils";
import { DIA_LABELS, WEEK_ORDER, type UpcomingTraining } from "./student-utils";

export interface WeekPlanProps {
  /** The upcoming sessions, soonest first (`findNextTrainingSessions`). */
  sessions: UpcomingTraining[];
  /** The instant the week is drawn around; injectable so tests own the clock. */
  now?: Date;
}

/** The seven ISO dates of the club-calendar week that contains `now`, Monday first. */
function currentWeek(now: Date): string[] {
  const today = clubToday(now);
  const sinceMonday = (today.getDay() + 6) % 7;
  return WEEK_ORDER.map((_, index) => {
    const date = new Date(today.getTime());
    date.setDate(date.getDate() - sinceMonday + index);
    return calendarIsoDate(date);
  });
}

const range = (session: UpcomingTraining): string => `${session.horaInicio} – ${session.horaFin}`;

/** `2026-10-01` → `01/10`. */
const dayMonth = (fecha: string): string => formatDate(fecha).slice(0, 5);

export default function WeekPlan({ sessions, now = new Date() }: WeekPlanProps): React.ReactElement {
  const next = sessions[0];
  const byDia = new Map<string, UpcomingTraining[]>();
  for (const session of sessions) byDia.set(session.dia, [...(byDia.get(session.dia) ?? []), session]);
  const week = currentWeek(now);
  const todayIso = calendarIsoDate(clubToday(now));

  const ranges = new Set(sessions.map(range));
  const sharedRange = ranges.size === 1 ? range(sessions[0]) : null;

  return (
    <div className="flex flex-col gap-3 px-5 pb-4">
      {next && (
        <p
          data-testid="week-plan-next"
          className="text-sm text-ink-2"
        >
          <span className="font-bold text-ink">Próximo:</span>{" "}
          <span className="font-semibold text-ink">
            {next.isToday ? "hoy, " : ""}
            {DIA_LABELS[next.dia]?.toLocaleLowerCase("es") ?? next.diaLabel.toLocaleLowerCase("es")}{" "}
            {dayMonth(next.fecha)}
          </span>{" "}
          <span className="font-semibold tabular-nums text-ink">· {range(next)}</span>
          {sharedRange && (
            <span data-testid="week-plan-same-time" className="text-ink-3-strong">
              {" "}
              · mismo horario todos los días marcados
            </span>
          )}
        </p>
      )}

      <ul
        data-testid="week-plan"
        className="grid grid-cols-7 gap-1.5 sm:gap-2"
      >
        {WEEK_ORDER.map((dia, index) => {
          const slots = byDia.get(dia) ?? [];
          const first = slots[0];
          const fecha = week[index];
          const isToday = fecha === todayIso;
          const isPast = fecha < todayIso;
          // A session's own date may fall next week; only a session that lands
          // on THIS cell's date lights it, so a Monday cell never borrows the
          // following Monday's session.
          const trained = slots.length > 0;
          const state = !trained ? "idle" : first === next && first.fecha === fecha ? "next" : "active";
          const label = DIA_LABELS[dia];
          const name = trained
            ? `${label} ${formatDate(fecha)}, ${slots.map(range).join(" y ")}`
            : `${label} ${formatDate(fecha)}, sin entrenamiento`;
          return (
            <li
              key={dia}
              data-day={dia}
              data-state={state}
              data-date={fecha}
              data-today={String(isToday)}
              data-past={String(isPast)}
              aria-current={isToday ? "date" : undefined}
              aria-label={name}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 rounded-ctl border px-1 py-2.5 text-center",
                // The days that train carry the brand: white on `cata-red` is
                // 5.00:1. The next session is coal so it still reads first. A
                // training day already gone drops to the `state-bad` pair the
                // Badge spends instead of fading with opacity, which would take
                // the text under AA. Rest days stay on the quiet sunken fill.
                state === "next" && "border-ink bg-ink text-white",
                state === "active" && !isPast && "border-cata-red bg-cata-red text-white",
                state === "active" && isPast && "border-state-bad/25 bg-state-bad-bg text-state-bad",
                state === "idle" && "border-transparent bg-sunken text-ink-3-strong",
                isToday && "ring-2 ring-ink ring-offset-2 ring-offset-paper",
              )}
            >
              {isToday ? (
                <span
                  data-testid="week-plan-today-dot"
                  aria-hidden="true"
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ball"
                />
              ) : null}
              <span aria-hidden="true" className="text-2xs font-bold">
                {label.charAt(0)}
              </span>
              <span aria-hidden="true" className="text-base font-extrabold tabular-nums leading-none">
                {fecha.slice(8, 10)}
              </span>
              {first && !sharedRange ? (
                <span aria-hidden="true" className="text-2xs font-semibold tabular-nums">
                  {first.horaInicio}
                  {slots.length > 1 ? ` +${slots.length - 1}` : ""}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

    </div>
  );
}
