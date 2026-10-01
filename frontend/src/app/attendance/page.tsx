/**
 * Asistencias — the admin's read-only view of training records, redesigned
 * for Fase 3. Source of truth: `docs/archive/prototypes/prototipos/12-asistencias.html`.
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
 * Domain rule (issue #13): schedules are NOT trainer-owned and attendance
 * does not record who taught the session — any trainer operates any session.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import AttendanceFilters, {
  useAttendanceFilters,
} from "@/components/attendance/AttendanceFilters";
import {
  narrowSchedules,
  narrowToHorarios,
  toApiParams,
} from "@/components/attendance/attendance-filters-utils";
import AttendancePeriodRail from "@/components/attendance/AttendancePeriodRail";
import SessionHistoryList, {
  sessionKey,
} from "@/components/attendance/SessionHistoryList";
import { type AttendanceCorrectionPatch } from "@/app/attendance/AttendanceCorrectionAction";
import SessionRecordsPanel from "@/app/attendance/SessionRecordsPanel";
import { groupRecordsBySession } from "@/app/trainer/trainer-day-utils";
import { ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { fetchTrainingSchedules, fetchAttendanceRecords } from "@/services/api";
import {
  buttonClasses,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
} from "@/components/ui";
import {
  ATTENDANCE_PAGE_SIZE,
  type AttendanceRecord,
  type TrainingSchedule,
} from "./attendance-utils";

export default function AttendancePage(): React.ReactElement {
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useAttendanceFilters("this_month", schedules);
  const { query } = filters;
  // The API takes one horarioId; a slot's "Todos los días" narrows client-side.
  const apiParams = useMemo(() => (query ? toApiParams(query) : {}), [query]);

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
      setRecords(
        await fetchAttendanceRecords(
          Object.keys(apiParams).length > 0 ? apiParams : undefined,
        ),
      );
    } catch (err) {
      console.error("[attendance] fetchAttendanceRecords failed", err);
      setError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setLoading(false);
    }
  }, [query, apiParams]);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const scopedRecords = useMemo(() => narrowToHorarios(records, query), [records, query]);
  const scopedSchedules = useMemo(() => narrowSchedules(schedules, query), [schedules, query]);
  const sessions = useMemo(() => groupRecordsBySession(scopedRecords), [scopedRecords]);
  const recordsBySession = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const record of scopedRecords) {
      const key = sessionKey(record);
      map.set(key, [...(map.get(key) ?? []), record]);
    }
    return map;
  }, [scopedRecords]);

  // Issue #663: patches the corrected row in place, same idiom as the
  // trainer roster's `handleRowCorrected` — a fresh `fetchAttendanceRecords`
  // round trip is not needed to reflect what the PATCH response already
  // confirmed.
  const handleCorrected = useCallback(
    (recordId: string, patch: AttendanceCorrectionPatch): void => {
      setRecords((prev) =>
        prev.map((record) =>
          record.id === recordId
            ? {
                ...record,
                estado: patch.estado,
                justificativo: patch.justificativo,
                estadoJustificativo: patch.estadoJustificativo,
              }
            : record,
        ),
      );
    },
    [],
  );

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Asistencias"
        subtitle="El registro de quién entrenó, y cuándo."
        actions={
          <Link href="/trainer/attendance" className={buttonClasses("primary")}>
            Tomar asistencia
            <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        {/* The panel spans the page here, so its slots flow across the width.
            It used to stack three controls in the left 320px of a full-width
            card — 254px tall with the entire right half empty, which is the
            "espacios vacíos" reproche inside the block that is meant to be
            dense. The trainer's history draws this same component in the left
            third of its layout and keeps the column, which is why the axis is
            declared by the caller and not changed for everyone. */}
        <AttendanceFilters
          filters={filters}
          schedules={schedules}
          layout="row"
          className="lg:grid-cols-[1fr_1.7fr_1fr]"
        />

        {loading && <LoadingState label="Cargando registros…" />}

        {error && !loading && (
          <ErrorState message={error} onRetry={() => void loadRecords()} />
        )}

        {!loading && !error && (
          <div className={query !== null ? PAGE_RAIL : undefined}>
            <SessionHistoryList
              sessions={sessions}
              pageSize={ATTENDANCE_PAGE_SIZE}
              rangeInvalid={query === null}
              // NOT `primary`: the header already draws "Tomar asistencia" in red.
              emptyAction={
                <Link
                  href="/trainer/attendance"
                  className={buttonClasses("secondary")}
                >
                  Tomar asistencia
                </Link>
              }
              // Issue #663: the door into correcting a record — admin only, already
              // enforced by this page's `ProtectedRoute`, so no second role check.
              renderDetail={(session) => (
                <SessionRecordsPanel
                  records={recordsBySession.get(sessionKey(session)) ?? []}
                  onCorrected={handleCorrected}
                />
              )}
            />

            {query !== null && (
              <AttendancePeriodRail
                sessions={sessions}
                schedules={scopedSchedules}
                fechaInicio={query.fechaInicio ?? ""}
                fechaFin={query.fechaFin ?? ""}
                horarioId={query.horarioId ?? null}
                studentFiltered={Boolean(filters.student)}
                guideExtra={
                  <>
                    <p>
                      Abra «Registros» en una sesión para ver a cada alumno.
                      «Corregir» cambia el estado de un registro y exige un
                      motivo, que queda guardado con quien corrigió.
                    </p>
                    <p>
                      Solo se puede corregir una sesión de los últimos 30 días;
                      después, la ventana se cierra y el registro queda fijo.
                    </p>
                  </>
                }
              />
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
