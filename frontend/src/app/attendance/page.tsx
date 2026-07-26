/**
 * Asistencias — the admin's read-only view of training records, redesigned
 * for Fase 3. Source of truth: `docs/ux/prototipos/12-asistencias.html`.
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
 * Domain rule: schedules are NOT trainer-owned. `entrenadorId` on a Horario is
 * the titular trainer; the attendance record carries whoever actually
 * registered it, which can differ (substitution).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import AttendanceFilters, { useAttendanceFilters } from "@/components/attendance/AttendanceFilters";
import { ArrowRight, UserCheck } from "lucide-react";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import {
  Badge,
  buttonClasses,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  StatCard,
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
      <AppShell
        eyebrow="Horarios y registros"
        title="Asistencias"
        actions={
          <Link href="/trainer/attendance" className={buttonClasses("primary")}>
            Tomar asistencia
            <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Horarios" value={schedules.length} hint="sesiones semanales" />
          <StatCard label="Registros" value={stats.totalStudents} hint="en el rango elegido" />
          <StatCard
            label="Presentes"
            value={stats.totalPresent}
            unit={stats.totalStudents > 0 ? `${presentPercent}%` : undefined}
            hint="del total"
          />
          <StatCard
            label="Ausencias / tardanzas"
            value={stats.totalAbsent + stats.totalLate}
            hint="combinadas"
          />
        </div>

        <AttendanceFilters filters={filters} schedules={schedules} />

        {loading && <LoadingState label="Cargando registros…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => void loadRecords()} />}

        {!loading && !error && records.length === 0 && (
          <div className="rounded-card border border-line bg-paper">
            <EmptyState
              icon={<UserCheck size={21} strokeWidth={1.5} aria-hidden="true" />}
              title="No hay registros en este rango"
              description="Cambie el rango o los filtros, o registre una sesión de entrenamiento."
              action={
                <Link href="/trainer/attendance" className={buttonClasses("primary")}>
                  Tomar asistencia
                </Link>
              }
            />
          </div>
        )}

        {!loading && !error && records.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            <div className="overflow-x-auto">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Fecha</TableHeaderCell>
                    <TableHeaderCell>Horario</TableHeaderCell>
                    <TableHeaderCell>Estudiante</TableHeaderCell>
                    <TableHeaderCell>Estado</TableHeaderCell>
                    <TableHeaderCell>Registrado por</TableHeaderCell>
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
                      <TableCell>{record.entrenador}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <Pagination
                className="mt-0 border-t border-line px-4 py-3"
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
