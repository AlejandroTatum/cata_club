/**
 * Step 1's own state: which horarios exist, which day-groups are expanded,
 * and — issue #483 — how many attendance records the trailing club week
 * already has per horario, which is what "Esta lista ya fue tomada" reads.
 *
 * Lifted out of `TrainerAttendancePage` together, not split further: the
 * schedules list, the day accordion and the week-taken count are all read
 * off the SAME `schedules` load and none of them means anything without it.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { selectVisibleSchedules } from "@/app/attendance/attendance-utils";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import { clubIsoDate, todayDiaSemana, weekWindowStartIso } from "@/lib/club-date";
import { fetchAttendanceRecords, fetchTrainingSchedules } from "@/services/api";
import type { DiaSemana } from "@/types/domain";
import { countRecordsByHorario } from "./attendance-utils";

export interface AttendanceSchedules {
  schedules: TrainingSchedule[];
  loading: boolean;
  loadError: string | null;
  loadOptions: () => Promise<void>;
  /** Resolved every render — see the field's own note in the source. */
  today: DiaSemana;
  visible: ReturnType<typeof selectVisibleSchedules>;
  expandedDays: Set<DiaSemana>;
  toggleDay: (day: DiaSemana) => void;
  showAllDays: boolean;
  setShowAllDays: (updater: (prev: boolean) => boolean) => void;
  /** Per-horario attendance-record count for the trailing club week. */
  weekRecordCounts: Map<number, number>;
  selectedScheduleId: number | null;
  setSelectedScheduleId: (id: number | null) => void;
  selectedSchedule: TrainingSchedule | null;
  /** Issue #368/#483: the SELECTED horario already has a list on file, any day of the week. */
  selectedListTaken: boolean;
}

export function useAttendanceSchedules(): AttendanceSchedules {
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<DiaSemana>>(new Set());
  const [showAllDays, setShowAllDays] = useState(false);
  const [weekRecordCounts, setWeekRecordCounts] = useState<Map<number, number>>(new Map());

  const loadOptions = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError(null);
      const scheduleData = await fetchTrainingSchedules();
      setSchedules(scheduleData);
    } catch (err) {
      console.error("[trainer/attendance] loadOptions failed", err);
      setLoadError("Error al cargar horarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const today = todayDiaSemana();
  const visible = useMemo(
    () => selectVisibleSchedules(schedules, today, showAllDays),
    [schedules, today, showAllDays],
  );

  /** Open today's panel as soon as the schedules land — see the page's own note. */
  useEffect(() => {
    if (schedules.length === 0) return;
    const currentDay = todayDiaSemana();
    if (!schedules.some((s) => s.diaSemana === currentDay)) return;
    setExpandedDays((prev) => (prev.has(currentDay) ? prev : new Set(prev).add(currentDay)));
  }, [schedules]);

  /** Issue #310/#22, extended by #483 to the full trailing week — see the page's own note. */
  useEffect(() => {
    if (schedules.length === 0) return;
    let cancelled = false;
    fetchAttendanceRecords({ fechaInicio: weekWindowStartIso(), fechaFin: clubIsoDate() })
      .then((records) => {
        if (cancelled) return;
        setWeekRecordCounts(countRecordsByHorario(records));
      })
      .catch((err: unknown) => {
        console.error("[trainer/attendance] fetchAttendanceRecords week-counts failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [schedules]);

  const toggleDay = useCallback((day: DiaSemana): void => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }, []);

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) ?? null;
  const selectedListTaken =
    selectedSchedule !== null && (weekRecordCounts.get(selectedSchedule.id) ?? 0) > 0;

  return {
    schedules,
    loading,
    loadError,
    loadOptions,
    today,
    visible,
    expandedDays,
    toggleDay,
    showAllDays,
    setShowAllDays,
    weekRecordCounts,
    selectedScheduleId,
    setSelectedScheduleId,
    selectedSchedule,
    selectedListTaken,
  };
}
