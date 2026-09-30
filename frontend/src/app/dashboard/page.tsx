/**
 * Panel de Control — the admin's day, organised around what needs doing now.
 *
 * Top to bottom, each block answers the next question the reader has:
 *
 *   1. Header: who and when — a greeting and "Administración · <fecha>".
 *   2. "Requiere su atención": the actionable counts (payments waiting,
 *      members without a membership), each with its own action on the same
 *      row. It replaces the full-width coal hero that carried one number and
 *      left the rest of the bar empty. Nothing to do is stated, not hidden.
 *   3. The pulse: four figures, each one link to the module it comes from.
 *   4. The work: "Pagos por validar" (the queue, oldest first) beside "Clases
 *      de hoy" (today's timetable read against today's lists).
 *   5. Two calm blocks level with each other: recent activity and how
 *      attendance splits.
 *
 * Every block loads and fails on its own. The stats fail loudly and retry as
 * before; the best-effort lists (payments, attendance, timetable) used to fail
 * silently into an empty state, which is indistinguishable from "nothing
 * happened". Each now says in one line that its data did not arrive, and
 * retries alone.
 *
 * No endpoint was added: everything here derives from `fetchDashboardStats`,
 * `fetchPaymentValidations`, `fetchAttendanceRecords` and
 * `fetchTrainingSchedules`. See `buildActivityFeed` for the feed's ceiling.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  ActivityItem,
  ActivityList,
  Badge,
  buttonClasses,
  cn,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  STAT_GRID,
  StatSpark,
  StatCard,
  StatTrack,
  type BadgeTone,
} from "@/components/ui";
import AttentionStrip, { type AttentionItem } from "@/components/dashboard/AttentionStrip";
import CompactEmpty from "@/components/dashboard/CompactEmpty";
import DashboardSection from "@/components/dashboard/DashboardSection";
import StatusRowList from "@/components/dashboard/StatusRowList";
import SectionNotice from "@/components/dashboard/SectionNotice";
import { buildContextLine } from "@/components/dashboard/context-line";
import {
  fetchDashboardStats,
  fetchAttendanceRecords,
  fetchPaymentValidations,
  fetchTrainingSchedules,
  type DashboardStats,
  type PaymentValidationRequest,
} from "@/services/api";
import {
  buildAttendanceStats,
  formatHumanDate,
  type AttendanceDayStats,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { buildWizardQuery } from "@/app/trainer/attendance/attendance-utils";
import { todayDiaSemana } from "@/lib/club-date";
import {
  buildActivityFeed,
  buildFourWeekAttendance,
  buildPaymentQueue,
  buildTodayClasses,
  countPaymentsWaitingOverAWeek,
  formatWaiting,
  getActivityMarker,
  type TodayClassStatus,
} from "./dashboard-utils";
import AttendanceStatusChart from "./AttendanceStatusChart";

/**
 * Six rows, level with the donut's six-row legend: two blocks side by side end
 * where the shorter one runs out, so the feed is sized to the legend instead of
 * leaving a gap under it.
 */
const ACTIVITY_LIMIT = 6;

/** Receipts previewed in "Pagos por validar" before deferring to the full queue. */
const QUEUE_LIMIT = 5;

/**
 * The marker's dot color, one per `Badge` tone. Same idiom
 * `/student/payments` uses for its own status dot (`STATUS_DOT_TEXT`): plain
 * `text-state-*` rather than the pill's `-bg` pair, since this dot sits alone
 * next to a name rather than inside a `Badge`.
 */
const ACTIVITY_MARKER_DOT_TONE: Record<BadgeTone, string> = {
  neutral: "text-state-neutral",
  ok: "text-state-ok",
  warn: "text-state-warn",
  bad: "text-state-bad",
};

const CLASS_STATUS: Record<TodayClassStatus, { tone: BadgeTone; label: string }> = {
  taken: { tone: "ok", label: "Lista tomada" },
  missing: { tone: "warn", label: "Sin lista" },
  pending: { tone: "neutral", label: "Pendiente" },
};

type SectionStatus = "loading" | "ready" | "error";

/** First name only — "Hola, Marta Gómez" is a greeting nobody says out loud. */
function firstNameOf(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || "administrador";
}

export default function DashboardPage(): React.ReactElement {
  const { session, isLoading: authLoading } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentValidationRequest[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [recordsStatus, setRecordsStatus] = useState<SectionStatus>("loading");
  const [paymentsStatus, setPaymentsStatus] = useState<SectionStatus>("loading");
  const [schedulesStatus, setSchedulesStatus] = useState<SectionStatus>("loading");

  const loadStats = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchDashboardStats());
    } catch {
      setError("No se pudieron cargar las estadísticas del panel. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The three best-effort lists, each on its own. A failing one must not blank
   * its neighbours, and each block needs to retry alone — but none of them may
   * fail silently, so each records its own status for its block to read.
   */
  const loadRecords = useCallback(async (): Promise<void> => {
    setRecordsStatus("loading");
    try {
      setRecords(await fetchAttendanceRecords());
      setRecordsStatus("ready");
    } catch {
      setRecords([]);
      setRecordsStatus("error");
    }
  }, []);

  const loadPayments = useCallback(async (): Promise<void> => {
    setPaymentsStatus("loading");
    try {
      setPayments(await fetchPaymentValidations());
      setPaymentsStatus("ready");
    } catch {
      setPayments([]);
      setPaymentsStatus("error");
    }
  }, []);

  const loadSchedules = useCallback(async (): Promise<void> => {
    setSchedulesStatus("loading");
    try {
      setSchedules(await fetchTrainingSchedules());
      setSchedulesStatus("ready");
    } catch {
      setSchedules([]);
      setSchedulesStatus("error");
    }
  }, []);

  // Gate the fetch on the RESOLVED role — same fix as `/members` (issue #319
  // hallazgo #49). `ProtectedRoute` redirects a non-admin away, but its
  // redirect runs in an effect of its own; a bare mount effect here fired
  // GET /api/dashboard (and its siblings) before that redirect landed, so a
  // student's browser logged 403s on its way to /student.
  const isAdmin = !authLoading && session?.user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    void loadStats();
    void loadRecords();
    void loadPayments();
    void loadSchedules();
  }, [isAdmin, loadStats, loadRecords, loadPayments, loadSchedules]);

  const attendanceStats: AttendanceDayStats = buildAttendanceStats(records);
  const fourWeeks = buildFourWeekAttendance(records);
  const activity = buildActivityFeed(payments, records, ACTIVITY_LIMIT);
  const queue = buildPaymentQueue(payments, QUEUE_LIMIT);
  const todayClasses = useMemo(() => {
    const today = todayDiaSemana();
    return buildTodayClasses(
      schedules.filter((schedule) => schedule.diaSemana === today),
      records,
    );
  }, [schedules, records]);

  const pendingPayments = stats?.pendingPayments ?? 0;
  const overAWeek = countPaymentsWaitingOverAWeek(payments);
  const activeMemberships = stats?.activeMemberships ?? 0;
  const totalPersonas = stats?.totalPersonas ?? 0;
  const totalAlumnos = stats?.totalAlumnos ?? 0;
  const personasSinMembresia = stats?.personasSinMembresia ?? 0;
  const membershipPercent =
    totalAlumnos > 0 ? Math.round((activeMemberships / totalAlumnos) * 100) : 0;

  /**
   * The strip's rows: only what has a count. A row with nothing behind it is
   * noise, and the strip says "all clear" when none is left.
   */
  const attention: AttentionItem[] = [];
  if (pendingPayments > 0) {
    attention.push({
      id: "payments",
      count: pendingPayments,
      label: pendingPayments === 1 ? "pago espera su validación" : "pagos esperan su validación",
      note:
        overAWeek > 0
          ? `${overAWeek} ${overAWeek === 1 ? "lleva" : "llevan"} más de una semana esperando`
          : null,
      href: "/payments",
      cta: "Revisar",
    });
  }
  if (personasSinMembresia > 0) {
    attention.push({
      id: "sin-membresia",
      count: personasSinMembresia,
      label: personasSinMembresia === 1 ? "persona sin membresía" : "personas sin membresía",
      note: "por regularizar",
      tone: "neutral",
      href: "/members",
      cta: "Ver miembros",
    });
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      {/*
        The header action is not the payments shortcut any more — that lives on
        the attention row, next to the count it clears. The slot carries the
        one thing the dashboard does not already answer.
      */}
      <AppShell
        title={`Hola, ${firstNameOf(session?.user?.name)}`}
        subtitle={buildContextLine("Administración")}
        actions={
          <Link href="/reports" className={buttonClasses("secondary")}>
            Ver reportes
          </Link>
        }
      >
        {error && (
          <ErrorState
            title="No se pudieron cargar las estadísticas"
            message={error}
            onRetry={() => void loadStats()}
          />
        )}

        {loading && !stats ? (
          <LoadingState label="Cargando estadísticas…" />
        ) : (
          <>
            <AttentionStrip
              title="Requiere su atención"
              items={attention}
              allClearMessage="Todo al día: no hay nada pendiente por revisar."
            />

            {/*
              Four tiles, each the front door of its module. "Sin membresía"
              left the pulse for the attention strip above, where it is an
              action rather than a figure.

              Miembros counts the whole padrón (staff included) and Membresías
              activas only alumnos, on purpose (issue #313): the captions name
              the difference instead of forcing the two to agree. The bar and
              the sparkline are the two figures whose SHAPE is a proportion and
              a series (`StatTrack`, `StatSpark`).
            */}
            <div className={STAT_GRID}>
              <StatCard
                label="Miembros"
                value={totalPersonas}
                hint="personas registradas (incluye staff)"
                href="/members"
              />
              <StatCard
                label="Membresías activas"
                value={activeMemberships}
                unit={`de ${totalAlumnos}`}
                href="/members"
                hint={
                  <span className="flex flex-col gap-y-field">
                    <StatTrack value={activeMemberships} total={totalAlumnos} />
                    <span>{membershipPercent}% del total</span>
                  </span>
                }
              />
              <StatCard
                label="Sesiones hoy"
                value={stats?.todaySchedules ?? 0}
                hint="programadas para hoy"
                href="/attendance"
              />
              <StatCard
                label="Asistencia · 4 semanas"
                value={fourWeeks.ratePercent}
                unit="%"
                href="/attendance"
                hint={
                  <span className="flex flex-col gap-y-field">
                    <StatSpark values={fourWeeks.bars.map((bar) => bar.ratePercent)} />
                    <span>{`${fourWeeks.present} de ${fourWeeks.total} presentes`}</span>
                  </span>
                }
              />
            </div>
          </>
        )}

        {/*
          Two independent columns, not row-aligned pairs. A pair stretches the
          shorter block to the taller one (one pending payment beside five
          classes left a hole under the payment); each column stacks its own
          blocks instead, so it is exactly as tall as its content. Empty states
          are one line, so nothing here is a tall empty card.
        */}
        <div data-testid="dashboard-work" className={PAGE_RAIL}>
          <div data-testid="dashboard-main" className="flex min-w-0 flex-col gap-page">
          <DashboardSection
            title="Pagos por validar"
            testId="payment-queue"
            action={
              <Link href="/payments" className={buttonClasses("secondary", "sm")}>
                Ver todos
              </Link>
            }
          >
            {paymentsStatus === "loading" ? (
              <LoadingState label="Cargando pagos…" />
            ) : paymentsStatus === "error" ? (
              <SectionNotice
                message="No se pudieron cargar los pagos por validar."
                onRetry={() => void loadPayments()}
              />
            ) : queue.rows.length > 0 ? (
              <ActivityList>
                {queue.rows.map((row) => (
                  <ActivityItem
                    key={row.id}
                    initials={row.initials}
                    subject={row.payer}
                    detail={row.detail}
                    at={
                      <Badge tone={row.overdue ? "warn" : "neutral"}>
                        {formatWaiting(row.waitingDays)}
                      </Badge>
                    }
                  />
                ))}
              </ActivityList>
            ) : (
              <CompactEmpty
                title="No hay pagos por validar"
                description="Los comprobantes de las familias aparecen aquí."
              />
            )}
          </DashboardSection>

          <DashboardSection
            title="Actividad reciente"
            testId="activity-feed"
            action={
              <Link href="/attendance" className={buttonClasses("secondary", "sm")}>
                Ver todo
              </Link>
            }
          >
            {recordsStatus === "loading" || paymentsStatus === "loading" ? (
              <LoadingState label="Cargando actividad…" />
            ) : recordsStatus === "error" || paymentsStatus === "error" ? (
              <SectionNotice
                message={
                  recordsStatus === "error"
                    ? "No se pudo cargar la asistencia, así que la actividad está incompleta."
                    : "No se pudieron cargar los pagos, así que la actividad está incompleta."
                }
                onRetry={() => {
                  if (recordsStatus === "error") void loadRecords();
                  if (paymentsStatus === "error") void loadPayments();
                }}
              />
            ) : activity.length > 0 ? (
              <ActivityList>
                {activity.map((event) => {
                  const marker = getActivityMarker(event.kind);
                  return (
                    <ActivityItem
                      key={event.id}
                      initials={event.initials}
                      subject={
                        <>
                          {/* A persistent dot ahead of the name marks every row
                              by its `kind`, colour-only — the `sr-only` label
                              right after it is what makes the mark itself
                              accessible, not just the sentence that follows. */}
                          <span
                            aria-hidden="true"
                            data-testid={`activity-marker-${event.kind}`}
                            className={cn(
                              "mr-1.5 inline-block h-1.5 w-1.5 flex-none rounded-full bg-current align-middle",
                              ACTIVITY_MARKER_DOT_TONE[marker.tone],
                            )}
                          />
                          <span className="sr-only">{marker.label}: </span>
                          {event.subject}
                        </>
                      }
                      detail={event.detail}
                      at={formatHumanDate(event.at)}
                    />
                  );
                })}
              </ActivityList>
            ) : (
              <CompactEmpty
                title="Todavía no hay movimiento"
                description="Aquí aparecen los pagos que suben y las listas que se pasan."
                action={
                  <Link href="/trainer/attendance" className={buttonClasses("primary", "sm")}>
                    Pasar lista
                  </Link>
                }
              />
            )}
          </DashboardSection>

          </div>
          <div data-testid="dashboard-rail" className="flex min-w-0 flex-col gap-page">
          <DashboardSection
            title="Clases de hoy"
            testId="today-classes"
            action={
              <Link href="/attendance" className={buttonClasses("secondary", "sm")}>
                Ver asistencia
              </Link>
            }
          >
            {schedulesStatus === "loading" || recordsStatus === "loading" ? (
              <LoadingState label="Cargando clases…" />
            ) : schedulesStatus === "error" ? (
              <SectionNotice
                message="No se pudieron cargar las clases de hoy."
                onRetry={() => void loadSchedules()}
              />
            ) : todayClasses.length > 0 ? (
              <>
                {recordsStatus === "error" && (
                  <SectionNotice
                    message="No se pudo comprobar qué listas ya se tomaron."
                    onRetry={() => void loadRecords()}
                  />
                )}
                <StatusRowList
                  rows={todayClasses.map((entry) => ({
                    id: entry.scheduleId,
                    title: entry.hours,
                    detail: entry.category,
                    status: CLASS_STATUS[entry.status],
                    action:
                      entry.status === "missing" ? (
                        <Link
                          href={`/trainer/attendance${buildWizardQuery(entry.scheduleId, null, "mark-attendance")}`}
                          className={buttonClasses("secondary", "sm")}
                        >
                          Pasar lista
                        </Link>
                      ) : null,
                  }))}
                />
              </>
            ) : (
              <CompactEmpty title="Hoy no hay clases" description="Sin sesiones programadas." />
            )}
          </DashboardSection>
          <DashboardSection title="Distribución de asistencias" testId="attendance-distribution">
            {recordsStatus === "loading" ? (
              <LoadingState label="Cargando asistencias…" />
            ) : recordsStatus === "error" ? (
              <SectionNotice
                message="No se pudo cargar la asistencia."
                onRetry={() => void loadRecords()}
              />
            ) : attendanceStats.totalStudents > 0 ? (
              <div className="p-[18px]">
                <AttendanceStatusChart stats={attendanceStats} />
              </div>
            ) : (
              <CompactEmpty
                title="Sin asistencias registradas"
                description="El gráfico se dibuja con la primera lista."
              />
            )}
          </DashboardSection>
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
