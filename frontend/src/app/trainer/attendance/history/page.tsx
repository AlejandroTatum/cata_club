/**
 * Trainer — "Historial de asistencias"
 * (`docs/ux/prototipos/21-entrenador-historial.html`).
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
 * with the four state counts in the row itself, and "Registró" is shown
 * because a substitution puts a different name there than the horario's
 * titular trainer — and the club needs to see that.
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
 * ## Known gap: "Corregir" cannot deep-link
 *
 * `AttendanceRecord` (src/app/attendance/attendance-utils.ts:61) carries the
 * horario only as a display string — there is no `horarioId` on the DTO. So
 * "Corregir" opens the wizard at step 1 with the day accordion, rather than
 * jumping straight into that session's roster. Closing that needs a backend
 * field, not a frontend workaround.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import { ClipboardList } from "lucide-react";
import { fetchAttendanceRecords, fetchTrainingSchedules } from "@/services/api";
import AttendanceFilters, { useAttendanceFilters } from "@/components/attendance/AttendanceFilters";
import {
  Badge,
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
  buttonClasses,
} from "@/components/ui";
import {
  getAttendanceBadgeTone,
  getAttendanceLabel,
  getTotalPages,
  paginateRecords,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { formatDate } from "@/lib/format-utils";
import { groupRecordsBySession, type SessionSummary } from "../../trainer-day-utils";

/** Sessions per page. */
const PAGE_SIZE = 10;

/** Best news first, same order as every other attendance surface. */
const STATE_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

export default function TrainerAttendanceHistoryPage(): React.ReactElement {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

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
      <AppShell eyebrow="Área de entrenadores" title="Historial de asistencias">
        <BackLink href="/trainer" label="Volver a Mi día" />

        <div className="mt-4 flex flex-col gap-4">
          <AttendanceFilters
            filters={filters}
            schedules={schedules}
            className="flex flex-col gap-4 rounded-card border border-line bg-paper p-[18px]"
          />

          {loading && <LoadingState label="Cargando historial…" />}

          {error && !loading && <ErrorState message={error} onRetry={() => loadHistory()} />}

          {!loading && !error && (
            <div className="overflow-hidden rounded-card border border-line bg-paper">
              {sessions.length === 0 ? (
                <EmptyState
                  icon={<ClipboardList size={21} strokeWidth={1.5} aria-hidden="true" />}
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
                          <TableHeaderCell align="right">
                            <span className="sr-only">Acciones</span>
                          </TableHeaderCell>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {visible.map((sessionRow: SessionSummary) => (
                          <TableRow key={`${sessionRow.fecha}|${sessionRow.horario}`}>
                            <TableNameCell
                              name={formatDate(sessionRow.fecha)}
                              sub={sessionRow.horario}
                            />
                            <TableCell>{sessionRow.registradoPor}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-[5px]">
                                {STATE_ORDER.map((estado) => (
                                  <Badge key={estado} tone={getAttendanceBadgeTone(estado)}>
                                    {sessionRow.counts[estado]}
                                    {/* A bare "9" tells a screen reader
                                        nothing; the state name rides along
                                        without changing the 26px pill. */}
                                    <span className="sr-only">
                                      {" "}
                                      {getAttendanceLabel(estado).toLowerCase()}
                                    </span>
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell align="right">
                              <Link
                                href="/trainer/attendance"
                                className={buttonClasses("secondary", "sm")}
                              >
                                Corregir
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {totalPages > 1 && (
                    <Pagination
                      className="mt-0 border-t border-line bg-canvas px-5 py-3.5"
                      page={page}
                      totalPages={totalPages}
                      onPageChange={setPage}
                      totalItems={sessions.length}
                      pageSize={PAGE_SIZE}
                      itemNoun="sesión"
                    />
                  )}
                </>
              )}
            </div>
          )}

          <p className="text-xs text-ink-3">
            Quien registró puede diferir del entrenador titular del horario — las suplencias
            quedan asentadas.
          </p>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
