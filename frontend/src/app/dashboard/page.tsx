/**
 * Panel de Control — the admin's "jornada", redesigned for Fase 3.
 *
 * Source of truth: `docs/ux/prototipos/06-panel.html`.
 *
 * The audit's verdict on the previous version was that the page was a table of
 * contents for the sidebar next to it: four "Acciones Rápidas" cards, of which
 * four duplicated sidebar links, above three stat cards that answered nothing
 * in particular. So:
 *
 *   · A coal hero carrying ONE number — how many payments are waiting — and
 *     the button that acts on it. Its sub-line appears only when it has
 *     something to say. Nothing else lives in the hero.
 *   · A pulse of three stats: Miembros, Membresías activas and Asistencia over
 *     the last four weeks. All three share one internal grammar.
 *   · "Actividad reciente", derived from data the admin surfaces already
 *     fetch — see `buildActivityFeed` for why this needs no new endpoint and
 *     what its ceiling is. The comment that used to live here declaring the
 *     feed impossible is gone with it.
 *   · The 4-state donut. Its `<table>` legend, per-arc `<title>` and
 *     bidirectional hover/focus were one of the audit's three named strengths
 *     and are untouched — only its flow and its text colors changed.
 *   · `quickActions` is deleted.
 *
 * The feed and the donut share one row below the pulse. The page was otherwise
 * a stack of equal-weight full-width white cards with no path for the eye.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ArrowRight, CalendarCheck, ClipboardList } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  ActivityItem,
  ActivityList,
  ActivityListHeader,
  buttonClasses,
  EmptyState,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  STAT_GRID,
  StatCard,
} from "@/components/ui";
import {
  fetchDashboardStats,
  fetchAttendanceRecords,
  fetchPaymentValidations,
  type DashboardStats,
  type PaymentValidationRequest,
} from "@/services/api";
import {
  buildAttendanceStats,
  formatHumanDate,
  type AttendanceDayStats,
  type AttendanceRecord,
} from "@/app/attendance/attendance-utils";
import {
  buildActivityFeed,
  buildFourWeekAttendance,
  countPaymentsWaitingOverAWeek,
} from "./dashboard-utils";
import AttendanceStatusChart from "./AttendanceStatusChart";

/**
 * How many activity rows the card shows before deferring to the full lists.
 *
 * Five, not six: the feed now shares its row with the donut, and a card that
 * outgrows its neighbour is back to dominating the page.
 */
const ACTIVITY_LIMIT = 5;

export default function DashboardPage(): React.ReactElement {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<PaymentValidationRequest[]>([]);

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
   * Best-effort, and deliberately separate from the stats error/retry above:
   * these two feed the pulse's attendance bars and the activity card. If
   * either fails, its section simply does not render — a dashboard that
   * refuses to load because a secondary list timed out is worse than a
   * dashboard missing one card.
   */
  const loadDetail = useCallback(async (): Promise<void> => {
    const [recordsResult, paymentsResult] = await Promise.allSettled([
      fetchAttendanceRecords(),
      fetchPaymentValidations(),
    ]);
    setRecords(recordsResult.status === "fulfilled" ? recordsResult.value : []);
    setPayments(paymentsResult.status === "fulfilled" ? paymentsResult.value : []);
  }, []);

  useEffect(() => {
    void loadStats();
    void loadDetail();
  }, [loadStats, loadDetail]);

  const attendanceStats: AttendanceDayStats = buildAttendanceStats(records);
  const fourWeeks = buildFourWeekAttendance(records);
  const activity = buildActivityFeed(payments, records, ACTIVITY_LIMIT);

  const pendingPayments = stats?.pendingPayments ?? 0;
  const overAWeek = countPaymentsWaitingOverAWeek(payments);
  const activeMemberships = stats?.activeMemberships ?? 0;
  const totalPersonas = stats?.totalPersonas ?? 0;
  const totalAlumnos = stats?.totalAlumnos ?? 0;
  const personasSinMembresia = stats?.personasSinMembresia ?? 0;
  const membershipPercent =
    totalAlumnos > 0 ? Math.round((activeMemberships / totalAlumnos) * 100) : 0;

  /**
   * The hero's second line, or nothing at all.
   *
   * It used to fall back to "Ninguno lleva más de una semana esperando" — a
   * negative spending the most valuable space on the screen to report that
   * there is nothing to report. The line now appears only when it carries a
   * reason to act now, or when the queue being empty is itself the news.
   */
  const heroNote =
    overAWeek > 0
      ? `${overAWeek} ${overAWeek === 1 ? "lleva" : "llevan"} más de una semana esperando`
      : pendingPayments === 0
        ? "La cola está al día"
        : null;

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        title="Panel de Control"
        actions={
          <Link href="/payments" className={buttonClasses("primary")}>
            {pendingPayments > 0 ? "Revisar ahora" : "Ver pagos"}
            <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
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
            {/* Hero — one number and the sentence that reads it. Nothing else
                belongs here.

                It used to close with the action too ("Revisar ahora"), which
                made this the third place in the product where a screen's
                primary action could be found. An admin who learned "the button
                is at the top right" was right on three screens out of eight.
                The action moved to the header's `actions` slot; the number and
                the sentence stay, because they are what the action is FOR. */}
            <section className="flex flex-wrap items-center gap-x-6 gap-y-section rounded-card bg-coal px-6 py-6">
              <span className="text-display font-extrabold leading-none tabular-nums text-white">
                {pendingPayments}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold text-white">
                  {pendingPayments === 1
                    ? "Pago espera tu validación"
                    : "Pagos esperan tu validación"}
                </span>
                {heroNote && (
                  <span
                    data-testid="hero-note"
                    className="mt-1 flex items-center gap-2 text-sm text-white/60"
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
                    {heroNote}
                  </span>
                )}
              </span>
            </section>

            {/*
              Pulse — one internal grammar across all four tiles: uppercase
              label, ink figure with its unit, one caption line.

              The tiles used to close on three different things — a caption, a
              progress track, four sparkbars — which read as three unrelated
              widgets rather than one pulse. Miembros has no ratio the API
              supplies, so no meter could be made uniform; the captions carry
              the numbers the widgets only gestured at, which is what the
              sparkbars' own aria-label already conceded they could not.
            */}
            <div className={STAT_GRID}>
              <StatCard label="Miembros" value={totalPersonas} hint="personas registradas" />
              {/*
                  The denominator is `totalAlumnos`, not `totalPersonas`: this
                  counts membresía rows in estado ACTIVA, and administradores
                  and entrenadores are on the padrón without ever holding one.
                  Counting against the whole padrón made a club of 84 alumnos
                  with 21 active memberships read "de 86 · 24%" instead of
                  "de 84 · 25%" — every staff account pushing the ratio further
                  down. The tile above answers the other question and keeps the
                  full padrón; the backend supplies both counts precisely so
                  neither has to stand in for the other.
              */}
              <StatCard
                label="Membresías activas"
                value={activeMemberships}
                unit={`de ${totalAlumnos}`}
                hint={`${membershipPercent}% del total`}
              />
              <StatCard
                label="Sin membresía"
                value={personasSinMembresia}
                hint="por regularizar"
              />
              <StatCard
                label="Asistencia · 4 semanas"
                value={fourWeeks.ratePercent}
                unit="%"
                hint={`${fourWeeks.present} de ${fourWeeks.total} presentes`}
              />
            </div>
          </>
        )}

        {/*
          Below the pulse the page used to be a stack of equal-weight full-width
          white cards — hero, stats, feed, donut — with no grouping and no path
          for the eye. Neither the feed nor the donut needs the full width, so
          they share one row: the feed takes the flexible column, the donut a
          fixed narrower one. Each still stands alone when the other has no data.
        */}
        {/*
          Both cards now ALWAYS render. They used to unmount when they had
          nothing to show, which on a fresh install left an admin with a hero, a
          row of zeroes and roughly 600px of nothing — no message, no action,
          and no way to tell "there is no activity yet" apart from "this page is
          broken". A section that disappears answers neither question.

          The row keeps its two columns unconditionally for the same reason: the
          split used to depend on both cards having data, so the layout moved
          under the admin as records arrived.
        */}
        <div data-testid="dashboard-lower" className={PAGE_RAIL}>
          <section data-testid="activity-feed" className="card overflow-hidden">
            {/* `ui/ActivityList`, not `ui/Table` and not loose markup.
                A table row is the same fields in the same columns every time;
                this row is a mark, one variable-width sentence and a
                timestamp, so there is nothing to align and a `<thead>` would
                name nothing. What it was not allowed to keep was writing its
                own row height — see the primitive's own note. */}
            <ActivityListHeader
              title="Actividad reciente"
              action={
                <Link href="/attendance" className={buttonClasses("secondary", "sm")}>
                  Ver todo
                </Link>
              }
            />
            {activity.length > 0 ? (
              <ActivityList>
                {activity.map((event) => (
                  <ActivityItem
                    key={event.id}
                    initials={event.initials}
                    subject={event.subject}
                    detail={event.detail}
                    at={formatHumanDate(event.at)}
                  />
                ))}
              </ActivityList>
            ) : (
              /* `inset`: the card and its header are already open above. What
                 the empty state has to do here is name the two things that
                 actually produce activity, and offer the nearer one. */
              <EmptyState
                surface="inset"
                icon={<ClipboardList size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title="Todavía no hay movimiento"
                description="Acá aparecen los pagos que suben y las listas que se pasan, apenas ocurra el primero."
                action={
                  <Link href="/trainer/attendance" className={buttonClasses("primary", "sm")}>
                    Pasar lista
                  </Link>
                }
              />
            )}
          </section>

          <section className="card p-[18px]">
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
          </section>
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
