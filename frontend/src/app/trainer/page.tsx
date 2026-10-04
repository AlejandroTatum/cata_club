/**
 * Trainer — "Mi día", drawn in the student dashboard's idiom.
 *
 * Top to bottom, what a trainer standing courtside asks:
 *
 *   1. `NextSessionHero`: the next (or running) session — its hour, the wait in
 *      words, the enrolled students as initials — and the one primary action,
 *      named by that hour ("Pasar lista de las 15:00").
 *   2. "Hoy": the day's sessions on the same `Timeline` the admin uses, placed
 *      by their real hours, coloured by the state of their list.
 *   3. The rail: attendance trend over the last six weeks, "Alumnos a seguir"
 *      with a dot per recent session (filled = trained, ring = did not) and
 *      "Últimas listas" in the fluid column; "Sesiones sin lista", with "Pasar
 *      lista", in the fixed one.
 *
 * ## Only what the backend can sustain
 *
 * One attendance query covers the trailing six weeks and the current month; the
 * month figures (students to follow, missing lists) are filtered from it, so no
 * second call. The trend is the club's, not the trainer's own: no DTO says who
 * taught a session. "Inscritos" is a count of `AlumnoHorario` rows — who is
 * ENROLLED — never who turned up. No level anywhere: the competitive-ranking
 * feature it belonged to left the MVP.
 *
 * "Últimas listas" has no author column on purpose: it is counts-only. Who took
 * a list is surfaced in the history, not here.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { Bars, Dots, Timeline, type ChartTone } from "@/components/charts";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchTrainingSchedules,
  fetchAttendanceRecords,
  fetchRosterDeTodosLosHorarios,
  fetchRecentAttendanceSessions,
  type AlumnoHorario,
  type RecentAttendanceSession,
} from "@/services/api";
import {
  ErrorState,
  LoadingState,
  InfoPanel,
  PAGE_RAIL,
  buttonClasses,
} from "@/components/ui";
import {
  ATTENDANCE_LABELS,
  formatDay,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { clubIsoDate, clubTimeHHMM, todayDiaSemana } from "@/lib/club-date";
import { buildTimelineItems, buildTodayClasses, clubNowMinutes } from "@/app/dashboard/dashboard-utils";
import { formatDate } from "@/lib/format-utils";
import {
  buildEnrolledCountsByHorario,
  buildLastSessionSummary,
  buildRosterNamesByHorario,
  buildSessionCardState,
  buildWeeklyAttendanceTrend,
  recentStatesOfStudent,
  trailingWeeksRange,
  findNextScheduledSession,
  findStudentsToFollow,
  formatNextSessionLabel,
  formatAbsenceCount,
  monthToDateRange,
} from "./trainer-day-utils";
import CompactEmpty from "@/components/dashboard/CompactEmpty";
import DashboardSection from "@/components/dashboard/DashboardSection";
import { buildContextLine } from "@/components/dashboard/context-line";
import NextSessionHero from "./NextSessionHero";
import RecentSessionsList from "./RecentSessionsList";
import SessionsWithoutList from "./SessionsWithoutList";
import TodaySessionList from "./TodaySessionList";
import { buildWizardQuery } from "@/app/trainer/attendance/attendance-utils";
import { findMissingSessions } from "@/app/trainer/attendance/history/history-utils";

/** Weeks the attendance trend spans. */
const TREND_WEEKS = 6;

/** Sessions each student's dots remember. */
const DOT_SESSIONS = 6;

/** The tone of a student's session dot; only presente and tardanza count as having trained. */
const STATE_TONE: Record<EstadoAsistencia, ChartTone> = {
  present: "ok",
  late: "warn",
  justified: "neutral",
  sick: "neutral",
  competition: "neutral",
  absent: "bad",
};

/** First name only — "Hola, Carlos Mendoza" is a greeting nobody says out loud. */
function firstNameOf(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? "entrenador";
}

/** From the earlier of the month's first day and the trend window's, through today. */
function loadRange(): { fechaInicio: string; fechaFin: string } {
  const month = monthToDateRange();
  const trend = trailingWeeksRange(new Date(), TREND_WEEKS);
  return { fechaInicio: month.fechaInicio < trend.fechaInicio ? month.fechaInicio : trend.fechaInicio, fechaFin: month.fechaFin };
}

export default function TrainerPage(): React.ReactElement {
  const { session, isLoading: authLoading } = useAuth();

  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  /** The club-wide roster, one row per enrolment; `null` until it loads (or if it fails). */
  const [padron, setPadron] = useState<AlumnoHorario[] | null>(null);
  const [recentSessions, setRecentSessions] = useState<RecentAttendanceSession[]>([]);
  const [recentStatus, setRecentStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const [scheduleData, recordData] = await Promise.all([fetchTrainingSchedules(), fetchAttendanceRecords(loadRange())]);
      setSchedules(scheduleData);
      setRecords(recordData);
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
   * failure here empties the card instead of blocking the hero.
   */
  const loadRecentSessions = useCallback(async (): Promise<void> => {
    setRecentStatus("loading");
    try {
      setRecentSessions(await fetchRecentAttendanceSessions());
      setRecentStatus("ready");
    } catch (err) {
      console.error("[trainer] fetchRecentAttendanceSessions failed", err);
      setRecentSessions([]);
      setRecentStatus("error");
    }
  }, []);

  // Gate the fetch on the RESOLVED role — same fix as `/members`, `/dashboard`
  // and `/payments` (issue #319 hallazgo #49). `ProtectedRoute` redirects a
  // non-trainer away, but its redirect runs in an effect of its own; a bare
  // mount effect here fired GET /api/attendance/records and
  // GET /api/attendance/recent-sessions before that redirect landed.
  const isTrainer = !authLoading && session?.user?.role === "trainer";

  useEffect(() => {
    if (!isTrainer) return;
    loadData();
    loadRecentSessions();
  }, [isTrainer, loadData, loadRecentSessions]);

  const todaySchedules = useMemo(() => {
    const today = todayDiaSemana();
    return schedules.filter((s) => s.diaSemana === today);
  }, [schedules]);

  const sessionCardState = useMemo(() => buildSessionCardState(todaySchedules), [todaySchedules]);
  const nextSessionLabel = useMemo(() => {
    const next = findNextScheduledSession(schedules);
    return next ? formatNextSessionLabel(next) : null;
  }, [schedules]);

  // The query spans the trend window AND the month; the month figures read
  // only the month's part of it.
  const monthRecords = useMemo(() => {
    const { fechaInicio } = monthToDateRange();
    return records.filter((record) => record.fecha >= fechaInicio);
  }, [records]);
  const studentsToFollow = useMemo(() => findStudentsToFollow(monthRecords), [monthRecords]);
  const trend = useMemo(() => buildWeeklyAttendanceTrend(records, new Date(), TREND_WEEKS), [records]);
  const trendTotal = trend.reduce((sum, week) => sum + week.total, 0);
  const trendAttended = trend.reduce((sum, week) => sum + week.attended, 0);
  const trendPercent = trendTotal > 0 ? Math.round((trendAttended / trendTotal) * 100) : 0;
  const trendData = trend.map((week, index) => ({
    key: week.startIso,
    label: index === trend.length - 1 ? "Act." : `S-${trend.length - 1 - index}`,
    value: week.ratePercent,
    detail: `Semana del ${formatDate(week.startIso).slice(0, 5)}: ${week.total > 0 ? `${week.ratePercent}% · ${week.attended} de ${week.total}` : "sin registros"}`,
  }));

  /**
   * Who is enrolled: one club-wide roster call, not one per row. A garnish — a
   * failure leaves the names unknown (the hero says so in a line, the timeline
   * omits the counts, "Sesiones sin lista" cannot tell a partial list from a
   * complete one) instead of blocking the day.
   */
  useEffect((): (() => void) => {
    let cancelled = false;
    if (schedules.length === 0) {
      setPadron(null);
      return (): void => {};
    }
    fetchRosterDeTodosLosHorarios()
      .then((all) => {
        if (!cancelled) setPadron(all);
      })
      .catch((err: unknown) => {
        console.error("[trainer] fetchRosterDeTodosLosHorarios failed", err);
        if (!cancelled) setPadron(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [schedules]);

  const roster = useMemo(() => (padron ? buildRosterNamesByHorario(todaySchedules, padron) : null), [padron, todaySchedules]);
  const enrolledCounts = useMemo(() => {
    if (!roster) return null;
    return Object.fromEntries(Object.entries(roster).map(([id, names]) => [Number(id), names.length])) as Record<number, number>;
  }, [roster]);
  const enrolledBySchedule = useMemo(() => (padron ? buildEnrolledCountsByHorario(schedules, padron) : null), [padron, schedules]);

  /**
   * "Sesiones sin lista" — this month's weekly schedule minus the sessions
   * that already have a list, newest first. Same cross the history screen
   * counts (`findMissingSessions`), with the same ESTIMATE caveat.
   */
  const missingSessions = useMemo(() => {
    const { fechaInicio, fechaFin } = monthToDateRange();
    return findMissingSessions({
      sessions: monthRecords.map((r) => ({ fecha: r.fecha, horarioId: r.horarioId, registrados: 1 })),
      inscritosPorHorario: enrolledBySchedule ?? undefined,
      schedules,
      desde: fechaInicio,
      hasta: fechaFin,
      hoy: clubIsoDate(),
      horaActual: clubTimeHHMM(),
    });
  }, [monthRecords, schedules, enrolledBySchedule]);

  const todayClasses = useMemo(() => buildTodayClasses(todaySchedules, records), [todaySchedules, records]);
  const timelineItems = useMemo(
    () =>
      buildTimelineItems(todayClasses, enrolledCounts, (id) => `/trainer/attendance${buildWizardQuery(id, null, "mark-attendance")}`),
    [todayClasses, enrolledCounts],
  );
  const listsTaken = todayClasses.filter((entry) => entry.status === "taken").length;
  const heroSummary = useMemo(
    () =>
      sessionCardState && sessionCardState.kind !== "done"
        ? buildLastSessionSummary(records, sessionCardState.schedule.id, clubIsoDate())
        : null,
    [records, sessionCardState],
  );

  return (
    <ProtectedRoute allowedRoles={["trainer"]}>
      {/*
       * The `<h1>` is a greeting on purpose — this is the one screen a trainer
       * opens standing at courtside, and it should sound like a person. The
       * subtitle carries the role and date; the one primary action lives in the
       * hero, named by the session's own hour.
       */}
      <AppShell title={`Hola, ${firstNameOf(session?.user?.name)}`} subtitle={buildContextLine("Entrenador")}>
        {loading && <LoadingState label="Cargando su día…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadData()} />}

        {!loading && !error && (
          <>
            {sessionCardState ? (
              <NextSessionHero
                state={sessionCardState}
                roster={roster}
                lastSummary={heroSummary}
                nextSessionLabel={nextSessionLabel}
              />
            ) : (
              <section data-testid="rest-day" className="card flex flex-wrap items-center gap-x-4 gap-y-field px-[18px] py-4">
                <CalendarOff size={ICON.lg} strokeWidth={1.5} className="flex-none text-ink-3" aria-hidden="true" />
                <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
                  <b className="text-sm font-bold text-ink">Hoy no hay entrenamientos</b>
                  <span className="text-sm text-ink-2">
                    {`El club no tiene sesiones programadas para hoy, ${formatDay(todayDiaSemana()).toLowerCase()}. Puede pasar la lista de otro día si quedó pendiente.`}
                  </span>
                </div>
                <Link href="/trainer/attendance" className={buttonClasses("secondary")}>
                  Elegir otro horario
                </Link>
              </section>
            )}

            {timelineItems.length > 0 && (
              <DashboardSection title="Hoy" testId="trainer-today">
                <div className="flex flex-col gap-3 px-[18px] py-4">
                  <Timeline
                    items={timelineItems}
                    nowMinutes={clubNowMinutes()}
                    ariaLabel={`Sesiones de hoy: ${timelineItems.length}, ${listsTaken} con lista tomada`}
                    className="max-sm:hidden"
                  />
                  <TodaySessionList items={timelineItems} />
                </div>
              </DashboardSection>
            )}

            <div data-testid="trainer-lower" className={PAGE_RAIL}>
              {/* Two independent stacks: each column ends where its own content
                  ends, so an empty block on one side never stretches the other. */}
              <div data-testid="trainer-main" className="flex min-w-0 flex-col gap-page">
                <DashboardSection
                  title="Asistencia de las últimas semanas"
                  testId="attendance-trend"
                  action={
                    <Link href="/trainer/attendance/history" className={buttonClasses("secondary", "sm")}>
                      Ver historial
                    </Link>
                  }
                >
                  {trendTotal > 0 ? (
                    <div className="flex flex-col gap-3 px-[18px] py-4">
                      <p className="m-0 text-sm text-ink-2">
                        <b className="font-display text-xl font-normal tabular-nums tracking-flat text-ink">{trendPercent}%</b> entrenaron en {TREND_WEEKS}{" "}
                        semanas · {trendAttended} de {trendTotal} registros
                      </p>
                      <Bars
                        data={trendData}
                        max={100}
                        heightClass="h-24"
                        ariaLabel={`Asistencia de las últimas ${TREND_WEEKS} semanas: ${trendData.map((d) => `${d.label} ${d.value}%`).join(", ")}`}
                      />
                    </div>
                  ) : (
                    <CompactEmpty title="Sin asistencias recientes" description="La tendencia se dibuja con la primera lista." />
                  )}
                </DashboardSection>

                <DashboardSection title="Alumnos a seguir" testId="students-to-follow">
                  {studentsToFollow.length > 0 ? (
                    <ul className="m-0 grid list-none p-0 sm:grid-cols-2 lg:grid-cols-3">
                      {studentsToFollow.map((student) => {
                        const dots = recentStatesOfStudent(monthRecords, student.estudiante, DOT_SESSIONS).map((entry) => ({
                          key: entry.fecha,
                          label: `${formatDate(entry.fecha).slice(0, 5)} ${ATTENDANCE_LABELS[entry.estado].toLowerCase()}`,
                          tone: STATE_TONE[entry.estado],
                          hollow: entry.estado !== "present" && entry.estado !== "late",
                        }));
                        return (
                          <li
                            key={student.estudiante}
                            className="flex min-h-drow flex-col justify-center gap-1.5 border-b border-line px-[18px] py-3 text-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <b className="min-w-0 truncate font-semibold text-ink">{student.estudiante}</b>
                              <span className="flex-none text-xs font-semibold text-ink-2">{formatAbsenceCount(student.ausencias)}</span>
                            </div>
                            <Dots data={dots} ariaLabel={`Últimas asistencias de ${student.estudiante}`} />
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <CompactEmpty
                      title="Nadie necesita seguimiento"
                      description="Aquí aparecen quienes faltan dos veces o más en el mes."
                    />
                  )}
                </DashboardSection>

                <RecentSessionsList sessions={recentSessions} status={recentStatus} onRetry={() => void loadRecentSessions()} />
              </div>

              <div data-testid="trainer-rail" className="flex min-w-0 flex-col gap-page max-lg:order-first">
                <section className="card flex flex-col gap-4 p-[18px]">
                  <SessionsWithoutList missing={missingSessions} coverageKnown={padron !== null} />
                </section>
                <InfoPanel title="Cómo funciona su día">
                  <p>El botón principal abre la lista de la próxima sesión; la línea de «Hoy» muestra el estado de cada una.</p>
                  <p>«Sesiones sin lista» reúne las del mes que nadie registró: use «Pasar lista» para completarlas.</p>
                  <p>«Alumnos a seguir» marca a quienes faltaron dos veces o más este mes.</p>
                </InfoPanel>
              </div>
            </div>
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
