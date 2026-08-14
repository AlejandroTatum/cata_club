/**
 * The immediate-session card — the coal half of the trainer dashboard's top
 * row (issue #211, `docs/archive/prototypes/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * The big number is the session's own identifier — its start hour — in every
 * state that has a session at all, and the elapsed or remaining time is said
 * in words on the support line.
 *
 * It used to swap: the countdown owned the figure until the session started,
 * and the hour took over afterwards. Two things were wrong with that. A
 * minute count is only a readable quantity for about an hour, and this panel
 * is opened at any hour — at 03:20 on a Friday whose first session is at
 * 15:00 the 46px figure read "700 minutos", which is a number nobody
 * converts. And the same slot meaning two different things is what
 * DESIGN.md's "un solo formato por columna" exists to stop: the eye has to
 * read the kicker before it can know what the figure is. The hour decides
 * which session; the wait only qualifies it, so the wait is a line of text
 * (`formatTimeUntilStart`, which changes unit at the hour).
 *
 * The primary action moved here from the page header (`page.tsx`) — once,
 * never twice — and names the session by its hour ("Pasar lista de las
 * 15:00"), never "esta sesión": the label has to survive being read without
 * the card around it.
 *
 * `state === null` renders nothing. Combined with `page.tsx` never mounting
 * this component during loading/error, and `buildSessionCardState` never
 * producing a schedule for "done", none of the three no-session states can
 * leave a `horario=` link in the tree — see `SessionCard.test.tsx`.
 *
 * ## The rest of today
 *
 * QA rejected the "next"/"live" card on its own: five short lines forced to
 * fill the same 470px the white summary card next to it stands at (issue
 * #211's shared-height rule stays — the fix is not shrinking this card), and
 * `mt-auto` on the actions left the surplus stranded as dead air in the
 * middle instead of respiro under them.
 *
 * The fill is real content, not padding: every OTHER session still to come
 * today (`state.later`, from `selectTodaySessions`), read out as a plain
 * `<ol>` — not a horizontal carousel — so it grows with the day's own
 * session count instead of leaving a fixed-height strip with its own dead
 * space. A vertical list is also keyboard-accessible for free: no custom
 * scroll region, no roving tabindex, nothing to get wrong. `role="list"` is
 * explicit because Safari/VoiceOver drops the implicit list role once
 * `list-none` removes the bullets. One later session renders as a one-row
 * list — nothing carousel-shaped to look odd. Zero later sessions swaps the
 * list for a single line ("Es tu última sesión de hoy.") so the card still
 * says something true about the rest of the day instead of just stopping.
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import {
  formatElapsedMinutes,
  formatEnrolledCount,
  formatTimeUntilStart,
  type SessionCardState,
} from "./trainer-day-utils";

interface SessionCardProps {
  state: SessionCardState;
  /** Enrolled-count-by-horario-id — covers the hero session AND everything in `later`. */
  enrolledCounts: Record<number, number>;
}

export default function SessionCard({ state, enrolledCounts }: SessionCardProps): React.ReactElement | null {
  if (state === null) return null;

  if (state.kind === "done") {
    return (
      <section
        className="flex flex-col gap-3 rounded-card bg-coal px-7 py-6 text-white"
        aria-label="Tu día de hoy"
      >
        <p className="m-0 flex items-center gap-2 text-sm text-white/60">
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
          Hoy
        </p>
        <p className="m-0 text-lg font-bold leading-snug">Ya no quedan sesiones hoy.</p>
        <div className="mt-auto flex flex-wrap gap-2.5 pt-3">
          <Link href="/trainer/attendance" className={buttonClasses("onCoal")}>
            Elegir otro horario
          </Link>
        </div>
      </section>
    );
  }

  const isLive = state.kind === "live";
  const enrolledLabel = formatEnrolledCount(enrolledCounts[state.schedule.id] ?? null);

  return (
    <section
      className="flex flex-col gap-3 rounded-card bg-coal px-7 py-6 text-white"
      aria-label="Tu día de hoy"
    >
      <p className="m-0 flex items-center gap-2 text-sm text-white/60">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 flex-none rounded-full ${isLive ? "bg-cata-red" : "bg-ball"}`}
        />
        {isLive ? "En curso" : "Próxima sesión"}
      </p>

      {/* Graduate, like every other figure the system prints at a display step
          (`StatCard`), and with the declared tracking that keeps a wide,
          flat face from inheriting the step's own tightening. No weight: the
          face ships a single 400 cut and anything else is a synthesised fake. */}
      <span className="font-display text-display leading-none tracking-flat tabular-nums">
        {state.schedule.horaInicio}
      </span>

      <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-white/70">
        <span>
          {formatDay(state.schedule.diaSemana)} {state.schedule.horaInicio} — {state.schedule.horaFin}
        </span>
        <span>
          {isLive
            ? formatElapsedMinutes(state.minutesElapsed)
            : formatTimeUntilStart(state.minutesAway)}
        </span>
        {enrolledLabel && <span>{enrolledLabel}</span>}
      </p>

      {state.later.length > 0 ? (
        <ol
          role="list"
          aria-label="Después, más tarde hoy"
          className="m-0 flex list-none flex-col gap-2 border-t border-white/10 p-0 pt-3"
        >
          {state.later.map((later) => {
            const laterLabel = formatEnrolledCount(enrolledCounts[later.id] ?? null);
            return (
              <li
                key={later.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white/5 px-3.5 py-2.5"
              >
                <span className="text-sm font-semibold tabular-nums">
                  {later.horaInicio} — {later.horaFin}
                </span>
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/60">
                  {laterLabel && <span>{laterLabel}</span>}
                  <span className="font-semibold uppercase tracking-wide">Por venir</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m-0 border-t border-white/10 pt-3 text-sm text-white/60">
          Es tu última sesión de hoy.
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2.5 pt-3">
        <Link href={state.href} className={buttonClasses("primary")}>
          <ClipboardList size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          Pasar lista de las {state.schedule.horaInicio}
        </Link>
        <Link href="/trainer/attendance" className={buttonClasses("onCoal")}>
          Elegir otro horario
        </Link>
      </div>
    </section>
  );
}
