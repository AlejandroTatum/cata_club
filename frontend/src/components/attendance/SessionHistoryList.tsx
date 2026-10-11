/**
 * The attendance history card: one row per SESSION, with the proportional
 * result bar and its counts, a "Registró" column and the footer pagination.
 * An empty period is one compact block, and a short list ends where its rows
 * end: skeleton rows under either read as a list that never finished loading.
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
  EmptyState,
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
  /** Sessions per page. */
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
    <div className="card flex flex-col overflow-hidden">
      {sessions.length === 0 ? (
        <EmptyState
          layout="row"
          surface="inset"
          icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} />}
          title="No hay listas en este período"
          description={
            rangeInvalid
              ? // Covers both unusable states — one end missing, or the two
                // ends inverted — because "complete las dos fechas" is wrong
                // advice when both are already filled in.
                "Ajuste el rango de fechas para ver las listas."
              : "Cambia el rango o los filtros, o pasa lista para que aparezca aquí."
          }
          // The page header already carries the CTA on a phone; the empty
          // state repeats it only where the header is far away.
          action={<div className="max-lg:hidden">{emptyAction}</div>}
        />
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
    </div>
  );
}
