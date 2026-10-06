/**
 * Trainer — "Historial de asistencias"
 * (`docs/archive/prototypes/prototipos/21-entrenador-historial.html`).
 *
 * This route used to be a `redirect("/trainer")`: the history had been merged
 * into the trainer dashboard, which is what left that screen with two
 * quick-action cards, three stat cards, a four-control filter panel and a
 * paginated table competing for one scroll. The history is a separate errand
 * — it comes back to its own view, and "Mi día" keeps a single focus.
 *
 * ## Grouped by SESSION, not by student
 *
 * The prototype's reasoning, verbatim: *"el entrenador no busca «qué hizo Ana
 * el 14»; busca «la lista del lunes pasado»"*. So each row is one session,
 * with the four state counts in the row itself. A "Registró" column shows
 * who TOOK the list (issue #263, persisted `registrado_por_id`/nombre). Who
 * TAUGHT the session still isn't recorded (issue #13) — a separate fact.
 *
 * ## Filters
 *
 * Range, horario and alumno, rendered from the shared
 * `<AttendanceFilters>` panel (src/components/attendance/AttendanceFilters.tsx).
 * The three date presets this screen shipped with were not enough: the same
 * controls existed only on the admin's `/attendance`, which redirects a trainer
 * away, so "how did the Friday 17:00 group do?" and "what has Ana been doing
 * this term?" had no answer anywhere in the trainer's product. Grouping stays
 * by session; the filters just narrow what gets grouped.
 *
 * ## "Corregir" deep-links into the session (#95)
 *
 * Each row addresses its own roll call:
 * `/trainer/attendance?horario=<id>&fecha=<YYYY-MM-DD>&paso=lista`. Both
 * halves are load-bearing — the horario says which group, the fecha says
 * which day, and the same horario on two days is two different sessions. The
 * wizard opens on that roster with its filed marks already showing, and files
 * the correction back on that same date.
 *
 * This used to be documented here as a gap needing a backend field. It did
 * not: `AsistenciaResponseDTO` had always sent `horarioId` and the adapter
 * was dropping it. `AttendanceRecord` carries it now, so the row has an id
 * and not only the "Lunes 15:00 — 16:30" label, which is not reversible into
 * a horario.
 */

"use client";

import { useNoClassDays } from "@/lib/use-no-class-days";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  fetchAttendanceRecords,
  fetchConteosPorHorario,
  fetchTrainingSchedules,
  type ConteoHorario,
} from "@/services/api";
import { buildEnrolledCountsByHorario } from "@/app/trainer/trainer-day-utils";
import AttendanceFilters, {
  useAttendanceFilters,
} from "@/components/attendance/AttendanceFilters";
import {
  narrowSchedules,
  narrowToHorarios,
  toApiParams,
} from "@/components/attendance/attendance-filters-utils";
import AttendancePeriodRail from "@/components/attendance/AttendancePeriodRail";
import SessionHistoryList from "@/components/attendance/SessionHistoryList";
import {
  Button,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  BackLink,
  buttonClasses,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import {
  CORRECTION_WINDOW_CLOSED_REASON,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { calendarIsoDate, clubToday } from "@/lib/club-date";
import {
  groupRecordsBySession,
  type SessionSummary,
} from "../../trainer-day-utils";
import { buildWizardQuery } from "../attendance-utils";

/** Corregir solo admite sesiones con hasta 30 días de antigüedad — mismo
 *  tope que el backend impone en `PATCH /asistencias/{id}/corregir`
 *  (`LIMITE_CORRECCION_ASISTENCIA_DIAS`, issue #389). */
const LIMITE_CORRECCION_DIAS = 30;

/**
 * Where "Corregir" goes: that session's roll call, already open.
 *
 * Built through `buildWizardQuery` rather than by hand so the wizard stays
 * the single owner of its own address — the parameter names and the step
 * vocabulary ("lista") live in one module, and this screen cannot drift out
 * of sync with the page it links into.
 *
 * The roster it lands on is read-only for everyone now (issue #389, slice 3)
 * — what actually corrects a row is that slice's per-student "Corregir"
 * button on that same roster (slice 4b), not this link by itself. This link
 * is only the entry point: it still has to land on the right session before
 * an admin can reach that button.
 */
function buildCorrectionHref(session: SessionSummary): string {
  return `/trainer/attendance${buildWizardQuery(session.horarioId, session.fecha, "mark-attendance")}`;
}

/**
 * El ancla entre el control muerto y su motivo, una por fila.
 *
 * `aria-describedby` apunta a un id, así que dos filas vencidas en la misma
 * página no pueden compartirlo o el lector de pantalla leería el motivo de
 * otra sesión. La fecha y el horario son justamente lo que hace única a una
 * sesión — la misma pareja con la que se arma la `key` de la fila.
 */
function buildReasonId(session: SessionSummary): string {
  return `correccion-vencida-${session.fecha}-${session.horarioId}`;
}

/** Sessions per page. */
const PAGE_SIZE = 10;

export default function TrainerAttendanceHistoryPage(): React.ReactElement {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { session } = useAuth();
  const esAdmin = session?.user.role === "admin";
  // "Hoy - 30 días" resuelto en la zona del club, en YYYY-MM-DD para compararlo
  // lexicográficamente contra `sessionRow.fecha` (también YYYY-MM-DD).
  const corteCorreccion = useMemo(() => {
    const hoy = clubToday();
    const corte = new Date(hoy);
    corte.setDate(corte.getDate() - LIMITE_CORRECCION_DIAS);
    return calendarIsoDate(corte);
  }, []);

  const filters = useAttendanceFilters("this_month", schedules);
  const { query } = filters;

  const loadHistory = useCallback(async (): Promise<void> => {
    // A half-filled custom range shows no sessions rather than silently
    // falling back to "everything" — see `buildAttendanceQuery`.
    if (query === null) {
      setRecords([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchAttendanceRecords(toApiParams(query)));
    } catch (err) {
      console.error("[trainer/attendance/history] loadHistory failed", err);
      setError("No se pudieron cargar los registros de asistencia.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // The horario select needs the schedule list; a failure there only costs the
  // trainer that one filter, so it never blocks or errors the history itself.
  useEffect(() => {
    fetchTrainingSchedules()
      .then(setSchedules)
      .catch((err: unknown) => {
        console.error(
          "[trainer/attendance/history] fetchTrainingSchedules failed",
          err,
        );
      });
  }, []);

  // Enrolled students per horario let the rail tell a partial list from a
  // complete one (ENT-13). Best effort: without the roster the rail simply
  // keeps counting any list as taken.
  const [conteos, setConteos] = useState<ConteoHorario[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchConteosPorHorario()
      .then((all) => {
        if (!cancelled) setConteos(all);
      })
      .catch((err: unknown) => {
        console.error("[trainer/attendance/history] fetchConteosPorHorario failed", err);
      });
    return (): void => {
      cancelled = true;
    };
  }, []);
  const inscritosPorHorario = useMemo(
    () => (conteos ? buildEnrolledCountsByHorario(schedules, conteos) : undefined),
    [conteos, schedules],
  );

  const scopedRecords = useMemo(() => narrowToHorarios(records, query), [records, query]);
  const scopedSchedules = useMemo(() => narrowSchedules(schedules, query), [schedules, query]);
  const noClassDays = useNoClassDays(query?.fechaInicio, query?.fechaFin);
  const sessions = useMemo(() => groupRecordsBySession(scopedRecords), [scopedRecords]);

  const renderCorrectionAction = (
    sessionRow: SessionSummary,
  ): React.ReactNode => {
    if (sessionRow.fecha >= corteCorreccion)
      return (
        <Link
          href={buildCorrectionHref(sessionRow)}
          className={buttonClasses("secondary", "sm")}
        >
          Corregir
        </Link>
      );
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled
          aria-describedby={buildReasonId(sessionRow)}
        >
          Corregir
        </Button>
        <p
          id={buildReasonId(sessionRow)}
          className="max-w-[240px] text-balance text-xs text-ink-3"
        >
          {CORRECTION_WINDOW_CLOSED_REASON}
        </p>
      </div>
    );
  };

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell
        title="Historial"
        subtitle="Las listas que se pasaron, sesión por sesión."
        back={<BackLink href="/trainer" />}
        /*
         * The same link, with the same label and the same arrow, that `/attendance`
         * — this screen's admin twin, reading the same records — carries in its
         * header.
         */
        actions={
          <Link href="/trainer/attendance" className={buttonClasses("primary")}>
            Pasar lista
            <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        {/* The date column gets the wider track: with three equal ones the four
            presets wrapped onto a second row and left a blank band under the
            student and horario fields. */}
        <AttendanceFilters
          filters={filters}
          schedules={schedules}
          layout="row"
          className="lg:grid-cols-[1fr_1.7fr_1fr]"
        />

        {loading && <LoadingState label="Cargando historial…" />}

        {error && !loading && (
          <ErrorState message={error} onRetry={() => loadHistory()} />
        )}

        {!loading && !error && (
          <div className={query !== null ? PAGE_RAIL : undefined}>
            <SessionHistoryList
              sessions={sessions}
              pageSize={PAGE_SIZE}
              rangeInvalid={query === null}
              /* Issue #1273: the header already carries the page's one primary CTA
                 (`primary-action.test.ts` pins it there). This is still the honest
                 way out of an empty period, just not a second red button. */
              emptyAction={
                <Link
                  href="/trainer/attendance"
                  className={buttonClasses("secondary")}
                >
                  Pasar lista
                </Link>
              }
              renderAction={esAdmin ? renderCorrectionAction : undefined}
            />

            {query !== null && (
              <AttendancePeriodRail
                sessions={sessions}
                schedules={scopedSchedules}
                fechaInicio={query.fechaInicio ?? ""}
                fechaFin={query.fechaFin ?? ""}
                horarioId={query.horarioId ?? null}
                studentFiltered={Boolean(filters.student)}
                inscritosPorHorario={inscritosPorHorario}
                noClassDays={noClassDays}
                showGuide={false}
              />
            )}
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
