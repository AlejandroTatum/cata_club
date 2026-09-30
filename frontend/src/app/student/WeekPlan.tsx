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
 * Each day's accessible name is the whole sentence ("Jueves 01/10/2026,
 * 20:00 – 21:15") — the letter and the number are the drawing, not the label.
 */

import { cn } from "@/components/ui";
import { formatDate } from "@/lib/format-utils";
import { DIA_LABELS, WEEK_ORDER, type UpcomingTraining } from "./student-utils";

export interface WeekPlanProps {
  /** The upcoming sessions, soonest first (`findNextTrainingSessions`). */
  sessions: UpcomingTraining[];
}

const range = (session: UpcomingTraining): string => `${session.horaInicio} – ${session.horaFin}`;

/** `2026-10-01` → `01/10`. */
const dayMonth = (fecha: string): string => formatDate(fecha).slice(0, 5);

export default function WeekPlan({ sessions }: WeekPlanProps): React.ReactElement {
  const next = sessions[0];
  const byDia = new Map<string, UpcomingTraining[]>();
  for (const session of sessions) byDia.set(session.dia, [...(byDia.get(session.dia) ?? []), session]);

  const ranges = new Set(sessions.map(range));
  const sharedRange = ranges.size === 1 ? range(sessions[0]) : null;

  return (
    <div className="flex flex-1 flex-col justify-evenly gap-4 px-5 pb-4">
      {next && (
        <p
          data-testid="week-plan-next"
          className="rounded-ctl bg-sunken px-4 py-3 text-base text-ink-2"
        >
          <span className="font-bold text-ink">Próximo:</span>{" "}
          <span className="font-semibold text-ink">
            {next.isToday ? "hoy, " : ""}
            {DIA_LABELS[next.dia]?.toLocaleLowerCase("es") ?? next.diaLabel.toLocaleLowerCase("es")}{" "}
            {dayMonth(next.fecha)}
          </span>{" "}
          <span className="font-semibold tabular-nums text-ink">· {range(next)}</span>
        </p>
      )}

      {/* `flex-1` up to a ceiling: the panel may be stretched to its neighbour's
          height, and the days take that slack (they are the content) before any
          air is added between the blocks. */}
      <ul
        data-testid="week-plan"
        className="grid min-h-[72px] flex-1 grid-cols-7 gap-1.5 sm:gap-2 lg:max-h-[120px]"
      >
        {WEEK_ORDER.map((dia) => {
          const slots = byDia.get(dia) ?? [];
          const first = slots[0];
          const state = !first ? "idle" : first === next ? "next" : "active";
          const label = DIA_LABELS[dia];
          const name = first
            ? `${label} ${formatDate(first.fecha)}, ${slots.map(range).join(" y ")}`
            : `${label}, sin entrenamiento`;
          return (
            <li
              key={dia}
              data-day={dia}
              data-state={state}
              aria-label={name}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-ctl border px-1 py-2 text-center",
                state === "next" && "border-cata-red bg-cata-red text-white",
                state === "active" && "border-line-2 bg-paper text-ink",
                state === "idle" && "border-transparent bg-sunken text-ink-3-strong",
              )}
            >
              <span aria-hidden="true" className="text-2xs font-bold">
                {label.charAt(0)}
              </span>
              {first ? (
                <span aria-hidden="true" className="text-base font-extrabold tabular-nums leading-none">
                  {first.fecha.slice(8, 10)}
                </span>
              ) : null}
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

      {sharedRange && (
        <p data-testid="week-plan-same-time" className="text-xs text-ink-3-strong">
          Mismo horario todos los días marcados.
        </p>
      )}
    </div>
  );
}
