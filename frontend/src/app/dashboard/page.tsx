/**
 * Panel de Control — the admin's day, drawn rather than listed.
 *
 * It follows the idiom the student dashboard settled on (calm cards, one clear
 * signal each, figures with a small picture) and spends it on what an
 * administrator asks, top to bottom:
 *
 *   1. "Hoy en el club": today's classes on a timeline, placed by their real
 *      hours and coloured by the state of their list, with a marker at the
 *      current minute. Each block opens that session's attendance. What needs
 *      the administrator's hands (payments waiting, people without a
 *      membership) sits under it as action chips, each with its own link —
 *      nothing to do is stated, not hidden.
 *   2. The pulse: four figures, each with the shape it is made of — alumnos
 *      against staff, memberships as a ring, payments by how long they have
 *      waited, attendance week by week.
 *   3. The work: attendance by state and week (toggle the states, hover the
 *      weeks) and a recent-activity feed with filter chips, beside the
 *      payments pipeline and its queue.
 *
 * Every block loads and fails on its own. The stats fail loudly and retry; the
 * best-effort lists (payments, attendance, timetable, roster) say in one line
 * that their data did not arrive and retry alone.
 *
 * No endpoint was added: everything derives from `fetchDashboardStats`,
 * `fetchPaymentValidations`, `fetchAttendanceRecords`, `fetchTrainingSchedules`
 * and the club-wide roster call the trainer screen already makes. The growth of
 * the padrón over time and the members' breakdown by role are NOT available from
 * any of them, so the members tile shows the one split the stats do support
 * (alumnos against staff) and nothing invented. See `buildActivityFeed` for the
 * feed's ceiling.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
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
  FilterPill,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
  SearchInput,
  STAT_GRID,
  type BadgeTone,
} from "@/components/ui";
import {
  Bars,
  Ring,
  SegmentBar,
  StackedBars,
  Timeline,
} from "@/components/charts";
import CompactEmpty from "@/components/dashboard/CompactEmpty";
import DashboardSection from "@/components/dashboard/DashboardSection";
import KpiTile from "@/components/dashboard/KpiTile";
import PaymentsAction from "@/components/dashboard/PaymentsAction";
import TimelineDayList from "@/components/dashboard/TimelineDayList";
import SectionNotice from "@/components/dashboard/SectionNotice";
import SectionSkeleton from "@/components/dashboard/SectionSkeleton";
import { buildContextLine } from "@/components/dashboard/context-line";
import {
  fetchDashboardStats,
  fetchAttendanceRecords,
  fetchPaymentValidations,
  fetchConteosPorHorario,
  fetchTrainingSchedules,
  type DashboardStats,
  type PaymentValidationRequest,
} from "@/services/api";
import {
  formatHumanDate,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import { buildWizardQuery } from "@/app/trainer/attendance/attendance-utils";
import { buildEnrolledCountsByHorario } from "@/app/trainer/trainer-day-utils";
import { formatDate } from "@/lib/format-utils";
import { ICON } from "@/lib/icon-size";
import { todayDiaSemana } from "@/lib/club-date";
import {
  attendanceChartSeries,
  attendanceWindowStartIso,
  buildActivityFeed,
  buildFourWeekAttendance,
  buildPaymentAgeBuckets,
  buildPaymentPipeline,
  buildPaymentQueue,
  buildTimelineItems,
  buildTodayClasses,
  buildWeeklyStatusBreakdown,
  clubNowMinutes,
  countPaymentsWaitingOverAWeek,
  filterActivity,
  formatWaiting,
  getActivityMarker,
  type ActivityFilter,
} from "./dashboard-utils";

/** Events loaded for the feed; the chips filter inside them, so it is larger than what shows. */
const ACTIVITY_POOL = 18;

/** Rows the feed shows once filtered. */
const ACTIVITY_LIMIT = 5;

/** Receipts previewed in the payments block before deferring to the full queue. */
const QUEUE_LIMIT = 4;

/** Weeks the attendance-by-state chart spans. */
const CHART_WEEKS = 6;

const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "payments", label: "Pagos" },
  { value: "attendance", label: "Asistencia" },
];

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

type SectionStatus = "loading" | "ready" | "error";

/** First name only — "Hola, Marta Gómez" is a greeting nobody says out loud. */
function firstNameOf(fullName: string | undefined): string {
  return fullName?.trim().split(/\s+/)[0] || "administrador";
}

const plural = (count: number, one: string, many: string): string =>
  count === 1 ? one : many;

export default function DashboardPage(): React.ReactElement {
  const { session, isLoading: authLoading } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentValidationRequest[]>([]);
  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [enrolled, setEnrolled] = useState<Record<number, number> | null>(null);
  const [recordsStatus, setRecordsStatus] = useState<SectionStatus>("loading");
  const [paymentsStatus, setPaymentsStatus] =
    useState<SectionStatus>("loading");
  const [schedulesStatus, setSchedulesStatus] =
    useState<SectionStatus>("loading");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activityQuery, setActivityQuery] = useState("");

  const loadStats = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setStats(await fetchDashboardStats());
    } catch {
      setError(
        "No se pudieron cargar las estadísticas del panel. Intente nuevamente.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * The best-effort lists, each on its own. A failing one must not blank
   * its neighbours, and each block needs to retry alone — but none of them may
   * fail silently, so each records its own status for its block to read.
   */
  const loadRecords = useCallback(async (): Promise<void> => {
    setRecordsStatus("loading");
    try {
      // Only the weeks the page draws, not the whole history (PERF-03).
      setRecords(
        await fetchAttendanceRecords({
          fechaInicio: attendanceWindowStartIso(CHART_WEEKS),
        }),
      );
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

  const todaySchedules = useMemo(() => {
    const today = todayDiaSemana();
    return schedules.filter((schedule) => schedule.diaSemana === today);
  }, [schedules]);

  /**
   * Enrolled students per class: a garnish for the tooltips, so failed
   * counts leave the counts unknown (the tooltip simply omits them) instead
   * of blocking the timeline.
   */
  useEffect((): (() => void) => {
    let cancelled = false;
    if (!isAdmin || todaySchedules.length === 0) {
      setEnrolled(null);
      return (): void => {};
    }
    fetchConteosPorHorario()
      .then((conteos) => {
        if (!cancelled)
          setEnrolled(buildEnrolledCountsByHorario(todaySchedules, conteos));
      })
      .catch(() => {
        if (!cancelled) setEnrolled(null);
      });
    return (): void => {
      cancelled = true;
    };
  }, [isAdmin, todaySchedules]);

  const fourWeeks = buildFourWeekAttendance(records);
  const weeklyStatus = useMemo(
    () => buildWeeklyStatusBreakdown(records, new Date(), CHART_WEEKS),
    [records],
  );
  const weeklyStatusTotal = weeklyStatus.reduce(
    (sum, week) => sum + week.total,
    0,
  );
  const activityPool = buildActivityFeed(payments, records, ACTIVITY_POOL);
  const filteredActivity = filterActivity(activityPool, activityFilter).filter(
    (event) =>
      event.subject.toLowerCase().includes(activityQuery.trim().toLowerCase()),
  );
  const activity = filteredActivity.slice(0, ACTIVITY_LIMIT);
  const queue = buildPaymentQueue(payments, QUEUE_LIMIT);
  const pipeline = buildPaymentPipeline(payments);
  const ageBuckets = buildPaymentAgeBuckets(payments);
  const todayClasses = useMemo(
    () => buildTodayClasses(todaySchedules, records),
    [todaySchedules, records],
  );
  const timelineItems = useMemo(
    () =>
      buildTimelineItems(
        todayClasses,
        enrolled,
        (id) =>
          `/trainer/attendance${buildWizardQuery(id, null, "mark-attendance")}`,
      ),
    [todayClasses, enrolled],
  );
  const listsTaken = todayClasses.filter(
    (entry) => entry.status === "taken",
  ).length;

  const listsMissing = todayClasses.filter(
    (entry) => entry.status === "missing",
  ).length;
  const todoItems: {
    key: string;
    label: string;
    hint: string;
    href: string;
    count: number;
    tone: BadgeTone;
  }[] = [
    {
      key: "payments",
      label: "Pagos por validar",
      hint: "Revise cada comprobante y apruébelo o recházelo.",
      href: "/payments",
      count: stats?.pendingPayments ?? 0,
      tone: "warn",
    },
    {
      key: "attendance",
      label: "Asistencias sin lista",
      hint: "Clases de hoy ya terminadas sin lista tomada.",
      href: "/attendance",
      count: listsMissing,
      tone: "bad",
    },
    {
      key: "members",
      label: "Alumnos sin membresía activa",
      hint: "Asígneles un plan o regularice su deuda.",
      href: "/members",
      count: stats?.personasSinMembresia ?? 0,
      tone: "warn",
    },
  ];

  const pendingPayments = stats?.pendingPayments ?? 0;
  const overAWeek = countPaymentsWaitingOverAWeek(payments);
  const activeMemberships = stats?.activeMemberships ?? 0;
  const totalPersonas = stats?.totalPersonas ?? 0;
  const totalAlumnos = stats?.totalAlumnos ?? 0;
  const staff = Math.max(0, totalPersonas - totalAlumnos);
  const personasSinMembresia = stats?.personasSinMembresia ?? 0;
  const membershipPercent =
    totalAlumnos > 0 ? Math.round((activeMemberships / totalAlumnos) * 100) : 0;

  const ageTotal = ageBuckets.today + ageBuckets.recent + ageBuckets.old;
  const ageData = [
    {
      key: "today",
      label: "Hoy",
      value: ageBuckets.today,
      detail: `Hoy: ${ageBuckets.today} ${plural(ageBuckets.today, "pago", "pagos")}`,
    },
    {
      key: "recent",
      label: "1–3 d",
      value: ageBuckets.recent,
      detail: `1 a 3 días: ${ageBuckets.recent} ${plural(ageBuckets.recent, "pago", "pagos")}`,
    },
    {
      key: "old",
      label: "+3 d",
      value: ageBuckets.old,
      detail: `Más de 3 días: ${ageBuckets.old} ${plural(ageBuckets.old, "pago", "pagos")}`,
    },
  ];
  const weekData = fourWeeks.bars.map((bar, index, all) => ({
    key: bar.startIso,
    label: index === all.length - 1 ? "Act." : `S-${all.length - 1 - index}`,
    value: bar.ratePercent,
    detail: `Semana del ${formatDate(bar.startIso).slice(0, 5)}: ${bar.ratePercent}% · ${bar.present} de ${bar.total}`,
  }));

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
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
            {/*
              The hero. The timeline is the day; the chips under it are what the
              day asks of the administrator. With nothing to do the chips row
              says so in one calm line instead of disappearing.
            */}
            <DashboardSection
              title="Hoy en el club"
              testId="today-hero"
              action={
                <Link
                  href="/attendance"
                  className={buttonClasses("secondary", "sm")}
                >
                  Ver asistencia
                </Link>
              }
            >
              <div className="flex flex-col gap-4 px-[18px] py-4">
                {schedulesStatus === "loading" ||
                recordsStatus === "loading" ? (
                  <SectionSkeleton label="Cargando clases…" rows={3} />
                ) : schedulesStatus === "error" ? (
                  <SectionNotice
                    message="No se pudieron cargar las clases de hoy."
                    onRetry={() => void loadSchedules()}
                  />
                ) : timelineItems.length > 0 ? (
                  <>
                    {recordsStatus === "error" && (
                      <SectionNotice
                        message="No se pudo comprobar qué listas ya se tomaron."
                        onRetry={() => void loadRecords()}
                      />
                    )}
                    {/* On a phone the proportional track crushes short sessions into unreadable chips:
                        keep its summary and legend, hide the track, and list the sessions in full. */}
                    <Timeline
                      items={timelineItems}
                      nowMinutes={clubNowMinutes()}
                      ariaLabel={`Clases de hoy: ${timelineItems.length} ${plural(timelineItems.length, "sesión", "sesiones")}, ${listsTaken} con lista tomada`}
                      className="max-lg:[&_[role=group]]:hidden [&_[data-testid=timeline-now-label]]:bg-coal"
                    />
                    <TimelineDayList items={timelineItems} className="lg:hidden" />
                  </>
                ) : (
                  <CompactEmpty
                    title="Hoy no hay clases"
                    description="Sin sesiones programadas."
                  />
                )}

                <div
                  data-testid="attention-chips"
                  className="flex flex-col gap-3 border-t border-line pt-4"
                >
                  <PaymentsAction
                    count={pendingPayments}
                    senders={queue.rows.map((row) => ({
                      id: row.id,
                      name: row.payer,
                      initials: row.initials,
                    }))}
                    oldest={
                      queue.rows.length > 0
                        ? formatWaiting(queue.rows[0].waitingDays).toLowerCase()
                        : null
                    }
                    overAWeek={overAWeek}
                  />
                  {personasSinMembresia > 0 && (
                    <p className="m-0 text-sm text-ink-2">
                      <b className="font-semibold text-ink">
                        {personasSinMembresia}{" "}
                        {plural(
                          personasSinMembresia,
                          "persona sin membresía",
                          "personas sin membresía",
                        )}
                        .
                      </b>{" "}
                      <Link
                        href="/members"
                        className="font-semibold text-ink underline underline-offset-2"
                      >
                        Ver miembros
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            </DashboardSection>

            {/*
              Four figures, each with the shape it is made of. Miembros counts
              the whole padrón (staff included) and Membresías activas only
              alumnos, on purpose (issue #313): the captions name the
              difference instead of forcing the two to agree.
            */}
            <div data-testid="dashboard-kpis" className={STAT_GRID}>
              <KpiTile
                label="Miembros"
                value={totalPersonas}
                visualPlacement="below"
                visual={
                  <SegmentBar
                    ariaLabel={`Miembros: ${totalAlumnos} alumnos y ${staff} representantes y personal`}
                    hideLegend
                    segments={[
                      {
                        key: "alumnos",
                        label: "Alumnos",
                        value: totalAlumnos,
                        tone: "coal",
                      },
                      {
                        key: "staff",
                        label: "Representantes y personal",
                        value: staff,
                        tone: "muted",
                      },
                    ]}
                  />
                }
                caption={`${totalAlumnos} alumnos · ${staff} representantes y personal`}
                captionClassName="max-lg:min-h-[44px]"
                href="/members"
              />
              <KpiTile
                label="Membresías activas"
                value={activeMemberships}
                unit={`de ${totalAlumnos}`}
                visual={
                  <div className="flex justify-end">
                    <Ring
                      value={activeMemberships}
                      total={totalAlumnos}
                      label="Membresías activas"
                    />
                  </div>
                }
                caption={`${membershipPercent}% del total`}
                href="/members"
              />
              <KpiTile
                label="Pagos por validar"
                value={pendingPayments}
                visual={
                  ageTotal > 0 ? (
                    <Bars
                      data={ageData}
                      ariaLabel={`Pagos por validar según su espera: ${ageBuckets.today} hoy, ${ageBuckets.recent} de 1 a 3 días, ${ageBuckets.old} de más de 3 días`}
                      heightClass="h-10"
                      highlightLast={false}
                      tone="warn"
                    />
                  ) : undefined
                }
                caption="Revisar pagos"
                href="/payments"
              />
              <KpiTile
                label="Asistencia · 4 semanas"
                value={recordsStatus === "loading" ? "—" : fourWeeks.ratePercent}
                unit={recordsStatus === "loading" ? undefined : "%"}
                visual={
                  <Bars
                    data={weekData}
                    max={100}
                    ariaLabel={`Asistencia de las últimas 4 semanas: ${weekData.map((d) => `${d.label} ${d.value}%`).join(", ")}`}
                    heightClass="h-10"
                  />
                }
                caption={
                  recordsStatus === "loading"
                    ? "Calculando…"
                    : `${fourWeeks.present} de ${fourWeeks.total} presentes`
                }
                href="/attendance"
              />
            </div>
          </>
        )}

        {/*
          Two independent columns, not row-aligned pairs. A pair stretches the
          shorter block to the taller one; each column stacks its own blocks
          instead, so it is exactly as tall as its content. Empty states are one
          line, so nothing here is a tall empty card.
        */}
        <div data-testid="dashboard-work" className={PAGE_RAIL}>
          <div
            data-testid="dashboard-main"
            data-dash-col
            className="flex min-w-0 flex-col gap-page"
          >
            <DashboardSection
              title="Actividad reciente"
              testId="activity-feed"
              action={
                <Link
                  href="/attendance"
                  className={buttonClasses("secondary", "sm")}
                >
                  Ver todo
                </Link>
              }
            >
              {recordsStatus === "loading" || paymentsStatus === "loading" ? (
                <SectionSkeleton label="Cargando actividad…" rows={ACTIVITY_LIMIT + 1} />
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
              ) : activityPool.length > 0 ? (
                <>
                  <div
                    data-testid="activity-toolbar"
                    className="flex flex-wrap items-center gap-x-3 gap-y-field border-b border-line px-[18px] py-3"
                  >
                    <SearchInput
                      label="Buscar en la actividad"
                      placeholder="Buscar por nombre…"
                      value={activityQuery}
                      onChange={setActivityQuery}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {ACTIVITY_FILTERS.map((filter) => (
                        <FilterPill
                          key={filter.value}
                          label={filter.label}
                          count={
                            filterActivity(activityPool, filter.value).length
                          }
                          active={activityFilter === filter.value}
                          onClick={() => setActivityFilter(filter.value)}
                        />
                      ))}
                    </div>
                    <span
                      className="ml-auto text-xs text-ink-3-strong"
                      aria-live="polite"
                    >
                      Mostrando {activity.length} de {filteredActivity.length}
                    </span>
                  </div>
                  {activity.length === 0 ? (
                    <CompactEmpty
                      title="Sin resultados"
                      description="Ningún movimiento coincide con el filtro."
                    />
                  ) : (
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
                                <span className="sr-only">
                                  {marker.label}:{" "}
                                </span>
                                {event.subject}
                              </>
                            }
                            detail={event.detail}
                            at={formatHumanDate(event.at)}
                          />
                        );
                      })}
                    </ActivityList>
                  )}
                </>
              ) : (
                <CompactEmpty
                  title="Todavía no hay movimiento"
                  description="Aquí aparecen los pagos que suben y las listas que se pasan."
                  action={
                    <Link
                      href="/trainer/attendance"
                      className={buttonClasses("primary", "sm")}
                    >
                      Pasar lista
                    </Link>
                  }
                />
              )}
            </DashboardSection>

            <DashboardSection
              title="Asistencia por estado"
              testId="attendance-distribution"
              action={
                <Link
                  href="/attendance"
                  className={buttonClasses("secondary", "sm")}
                >
                  Ver asistencia
                </Link>
              }
            >
              {recordsStatus === "loading" ? (
                <SectionSkeleton label="Cargando asistencias…" rows={5} />
              ) : recordsStatus === "error" ? (
                <SectionNotice
                  message="No se pudo cargar la asistencia."
                  onRetry={() => void loadRecords()}
                />
              ) : weeklyStatusTotal > 0 ? (
                <div className="p-[18px]">
                  <StackedBars
                    series={attendanceChartSeries()}
                    columns={weeklyStatus.map((week) => ({
                      key: week.startIso,
                      label: `Sem. ${formatDate(week.startIso).slice(0, 5)}`,
                      values: week.counts,
                    }))}
                    ariaLabel={`Asistencia por estado en las últimas ${CHART_WEEKS} semanas, ${weeklyStatusTotal} registros`}
                    tableCaption={`Asistencia por estado, ${CHART_WEEKS} semanas`}
                    periodLabel="Semana"
                  />
                </div>
              ) : (
                <CompactEmpty
                  title="Sin asistencias registradas"
                  description="El gráfico se dibuja con la primera lista."
                />
              )}
            </DashboardSection>
          </div>

          <div
            data-testid="dashboard-rail"
            data-dash-col
            className="flex min-w-0 flex-col gap-page"
          >
            <DashboardSection
              title="Pagos"
              testId="payment-queue"
              action={
                <Link
                  href="/payments"
                  className={buttonClasses("secondary", "sm")}
                >
                  Ver todos
                </Link>
              }
            >
              {paymentsStatus === "loading" ? (
                <SectionSkeleton label="Cargando pagos…" rows={QUEUE_LIMIT + 1} />
              ) : paymentsStatus === "error" ? (
                <SectionNotice
                  message="No se pudieron cargar los pagos por validar."
                  onRetry={() => void loadPayments()}
                />
              ) : payments.length > 0 ? (
                <>
                  <div className="px-[18px] py-4">
                    <SegmentBar
                      ariaLabel={`Pagos por estado: ${pipeline.pendiente} por validar, ${pipeline.validado} validados, ${pipeline.rechazado} rechazados`}
                      segments={[
                        {
                          key: "pendiente",
                          label: "Por validar",
                          value: pipeline.pendiente,
                          tone: "warn",
                          href: "/payments",
                        },
                        {
                          key: "validado",
                          label: "Validados",
                          value: pipeline.validado,
                          tone: "ok",
                          href: "/payments",
                        },
                        {
                          key: "rechazado",
                          label: "Rechazados",
                          value: pipeline.rechazado,
                          tone: "bad",
                          href: "/payments",
                        },
                      ]}
                    />
                  </div>
                  {queue.rows.length > 0 ? (
                    <ActivityList className="border-t border-line">
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
                    <p className="m-0 flex items-center gap-2.5 border-t border-line px-[18px] py-3.5 text-sm text-ink-2">
                      <CircleCheck
                        size={ICON.base}
                        strokeWidth={1.5}
                        className="flex-none text-state-ok"
                        aria-hidden="true"
                      />
                      No hay pagos por validar.
                    </p>
                  )}
                </>
              ) : (
                <CompactEmpty
                  title="No hay pagos por validar"
                  description="Los comprobantes de las familias aparecen aquí."
                />
              )}
            </DashboardSection>

            <InfoPanel title="Qué hacer hoy" as="div">
              <p>Revise en este orden; cada punto abre su pantalla.</p>
              <div className="grid gap-3">
                {todoItems.map((item) => (
                  <div key={item.key} className="flex items-start gap-2">
                    <Badge tone={item.count > 0 ? item.tone : "ok"}>
                      {item.count}
                    </Badge>
                    <span>
                      <Link
                        href={item.href}
                        className="font-semibold text-ink underline underline-offset-2"
                      >
                        {item.label}
                      </Link>
                      <span className="block">{item.hint}</span>
                    </span>
                  </div>
                ))}
              </div>
              <dl className="m-0 grid gap-1.5 border-t border-line pt-3">
                <dt className="font-semibold text-ink">
                  Cómo leer «Hoy en el club»
                </dt>
                <dd className="m-0">
                  <b className="font-semibold text-ink">Lista tomada</b>: ya se
                  pasó asistencia.
                </dd>
                <dd className="m-0">
                  <b className="font-semibold text-ink">En curso</b>: la clase
                  está ocurriendo ahora.
                </dd>
                <dd className="m-0">
                  <b className="font-semibold text-ink">Pendiente</b>: aún no
                  empieza.
                </dd>
                <dd className="m-0">
                  <b className="font-semibold text-ink">Sin lista</b>: terminó y
                  falta pasar asistencia.
                </dd>
              </dl>
            </InfoPanel>
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
