/**
 * "Últimas listas" — the club's recent attendance sessions as dense,
 * full-width rows (issue #211,
 * `docs/archive/prototypes/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * Replaces the old table of four loose colored `Badge`s per row: the system
 * reserves color for badges and pills, and four tones per row competed with
 * the page's own red CTA. In its place, one proportional bar shows the
 * composition at a glance and the total goes in ink. The four numbers stay
 * reachable two ways — the bar's `aria-label` always states them, and a
 * breakdown appears in the same cell when a row is hovered or focused.
 *
 * Hover and focus are tracked SEPARATELY on purpose. The bar is the one
 * focusable element in a row (`tabIndex=0`, for `aria-label` access via
 * keyboard/AT), so hiding it while it is focused would take the focused
 * element out of the tree and lose focus along with it — the exact failure
 * the issue calls out. Hovering alone may swap the bar for the breakdown;
 * focus never does, and always shows the breakdown alongside it.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { EmptyState, buttonClasses } from "@/components/ui";
import type { RecentAttendanceSession } from "@/services/api";
import { formatDate } from "@/lib/format-utils";
import { SessionCompositionBar, SessionCompositionCounts } from "./SessionComposition";

interface RecentSessionsListProps {
  sessions: RecentAttendanceSession[];
}

export default function RecentSessionsList({ sessions }: RecentSessionsListProps): React.ReactElement {
  return (
    <section aria-labelledby="ultimas-listas-title" className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {/* The card title step, in the display face — see `DESIGN.md`'s
            "regla de Graduate". */}
        <h2
          id="ultimas-listas-title"
          className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink"
        >
          Últimas listas
        </h2>
        <Link href="/trainer/attendance/history" className={buttonClasses("secondary", "sm")}>
          Ver historial
        </Link>
      </div>

      {sessions.length > 0 ? (
        <div className="flex flex-col">
          {sessions.map((session) => (
            <SessionRow key={`${session.horarioId}|${session.fecha}`} session={session} />
          ))}
        </div>
      ) : (
        <EmptyState
          surface="inset"
          icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
          title="Todavía no hay listas registradas"
          description="En cuanto alguien pase lista en el club, la sesión aparece acá con su desglose."
        />
      )}
    </section>
  );
}

function SessionRow({ session }: { session: RecentAttendanceSession }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [focusedWithin, setFocusedWithin] = useState(false);

  // Hover alone may hide the bar; focus never does — see the module doc.
  const barHidden = hovered && !focusedWithin;
  const breakdownShown = hovered || focusedWithin;

  return (
    <div
      // Not `PAGE_RAIL`'s main+rail shape (a page-level split) — this is one
      // dense row's own internal columns, which only happens to share the
      // "flexible first, fixed second" grammar at the mobile breakpoint.
      className="grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-1.5 border-b border-line px-5 py-3 last:border-b-0 hover:bg-sunken sm:grid-cols-[minmax(96px,.7fr)_minmax(130px,.9fr)_minmax(150px,1.3fr)_auto]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusedWithin(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedWithin(false);
      }}
    >
      <div className="col-start-1 row-start-1">
        <b className="block text-sm font-bold text-ink">{formatDate(session.fecha)}</b>
      </div>

      <div className="col-start-1 row-start-2 text-xs tabular-nums text-ink-2 sm:col-start-2 sm:row-start-1">
        {session.horario}
      </div>

      <div className="col-span-2 row-start-3 min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1">
        <SessionCompositionBar
          counts={session.counts}
          total={session.total}
          tabIndex={0}
          className={barHidden ? "hidden max-sm:flex" : "flex"}
        />
        <SessionCompositionCounts
          counts={session.counts}
          total={session.total}
          className={breakdownShown ? "flex" : "hidden max-sm:flex"}
        />
      </div>

      <div className="col-start-2 row-start-1 text-right sm:col-start-4">
        <b className="block text-lg font-extrabold tabular-nums text-ink">{session.total}</b>
        <span className="block text-2xs text-ink-3">registros</span>
      </div>
    </div>
  );
}
