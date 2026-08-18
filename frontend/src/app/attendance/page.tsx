/**
 * Asistencias — the admin's read-only view of training records, redesigned
 * for Fase 3. Source of truth: `docs/archive/prototypes/prototipos/12-asistencias.html`.
 *
 * What changed:
 *   · "Tomar asistencia" was a full-width banner card sitting above the data.
 *     It is now the header's primary button, which is where the one action of
 *     a screen belongs.
 *   · Range / horario / alumno filters, now living in the shared
 *     `<AttendanceFilters>` panel that the trainer's history renders too — the
 *     records endpoint has taken these parameters all along, this screen just
 *     never passed them and pulled the entire table every time.
 *   · Dates are humanised ("Hoy, 23 jul"), because the question this log
 *     answers is "how recent is this?".
 *   · "← Volver al Panel" is gone: the sidebar already does that.
 *
 * Domain rule (issue #13): schedules are NOT trainer-owned and attendance
 * does not record who taught the session — any trainer operates any session.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import AttendanceFilters, { useAttendanceFilters } from "@/components/attendance/AttendanceFilters";
import { UserCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  STAT_GRID,
  StatCard,
  StatTrack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import {
  buildAttendanceStats,
  formatHumanDate,
  getAttendanceBadgeTone,
  getAttendanceLabel,
  paginateRecords,
  getTotalPages,
  ATTENDANCE_PAGE_SIZE,
  type AttendanceRecord,
  type TrainingSchedule,
} from "./attendance-utils";

export default function AttendancePage(): React.ReactElement {
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filters = useAttendanceFilters("this_month");
  const { query } = filters;

  const loadSchedules = useCallback(async (): Promise<void> => {
    try {
      setSchedules(await fetchTrainingSchedules());
    } catch (err) {
      console.error("[attendance] fetchTrainingSchedules failed", err);
    }
  }, []);

  const loadRecords = useCallback(async (): Promise<void> => {
    /**
     * A custom range only queries once BOTH ends are set and ordered. An
     * incomplete range clears the table rather than leaving results that no
     * longer match the filters on screen.
     */
    if (query === null) {
      setRecords([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchAttendanceRecords(Object.keys(query).length > 0 ? query : undefined));
    } catch (err) {
      console.error("[attendance] fetchAttendanceRecords failed", err);
      setError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  // Reset to page 1 whenever the underlying set changes, so the paginator
  // never gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [records]);

  const stats = buildAttendanceStats(records);
  const presentPercent =
    stats.totalStudents > 0 ? Math.round((stats.totalPresent / stats.totalStudents) * 100) : 0;

  const totalPages = useMemo(() => getTotalPages(records.length), [records]);
  const paginatedRecords = useMemo(() => paginateRecords(records, page), [records, page]);

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      {/*
       * Sin acción en el encabezado. Llevaba "Tomar asistencia" desde #74,
       * apuntando al asistente del entrenador, que dejó de ofrecerse desde la
       * interfaz mientras se rehace dentro del área de miembros. Esta pantalla
       * es el registro que el administrador consulta: tomar la lista nunca fue
       * su trabajo, y no queda ningún verbo suyo para poner en el slot.
       */}
      <AppShell title="Asistencias">
        <div className={STAT_GRID}>
          <StatCard label="Horarios" value={schedules.length} hint="sesiones semanales" />
          <StatCard label="Registros" value={stats.totalStudents} hint="en el rango elegido" />
          {/* LA REGLA DE LA FORMA. "Presentes" is a proportion of "Registros"
              right beside it, and it stated the share as a bare "54%" glued to
              the figure with "del total" underneath — a sentence where the
              system has a shape. `StatTrack` is the piece, and `/members` and
              `/dashboard` now draw the same statistic the same way. */}
          <StatCard
            label="Presentes"
            value={stats.totalPresent}
            hint={
              <span className="flex flex-col gap-y-field">
                <StatTrack value={stats.totalPresent} total={stats.totalStudents} />
                <span>
                  {stats.totalStudents > 0 ? `${presentPercent}% del total` : "del total"}
                </span>
              </span>
            }
          />
          {/* "Ausencias / tardanzas · combinadas" was a slash compound holding
              two different states in one figure, with the caption spending its
              line to say that it did. The two counts exist separately — the
              donut on `/dashboard` draws them apart — so the caption states the
              split instead of announcing that there is one. No shoulder on this
              row and no `hot` tile: the shoulder marks what ASKS somebody to
              come and do it, and this screen reports a log rather than holding
              a queue. Marking one of four here would mark nothing. */}
          <StatCard
            label="Ausencias y tardanzas"
            value={stats.totalAbsent + stats.totalLate}
            hint={`${stats.totalAbsent} ausencias y ${stats.totalLate} tardanzas`}
          />
        </div>

        {/* The panel spans the page here, so its slots flow across the width.
            It used to stack three controls in the left 320px of a full-width
            card — 254px tall with the entire right half empty, which is the
            "espacios vacíos" reproche inside the block that is meant to be
            dense. The trainer's history draws this same component in the left
            third of its layout and keeps the column, which is why the axis is
            declared by the caller and not changed for everyone. */}
        <AttendanceFilters filters={filters} schedules={schedules} layout="row" />

        {loading && <LoadingState label="Cargando registros…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => void loadRecords()} />}

        {!loading && !error && records.length === 0 && (
          <EmptyState
            fill
            icon={<UserCheck size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
            title="No hay registros en este rango"
            description="Cambie el rango o los filtros para ver otros registros."
          />
        )}

        {!loading && !error && records.length > 0 && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Fecha</TableHeaderCell>
                    <TableHeaderCell>Horario</TableHeaderCell>
                    <TableHeaderCell>Estudiante</TableHeaderCell>
                    <TableHeaderCell>Estado</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableNameCell name={formatHumanDate(record.fecha)} />
                      <TableCell>{record.horario}</TableCell>
                      <TableCell className="font-semibold text-ink">{record.estudiante}</TableCell>
                      <TableCell>
                        <Badge tone={getAttendanceBadgeTone(record.estado)}>
                          {getAttendanceLabel(record.estado)}
                        </Badge>
                      </TableCell>
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
                totalItems={records.length}
                pageSize={ATTENDANCE_PAGE_SIZE}
                itemNoun="registro"
              />
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
