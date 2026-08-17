/**
 * Trainer — "Mi día" (issue #211,
 * `docs/archive/prototypes/prototipos/31-entrenador-dashboard-alternativas.html`).
 *
 * ## The panel's anatomy, because the owner approves the panel
 *
 * This screen and `/dashboard` used to read as two different products, and the
 * owner named the admin one as the reference. So the three layers are its
 * three layers:
 *
 *   1. a full-width coal band — `SessionCard`, which already spoke that
 *      vocabulary (`rounded-card bg-coal`, a `font-display text-display`
 *      figure) and was merely boxed into half a screen by a
 *      `split:grid-cols-2` pair with the donut;
 *   2. the pulse row on `STAT_GRID`, four tiles in one grammar;
 *   3. `PAGE_RAIL` — `RecentSessionsList` ("Últimas listas") fluid beside the
 *      340px "Distribución de asistencias" card.
 *
 * What did NOT come across is the hero's empty hands. `/dashboard` moved its
 * action to the header because it was the third place in the product where a
 * primary action could be found; this one is bound to one session and named by
 * that session's own hour — "Pasar lista de las 15:00", never "esta sesión" —
 * which is exactly what #211 put on the card and why. Porting a shape is not a
 * reason to undo a placement.
 *
 * ## The pulse row is not the recap that was removed
 *
 * A per-trainer "Última lista" `StatGrid` used to sit here and was deleted for
 * duplicating what the dense rows below already show for the same (fecha,
 * horario) pair. These four tiles are the opposite case — none of them can be
 * read off those rows: how many sessions the club runs TODAY, how many
 * students are enrolled in them, the month's attendance rate, and how many
 * lists have been taken all month. Same component, different question.
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
 * This summary list carries no author column on purpose — it's counts-only.
 * `Asistencia` DOES record who took the list since #263
 * (`registrado_por_id`/nombre), surfaced in the history, not here. Who TAUGHT
 * the session is still unrecorded: trainers are paid a flat monthly rate and
 * the club never asked "who marked this kid absent". This list does not grow a
 * column to fill that gap.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import Link from "next/link";
import { CalendarCheck, CalendarOff } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchTrainingSchedules,
  fetchAttendanceRecords,
  fetchRosterDeTodosLosHorarios,
  fetchRecentAttendanceSessions,
  type RecentAttendanceSession,
} from "@/services/api";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  STAT_GRID,
  StatCard,
  StatTrack,
  buttonClasses,
} from "@/components/ui";
import {
  buildAttendanceStats,
  formatDay,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { todayDiaSemana } from "@/lib/club-date";
import {
  buildEnrolledCountsByHorario,
  buildMonthAttendanceRate,
  buildSessionCardState,
  findAbsenceAlert,
  formatAbsenceCount,
  groupRecordsBySession,
  monthToDateRange,
  sumEnrolledToday,
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
  const { session, isLoading: authLoading } = useAuth();
  const { showInfo } = useToast();

  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [enrolledCounts, setEnrolledCounts] = useState<Record<number, number>>({});
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

  // #319 hallazgo #68: `ProtectedRoute` already bounces a non-trainer session
  // away, but silently — the URL changed and nothing said why. Same pattern
  // as the medical-record minor bounce (#315 hallazgo #69): a toast at the
  // landing spot names the reason instead of leaving a mute redirect.
  useEffect(() => {
    if (authLoading || !session || session.user.role === "trainer") return;
    showInfo("No tiene permiso para acceder a esa sección.");
  }, [authLoading, session, showInfo]);

  const todaySchedules = useMemo(() => {
    const today = todayDiaSemana();
    return schedules.filter((s) => s.diaSemana === today);
  }, [schedules]);

  const sessionCardState = useMemo(() => buildSessionCardState(todaySchedules), [todaySchedules]);
  const absenceAlert = useMemo(() => findAbsenceAlert(monthRecords), [monthRecords]);
  const attendanceStats = useMemo(() => buildAttendanceStats(monthRecords), [monthRecords]);

  /**
   * The pulse row's four figures — every one of them read from state this
   * screen already holds, none of them a new call.
   *
   * `listsThisMonth` counts SESSIONS, not records: `groupRecordsBySession`
   * keys on (fecha, horarioId), so a list of twenty students is one list. The
   * record count would have been a bigger number measuring nothing anyone
   * asks for.
   */
  const enrolledToday = useMemo(
    () => sumEnrolledToday(todaySchedules, enrolledCounts),
    [todaySchedules, enrolledCounts],
  );
  const monthRate = useMemo(() => buildMonthAttendanceRate(attendanceStats), [attendanceStats]);
  const listsThisMonth = useMemo(
    () => groupRecordsBySession(monthRecords).length,
    [monthRecords],
  );

  /**
   * Enrolled counts for every session shown on the card today — the hero
   * session AND the "rest of today" list underneath it. One club-wide roster
   * call (`fetchRosterDeTodosLosHorarios`, the same TRA-7 move `/groups`
   * already made) instead of one `fetchAlumnosPorHorario` per row, so the new
   * list does not turn into an N+1 as the day's session count grows.
   *
   * Loaded separately from `loadData`, once `todaySchedules` is known: it is
   * a garnish, so a failure here leaves every count unknown (each clause
   * simply not rendered) instead of blocking the card's one CTA.
   */
  useEffect((): (() => void) => {
    let cancelled = false;
    if (todaySchedules.length === 0) {
      setEnrolledCounts({});
      return (): void => {};
    }
    fetchRosterDeTodosLosHorarios()
      .then((roster) => {
        if (!cancelled) setEnrolledCounts(buildEnrolledCountsByHorario(todaySchedules, roster));
      })
      .catch((err: unknown) => {
        console.error("[trainer] fetchRosterDeTodosLosHorarios failed", err);
        if (!cancelled) setEnrolledCounts({});
      });
    return (): void => {
      cancelled = true;
    };
  }, [todaySchedules]);

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
        subtitle="Mi día — su próxima sesión y el resumen de asistencias."
      >
        {loading && <LoadingState label="Cargando su día…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadData()} />}

        {!loading && !error && (
          <>
            {/*
              LAYER 1 — the hero band, full width.

              It used to be half of a `split:grid-cols-2` pair with the donut,
              which is the single biggest reason this screen and `/dashboard`
              read as different products: the panel the owner approves leads
              with ONE full-width coal band and sends its secondary cards to
              the rail below. `SessionCard` already spoke that vocabulary —
              `rounded-card bg-coal`, a `font-display text-display` figure —
              it was just boxed into half a screen.

              Its action stays on the card and did NOT move to the header.
              `/dashboard`'s hero gave its action up because it was the third
              place in the product where a primary action could be found; this
              one is bound to a specific session and named by that session's
              own hour ("Pasar lista de las 15:00"), which is the whole point
              of #211's placement. Porting the shape is not a reason to undo it.

              On a rest day `sessionCardState` is `null` and `SessionCard`
              renders nothing — that guard is the component's whole safety rule
              and does not move. The rest-day statement takes the band's place,
              full width, with the three parts D11 asks for. It no longer needs
              `fill`: there is no equal-height sibling left to match.
            */}
            {sessionCardState ? (
              <SessionCard state={sessionCardState} enrolledCounts={enrolledCounts} />
            ) : (
              <EmptyState
                icon={<CalendarOff size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="Hoy no hay entrenamientos"
                description={`El club no tiene sesiones programadas para hoy, ${formatDay(todayDiaSemana()).toLowerCase()}. Puede pasar la lista de otro día si quedó pendiente.`}
                action={
                  // The same words the card uses for the same destination —
                  // "Elegir otro horario" is already how this screen names
                  // the picker, and a second name for one place is the drift
                  // the destination registry exists to stop.
                  <Link href="/trainer/attendance" className={buttonClasses("secondary")}>
                    Elegir otro horario
                  </Link>
                }
              />
            )}

            {/*
              LAYER 2 — the pulse, on `/dashboard`'s own `STAT_GRID`.

              One internal grammar across all four tiles, the same the admin
              panel states: uppercase label, ink figure with its unit, one
              caption line. Every figure is read from data already on this
              screen — nothing here triggers a call, and nothing here is
              derived from something the backend does not send. That second
              constraint is not decoration: `/profile`'s history records two
              figures retired for failing it.

              "Inscritos hoy" is an em dash rather than a number when the
              roster did not fully arrive. `sumEnrolledToday` returns `null`
              instead of a partial sum for the reason its own doc gives — a
              partial sum is not a smaller number, it is a wrong one — and the
              tile has to state that absence rather than paper over it.

              Issue #313 (K5 hallazgo #56): "SESIONES HOY 0" convivía con
              "ÚLTIMAS LISTAS" mostrando una lista de hoy con registros
              reales — no es una contradicción (uno cuenta el horario
              SEMANAL programado para hoy, el otro las listas que de hecho
              se tomaron, y un entrenador puede tomar lista de un día
              distinto al programado), pero los dos tiles no decían su
              propio alcance. Los hints ahora nombran "programadas", no
              "hoy" a secas.
            */}
            <div data-testid="trainer-pulse" className={STAT_GRID}>
              <StatCard
                label="Sesiones hoy"
                value={todaySchedules.length}
                hint={`programadas para hoy, ${formatDay(todayDiaSemana()).toLowerCase()}`}
              />
              <StatCard
                label="Inscritos hoy"
                value={enrolledToday ?? "—"}
                hint={
                  enrolledToday === null
                    ? "no se pudo leer el padrón"
                    : "alumnos en las sesiones programadas para hoy"
                }
              />
              <StatCard
                label="Asistencia del mes"
                value={monthRate.percent}
                unit="%"
                hint={
                  <span className="flex flex-col gap-y-field">
                    <StatTrack value={monthRate.present} total={monthRate.total} />
                    <span>{`${monthRate.present} de ${monthRate.total} entrenaron`}</span>
                  </span>
                }
              />
              <StatCard
                label="Listas del mes"
                value={listsThisMonth}
                hint="sesiones con lista tomada"
              />
            </div>

            {/*
              LAYER 3 — the rail. Neither the recent lists nor the donut needs
              the full width, and `PAGE_RAIL` is the token `/dashboard` spends
              on exactly this pair: a fluid feed beside a fixed 340px card.

              The absence alert stays inside the donut card. It is a fact ABOUT
              attendance and it belongs to the block that draws attendance —
              moving it up to the band would have made it the second thing in
              a hero whose own rule is one number and the sentence that reads it.
            */}
            <div data-testid="trainer-lower" className={PAGE_RAIL}>
              <RecentSessionsList sessions={recentSessions} />

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
                  {/* The card title step, in the club's display face — the
                      role DESIGN.md gives Graduate and the one this screen
                      had never asked for. */}
                  <h2 className="mb-4 font-display text-lg uppercase leading-tight tracking-flat text-ink">
                    Distribución de asistencias
                  </h2>
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
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
