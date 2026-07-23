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
import {
  Calendar,
  Clock,
  UserCheck,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock3,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import {
  buildAttendanceStats,
  getAttendanceBadgeTokens,
  ATTENDANCE_LABELS,
  paginateRecords,
  getTotalPages,
  type AttendanceRecord,
  type TrainingSchedule,
} from "./attendance-utils";

// ---------------------------------------------------------------------------
// Attendance state icon
// ---------------------------------------------------------------------------

interface AttendanceIconProps {
  estado: string;
}

function AttendanceIcon({ estado }: AttendanceIconProps): React.ReactElement {
  const { iconClass } = getAttendanceBadgeTokens(estado);
  switch (estado) {
    case "present":
      return <CheckCircle2 size={12} strokeWidth={2} className={iconClass} aria-hidden="true" />;
    case "absent":
      return <XCircle size={12} strokeWidth={2} className={iconClass} aria-hidden="true" />;
    case "late":
      return <Clock3 size={12} strokeWidth={2} className={iconClass} aria-hidden="true" />;
    case "justified":
      return <AlertTriangle size={12} strokeWidth={2} className={iconClass} aria-hidden="true" />;
    default:
      return <HelpCircle size={12} strokeWidth={2} className={iconClass} aria-hidden="true" />;
  }
}

interface AttendanceBadgeProps {
  estado: string;
}

function AttendanceBadge({ estado }: AttendanceBadgeProps): React.ReactElement {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
  const { badgeClass } = getAttendanceBadgeTokens(estado);
  const safeLabel = ATTENDANCE_LABELS[estado as keyof typeof ATTENDANCE_LABELS] ?? "Desconocido";
  return (
    <span className={`${base} ${badgeClass}`}>
      <AttendanceIcon estado={estado} />
      {safeLabel}
    </span>
  );
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
        eyebrow="Asistencias"
        title="Asistencias"
      >
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-2">
              <Clock size={16} strokeWidth={1.5} className="animate-spin text-cata-text/65" aria-hidden="true" />
              <p className="text-sm text-cata-text/50">Cargando horarios y asistencias...</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="card mb-8 border border-red-200 bg-red-50 p-6 text-center">
            <XCircle size={32} strokeWidth={1.5} className="mx-auto mb-3 text-red-700" aria-hidden="true" />
            <p className="text-sm text-cata-red">{error}</p>
            <button type="button" onClick={() => loadData()} className="btn-ghost mt-3 text-xs text-cata-red">
              Reintentar
            </button>
          </div>
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
              <Link href="/trainer/attendance" className="btn-primary w-full shadow-soft sm:w-auto">
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
                              <td className="px-4 py-3 text-xs text-cata-text/65">
                                {record.fecha}
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
                    <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
                      <p className="text-sm font-semibold text-cata-text">
                        Página {recordsPage} de {recordsTotalPages}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRecordsPage((p) => Math.max(1, p - 1))}
                          disabled={recordsPage <= 1}
                          className="btn-secondary px-4 py-2 text-xs"
                        >
                          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                          Anterior
                        </button>
                        <button
                          type="button"
                          onClick={() => setRecordsPage((p) => Math.min(recordsTotalPages, p + 1))}
                          disabled={recordsPage >= recordsTotalPages}
                          className="btn-secondary px-4 py-2 text-xs"
                        >
                          Siguiente
                          <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="card flex flex-col items-center py-12 text-center">
                  <UserCheck size={32} strokeWidth={1.5} className="mb-3 text-cata-text/20" aria-hidden="true" />
                  <p className="text-sm text-cata-text/50">
                    Aún no hay registros de asistencia.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
