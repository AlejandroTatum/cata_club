/**
 * Trainer — "Mi día" (`docs/ux/prototipos/19-entrenador.html`).
 *
 * Redesigned for Fix 8 / DSH-2 (decisiones-de-negocio-2026-08-11.md §8): the
 * audit measured ~43-47% of a 1440×900 viewport left blank below a "última
 * lista" card that showed its four counts as loose `Badge`s in a flex row —
 * the same shape the audit already flagged and fixed on `/dashboard`. The
 * approved pattern is that admin panel: a hero, a `StatGrid` pulse, then two
 * content cards sharing one row. This screen now follows it:
 *
 *   1. The hero — one decision, unchanged from the original redesign below.
 *   2. The last session's four counts in `StatGrid` tiles, replacing the
 *      `Badge` row DSH-2 named directly.
 *   3. "Últimas listas del club" — the club's own recent sessions, not the
 *      trainer's: there is no entrenador–horario relation to filter by
 *      (issue #13, `modelos.py:506-507`), so the closest honest content is
 *      what's actually recorded, whoever took it. Fed by the new
 *      `GET /asistencias/ultimas-listas` (no migration — computed from
 *      `Asistencia` + `HorarioEntrenamiento`, both already there).
 *   4. The 4-state donut — `/dashboard`'s own `AttendanceStatusChart`,
 *      reused rather than rebuilt — sharing a card with the chronic-absence
 *      notice that already lived here.
 *
 * Deliberately absent: the full week's agenda. The club's horarios are fixed
 * and a trainer has them memorized; a schedule grid would spend half the
 * screen restating something nobody needed restated.
 *
 * ## Only what the backend can sustain
 *
 * "N estudiantes inscritos", not "N esperan": the number is a count of
 * `AlumnoHorario` rows (who is ENROLLED), and no DTO says who turned up. And
 * no level anywhere on THIS screen — "Mi día" has one decision on it, and the
 * competitive-ranking feature the old level concept belonged to was removed
 * from the MVP entirely.
 *
 * "Avisar al club" has no endpoint behind it: nothing in the API notifies the
 * club about a student. It opens the help assistant with the message already
 * written (see `openHelpChat`), which is the only real channel there is. That
 * used to be documented HERE and nowhere the trainer could see it, so the
 * button read as "the club has been told" when in fact the trainer still has to
 * send the message — hence the hint rendered next to it.
 *
 * ## "Últimas listas del club" has no author column
 *
 * `Asistencia` deliberately doesn't record who took the list
 * (`modelos.py:536`) — the trainers are paid a flat monthly rate and the club
 * never asked "who marked this kid absent". Adding it is a real, separate
 * idea (`registrado_por`, for audit trail) parked for after launch — see
 * decisiones-de-negocio-2026-08-11.md §8's own closing note. This table does
 * not grow a column to fill that gap.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell, { openHelpChat } from "@/components/shell/AppShell";
import { ArrowRight, CalendarCheck, ClipboardList, Megaphone } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchTrainingSchedules,
  fetchAttendanceRecords,
  fetchAlumnosPorHorario,
  fetchRecentAttendanceSessions,
  type RecentAttendanceSession,
} from "@/services/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  STAT_GRID,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
  buttonClasses,
} from "@/components/ui";
import {
  buildAttendanceStats,
  formatDay,
  getAttendanceBadgeTone,
  getAttendanceLabel,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";
import { todayDiaSemana } from "@/lib/club-date";
import { formatDate } from "@/lib/format-utils";
import {
  buildAbsenceNotice,
  findAbsenceAlert,
  formatAbsenceCount,
  formatEnrolledCount,
  formatSessionCountdown,
  minutesUntilStart,
  monthToDateRange,
  selectTodaySessions,
  summarizeLastSession,
} from "./trainer-day-utils";
// Reused, not rebuilt (decisión §8: "el gráfico de torta ya existe ahí;
// reusalo, no construyas uno nuevo"). It's a plain presentational component
// (props: AttendanceDayStats) with no route of its own, so importing it from
// another screen's folder costs nothing beyond the import line itself.
import AttendanceStatusChart from "@/app/dashboard/AttendanceStatusChart";

/** The order the four states are read in — best news first, as on every other screen. */
const STATE_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

/** Ties the "Avisar al club" button to the sentence explaining what it opens. */
const ABSENCE_NOTICE_HINT_ID = "trainer-absence-notice-hint";

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

  const { next, later } = useMemo(() => selectTodaySessions(todaySchedules), [todaySchedules]);
  const lastSession = useMemo(() => summarizeLastSession(monthRecords), [monthRecords]);
  const absenceAlert = useMemo(() => findAbsenceAlert(monthRecords), [monthRecords]);
  const attendanceStats = useMemo(() => buildAttendanceStats(monthRecords), [monthRecords]);

  /**
   * The roster count for the hero. Loaded separately because it needs the
   * resolved next session, and it is a garnish: if it fails the hero still
   * says when and where to be, so the failure stays silent (null → the clause
   * is simply not rendered) instead of blocking the one CTA on the screen.
   */
  useEffect((): (() => void) => {
    let cancelled = false;
    if (!next) {
      setEnrolledCount(null);
      return (): void => {};
    }
    fetchAlumnosPorHorario(next.id)
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
  }, [next]);

  const enrolledLabel = formatEnrolledCount(enrolledCount);

  return (
    <ProtectedRoute allowedRoles={["trainer"]}>
      {/*
       * The `<h1>` is a greeting on purpose — this is the one screen a trainer
       * opens standing at courtside, and it should sound like a person. But a
       * greeting is not a page name, and every other authenticated screen names
       * itself, so the subtitle carries "Mi día" — the same name the sidebar
       * and the browser tab use — instead of overwriting the welcome.
       */}
      <AppShell
        title={`Hola, ${firstNameOf(session?.user?.name)}`}
        subtitle="Mi día — tu próxima sesión y el resumen de la última lista."
        /*
         * "Pasar lista" used to live in TWO places on this one screen: `.btn.xl`
         * inside the coal hero when there was a next session, and inside the
         * empty state's action when there was not. Which is to say the trainer's
         * only verb moved depending on the data — the exact shape #74 named on
         * the admin side ("teaches a rule and then breaks it"), except here one
         * screen breaks it against itself.
         *
         * The header slot is the one place that does not move. It also brings
         * this screen level with `/dashboard`, whose hero was emptied of its CTA
         * for the same reason and now "carries ONE number" and nothing else.
         */
        actions={
          <Link href="/trainer/attendance" className={buttonClasses("primary")}>
            Pasar lista
            <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        {loading && <LoadingState label="Cargando tu día…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadData()} />}

        {!loading && !error && (
          <>
            {/* --- The hero: the one thing to do next. --- */}
            {next ? (
              <div className="flex flex-wrap items-end gap-6 rounded-card bg-coal px-7 py-6 text-white">
                <span className="text-display font-extrabold leading-none tabular-nums">
                  {next.horaInicio}
                </span>
                <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                  <b className="text-base font-bold">
                    {formatDay(next.diaSemana)} {next.horaInicio} — {next.horaFin}
                  </b>
                  <span className="flex items-center gap-2 text-sm text-white/60">
                    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
                    {formatSessionCountdown(minutesUntilStart(next))}
                    {enrolledLabel ? ` · ${enrolledLabel}` : ""}
                  </span>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<CalendarCheck size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title={
                  todaySchedules.length > 0
                    ? "Ya no quedan sesiones hoy"
                    : "Hoy no tienes sesiones"
                }
                description="Puedes pasar lista de cualquier horario disponible desde Pasar lista."
                action={
                  <Link href="/trainer/attendance" className={buttonClasses("primary")}>
                    Pasar lista
                  </Link>
                }
              />
            )}

            {/* --- What comes after it. One line, not a second list. --- */}
            {later.length > 0 && (
              <p className="text-sm text-ink-3">
                Después:{" "}
                {later.map((s, index) => (
                  <span key={s.id}>
                    {index > 0 ? " · " : ""}
                    <b className="font-semibold text-ink">{s.horaInicio}</b>
                  </span>
                ))}
              </p>
            )}

            {/* --- Última lista: its four counts, as StatGrid tiles (DSH-2:
                these used to be loose Badges in a flex row). --- */}
            <section
              aria-labelledby="ultima-lista-title"
              data-testid="ultima-lista"
              className="card overflow-hidden"
            >
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <h2 id="ultima-lista-title" className="flex-1 text-sm font-bold text-ink">
                  {lastSession
                    ? `Última lista — ${formatDate(lastSession.fecha)} · ${lastSession.horario}`
                    : "Última lista"}
                </h2>
                <Link
                  href="/trainer/attendance/history"
                  className={buttonClasses("secondary", "sm")}
                >
                  Ver historial
                </Link>
              </div>

              {lastSession ? (
                <div className={`p-5 ${STAT_GRID}`}>
                  {STATE_ORDER.map((estado) => (
                    <StatCard
                      key={estado}
                      label={getAttendanceLabel(estado)}
                      value={lastSession.counts[estado]}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  surface="inset"
                  icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                  title="Todavía no registraste ninguna lista este mes"
                  description="En cuanto pases lista, el resumen de la sesión aparece aquí."
                />
              )}
            </section>

            {/*
              Two cards sharing one row, same grammar as /dashboard's own
              "Actividad reciente" + donut row: a flexible column and a fixed
              narrower one, both always rendered so an empty state reads as
              "nothing here yet", never as a layout that broke.
            */}
            <div className={PAGE_RAIL}>
              <section data-testid="recent-club-sessions" className="card overflow-hidden">
                <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                  <h2 className="flex-1 text-sm font-bold text-ink">Últimas listas del club</h2>
                </div>
                {recentSessions.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHead>
                        <tr>
                          <TableHeaderCell>Sesión</TableHeaderCell>
                          <TableHeaderCell>Resultado</TableHeaderCell>
                        </tr>
                      </TableHead>
                      <TableBody>
                        {recentSessions.map((s) => (
                          <TableRow key={`${s.horarioId}|${s.fecha}`}>
                            <TableNameCell name={formatDate(s.fecha)} sub={s.horario} />
                            <TableCell>
                              <div className="flex flex-wrap gap-[5px]">
                                {STATE_ORDER.map((estado) => (
                                  <Badge key={estado} tone={getAttendanceBadgeTone(estado)}>
                                    {s.counts[estado]}
                                    {/* A bare "9" tells a screen reader
                                        nothing; the state name rides along
                                        without changing the pill's width. */}
                                    <span className="sr-only">
                                      {" "}
                                      {getAttendanceLabel(estado).toLowerCase()}
                                    </span>
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState
                    surface="inset"
                    icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                    title="Todavía no hay listas registradas"
                    description="En cuanto alguien pase lista en el club, aparece aquí."
                  />
                )}
              </section>

              <section className="card flex flex-col gap-4 p-[18px]">
                {absenceAlert && (
                  <div className="flex flex-col gap-2.5 border-b border-line pb-4">
                    <p className="m-0 text-sm text-ink-2">
                      <b className="font-semibold text-ink">{absenceAlert.estudiante}</b> suma{" "}
                      <b className="font-semibold text-ink">
                        {formatAbsenceCount(absenceAlert.ausencias)}
                      </b>{" "}
                      este mes
                    </p>
                    <Button
                      variant="dark"
                      size="sm"
                      aria-describedby={ABSENCE_NOTICE_HINT_ID}
                      onClick={(): void => openHelpChat(buildAbsenceNotice(absenceAlert))}
                    >
                      <Megaphone size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                      Avisar al club
                    </Button>
                    <p id={ABSENCE_NOTICE_HINT_ID} className="m-0 text-xs text-ink-3">
                      Abre el asistente con el mensaje ya escrito. Usted lo revisa y lo envía.
                    </p>
                  </div>
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
          </>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
