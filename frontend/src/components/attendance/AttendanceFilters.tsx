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
import {
  FILTER_LABEL,
  FilterGroup,
  FilterPanel,
  FilterPill,
  type FilterPanelLayout,
} from "@/components/ui";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DateRangePreset } from "@/lib/club-date";
import type { PersonaBusqueda } from "@/types/domain";
import {
  buildAttendanceQuery,
  buildScheduleSlots,
  customRangeError,
  DATE_PRESETS,
  resolveScheduleFilter,
  slotDayOptions,
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
  /** The chosen slot (category + times, any day); `null` = every horario. */
  slotKey: string | null;
  /** Picking a slot always resets the day to "Todos los días". */
  setSlotKey: (key: string | null) => void;
  /** One horario of the slot; `null` = every day of the slot. */
  dayId: number | null;
  setDayId: (id: number | null) => void;
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
  schedules: readonly TrainingSchedule[] = [],
): AttendanceFiltersController {
  const [preset, setPreset] = useState<DateRangePreset>(initialPreset);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [slotKey, setSlotKeyState] = useState<string | null>(null);
  const [dayId, setDayId] = useState<number | null>(null);
  const [student, setStudent] = useState<PersonaBusqueda | null>(null);

  const clearStudent = useCallback(() => {
    setStudent(null);
  }, []);

  const setSlotKey = useCallback((key: string | null) => {
    setSlotKeyState(key);
    setDayId(null);
  }, []);

  const slots = useMemo(() => buildScheduleSlots(schedules), [schedules]);

  // Resolved to primitives on purpose: `schedules` arrive after the first
  // render, and a query rebuilt on that alone would refetch for nothing.
  const { horarioId, horarioIds } = resolveScheduleFilter(slots, slotKey, dayId);
  const horarioIdsKey = horarioIds?.join(",");

  const query = useMemo(
    () =>
      buildAttendanceQuery({
        preset,
        customStart,
        customEnd,
        horarioId: horarioId ?? null,
        horarioIds: horarioIdsKey === undefined ? undefined : horarioIdsKey.split(",").map(Number),
        personaId: student?.id ?? null,
      }),
    [preset, customStart, customEnd, horarioId, horarioIdsKey, student],
  );

  return {
    preset,
    setPreset,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    rangeError: preset === "custom" ? customRangeError(customStart, customEnd) : null,
    slotKey,
    setSlotKey,
    dayId,
    setDayId,
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
   * Forwarded to `FilterPanel`. Both screens that draw this component —
   * `/attendance` and the trainer's history — give it the WHOLE page, and both
   * pass `row`. Neither has ever stood it in a rail; the note that said the
   * history did was wrong, and the history spent that time stacked across
   * 1408px because of it (issue #375).
   *
   * The prop stays anyway, because the axis belongs to the screen and not to
   * this component. What decides it is written once, on `AXIS` in
   * `ui/FilterPanel.tsx`; `column` is the default there, so it is the default
   * here.
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
  const slots = useMemo(() => buildScheduleSlots(schedules), [schedules]);
  const selectedSlot = slots.find((slot) => slot.key === filters.slotKey);
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
            placeholder="Buscar jugador…"
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
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-field">
            <span className={FILTER_LABEL}>Horario</span>
            <select
              aria-label="Filtrar por horario"
              value={filters.slotKey ?? ""}
              onChange={(e) => filters.setSlotKey(e.target.value || null)}
              className={FIELD_CONTROL}
            >
              <option value="">Todos los horarios</option>
              {slots.map((slot) => (
                <option key={slot.key} value={slot.key}>
                  {slot.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-field">
            <span className={FILTER_LABEL}>Día</span>
            <select
              aria-label="Filtrar por día"
              value={filters.dayId ?? ""}
              disabled={selectedSlot === undefined}
              onChange={(e) => filters.setDayId(e.target.value ? Number(e.target.value) : null)}
              className={`${FIELD_CONTROL} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <option value="">Todos los días</option>
              {slotDayOptions(selectedSlot).map((day) => (
                <option key={day.id} value={day.id}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    />
  );
}
