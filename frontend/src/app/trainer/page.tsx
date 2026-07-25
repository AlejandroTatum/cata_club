/**
 * Trainer Dashboard — today's real schedules, attendance summary, and
 * full attendance history (filterable + paginated) in one single page.
 *
 * Backend gap (see src/lib/server/attendance-adapter.ts): there's no API
 * exposing which NivelRanking (Grupo) a Horario belongs to, so a per-schedule
 * roster count ("Estudiantes Asignados") can't be derived honestly. Instead
 * this dashboard shows real, directly-queryable numbers: how many real
 * schedules fall on today (`GET /asistencias/horarios`) and how many
 * attendance records exist for today (`GET /asistencias/reportes?fecha_inicio=
 * fecha_fin=hoy`), reusing the same `buildAttendanceStats` the admin
 * `/attendance` page uses.
 *
 * Historial (previously at `/trainer/attendance/history`) was merged into
 * this page below the stats cards. The old page now redirects here.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import StudentSearch from "@/components/StudentSearch";
import {
  Calendar,
  Users,
  UserCheck,
  ClipboardList,
  ArrowRight,
  Trophy,
} from "lucide-react";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import { formatDate } from "@/lib/format-utils";
import {
  Badge,
  EmptyState,
  ErrorState,
  FilterPill,
  LoadingState,
  Pagination,
} from "@/components/ui";
import {
  buildAttendanceStats,
  getAttendanceBadgeTone,
  getAttendanceLabel,
  jsDayIndexToDiaSemana,
  formatDay,
  paginateRecords,
  getTotalPages,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import type { PersonaBusqueda } from "@/types/domain";
import { buildDateRange, type DateRangePreset } from "./trainer-history-utils";

/** Page size for the history list — 10 rows per page, as specified. */
const HISTORY_PAGE_SIZE = 10;

/** Date range presets for the history filter. */
const DATE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "this_week", label: "Esta semana" },
  { key: "this_month", label: "Este mes" },
  { key: "custom", label: "Rango personalizado" },
];

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AttendanceStateBadgeProps {
  estado: AttendanceRecord["estado"];
}

/**
 * Local equivalent of the admin `AttendancePage`'s (unexported) badge —
 * reuses the SAME shared tone/label helpers so estado colors stay
 * byte-identical to the admin view instead of a second drifting mapping.
 * The shape now comes from the `Badge` primitive rather than a hand-rolled
 * pill, so "byte-identical" is true of the geometry too, not just the color.
 */
function AttendanceStateBadge({ estado }: Readonly<AttendanceStateBadgeProps>): React.ReactElement {
  return <Badge tone={getAttendanceBadgeTone(estado)}>{getAttendanceLabel(estado)}</Badge>;
}

export default function TrainerPage(): React.ReactElement {
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- Historial state ---
  const [historyRecords, setHistoryRecords] = useState<AttendanceRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DateRangePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customDateError, setCustomDateError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<PersonaBusqueda | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  /**
   * Contador que se incrementa para pedirle al <StudentSearch> que resetee
   * su input cuando el padre limpia la selección externamente (botón
   * "Limpiar selección"). Pasado como `resetSignal` al componente.
   */
  const [studentSearchReset, setStudentSearchReset] = useState(0);

  const loadData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const today = todayIsoDate();
      const [scheduleData, recordData] = await Promise.all([
        fetchTrainingSchedules(),
        fetchAttendanceRecords({ fechaInicio: today, fechaFin: today }),
      ]);
      setSchedules(scheduleData);
      setTodayRecords(recordData);
    } catch (err) {
      console.error("[trainer] loadData failed", err);
      setError("Error al cargar el resumen de hoy");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const range = datePreset === "custom"
        ? { fechaInicio: customStart, fechaFin: customEnd }
        : buildDateRange(datePreset);

      const params: {
        fechaInicio?: string;
        fechaFin?: string;
        horarioId?: number;
        personaId?: number;
      } = {};
      if (range.fechaInicio) params.fechaInicio = range.fechaInicio;
      if (range.fechaFin) params.fechaFin = range.fechaFin;
      if (selectedScheduleId !== null) params.horarioId = selectedScheduleId;
      if (selectedStudent !== null) params.personaId = selectedStudent.id;

      const data = await fetchAttendanceRecords(
        Object.keys(params).length > 0 ? params : undefined,
      );
      setHistoryRecords(data);
    } catch (err) {
      console.error("[trainer] loadHistory failed", err);
      setHistoryError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setHistoryLoading(false);
    }
  }, [datePreset, customStart, customEnd, selectedScheduleId, selectedStudent]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /**
   * Dispara la carga del historial cuando:
   *  - El preset no es "custom" (rango derivado, siempre válido), o
   *  - Es "custom" Y ambas fechas están seteadas Y la fecha de fin no es
   *    menor que la de inicio (validación local, ver setCustomEnd handler).
   */
  useEffect(() => {
    if (datePreset !== "custom" || (customStart && customEnd && customEnd >= customStart)) {
      loadHistory();
    } else if (datePreset === "custom" && (!customStart || !customEnd)) {
      // Rango incompleto: limpia resultados previos en lugar de mostrarlos
      // desfasados con los filtros actuales.
      setHistoryRecords([]);
    }
  }, [datePreset, customStart, customEnd, selectedScheduleId, selectedStudent, loadHistory]);

  /** Resetea a página 1 cada vez que cambian los registros del historial. */
  useEffect(() => {
    setHistoryPage(1);
  }, [historyRecords]);

  const todayDia = jsDayIndexToDiaSemana(new Date().getDay());
  const todaySchedules = schedules.filter((s) => s.diaSemana === todayDia);
  const stats = buildAttendanceStats(todayRecords);
  const presentPercent = stats.totalStudents > 0 ? Math.round((stats.totalPresent / stats.totalStudents) * 100) : 0;

  const totalPages = useMemo(
    () => getTotalPages(historyRecords.length, HISTORY_PAGE_SIZE),
    [historyRecords.length],
  );
  const paginatedRecords = useMemo(
    () => paginateRecords(historyRecords, historyPage, HISTORY_PAGE_SIZE),
    [historyRecords, historyPage],
  );

  /** Validación: la fecha de fin no puede ser menor que la de inicio. */
  function handleCustomEndChange(value: string): void {
    setCustomEnd(value);
    if (customStart && value && value < customStart) {
      setCustomDateError("La fecha límite no puede ser menor que la fecha de inicio.");
      setHistoryRecords([]);
    } else {
      setCustomDateError(null);
    }
  }

  function handleCustomStartChange(value: string): void {
    setCustomStart(value);
    if (customEnd && value && customEnd < value) {
      setCustomDateError("La fecha límite no puede ser menor que la fecha de inicio.");
      setHistoryRecords([]);
    } else {
      setCustomDateError(null);
    }
  }

  function handleStudentSelect(alumno: PersonaBusqueda): void {
    setSelectedStudent(alumno);
  }

  return (
    <ProtectedRoute allowedRoles={["trainer"]}>
      <AppShell
        eyebrow="Área de entrenadores"
        title="Mi día"
      >
        {/* Quick Actions */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/trainer/attendance"
            className="group flex items-center gap-4 rounded-2xl border border-cata-fuchsia/20 bg-cata-fuchsia/10 px-5 py-4 transition-all duration-200 hover:border-cata-fuchsia/30 hover:bg-cata-fuchsia/15 hover:shadow-soft"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cata-fuchsia/15 text-cata-fuchsia-ink transition-colors group-hover:bg-cata-fuchsia/25">
              <ClipboardList size={20} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-cata-fuchsia-ink">Registrar Asistencia</span>
              <span className="block text-xs text-cata-fuchsia-ink/90">Sesiones de hoy en unos pasos</span>
            </span>
            <ArrowRight size={16} strokeWidth={1.5} className="text-cata-fuchsia-ink/60 transition-transform group-hover:translate-x-0.5 group-hover:text-cata-fuchsia-ink" aria-hidden="true" />
          </Link>
          <Link
            href="/trainer/nivel"
            className="group flex items-center gap-4 rounded-2xl border border-cata-fuchsia/20 bg-cata-fuchsia/10 px-5 py-4 transition-all duration-200 hover:border-cata-fuchsia/30 hover:bg-cata-fuchsia/15 hover:shadow-soft"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cata-fuchsia/15 text-cata-fuchsia-ink transition-colors group-hover:bg-cata-fuchsia/25">
              <Trophy size={20} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-cata-fuchsia-ink">Gestionar Nivel</span>
              <span className="block text-xs text-cata-fuchsia-ink/90">Asignar nivel a estudiantes</span>
            </span>
            <ArrowRight size={16} strokeWidth={1.5} className="text-cata-fuchsia-ink/60 transition-transform group-hover:translate-x-0.5 group-hover:text-cata-fuchsia-ink" aria-hidden="true" />
          </Link>
        </div>

        {/* Loading state */}
        {loading && <LoadingState label="Cargando resumen de hoy…" />}

        {/* Error state */}
        {error && !loading && (
          <ErrorState className="mb-8" message={error} onRetry={() => loadData()} />
        )}

        {/* Stats cards */}
        {!loading && !error && (
          <div className="mb-10 grid gap-5 sm:grid-cols-3">
            <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                <Calendar size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              </div>
              <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                Horarios de Hoy
              </p>
              <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{todaySchedules.length}</p>
            </div>
            <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                <Users size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              </div>
              <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                Asistencias Registradas Hoy
              </p>
              <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{stats.totalStudents}</p>
            </div>
            <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
                <UserCheck size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              </div>
              <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                Presentes Hoy
              </p>
              <p className="flex shrink-0 items-baseline gap-1.5 text-2xl font-bold tracking-tight text-cata-text">
                {stats.totalPresent}/{stats.totalStudents}
                <span className="text-xs font-semibold text-cata-state-ok">{presentPercent}%</span>
              </p>
            </div>
          </div>
        )}

        {/* Historial de Asistencias — integrado debajo de las estadísticas */}
        <section aria-labelledby="historial-asistencias-title" className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            <h2 id="historial-asistencias-title" className="text-lg font-bold text-cata-text">
              Historial de Asistencias
            </h2>
          </div>

          {/* Filters */}
          <div className="card mb-4 space-y-4 p-4">
            {/* Date range presets */}
            <div>
              <span className="mb-2 block text-xs font-medium text-cata-text/65">Rango de fechas</span>
              <div className="flex flex-wrap gap-2">
                {/* A closed set of four — pills, not bespoke buttons. The old
                    active state was red, which the design system reserves for
                    the primary CTA and for destructive/error: a red "Hoy"
                    read as an alarm about today. */}
                {DATE_PRESETS.map((preset) => (
                  <FilterPill
                    key={preset.key}
                    label={preset.label}
                    active={datePreset === preset.key}
                    onClick={() => setDatePreset(preset.key)}
                  />
                ))}
              </div>
              {datePreset === "custom" && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-cata-text/65">Fecha de inicio</span>
                    <input
                      type="date"
                      className="input-field"
                      aria-label="Fecha de inicio"
                      value={customStart}
                      onChange={(e) => handleCustomStartChange(e.target.value)}
                    />
                  </label>
                  <span className="mt-5 text-cata-text/45">—</span>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-medium text-cata-text/65">Fecha límite</span>
                    <input
                      type="date"
                      className="input-field"
                      aria-label="Fecha límite"
                      value={customEnd}
                      onChange={(e) => handleCustomEndChange(e.target.value)}
                    />
                  </label>
                </div>
              )}
              {customDateError && datePreset === "custom" && (
                <p className="mt-2 text-xs text-red-600" role="alert">
                  {customDateError}
                </p>
              )}
            </div>

            {/* Schedule + Student filters */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-cata-text/65">Horario</span>
                <select
                  className="input-field"
                  aria-label="Filtrar por horario"
                  value={selectedScheduleId ?? ""}
                  onChange={(e) => setSelectedScheduleId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Todos los horarios</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDay(s.diaSemana)} {s.horaInicio} — {s.horaFin} ({s.entrenadorNombre})
                    </option>
                  ))}
                </select>
              </label>
              <div className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-cata-text/65">Alumno</span>
                <StudentSearch
                  onSelect={handleStudentSelect}
                  placeholder="Buscar alumno…"
                  resetSignal={studentSearchReset}
                />
                {selectedStudent && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStudent(null);
                      setStudentSearchReset((n) => n + 1);
                    }}
                    className="mt-2 text-xs text-cata-red hover:underline"
                  >
                    Limpiar selección
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* History loading state */}
          {historyLoading && <LoadingState label="Cargando historial…" />}

          {/* History error state */}
          {historyError && !historyLoading && (
            <ErrorState className="mb-4" message={historyError} onRetry={() => loadHistory()} />
          )}

          {/* History table / empty state */}
          {!historyLoading && !historyError && (
            <>
              {historyRecords.length > 0 ? (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-cata-border bg-cata-bg text-xs font-medium uppercase tracking-wider text-cata-text/65">
                          <th className="px-4 py-3 font-medium">Fecha</th>
                          <th className="px-4 py-3 font-medium">Alumno</th>
                          <th className="px-4 py-3 font-medium">Horario</th>
                          <th className="px-4 py-3 font-medium">Estado</th>
                          <th className="px-4 py-3 font-medium">Entrenador</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cata-border">
                        {paginatedRecords.map((record) => (
                          <tr key={record.id} className="transition-colors hover:bg-cata-bg">
                            <td className="px-4 py-3 text-xs tabular-nums text-cata-text/65">{formatDate(record.fecha)}</td>
                            <td className="px-4 py-3 text-sm font-medium text-cata-text">{record.estudiante}</td>
                            <td className="px-4 py-3 text-xs text-cata-text">{record.horario}</td>
                            <td className="px-4 py-3">
                              <AttendanceStateBadge estado={record.estado} />
                            </td>
                            <td className="px-4 py-3 text-xs text-cata-text/65">{record.entrenador}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <Pagination
                      className="mt-0 border-t border-cata-border bg-cata-bg px-4 py-3"
                      page={historyPage}
                      totalPages={totalPages}
                      onPageChange={setHistoryPage}
                      totalItems={historyRecords.length}
                      pageSize={HISTORY_PAGE_SIZE}
                      itemNoun="registro"
                    />
                  )}
                </div>
              ) : (
                <div className="card">
                  <EmptyState
                    icon={<ClipboardList size={21} strokeWidth={1.5} aria-hidden="true" />}
                    title="No se encontraron registros de asistencia"
                    description="Ningún registro coincide con los filtros seleccionados. Amplíe el rango de fechas o quite un filtro."
                  />
                </div>
              )}
            </>
          )}
        </section>
      </AppShell>
    </ProtectedRoute>
  );
}
