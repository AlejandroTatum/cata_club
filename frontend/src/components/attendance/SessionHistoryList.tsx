/**
 * The attendance history card: one row per SESSION, with the proportional
 * result bar and its counts, a "Registró" column, ghost rows that keep a short
 * list the shape of a full page, and the footer pagination.
 *
 * Shared by the trainer's `/trainer/attendance/history` and the admin's
 * `/attendance` so the two screens cannot drift apart again. The admin's extra
 * capability (correcting a record) rides in through `renderDetail`: when given,
 * each row gets a toggle that expands the session's records inline — there is
 * no second, flat per-record table.
 */

"use client";

import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { formatDate } from "@/lib/format-utils";
import {
  Badge,
  Button,
  Pagination,
  ResponsiveListTable,
  TableCell,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import {
  getTotalPages,
  paginateRecords,
} from "@/app/attendance/attendance-utils";
import {
  SessionCompositionBar,
  SessionCompositionCounts,
} from "@/app/trainer/SessionComposition";
import type { SessionSummary } from "@/app/trainer/trainer-day-utils";

/** A dash, not «No registrado»: that read as «the attendance was not recorded» (ENT-19). */
const NO_AUTHOR = "—";

/** One session's identity: the same pair the grouping keys on. */
export function sessionKey(
  session: Pick<SessionSummary, "fecha" | "horarioId">,
): string {
  return `${session.fecha}|${session.horarioId}`;
}

/** A row-shaped placeholder: the shape of a session not yet filed, not a void under the table. */
function GhostSessionRows({
  count,
  caption,
}: {
  count: number;
  caption?: string;
}): React.ReactElement | null {
  if (count <= 0) return null;
  return (
    <ul
      aria-hidden="true"
      data-testid="history-ghost-rows"
      // Phones keep two ghost rows: ten placeholders are ~550px of nothing.
      className="flex flex-1 flex-col max-lg:[&>li:nth-child(n+3)]:hidden"
    >
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex flex-1 items-center gap-6 border-t border-dashed border-line px-4 py-3.5"
        >
          <span className="flex w-28 flex-none flex-col gap-1.5">
            <span className="h-3 w-20 rounded bg-line/70" />
            <span className="h-2.5 w-14 rounded bg-line/50" />
          </span>
          <span className="h-3 w-28 flex-none rounded bg-line/50" />
          <span className="h-2.5 flex-1 rounded-full bg-line/50" />
          {i === 0 && caption && <span className="sr-only">{caption}</span>}
        </li>
      ))}
    </ul>
  );
}

/** `ResponsiveListTable` switches from cards to the table at Tailwind's `sm`. */
const DESKTOP_QUERY = "(min-width: 640px)";

/** Which of the two renderings is on screen; desktop when there is no `matchMedia` (SSR, jsdom). */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia?.(DESKTOP_QUERY);
      mql?.addEventListener("change", onChange);
      return () => mql?.removeEventListener("change", onChange);
    },
    () => window.matchMedia?.(DESKTOP_QUERY).matches ?? true,
    () => true,
  );
}

export interface SessionHistoryListProps {
  sessions: readonly SessionSummary[];
  /** Sessions per page; short lists are padded with ghost rows up to it. */
  pageSize: number;
  /** The date range is unusable (one end missing or inverted) — changes the empty copy. */
  rangeInvalid: boolean;
  /** The empty state's way out; it is never `primary` — the header carries that. */
  emptyAction: ReactNode;
  /** Role-specific per-session action (e.g. the admin's wizard link). Adds the column. */
  renderAction?: (session: SessionSummary) => ReactNode;
  /** Drill-down content of a session. When given, rows expand to show it. */
  renderDetail?: (session: SessionSummary) => ReactNode;
}

export default function SessionHistoryList({
  sessions,
  pageSize,
  rangeInvalid,
  emptyAction,
  renderAction,
  renderDetail,
}: SessionHistoryListProps): React.ReactElement {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  // Back to page 1 whenever the result set changes — page 3 of a shorter list
  // is an empty screen with no explanation.
  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [sessions.length]);

  // The open detail belongs to the page it was opened on.
  useEffect(() => {
    setExpanded(null);
  }, [page]);

  const totalPages = getTotalPages(sessions.length, pageSize);
  const visible = useMemo(
    () => paginateRecords([...sessions], page, pageSize),
    [sessions, page, pageSize],
  );
  const hasActions = renderAction !== undefined || renderDetail !== undefined;

  const renderComposition = (session: SessionSummary): React.ReactElement => (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {(session.reviewCount ?? 0) > 0 && (
        // ENT-07: records accepted for a not-operative student or before their enrolment.
        <Badge tone="warn" className="self-start">
          {session.reviewCount} por revisar
        </Badge>
      )}
      {/* Cards stack bar over counts; from `lg` the bar keeps a short fixed width with the counts beside it. */}
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <SessionCompositionBar
          counts={session.counts}
          total={session.total}
          className="lg:w-40 lg:flex-none"
        />
        <SessionCompositionCounts
          counts={session.counts}
          total={session.total}
          hideZero
        />
      </div>
    </div>
  );

  const renderActions = (session: SessionSummary): React.ReactNode => {
    const key = sessionKey(session);
    const isOpen = expanded === key;
    return (
      <div className="flex flex-col items-end gap-1.5">
        {renderAction?.(session)}
        {renderDetail && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={isOpen}
            aria-controls={`session-detail-${key}`}
            onClick={() => setExpanded(isOpen ? null : key)}
          >
            Registros
            <ChevronDown
              size={ICON.sm}
              strokeWidth={2}
              aria-hidden="true"
              className={isOpen ? "rotate-180" : undefined}
            />
          </Button>
        )}
      </div>
    );
  };

  // The panel opens right under its session, in whichever rendering is on
  // screen: the mobile cards and the desktop table both walk the same items,
  // and a copy in each would duplicate ids and every correction dialog.
  const renderPanel = (
    session: SessionSummary,
    view: "card" | "row",
  ): React.ReactElement | null => {
    if (!renderDetail || expanded !== sessionKey(session)) return null;
    if ((view === "row") !== isDesktop) return null;
    const panel = (
      <section
        id={`session-detail-${sessionKey(session)}`}
        data-testid="session-detail"
        aria-label={`Registros del ${formatDate(session.fecha)}, ${session.horario}`}
        className={
          view === "row"
            ? "border-t border-line bg-sunken px-4 py-3"
            : "-mx-4 -mb-4 border-t border-line bg-sunken px-4 py-3"
        }
      >
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-3">
          Registros · {formatDate(session.fecha)} · {session.horario}
        </h3>
        {renderDetail(session)}
      </section>
    );
    return view === "row" ? (
      <tr>
        <td colSpan={hasActions ? 4 : 3} className="p-0">
          {panel}
        </td>
      </tr>
    ) : (
      panel
    );
  };

  return (
    <div className="card flex flex-col overflow-hidden lg:min-h-[calc(100dvh-21rem)]">
      {sessions.length === 0 ? (
        <>
          {/* One row, not a centred column in a tall card: the period having
              no lists is one sentence and one way out. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-section px-5 py-4">
            <ClipboardList
              size={ICON.lg}
              strokeWidth={1.5}
              aria-hidden="true"
              className="flex-none text-ink-3"
            />
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-sm font-bold text-ink">
                No hay listas en este período
              </p>
              <p className="mt-0.5 text-sm text-ink-3">
                {rangeInvalid
                  ? // Covers both unusable states — one end missing, or the two
                    // ends inverted — because "complete las dos fechas" is wrong
                    // advice when both are already filled in.
                    "Ajuste el rango de fechas para ver las listas."
                  : "Cambia el rango o los filtros, o pasa lista para que aparezca aquí."}
              </p>
            </div>
            {/* The page header already carries the CTA on a phone; the empty
                state repeats it only where the header is far away. */}
            <div className="max-lg:hidden">{emptyAction}</div>
          </div>
          <GhostSessionRows count={pageSize - 1} />
        </>
      ) : (
        <ResponsiveListTable
          items={visible}
          getKey={sessionKey}
          mobileListTestId="history-mobile-list"
          desktopTableTestId="history-desktop-table"
          tableHead={
            <tr>
              <TableHeaderCell className="w-px">Sesión</TableHeaderCell>
              <TableHeaderCell>Registró</TableHeaderCell>
              <TableHeaderCell className="w-full">Resultado</TableHeaderCell>
              {hasActions && (
                <TableHeaderCell align="right">
                  <span className="sr-only">Acciones</span>
                </TableHeaderCell>
              )}
            </tr>
          }
          renderCard={(session) => (
            <li
              className="space-y-section px-4 py-4"
              data-testid={`history-mobile-card-${session.fecha}-${session.horarioId}`}
            >
              <div>
                <p className="font-semibold text-ink">
                  {formatDate(session.fecha)}
                </p>
                <p className="text-xs text-ink-3">{session.horario}</p>
              </div>
              <p className="text-sm text-ink-2">
                <span className="font-semibold text-ink">Registró: </span>
                {session.registradoPorNombre ?? NO_AUTHOR}
              </p>
              {renderComposition(session)}
              {hasActions && (
                <div className="flex justify-end">{renderActions(session)}</div>
              )}
              {renderPanel(session, "card")}
            </li>
          )}
          renderRow={(session) => (
            <>
              <TableRow>
                <TableNameCell
                  className="w-px whitespace-nowrap"
                  name={formatDate(session.fecha)}
                  sub={session.horario}
                />
                <TableCell>
                  {session.registradoPorNombre ? (
                    <span
                      className="block max-w-[240px] truncate"
                      title={session.registradoPorNombre}
                    >
                      {session.registradoPorNombre}
                    </span>
                  ) : (
                    NO_AUTHOR
                  )}
                </TableCell>
                <TableCell>{renderComposition(session)}</TableCell>
                {hasActions && (
                  <TableCell align="right">{renderActions(session)}</TableCell>
                )}
              </TableRow>
              {renderPanel(session, "row")}
            </>
          )}
          footer={
            <>
              {totalPages > 1 && (
                <Pagination
                  variant="footer"
                  page={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                  totalItems={sessions.length}
                  pageSize={pageSize}
                  itemNoun="sesión"
                  itemNounPlural="sesiones"
                />
              )}
            </>
          }
        />
      )}
      {sessions.length > 0 && totalPages <= 1 && (
        <GhostSessionRows
          count={pageSize - visible.length}
          caption="Las próximas listas aparecerán aquí."
        />
      )}
    </div>
  );
}
