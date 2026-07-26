/**
 * Trainer — "Mi día" (`docs/ux/prototipos/19-entrenador.html`).
 *
 * The screen has ONE decision on it: pass the list for the next session. The
 * audit found the previous version fusing two quick-action cards, three stat
 * cards, a four-control filter panel and a paginated history table into one
 * scroll — five competing focal points for a person holding a phone at
 * courtside. The history moved out to its own view
 * (`/trainer/attendance/history`, prototype `21-entrenador-historial.html`)
 * and the stat cards went with it; what is left is the hero, what comes after
 * it, and the last list.
 *
 * ## Only what the backend can sustain
 *
 * "N estudiantes inscritos", not "N esperan": the number is a count of
 * `AlumnoHorario` rows (who is ENROLLED), and no DTO says who turned up. And
 * no level anywhere on THIS screen — neither the hero nor a Niveles section —
 * because "Mi día" has one decision on it. Levels are their own destination:
 * `/trainer/nivel` renders the same ladder the admin's `/ranking` renders (see
 * `NivelLadderScreen`), and the sidebar links to it.
 *
 * "Avisar al club" has no endpoint behind it: nothing in the API notifies the
 * club about a student. It opens the help assistant with the message already
 * written (see `openHelpChat`), which is the only real channel there is.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell, { openHelpChat } from "@/components/shell/AppShell";
import { ArrowRight, CalendarCheck, ClipboardList, Megaphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchTrainingSchedules,
  fetchAttendanceRecords,
  fetchAlumnosPorHorario,
} from "@/services/api";
import { Badge, Button, EmptyState, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import {
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

/** The order the four states are read in — best news first, as on every other screen. */
const STATE_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

/**
 * `.btn.xl` (`_sistema.css:174`) — 52px, 22px padding, 15px label, 12px
 * radius. Hand-rolled rather than added to the `Button` primitive because
 * this is the single XL control in the product, and `components/ui` is not
 * this change's to extend.
 */
const XL_CTA =
  "inline-flex h-[52px] items-center justify-center gap-2 rounded-xl bg-cata-red px-[22px] " +
  "text-[15px] font-semibold text-white transition-colors hover:bg-cata-red-dark";

/** First name only — "Hola, Carlos Mendoza" is a greeting nobody says out loud. */
function firstNameOf(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] ?? "entrenador";
}

export default function TrainerPage(): React.ReactElement {
  const { session } = useAuth();

  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([]);
  const [enrolledCount, setEnrolledCount] = useState<number | null>(null);
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

  useEffect(() => {
    loadData();
  }, [loadData]);

  const todaySchedules = useMemo(() => {
    const today = todayDiaSemana();
    return schedules.filter((s) => s.diaSemana === today);
  }, [schedules]);

  const { next, later } = useMemo(() => selectTodaySessions(todaySchedules), [todaySchedules]);
  const lastSession = useMemo(() => summarizeLastSession(monthRecords), [monthRecords]);
  const absenceAlert = useMemo(() => findAbsenceAlert(monthRecords), [monthRecords]);

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
        eyebrow="Área de entrenadores"
        title={`Hola, ${firstNameOf(session?.user?.name)}`}
        subtitle="Mi día — tu próxima sesión y el resumen de la última lista."
      >
        {loading && <LoadingState label="Cargando tu día…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => loadData()} />}

        {!loading && !error && (
          <div className="flex flex-col gap-5">
            {/* --- The hero: the one thing to do next. --- */}
            {next ? (
              <div className="flex flex-wrap items-end gap-6 rounded-card bg-coal px-7 py-6 text-white">
                <span className="text-[46px] font-extrabold leading-none tracking-[-0.05em] tabular-nums">
                  {next.horaInicio}
                </span>
                <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                  <b className="text-[17px] font-bold tracking-[-0.015em]">
                    {formatDay(next.diaSemana)} {next.horaInicio} — {next.horaFin}
                  </b>
                  <span className="flex items-center gap-2 text-[13px] text-white/60">
                    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
                    {formatSessionCountdown(minutesUntilStart(next))}
                    {enrolledLabel ? ` · ${enrolledLabel}` : ""}
                  </span>
                </div>
                <Link href="/trainer/attendance" className={XL_CTA}>
                  Pasar lista
                  <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <div className="rounded-card border border-line bg-paper">
                <EmptyState
                  icon={<CalendarCheck size={21} strokeWidth={1.5} aria-hidden="true" />}
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
              </div>
            )}

            {/* --- What comes after it. One line, not a second list. --- */}
            {later.length > 0 && (
              <p className="text-[13px] text-ink-3">
                Después:{" "}
                {later.map((s, index) => (
                  <span key={s.id}>
                    {index > 0 ? " · " : ""}
                    <b className="font-semibold text-ink">{s.horaInicio}</b>
                  </span>
                ))}
              </p>
            )}

            {/* --- Última lista: a result, and something to do about it. --- */}
            <section
              aria-labelledby="ultima-lista-title"
              className="overflow-hidden rounded-card border border-line bg-paper"
            >
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <h2 id="ultima-lista-title" className="flex-1 text-[13px] font-bold text-ink">
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
                <div className="flex flex-col gap-3.5 px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    {STATE_ORDER.map((estado) => (
                      <Badge key={estado} tone={getAttendanceBadgeTone(estado)}>
                        {lastSession.counts[estado]} {getAttendanceLabel(estado).toLowerCase()}
                      </Badge>
                    ))}
                  </div>

                  {absenceAlert && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3.5">
                      <p className="m-0 min-w-[230px] flex-1 text-[13.5px] text-ink-2">
                        <b className="font-semibold text-ink">{absenceAlert.estudiante}</b> suma{" "}
                        <b className="font-semibold text-ink">
                          {formatAbsenceCount(absenceAlert.ausencias)}
                        </b>{" "}
                        este mes
                      </p>
                      <Button
                        variant="dark"
                        size="sm"
                        onClick={(): void => openHelpChat(buildAbsenceNotice(absenceAlert))}
                      >
                        <Megaphone size={14} strokeWidth={2} aria-hidden="true" />
                        Avisar al club
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={<ClipboardList size={21} strokeWidth={1.5} aria-hidden="true" />}
                  title="Todavía no registraste ninguna lista este mes"
                  description="En cuanto pases lista, el resumen de la sesión aparece aquí."
                />
              )}
            </section>
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
