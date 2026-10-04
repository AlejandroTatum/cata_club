/**
 * NextSessionHero — the trainer's one decision, as a calm card.
 *
 * It replaces the heavy coal band: the student dashboard settled the idiom
 * (paper card, identity on the left, one clear signal), so the session is the
 * figure. Three zones share the whole width, left to right:
 *
 *   - WHICH session: the hour as the big number, the group, the range and the
 *     wait in words;
 *   - WHO: the enrolled students as first-name chips (a "+N" for the rest) and
 *     how the previous session of that group went;
 *   - WHAT TO DO: the primary action, named by the hour ("Pasar lista de las
 *     15:00"), and the generic way to another session.
 *
 * A thin bar along the bottom counts down to the start (the last three hours)
 * and, once running, through the session itself.
 *
 * `state === null` (rest day / loading / error) renders nothing, and `done`
 * carries no session link at all: no state without a session can leave a
 * `horario=` link in the tree.
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge, buttonClasses } from "@/components/ui";
import type { EmergencyCardStudent } from "@/app/trainer/attendance/EmergencyCardDialog";
import { formatDate } from "@/lib/format-utils";
import {
  buildHeroProgress,
  formatElapsedMinutes,
  formatEnrolledCount,
  formatTimeUntilStart,
  initialsOf,
  type LastSessionSummary,
  type SessionCardState,
} from "./trainer-day-utils";

/** Name chips shown before the rest collapses into "+N". */
const MAX_CHIPS = 8;

interface NextSessionHeroProps {
  state: SessionCardState;
  /** Enrolled students' names per horario id; `null` when the roster did not arrive. */
  roster: Record<number, string[]> | null;
  /** How the previous session of the hero's horario went, when a list is loaded. */
  lastSummary?: LastSessionSummary | null;
  /** "miércoles 15:00" — the next session when today is over and one is known. */
  nextSessionLabel?: string | null;
  /** The hero session's students, in the same order as the roster names (QA4
   *  ENT-27): each chip opens that student's emergency card. */
  students?: readonly EmergencyCardStudent[] | null;
  onOpenEmergency?: (student: EmergencyCardStudent) => void;
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

export default function NextSessionHero({
  state,
  roster,
  lastSummary = null,
  nextSessionLabel,
  students = null,
  onOpenEmergency,
}: NextSessionHeroProps): React.ReactElement | null {
  if (!state) return null;

  if (state.kind === "done") {
    return (
      <section data-testid="session-hero" className="card flex flex-wrap items-center justify-between gap-3 px-[18px] py-4">
        <p className="m-0 text-sm text-ink-2">
          <b className="font-semibold text-ink">Las sesiones de hoy ya terminaron.</b>
          {nextSessionLabel ? ` La próxima es el ${nextSessionLabel}.` : ""}
        </p>
        <Link href="/trainer/attendance" className={buttonClasses("secondary")}>
          Elegir otro horario
        </Link>
      </section>
    );
  }

  const { schedule, href } = state;
  const names = roster?.[schedule.id] ?? null;
  const shown = names?.slice(0, MAX_CHIPS) ?? [];
  const extra = names ? names.length - shown.length : 0;
  const live = state.kind === "live";
  const progress = buildHeroProgress(state);
  const wait = live ? formatElapsedMinutes(state.minutesElapsed) : formatTimeUntilStart(state.minutesAway);

  return (
    <section data-testid="session-hero" className="card flex flex-col gap-4 px-[18px] pb-4 pt-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-bold uppercase text-ink-3">{live ? "Sesión en curso" : "Próxima sesión"}</span>
            {live && <Badge tone="ok">En curso</Badge>}
          </div>
          <span className="font-display text-display leading-none tabular-nums tracking-flat text-ink">{schedule.horaInicio}</span>
          <span className="text-sm text-ink-2">
            {schedule.categoriaLabel ? <b className="font-semibold text-ink">{schedule.categoriaLabel}</b> : null}
            {schedule.categoriaLabel ? " · " : ""}
            {schedule.horaInicio} a {schedule.horaFin}
          </span>
          <span className="text-sm font-semibold text-ink">{wait}</span>
        </div>

        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2.5">
          {names ? (
            <>
              <span className="text-xs font-semibold text-ink-2">{formatEnrolledCount(names.length)}</span>
              {shown.length > 0 && (
                <ul aria-label="Alumnos inscritos" className="m-0 grid list-none grid-cols-2 gap-1.5 p-0 sm:grid-cols-4">
                  {shown.map((name, index) => {
                    const student = students?.[index];
                    const chip = (
                      <>
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-paper text-2xs font-bold text-ink-2"
                        >
                          {initialsOf(name)}
                        </span>
                        <span className="sr-only">{name}</span>
                        <span aria-hidden="true" className="truncate">{firstName(name)}</span>
                      </>
                    );
                    const chipClasses = "flex min-w-0 items-center gap-1.5 rounded-full bg-sunken py-0.5 pl-0.5 pr-2.5 text-xs font-semibold text-ink";
                    return (
                      <li key={name} title={name} className="min-w-0">
                        {student && onOpenEmergency ? (
                          <button
                            type="button"
                            aria-label={`Ficha de emergencia de ${name}`}
                            onClick={() => onOpenEmergency(student)}
                            className={`${chipClasses} w-full text-left hover:bg-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink`}
                          >
                            {chip}
                          </button>
                        ) : (
                          <span className={chipClasses}>{chip}</span>
                        )}
                      </li>
                    );
                  })}
                  {extra > 0 && (
                    <li className="flex items-center justify-center rounded-full bg-coal px-2.5 py-1 text-xs font-bold text-white">+{extra} más</li>
                  )}
                </ul>
              )}
              {shown.length > 0 && onOpenEmergency && (
                <span className="text-xs text-ink-3">Toque un nombre para ver su ficha de emergencia.</span>
              )}
            </>
          ) : (
            <span className="text-xs text-ink-3">No se pudo leer el padrón de esta sesión.</span>
          )}
          {lastSummary && lastSummary.total > 0 ? (
            <span data-testid="hero-last-summary" className="text-xs text-ink-2">
              La vez anterior ({formatDate(lastSummary.fecha).slice(0, 5)}):{" "}
              <b className="font-semibold text-ink">
                {lastSummary.attended} de {lastSummary.total}
              </b>{" "}
              entrenaron
            </span>
          ) : (
            <span className="text-xs text-ink-3">Sin lista anterior de este horario en las últimas semanas.</span>
          )}
        </div>

        <div className="flex flex-none flex-col gap-2">
          <Link href={href} className={buttonClasses("primary")}>
            <ClipboardList size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
            {`Pasar lista de las ${schedule.horaInicio}`}
          </Link>
          <Link href="/trainer/attendance" className={buttonClasses("secondary")}>
            Elegir otro horario
          </Link>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={live ? "Avance de la sesión" : "Cuenta regresiva a la sesión"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={wait}
        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-coal motion-safe:transition-[width]" style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
}
