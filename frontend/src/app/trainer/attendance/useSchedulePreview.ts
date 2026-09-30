/**
 * The roster of the horario picked on step 1, for the aside's preview — who
 * would be on the list, before the trainer commits to opening it.
 *
 * Purely informational and best-effort: a failure leaves the preview empty
 * and never surfaces an error, because `openRoster` runs its own load (with
 * its own error path) when the trainer continues. Results are cached per
 * horario so flipping between tiles does not refetch.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { fetchAlumnosPorHorario } from "@/services/api";

export interface SchedulePreview {
  names: string[];
  loading: boolean;
}

export function useSchedulePreview(horarioId: number | null): SchedulePreview {
  const cache = useRef(new Map<number, string[]>());
  const [, bump] = useState(0);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  useEffect(() => {
    if (horarioId === null || cache.current.has(horarioId)) return;
    let cancelled = false;
    setLoadingId(horarioId);
    fetchAlumnosPorHorario(horarioId)
      .then((alumnos) => {
        cache.current.set(
          horarioId,
          alumnos.map((a) => a.personaNombreCompleto).sort((a, b) => a.localeCompare(b, "es")),
        );
      })
      .catch(() => {
        cache.current.set(horarioId, []);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingId(null);
        bump((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [horarioId]);

  if (horarioId === null) return { names: [], loading: false };
  const names = cache.current.get(horarioId);
  return { names: names ?? [], loading: names === undefined && loadingId === horarioId };
}
