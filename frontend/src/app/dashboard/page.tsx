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
import { ArrowRight } from "lucide-react";
import { buttonClasses, ErrorState, LoadingState, StatCard } from "@/components/ui";
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
  const personasSinMembresia = stats?.personasSinMembresia ?? 0;
  const membershipPercent =
    totalPersonas > 0 ? Math.round((activeMemberships / totalPersonas) * 100) : 0;

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
      <AppShell eyebrow="Panel administrativo" title="Panel de Control">
        {error && (
          <ErrorState
            className="mb-6"
            title="No se pudieron cargar las estadísticas"
            message={error}
            onRetry={() => void loadStats()}
          />
        )}

        {loading && !stats ? (
          <LoadingState className="mb-8" label="Cargando estadísticas…" />
        ) : (
          <>
            {/* Hero — one number, one action. Nothing else belongs here. */}
            <section className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-card bg-coal px-6 py-6">
              <span className="text-[56px] font-extrabold leading-none tracking-[-0.05em] tabular-nums text-white">
                {pendingPayments}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-white">
                  {pendingPayments === 1
                    ? "Pago espera tu validación"
                    : "Pagos esperan tu validación"}
                </span>
                {heroNote && (
                  <span
                    data-testid="hero-note"
                    className="mt-1 flex items-center gap-2 text-[13px] text-white/60"
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
                    {heroNote}
                  </span>
                )}
              </span>
              <Link href="/payments" className={buttonClasses("primary")}>
                {pendingPayments > 0 ? "Revisar ahora" : "Ver pagos"}
                <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
              </Link>
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
            <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Miembros" value={totalPersonas} hint="personas registradas" />
              {/*
                  "de N personas", not a bare "de N": this counts membresía
                  rows in estado ACTIVA against EVERY registered persona —
                  administradores and entrenadores included, none of whom ever
                  holds a membership. `/members` counts a different population
                  (students inside the account tree), and the two tiles were
                  both labelled "Membresías activas" while answering different
                  questions. Each now names its own denominator.
              */}
              <StatCard
                label="Membresías activas"
                value={activeMemberships}
                unit={`de ${totalPersonas}`}
                hint={`${membershipPercent}% de las personas registradas`}
              />
              <StatCard
                label="Sin membresía"
                value={personasSinMembresia}
                hint={`personas por regularizar de ${totalPersonas}`}
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
        <div
          data-testid="dashboard-lower"
          className={`grid items-start gap-4 ${
            // Only split the row when there are in fact two cards to split it
            // between: a lone card holds the full width rather than sitting
            // beside an empty 340px track.
            activity.length > 0 && attendanceStats.totalStudents > 0
              ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]"
              : ""
          }`}
        >
          {activity.length > 0 && (
            <section
              data-testid="activity-feed"
              className="overflow-hidden rounded-card border border-line bg-paper"
            >
              <div className="flex items-center gap-3 border-b border-line px-[18px] py-4">
                <h2 className="flex-1 text-[15px] font-bold text-ink">Actividad reciente</h2>
                <Link href="/attendance" className={buttonClasses("secondary", "sm")}>
                  Ver todo
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {activity.map((event) => (
                  <li key={event.id} className="flex items-center gap-3 px-[18px] py-3">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-canvas text-[11.5px] font-bold text-ink-2"
                    >
                      {event.initials}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] text-ink-2">
                      <b className="font-semibold text-ink">{event.subject}</b> {event.detail}
                    </span>
                    <span className="flex-none text-[11.5px] text-ink-3">
                      {formatHumanDate(event.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {attendanceStats.totalStudents > 0 && (
            <section className="rounded-card border border-line bg-paper p-[18px]">
              <h2 className="mb-4 text-[15px] font-bold text-ink">Distribución de asistencias</h2>
              <AttendanceStatusChart stats={attendanceStats} />
            </section>
          )}
        </div>
      </AppShell>
    </ProtectedRoute>
  );
}
