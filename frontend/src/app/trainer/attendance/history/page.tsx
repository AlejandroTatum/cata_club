/**
 * Trainer — "Historial de asistencias"
 * (`docs/archive/prototypes/prototipos/21-entrenador-historial.html`).
 *
 * This route used to be a `redirect("/trainer")`: the history had been merged
 * into the trainer dashboard, which is what left that screen with two
 * quick-action cards, three stat cards, a four-control filter panel and a
 * paginated table competing for one scroll. The history is a separate errand
 * — it comes back to its own view, and "Mi día" keeps a single focus.
 *
 * ## Grouped by SESSION, not by student
 *
 * The prototype's reasoning, verbatim: *"el entrenador no busca «qué hizo Ana
 * el 14»; busca «la lista del lunes pasado»"*. So each row is one session,
 * with the four state counts in the row itself. A "Registró" column shows
 * who TOOK the list (issue #263, persisted `registrado_por_id`/nombre). Who
 * TAUGHT the session still isn't recorded (issue #13) — a separate fact.
 *
 * ## Filters
 *
 * Range, horario and alumno, rendered from the shared
 * `<AttendanceFilters>` panel (src/components/attendance/AttendanceFilters.tsx).
 * The three date presets this screen shipped with were not enough: the same
 * controls existed only on the admin's `/attendance`, which redirects a trainer
 * away, so "how did the Friday 17:00 group do?" and "what has Ana been doing
 * this term?" had no answer anywhere in the trainer's product. Grouping stays
 * by session; the filters just narrow what gets grouped.
 *
 * ## "Corregir" deep-links into the session (#95)
 *
 * Each row addresses its own roll call:
 * `/trainer/attendance?horario=<id>&fecha=<YYYY-MM-DD>&paso=lista`. Both
 * halves are load-bearing — the horario says which group, the fecha says
 * which day, and the same horario on two days is two different sessions. The
 * wizard opens on that roster with its filed marks already showing, and files
 * the correction back on that same date.
 *
 * This used to be documented here as a gap needing a backend field. It did
 * not: `AsistenciaResponseDTO` had always sent `horarioId` and the adapter
 * was dropping it. `AttendanceRecord` carries it now, so the row has an id
 * and not only the "Lunes 15:00 — 16:30" label, which is not reversible into
 * a horario.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ArrowRight, ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchAttendanceRecords, fetchTrainingSchedules } from "@/services/api";
import AttendanceFilters, { useAttendanceFilters } from "@/components/attendance/AttendanceFilters";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
  BackLink,
  buttonClasses,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import {
  getTotalPages,
  paginateRecords,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { formatDate } from "@/lib/format-utils";
import { calendarIsoDate, clubToday } from "@/lib/club-date";
import { groupRecordsBySession, type SessionSummary } from "../../trainer-day-utils";
import {
  SessionCompositionBar,
  SessionCompositionCounts,
} from "../../SessionComposition";
import { buildWizardQuery } from "../attendance-utils";

/** Sessions per page. */
const PAGE_SIZE = 10;

/** Corregir solo admite sesiones con hasta 30 días de antigüedad (issue #262). */
const LIMITE_CORRECCION_DIAS = 30;

/**
 * Where "Corregir" goes: that session's roll call, already open.
 *
 * Built through `buildWizardQuery` rather than by hand so the wizard stays
 * the single owner of its own address — the parameter names and the step
 * vocabulary ("lista") live in one module, and this screen cannot drift out
 * of sync with the page it links into.
 */
function buildCorrectionHref(session: SessionSummary): string {
  return `/trainer/attendance${buildWizardQuery(session.horarioId, session.fecha, "mark-attendance")}`;
}

export default function TrainerAttendanceHistoryPage(): React.ReactElement {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { session } = useAuth();
  const esAdmin = session?.user.role === "admin";
  // "Hoy - 30 días" resuelto en la zona del club, en YYYY-MM-DD para compararlo
  // lexicográficamente contra `sessionRow.fecha` (también YYYY-MM-DD).
  const corteCorreccion = useMemo(() => {
    const hoy = clubToday();
    const corte = new Date(hoy);
    corte.setDate(corte.getDate() - LIMITE_CORRECCION_DIAS);
    return calendarIsoDate(corte);
  }, []);

  const filters = useAttendanceFilters("this_month");
  const { query } = filters;

  const loadHistory = useCallback(async (): Promise<void> => {
    // A half-filled custom range shows no sessions rather than silently
    // falling back to "everything" — see `buildAttendanceQuery`.
    if (query === null) {
      setRecords([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchAttendanceRecords(query));
    } catch (err) {
      console.error("[trainer/attendance/history] loadHistory failed", err);
      setError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // The horario select needs the schedule list; a failure there only costs the
  // trainer that one filter, so it never blocks or errors the history itself.
  useEffect(() => {
    fetchTrainingSchedules()
      .then(setSchedules)
      .catch((err: unknown) => {
        console.error("[trainer/attendance/history] fetchTrainingSchedules failed", err);
      });
  }, []);

  const sessions = useMemo(() => groupRecordsBySession(records), [records]);

  // Back to page 1 whenever the result set changes — page 3 of a shorter list
  // is an empty screen with no explanation.
  useEffect(() => {
    setPage(1);
  }, [sessions.length]);

  const totalPages = getTotalPages(sessions.length, PAGE_SIZE);
  const visible = useMemo(() => paginateRecords(sessions, page, PAGE_SIZE), [sessions, page]);

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell
        title="Historial de asistencias"
        /*
         * The same link, with the same label and the same arrow, that `/attendance`
         * — this screen's admin twin, reading the same records — has carried in its
         * header since #74. Until now this one offered no way to pass a list at all
         * unless the table came back empty, so the action existed only in the state
         * where there was nothing to correct.
         */
        actions={
          <Link href="/trainer/attendance" className={buttonClasses("primary")}>
            Pasar lista
            <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <BackLink href="/trainer" className="mb-6" />

        <AttendanceFilters filters={filters} schedules={schedules} layout="row" />

        {loading && <LoadingState label="Cargando historial…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadHistory()} />}

        {!loading && !error && (
          <div className="card overflow-hidden">
            {sessions.length === 0 ? (
              <EmptyState surface="inset"
                icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="No hay listas en este período"
                description={
                  query === null
                    // Covers both unusable states — one end missing, or the
                    // two ends inverted — because "complete las dos fechas"
                    // is wrong advice when both are already filled in.
                    ? "Ajuste el rango de fechas para ver las listas."
                    : "Cambie el rango o los filtros, o pase lista para que aparezca aquí."
                }
                action={
                  <Link href="/trainer/attendance" className={buttonClasses("primary")}>
                    Pasar lista
                  </Link>
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHead>
                      <tr>
                        <TableHeaderCell>Sesión</TableHeaderCell>
                        <TableHeaderCell>Registró</TableHeaderCell>
                        <TableHeaderCell>Resultado</TableHeaderCell>
                        {/*
                         * "Corregir" is the only action this column has ever
                         * offered, and only an admin may correct an
                         * already-registered session (the same backend rule
                         * `renderReadOnlyReason` explains in the wizard, issue
                         * #310 / #27). For a trainer that action never exists,
                         * so the column itself — header included — is omitted
                         * rather than promising one under an "ACCIONES" label
                         * that stayed empty on every row.
                         */}
                        {esAdmin && (
                          <TableHeaderCell align="right">
                            <span className="sr-only">Acciones</span>
                          </TableHeaderCell>
                        )}
                      </tr>
                    </TableHead>
                    <TableBody>
                      {visible.map((sessionRow: SessionSummary) => (
                        <TableRow key={`${sessionRow.fecha}|${sessionRow.horario}`}>
                          <TableNameCell
                            name={formatDate(sessionRow.fecha)}
                            sub={sessionRow.horario}
                          />
                          <TableCell>
                            {sessionRow.registradoPorNombre ?? "No registrado"}
                          </TableCell>
                          <TableCell>
                            {/*
                              The composition, drawn the way the panel already
                              draws it on "Mi día" — see `SessionComposition`
                              for why there is only one drawing of it now. The
                              state name still rides along as real, visible
                              text: a bare "9" next to a colored dot would
                              force every reader to memorize what each color
                              meant.
                            */}
                            <div className="flex min-w-[220px] max-w-[420px] flex-col gap-2">
                              <SessionCompositionBar
                                counts={sessionRow.counts}
                                total={sessionRow.total}
                              />
                              <SessionCompositionCounts
                                counts={sessionRow.counts}
                                total={sessionRow.total}
                              />
                            </div>
                          </TableCell>
                          {esAdmin &&
                            (sessionRow.fecha >= corteCorreccion ? (
                              <TableCell align="right">
                                <Link
                                  href={buildCorrectionHref(sessionRow)}
                                  className={buttonClasses("secondary", "sm")}
                                >
                                  Corregir
                                </Link>
                              </TableCell>
                            ) : (
                              // Still an admin, so the header cell above exists —
                              // this keeps the row's columns aligned with it even
                              // when the 30-day window is the reason there is
                              // nothing to offer.
                              <TableCell align="right" />
                            ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <Pagination
                    variant="footer"
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    totalItems={sessions.length}
                    pageSize={PAGE_SIZE}
                    itemNoun="sesión"
                    itemNounPlural="sesiones"
                  />
                )}
              </>
            )}
          </div>
        )}

      </AppShell>
    </ProtectedRoute>
  );
}
