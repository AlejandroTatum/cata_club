/**
 * The immediate-session card — the coal half of the trainer dashboard's top
 * row (issue #211, `docs/ux/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * The big number follows whichever question is still live: before the
 * session starts, the question is "how long until" and the countdown owns
 * the number; once it has started, that count decides nothing any more (no
 * one arrives sooner for knowing ten minutes have passed) and the question
 * becomes "which one" — a session's identifier is its start hour, so the
 * hour takes the number's place and the elapsed minutes move to the support
 * line.
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
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import { formatDay } from "@/app/attendance/attendance-utils";
import {
  formatElapsedMinutes,
  formatEnrolledCount,
  type SessionCardState,
} from "./trainer-day-utils";

interface SessionCardProps {
  state: SessionCardState;
  enrolledCount: number | null;
}

export default function SessionCard({ state, enrolledCount }: SessionCardProps): React.ReactElement | null {
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
  const enrolledLabel = formatEnrolledCount(enrolledCount);

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
        {isLive ? "En curso" : "Empieza en"}
      </p>

      <span className="text-display font-extrabold leading-none tabular-nums">
        {isLive ? state.schedule.horaInicio : state.minutesAway}
        {!isLive && (
          <small className="ml-2 text-lg font-semibold text-white/60">
            {state.minutesAway === 1 ? "minuto" : "minutos"}
          </small>
        )}
      </span>

      <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-white/70">
        <span>
          {formatDay(state.schedule.diaSemana)} {state.schedule.horaInicio} — {state.schedule.horaFin}
        </span>
        {isLive && <span>{formatElapsedMinutes(state.minutesElapsed)}</span>}
        {enrolledLabel && <span>{enrolledLabel}</span>}
      </p>

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
