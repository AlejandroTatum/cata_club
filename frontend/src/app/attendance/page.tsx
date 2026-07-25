/**
 * Asistencias — Admin overview of training schedules and attendance.
 *
 * Admin can view real schedules (Horario, from `GET /asistencias/horarios`)
 * and attendance records (Asistencia, from `GET /asistencias/reportes`), both
 * proxied through `/api/attendance/*` (see src/lib/server/attendance-adapter.ts).
 * No CRUD operations yet — read-only, same as the original prototype.
 *
 * Domain rule: schedules are NOT trainer-owned. `entrenadorId` on a Horario
 * is the titular trainer by default; the attendance record itself carries
 * whoever actually registered it, which can differ (substitution).
 *
 * Backend gap: `HorarioResponseDTO` has no `cancha`, `cupoMaximo`, `activo`,
 * or nivel/group linkage — those existed only in the frontend mock and have
 * no real equivalent yet, so this page no longer shows them (see the
 * attendance-adapter.ts docstring for the full gap writeup).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import {
  Calendar,
  UserCheck,
  ClipboardCheck,
  CheckCircle2,
  Clock3,
  ChevronRight,
} from "lucide-react";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import { formatDate } from "@/lib/format-utils";
import {
  Badge,
  buttonClasses,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
} from "@/components/ui";
import {
  buildAttendanceStats,
  getAttendanceBadgeTone,
  getAttendanceLabel,
  paginateRecords,
  getTotalPages,
  ATTENDANCE_PAGE_SIZE,
  type AttendanceRecord,
  type TrainingSchedule,
} from "./attendance-utils";

// ---------------------------------------------------------------------------
// Attendance state badge
// ---------------------------------------------------------------------------

/**
 * The four attendance states, rendered through the shared `Badge`.
 *
 * The per-state icon that used to prefix the label is gone: `Badge` already
 * carries a `currentColor` dot, so an icon on top of it was a second status
 * marker for one status — and the `AlertTriangle` used for "justificado" read
 * as a warning about a state that is, by definition, fine.
 */
function AttendanceBadge({ estado }: { estado: string }): React.ReactElement {
  return <Badge tone={getAttendanceBadgeTone(estado)}>{getAttendanceLabel(estado)}</Badge>;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AttendancePage(): React.ReactElement {
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordsPage, setRecordsPage] = useState(1);

  const loadData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const [scheduleData, recordData] = await Promise.all([
        fetchTrainingSchedules(),
        fetchAttendanceRecords(),
      ]);
      setSchedules(scheduleData);
      setRecords(recordData);
    } catch (err) {
      console.error("[attendance] loadData failed", err);
      setError("Error al cargar horarios y asistencias");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset to page 1 whenever the underlying records set changes (e.g. after
  // a reload), so the paginator never gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setRecordsPage(1);
  }, [records]);

  const stats = buildAttendanceStats(records);

  const recordsTotalPages = useMemo(() => getTotalPages(records.length), [records]);
  const paginatedRecords = useMemo(
    () => paginateRecords(records, recordsPage),
    [records, recordsPage],
  );

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        eyebrow="Horarios y registros"
        title="Asistencias"
      >
        <BackLink href="/dashboard" label="Volver al Panel" />

        {/* Loading state */}
        {loading && <LoadingState label="Cargando horarios y asistencias…" />}

        {/* Error state */}
        {error && !loading && (
          <ErrorState className="mb-8" message={error} onRetry={() => loadData()} />
        )}

        {!loading && !error && (
          <>
            {/* Quick action: take attendance — replaces the removed
                "Horarios de Entrenamiento" table (PR3), which added no
                real value; admins can now register attendance too. */}
            <div className="card-hover mb-8 flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                  <ClipboardCheck size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-cata-text">Tomar asistencia</h2>
                  <p className="text-sm text-cata-text/65">
                    Registra la asistencia de una sesión de entrenamiento.
                  </p>
                </div>
              </div>
              <Link
                href="/trainer/attendance"
                className={buttonClasses("primary", "md", "w-full sm:w-auto")}
              >
                Tomar asistencia
                <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
              </Link>
            </div>

            {/* Stats grid */}
            <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                  <Calendar size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                </div>
                <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                  Horarios
                </p>
                <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{schedules.length}</p>
              </div>

              <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                  <UserCheck size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                </div>
                <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                  Asistencias registradas
                </p>
                <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{stats.totalStudents}</p>
              </div>

              <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                  <CheckCircle2 size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                </div>
                <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                  Presentes
                </p>
                <p className="flex shrink-0 items-baseline gap-1.5 text-2xl font-bold tracking-tight text-cata-text">
                  {stats.totalPresent}
                  <span className="text-xs font-semibold text-cata-state-ok">
                    {stats.totalStudents > 0
                      ? `${Math.round((stats.totalPresent / stats.totalStudents) * 100)}%`
                      : "N/A"}
                  </span>
                </p>
              </div>

              <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                  <Clock3 size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                </div>
                <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                  Ausencias / Tardanzas
                </p>
                <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">
                  {stats.totalAbsent + stats.totalLate}
                </p>
              </div>
            </div>

            {/* Recent attendance section */}
            <div className="mb-8">
              <div className="mb-4 flex items-center gap-2">
                <UserCheck size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                <h2 className="text-lg font-bold text-cata-text">
                  Registros de Asistencia
                </h2>
              </div>

              {records.length > 0 ? (
                <>
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-cata-border bg-cata-bg text-xs font-medium uppercase tracking-wider text-cata-text/65">
                            <th className="px-4 py-3 font-medium">Fecha</th>
                            <th className="px-4 py-3 font-medium">Horario</th>
                            <th className="px-4 py-3 font-medium">Estudiante</th>
                            <th className="px-4 py-3 font-medium">Estado</th>
                            <th className="px-4 py-3 font-medium">Registrado por</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-cata-border">
                          {paginatedRecords.map((record) => (
                            <tr key={record.id} className="transition-colors hover:bg-cata-bg">
                              <td className="px-4 py-3 text-xs tabular-nums text-cata-text/65">
                                {formatDate(record.fecha)}
                              </td>
                              <td className="px-4 py-3 text-xs text-cata-text">
                                {record.horario}
                              </td>
                              <td className="px-4 py-3 text-sm font-medium text-cata-text">
                                {record.estudiante}
                              </td>
                              <td className="px-4 py-3">
                                <AttendanceBadge estado={record.estado} />
                              </td>
                              <td className="px-4 py-3 text-xs text-cata-text/65">
                                <span className="flex items-center gap-1.5">
                                  <UserCheck size={11} strokeWidth={1.5} aria-hidden="true" />
                                  {record.entrenador}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {recordsTotalPages > 1 && (
                    <Pagination
                      page={recordsPage}
                      totalPages={recordsTotalPages}
                      onPageChange={setRecordsPage}
                      totalItems={records.length}
                      pageSize={ATTENDANCE_PAGE_SIZE}
                      itemNoun="registro"
                    />
                  )}
                </>
              ) : (
                <div className="card">
                  <EmptyState
                    icon={<UserCheck size={21} strokeWidth={1.5} aria-hidden="true" />}
                    title="Aún no hay registros de asistencia"
                    description="Cuando se registre una sesión de entrenamiento, sus asistencias aparecerán aquí."
                    action={
                      <Link href="/trainer/attendance" className={buttonClasses("primary")}>
                        Tomar asistencia
                      </Link>
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
