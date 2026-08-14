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
 *
 * ## The panel itself is not ours
 *
 * The bordered frame and the slot order come from `ui/FilterPanel`, which every
 * filtering screen now shares. This file used to hold that chrome in a local
 * class string, which is why it read as "the abstracted one" — it was not; it
 * is a domain component that happened to be the only one framing its controls.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import StudentSearch from "@/components/StudentSearch";
import ContextualHelp from "@/components/ContextualHelp";
import {
  FILTER_LABEL,
  FilterGroup,
  FilterPanel,
  FilterPill,
  type FilterPanelLayout,
} from "@/components/ui";
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
  /** Invalidate the selection — wired to `<StudentSearch>`'s own clear signal. */
  clearStudent: () => void;
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

  const clearStudent = useCallback(() => {
    setStudent(null);
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
    query,
  };
}

export interface AttendanceFiltersProps {
  filters: AttendanceFiltersController;
  /** Populates the horario select. Pass `[]` while they are still loading. */
  schedules: TrainingSchedule[];
  /**
   * Forwarded to `FilterPanel`. Two screens draw this component at two very
   * different widths — `/attendance` gives it the whole page, the trainer's
   * history gives it the left third — and the axis has to follow the column it
   * is standing in, not a default chosen for one of them. Stacked stays the
   * default because the narrow case is the one that breaks if it guesses wrong.
   */
  layout?: FilterPanelLayout;
  className?: string;
}

const FIELD_CONTROL =
  "h-ctl rounded-ctl border border-line-2 bg-paper px-3 text-sm text-ink outline-none focus:border-ink-3";

export default function AttendanceFilters({
  filters,
  schedules,
  layout = "column",
  className,
}: AttendanceFiltersProps): React.ReactElement {
  return (
    <FilterPanel
      label="Filtros de registros"
      layout={layout}
      className={className}
      search={
        <FilterGroup label="Alumno">
          <StudentSearch
            onSelect={filters.selectStudent}
            onClear={filters.clearStudent}
            placeholder="Buscar alumno…"
          />
        </FilterGroup>
      }
      chips={
        <FilterGroup label="Rango de fechas">
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
            <div className="flex flex-wrap items-end gap-section">
              <label className="flex flex-col gap-field">
                <span className={FILTER_LABEL}>Fecha de inicio</span>
                <input
                  type="date"
                  aria-label="Fecha de inicio"
                  value={filters.customStart}
                  onChange={(e) => filters.setCustomStart(e.target.value)}
                  className={FIELD_CONTROL}
                />
              </label>
              <label className="flex flex-col gap-field">
                <span className={FILTER_LABEL}>Fecha límite</span>
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
            <p role="alert" className="text-xs text-state-bad">
              {filters.rangeError}
            </p>
          )}
        </FilterGroup>
      }
      fields={
        <label className="flex flex-col gap-field">
          <span className={FILTER_LABEL}>Horario</span>
          <select
            aria-label="Filtrar por horario"
            value={filters.scheduleId ?? ""}
            onChange={(e) => filters.setScheduleId(e.target.value ? Number(e.target.value) : null)}
            className={FIELD_CONTROL}
          >
            <option value="">Todos los horarios</option>
            {schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {formatDay(schedule.diaSemana)} {schedule.horaInicio} — {schedule.horaFin}
              </option>
            ))}
          </select>
        </label>
      }
      // D11c — the caveat about what these controls reach, in the block that
      // holds them. An incomplete custom range makes the page render its empty
      // state ("no hay registros en este rango"), which is a claim about the
      // club rather than about the form: the query is simply not built yet.
      // The panel shows its own `role="alert"` about the range, but only once
      // both fields disagree; the half-filled case says nothing anywhere.
      help={
        <ContextualHelp title="Cómo funciona el filtro de registros">
          <ul className="flex flex-col gap-field">
            <li>
              Un rango personalizado necesita las dos fechas. Con una sola cargada el listado se
              muestra vacío porque todavía no hay rango que consultar, no porque el club no tenga
              registros.
            </li>
            <li>
              Los filtros se combinan: alumno, rango y horario se aplican a la vez, y el listado
              responde a los tres.
            </li>
          </ul>
        </ContextualHelp>
      }
    />
  );
}
