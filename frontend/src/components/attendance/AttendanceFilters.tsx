/**
 * The attendance filter panel — range, horario and alumno — shared by the
 * admin's `/attendance` log and the trainer's `/trainer/attendance/history`.
 *
 * It lives here, and not inside either page, because the two screens had
 * already drifted: `/attendance` carried all four controls while the trainer's
 * history offered three date presets and nothing else. Since `/attendance`
 * redirects a trainer away, that drift meant the trainer simply lost the
 * ability to answer "how did the Friday 17:00 group do?" or "what has Ana been
 * doing this term?" — questions the records endpoint has always accepted
 * parameters for. One component, one vocabulary, no second drift.
 *
 * ## Container / presentational
 *
 * `useAttendanceFilters` owns the state and derives the query synchronously;
 * this component only renders it. The page keeps the derived `query` in its
 * fetch dependencies, so there is no effect syncing child state up to a parent
 * and no duplicate request on mount.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import StudentSearch from "@/components/StudentSearch";
import { Button, FilterPill } from "@/components/ui";
import { formatDay, type TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DateRangePreset } from "@/lib/club-date";
import type { PersonaBusqueda } from "@/types/domain";
import {
  buildAttendanceQuery,
  customRangeError,
  DATE_PRESETS,
  type AttendanceQuery,
} from "./attendance-filters-utils";

/** Everything the panel needs to render, plus the query the page should fetch. */
export interface AttendanceFiltersController {
  preset: DateRangePreset;
  setPreset: (preset: DateRangePreset) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  rangeError: string | null;
  scheduleId: number | null;
  setScheduleId: (id: number | null) => void;
  student: PersonaBusqueda | null;
  selectStudent: (student: PersonaBusqueda) => void;
  clearStudent: () => void;
  /** Bumped to ask `<StudentSearch>` to clear its own input (reset-signal pattern). */
  studentResetSignal: number;
  /** `null` while a custom range is incomplete — the page must show no rows. */
  query: AttendanceQuery | null;
}

/** State + derived query for the filter panel. */
export function useAttendanceFilters(
  initialPreset: DateRangePreset = "this_month",
): AttendanceFiltersController {
  const [preset, setPreset] = useState<DateRangePreset>(initialPreset);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [student, setStudent] = useState<PersonaBusqueda | null>(null);
  const [studentResetSignal, setStudentResetSignal] = useState(0);

  const clearStudent = useCallback(() => {
    setStudent(null);
    setStudentResetSignal((n) => n + 1);
  }, []);

  const query = useMemo(
    () =>
      buildAttendanceQuery({
        preset,
        customStart,
        customEnd,
        horarioId: scheduleId,
        personaId: student?.id ?? null,
      }),
    [preset, customStart, customEnd, scheduleId, student],
  );

  return {
    preset,
    setPreset,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    rangeError: preset === "custom" ? customRangeError(customStart, customEnd) : null,
    scheduleId,
    setScheduleId,
    student,
    selectStudent: setStudent,
    clearStudent,
    studentResetSignal,
    query,
  };
}

export interface AttendanceFiltersProps {
  filters: AttendanceFiltersController;
  /** Populates the horario select. Pass `[]` while they are still loading. */
  schedules: TrainingSchedule[];
  className?: string;
}

const FIELD_LABEL =
  "text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3";
const FIELD_CONTROL =
  "h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-[13px] text-ink outline-none focus:border-ink-3";

export default function AttendanceFilters({
  filters,
  schedules,
  className,
}: AttendanceFiltersProps): React.ReactElement {
  return (
    <section
      aria-label="Filtros de registros"
      className={
        className ??
        "mb-5 flex flex-col gap-4 rounded-card border border-line bg-paper p-[18px]"
      }
    >
      <div>
        <span className={`mb-2 block ${FIELD_LABEL}`}>Rango de fechas</span>
        <div className="flex flex-wrap gap-2">
          {DATE_PRESETS.map((option) => (
            <FilterPill
              key={option.key}
              label={option.label}
              active={filters.preset === option.key}
              onClick={() => filters.setPreset(option.key)}
            />
          ))}
        </div>

        {filters.preset === "custom" && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Fecha de inicio</span>
              <input
                type="date"
                aria-label="Fecha de inicio"
                value={filters.customStart}
                onChange={(e) => filters.setCustomStart(e.target.value)}
                className={FIELD_CONTROL}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Fecha límite</span>
              <input
                type="date"
                aria-label="Fecha límite"
                value={filters.customEnd}
                onChange={(e) => filters.setCustomEnd(e.target.value)}
                className={FIELD_CONTROL}
              />
            </label>
          </div>
        )}

        {filters.rangeError && (
          <p role="alert" className="mt-2 text-[12.5px] text-cata-red">
            {filters.rangeError}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Horario</span>
          <select
            aria-label="Filtrar por horario"
            value={filters.scheduleId ?? ""}
            onChange={(e) => filters.setScheduleId(e.target.value ? Number(e.target.value) : null)}
            className={FIELD_CONTROL}
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
          <span className={FIELD_LABEL}>Alumno</span>
          <StudentSearch
            onSelect={filters.selectStudent}
            placeholder="Buscar alumno…"
            resetSignal={filters.studentResetSignal}
          />
          {filters.student && (
            <Button size="sm" variant="ghost" className="self-start" onClick={filters.clearStudent}>
              Limpiar selección
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
