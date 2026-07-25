/**
 * Asistencias — the admin's read-only view of training records, redesigned
 * for Fase 3. Source of truth: `docs/ux/prototipos/12-asistencias.html`.
 *
 * What changed:
 *   · "Tomar asistencia" was a full-width banner card sitting above the data.
 *     It is now the header's primary button, which is where the one action of
 *     a screen belongs.
 *   · Range / horario / alumno filters, reusing the exact controls and the
 *     `buildDateRange` helper the trainer dashboard already uses — the records
 *     endpoint has taken these parameters all along, this screen just never
 *     passed them and pulled the entire table every time.
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
import StudentSearch from "@/components/StudentSearch";
import { ArrowRight, UserCheck } from "lucide-react";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import type { PersonaBusqueda } from "@/types/domain";
import { buildDateRange, type DateRangePreset } from "@/app/trainer/trainer-history-utils";
import {
  Badge,
  Button,
  buttonClasses,
  EmptyState,
  ErrorState,
  FilterPill,
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
  formatDay,
  formatHumanDate,
  getAttendanceBadgeTone,
  getAttendanceLabel,
  paginateRecords,
  getTotalPages,
  ATTENDANCE_PAGE_SIZE,
  type AttendanceRecord,
  type TrainingSchedule,
} from "./attendance-utils";

const RANGE_ERROR = "La fecha límite no puede ser menor que la fecha de inicio.";

/** The same four presets the trainer history uses — one vocabulary, one helper. */
const DATE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Hoy" },
  { key: "this_week", label: "Esta semana" },
  { key: "this_month", label: "Este mes" },
  { key: "custom", label: "Rango personalizado" },
];

export default function AttendancePage(): React.ReactElement {
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [datePreset, setDatePreset] = useState<DateRangePreset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customDateError, setCustomDateError] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [student, setStudent] = useState<PersonaBusqueda | null>(null);
  /** Bumped to ask <StudentSearch> to clear its own input (reset-signal pattern). */
  const [studentSearchReset, setStudentSearchReset] = useState(0);

  const loadSchedules = useCallback(async (): Promise<void> => {
    try {
      setSchedules(await fetchTrainingSchedules());
    } catch (err) {
      console.error("[attendance] fetchTrainingSchedules failed", err);
    }
  }, []);

  const loadRecords = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const range =
        datePreset === "custom"
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
      if (scheduleId !== null) params.horarioId = scheduleId;
      if (student !== null) params.personaId = student.id;

      setRecords(await fetchAttendanceRecords(Object.keys(params).length > 0 ? params : undefined));
    } catch (err) {
      console.error("[attendance] fetchAttendanceRecords failed", err);
      setError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setLoading(false);
    }
  }, [datePreset, customStart, customEnd, scheduleId, student]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  /**
   * A custom range only queries once BOTH ends are set and ordered. An
   * incomplete range clears the table rather than leaving results that no
   * longer match the filters on screen.
   */
  useEffect(() => {
    if (datePreset !== "custom" || (customStart && customEnd && customEnd >= customStart)) {
      void loadRecords();
    } else {
      setRecords([]);
      setLoading(false);
    }
  }, [datePreset, customStart, customEnd, scheduleId, student, loadRecords]);

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

  function handleCustomStartChange(value: string): void {
    setCustomStart(value);
    setCustomDateError(customEnd && value && customEnd < value ? RANGE_ERROR : null);
  }

  function handleCustomEndChange(value: string): void {
    setCustomEnd(value);
    setCustomDateError(customStart && value && value < customStart ? RANGE_ERROR : null);
  }

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

        <section
          aria-label="Filtros de registros"
          className="mb-5 flex flex-col gap-4 rounded-card border border-line bg-paper p-[18px]"
        >
          <div>
            <span className="mb-2 block text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
              Rango de fechas
            </span>
            <div className="flex flex-wrap gap-2">
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
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                    Fecha de inicio
                  </span>
                  <input
                    type="date"
                    aria-label="Fecha de inicio"
                    value={customStart}
                    onChange={(e) => handleCustomStartChange(e.target.value)}
                    className="h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-[13px] text-ink outline-none focus:border-ink-3"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                    Fecha límite
                  </span>
                  <input
                    type="date"
                    aria-label="Fecha límite"
                    value={customEnd}
                    onChange={(e) => handleCustomEndChange(e.target.value)}
                    className="h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-[13px] text-ink outline-none focus:border-ink-3"
                  />
                </label>
              </div>
            )}
            {customDateError && datePreset === "custom" && (
              <p role="alert" className="mt-2 text-[12.5px] text-cata-red">
                {customDateError}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                Horario
              </span>
              <select
                aria-label="Filtrar por horario"
                value={scheduleId ?? ""}
                onChange={(e) => setScheduleId(e.target.value ? Number(e.target.value) : null)}
                className="h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-[13px] text-ink outline-none focus:border-ink-3"
              >
                <option value="">Todos los horarios</option>
                {schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    {formatDay(schedule.diaSemana)} {schedule.horaInicio} — {schedule.horaFin} (
                    {schedule.entrenadorNombre})
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                Alumno
              </span>
              <StudentSearch
                onSelect={setStudent}
                placeholder="Buscar alumno…"
                resetSignal={studentSearchReset}
              />
              {student && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => {
                    setStudent(null);
                    setStudentSearchReset((n) => n + 1);
                  }}
                >
                  Limpiar selección
                </Button>
              )}
            </div>
          </div>
        </section>

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
