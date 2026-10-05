/**
 * "Sesiones sin lista" — the current month's scheduled sessions that never
 * got a roll call, newest first (usability audit 2026-09-16).
 *
 * Replaces "Distribución de asistencias" in `page.tsx`'s rail: a donut the
 * trainer only ever looked at, never acted on — the third slice of the same
 * month query the pulse row already reads. This column asks the actionable
 * question instead — which session still needs a list — and links straight
 * into the wizard for exactly that one.
 *
 * The list comes from `findMissingSessions` (`history-utils.ts`), the same
 * cross the history screen counts. It is an ESTIMATE for the reasons that
 * module's header states (no `vigente_desde`, no holidays, no cancellations
 * in the model), which is why the footer carries the same caveat, verbatim.
 */

"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { buttonClasses } from "@/components/ui";
import { formatMissingSessionDate } from "./trainer-day-utils";
import { buildWizardQuery } from "@/app/trainer/attendance/attendance-utils";
import { AVISO_ESTIMACION, type MissingSession } from "@/app/trainer/attendance/history/history-utils";

/** Rows shown before the footer takes over — the same cap `RecentSessionsList` reads for "Últimas listas". */
const MAX_ROWS = 5;

interface SessionsWithoutListProps {
  /** Newest first, already the full month — this component only slices it. */
  missing: MissingSession[];
  /**
   * Whether enrolment is known. Without it a partial list looks complete, so
   * the empty state may not claim that every session has one.
   */
  coverageKnown: boolean;
}

export default function SessionsWithoutList({ missing, coverageKnown }: SessionsWithoutListProps): React.ReactElement {
  const visible = missing.slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col gap-3">
      {/* The card title step, in the club's display face — see `DESIGN.md`'s
          "regla de Graduate". */}
      <h2 className="mb-3 font-display text-lg uppercase leading-tight tracking-flat text-ink">
        Sesiones sin lista
      </h2>

      {visible.length > 0 ? (
        <div className="flex flex-col">
          {visible.map((session) => (
            <MissingSessionRow key={`${session.fecha}|${session.schedule.id}`} session={session} />
          ))}
        </div>
      ) : (
        <p data-testid="compact-empty" className="m-0 text-sm text-ink-2">
          {coverageKnown ? (
            <>
              <span className="font-semibold text-ink">Todas las sesiones del mes tienen lista.</span>{" "}
              No quedan sesiones programadas sin una lista completa.
            </>
          ) : (
            <>
              <span className="font-semibold text-ink">Ninguna sesión del mes está sin lista.</span>{" "}
              No se pudo comprobar si las listas están completas.
            </>
          )}
        </p>
      )}

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <p className="m-0 text-sm text-ink-2">
          <b className="font-semibold text-ink">{missing.length}</b>{" "}
          {missing.length === 1 ? "sesión sin lista" : "sesiones sin lista"} o incompletas este mes ·{" "}
          <Link href="/trainer/attendance/history" className="font-semibold text-ink underline">
            {missing.length > MAX_ROWS ? "Ver todas" : "Ver historial"}
          </Link>
        </p>
        {/* Short by default: the caveat matters, but four lines of it under
            every card made the estimate louder than the list. */}
        <details className="text-xs text-ink-3">
          <summary className="touch-target-pad cursor-pointer">Es una estimación</summary>
          <p className="m-0 mt-1" role="note">
            {AVISO_ESTIMACION}
          </p>
        </details>
      </div>
    </div>
  );
}

function MissingSessionRow({ session }: { session: MissingSession }): React.ReactElement {
  const href = `/trainer/attendance${buildWizardQuery(session.schedule.id, session.fecha, "mark-attendance")}`;
  const incomplete = session.registrados !== undefined && session.inscritos !== undefined;

  return (
    <div className="flex min-h-drow items-center justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <b className="text-sm font-bold tabular-nums text-ink">{formatMissingSessionDate(session.fecha)}</b>
        <span className="text-xs tabular-nums text-ink-2">
          {session.schedule.horaInicio} — {session.schedule.horaFin}
        </span>
        {incomplete && (
          <span className="text-xs font-semibold text-state-warn">
            {session.registrados} de {session.inscritos} registrados
          </span>
        )}
      </div>
      <Link href={href} className={buttonClasses("secondary", "sm")}>
        {incomplete ? "Completar lista" : "Pasar lista"}
      </Link>
    </div>
  );
}
