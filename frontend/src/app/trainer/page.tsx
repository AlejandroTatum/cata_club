/**
 * Trainer — "Mi día" (issue #211,
 * `docs/ux/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * Compacted from the Fix 8 / DSH-2 layout it replaces: two symmetric cards up
 * top — coal `SessionCard` for the immediate session, white
 * "Distribución de asistencias" for the month's donut — then `RecentSessionsList`
 * ("Últimas listas") as dense, full-width rows below. `SessionCard` moved the
 * one primary action out of the page header (compare the old `actions` prop
 * this file used to pass `AppShell`) and onto the card itself, named by the
 * session's own hour: "Pasar lista de las 15:00", never "esta sesión".
 *
 * The old per-trainer "Última lista" `StatGrid` recap is gone — it duplicated
 * what the dense rows below already show for the same (fecha, horario) pair,
 * once the badge-table version of that list became the proportional bar.
 *
 * ## Only what the backend can sustain
 *
 * "N estudiantes inscritos", not "N esperan": the number is a count of
 * `AlumnoHorario` rows (who is ENROLLED), and no DTO says who turned up. And
 * no level anywhere on THIS screen — "Mi día" has one decision on it, and the
 * competitive-ranking feature the old level concept belonged to was removed
 * from the MVP entirely.
 *
 * ## "Últimas listas" has no author column
 *
 * `Asistencia` deliberately doesn't record who took the list
 * (`modelos.py:536`) — the trainers are paid a flat monthly rate and the club
 * never asked "who marked this kid absent". Adding it is a real, separate
 * idea (`registrado_por`, for audit trail) parked for after launch — see
 * decisiones-de-negocio-2026-08-11.md §8's own closing note. This list does
 * not grow a column to fill that gap.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { CalendarCheck } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchTrainingSchedules,
  fetchAttendanceRecords,
  fetchAlumnosPorHorario,
  fetchRecentAttendanceSessions,
  type RecentAttendanceSession,
} from "@/services/api";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui";
import {
  buildAttendanceStats,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { todayDiaSemana } from "@/lib/club-date";
import {
  buildSessionCardState,
  findAbsenceAlert,
  formatAbsenceCount,
  monthToDateRange,
} from "./trainer-day-utils";
import SessionCard from "./SessionCard";
import RecentSessionsList from "./RecentSessionsList";
// Reused, not rebuilt (decisión §8: "el gráfico de torta ya existe ahí;
// reusalo, no construyas uno nuevo"). It's a plain presentational component
// (props: AttendanceDayStats) with no route of its own, so importing it from
// another screen's folder costs nothing beyond the import line itself.
import AttendanceStatusChart from "@/app/dashboard/AttendanceStatusChart";

/** First name only — "Hola, Carlos Mendoza" is a greeting nobody says out loud. */
function firstNameOf(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? "entrenador";
}

export default function TrainerPage(): React.ReactElement {
  const { session } = useAuth();

  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [enrolledCount, setEnrolledCount] = useState<number | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentAttendanceSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const [scheduleData, recordData] = await Promise.all([
        fetchTrainingSchedules(),
        fetchAttendanceRecords(monthToDateRange()),
      ]);
      setSchedules(scheduleData);
      setMonthRecords(recordData);
    } catch (err) {
      console.error("[trainer] loadData failed", err);
      setError("No se pudo cargar su día. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * "Últimas listas del club", loaded separately and best-effort: it is
   * companion content, not the one decision this screen exists for, so a
   * failure here empties the card instead of blocking the hero and the
   * "última lista" stats — same treatment `/dashboard` gives its own
   * secondary cards (`loadDetail`, `Promise.allSettled`).
   */
  const loadRecentSessions = useCallback(async (): Promise<void> => {
    try {
      setRecentSessions(await fetchRecentAttendanceSessions());
    } catch (err) {
      console.error("[trainer] fetchRecentAttendanceSessions failed", err);
      setRecentSessions([]);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadRecentSessions();
  }, [loadData, loadRecentSessions]);

  const todaySchedules = useMemo(() => {
    const today = todayDiaSemana();
    return schedules.filter((s) => s.diaSemana === today);
  }, [schedules]);

  const sessionCardState = useMemo(() => buildSessionCardState(todaySchedules), [todaySchedules]);
  const absenceAlert = useMemo(() => findAbsenceAlert(monthRecords), [monthRecords]);
  const attendanceStats = useMemo(() => buildAttendanceStats(monthRecords), [monthRecords]);

  // The card's own schedule when there is one to show ("next" or "live") —
  // `null` for "done" and for a rest day, when there is nothing to fetch a
  // roster for.
  const activeSchedule =
    sessionCardState?.kind === "next" || sessionCardState?.kind === "live"
      ? sessionCardState.schedule
      : null;

  /**
   * The roster count for the card. Loaded separately because it needs the
   * resolved active schedule, and it is a garnish: if it fails the card still
   * says when and where to be, so the failure stays silent (null → the clause
   * is simply not rendered) instead of blocking the card's one CTA.
   */
  useEffect((): (() => void) => {
    let cancelled = false;
    if (!activeSchedule) {
      setEnrolledCount(null);
      return (): void => {};
    }
    fetchAlumnosPorHorario(activeSchedule.id)
      .then((alumnos) => {
        if (!cancelled) setEnrolledCount(alumnos.length);
      })
      .catch((err: unknown) => {
        console.error("[trainer] fetchAlumnosPorHorario failed", err);
        if (!cancelled) setEnrolledCount(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [activeSchedule]);

  return (
    <ProtectedRoute allowedRoles={["trainer"]}>
      {/*
       * The `<h1>` is a greeting on purpose — this is the one screen a trainer
       * opens standing at courtside, and it should sound like a person. But a
       * greeting is not a page name, and every other authenticated screen names
       * itself, so the subtitle carries "Mi día" — the same name the sidebar
       * and the browser tab use — instead of overwriting the welcome.
       *
       * No `actions` prop here any more: the one primary action lives on
       * `SessionCard` now, named by the session's own hour — see the module
       * doc for why it moved.
       */}
      <AppShell
        title={`Hola, ${firstNameOf(session?.user?.name)}`}
        subtitle="Mi día — tu próxima sesión y el resumen de asistencias."
      >
        {loading && <LoadingState label="Cargando tu día…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadData()} />}

        {!loading && !error && (
          <>
            {/*
              Two symmetric cards on desktop (`split:grid-cols-2`), sharing
              height. `SessionCard` anchors its actions to the bottom with
              `mt-auto` so the surplus of an uneven pair lands there, never in
              the middle. On a rest day `sessionCardState` is `null`,
              `SessionCard` renders nothing, and the grid collapses to one
              column so the summary card takes the full row instead of
              standing alone in half of it.
            */}
            <div className={`grid items-stretch gap-[18px] ${sessionCardState ? "split:grid-cols-2" : ""}`}>
              <SessionCard state={sessionCardState} enrolledCount={enrolledCount} />

              <section className="card flex flex-col gap-4 p-[18px]">
                {absenceAlert && (
                  <p className="m-0 border-b border-line pb-4 text-sm text-ink-2">
                    <b className="font-semibold text-ink">{absenceAlert.estudiante}</b> suma{" "}
                    <b className="font-semibold text-ink">
                      {formatAbsenceCount(absenceAlert.ausencias)}
                    </b>{" "}
                    este mes
                  </p>
                )}

                <div>
                  <h2 className="mb-4 text-base font-bold text-ink">Distribución de asistencias</h2>
                  {attendanceStats.totalStudents > 0 ? (
                    <AttendanceStatusChart stats={attendanceStats} />
                  ) : (
                    <EmptyState
                      surface="inset"
                      icon={<CalendarCheck size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                      title="Sin asistencias registradas"
                      description="El gráfico se dibuja con la primera lista del período."
                    />
                  )}
                </div>
              </section>
            </div>

            <RecentSessionsList sessions={recentSessions} />
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
