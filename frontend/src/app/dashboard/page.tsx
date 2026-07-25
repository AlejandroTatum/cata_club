/**
 * Panel de Control — Admin overview (Fase 7, final phase).
 *
 * Connected to the real backend: `GET /api/dashboard` composes counts from
 * `/personas`, `/membresias/pagos*` and `/asistencias/horarios` — the same
 * FastAPI resources Fases 2-4 already proxy — since there is no backend
 * aggregation endpoint (see src/app/api/dashboard/route.ts).
 *
 * The former "Actividad Reciente" section (mock data: "Sofía Martínez —
 * pago validado", etc.) has been removed rather than left with fabricated
 * content — there is no audit-log/activity-feed endpoint in the backend to
 * back it with real data, and no per-persona timestamped event history
 * exists to derive one from. If that need resurfaces, it requires a new
 * backend endpoint, not a frontend workaround.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Users,
  ShieldCheck,
  Calendar,
  ArrowRight,
  Clock,
  Activity,
  UserPlus,
  PieChart,
} from "lucide-react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ErrorState, LoadingState } from "@/components/ui";
import { fetchDashboardStats, fetchAttendanceRecords, type DashboardStats } from "@/services/api";
import { buildAttendanceStats, type AttendanceDayStats } from "@/app/attendance/attendance-utils";
import AttendanceStatusChart from "./AttendanceStatusChart";

const quickActions = [
  {
    icon: ShieldCheck,
    label: "Validar Pagos",
    href: "/payments",
    description: "Revisar y aprobar o rechazar comprobantes de pago de membresías",
  },
  {
    icon: Users,
    label: "Gestionar Miembros",
    href: "/members",
    description: "Estudiantes, representantes y perfiles de membresía",
  },
  {
    icon: UserPlus,
    label: "Niveles",
    href: "/ranking",
    description: "Niveles de entrenamiento y asignación de estudiantes",
  },
  {
    icon: Calendar,
    label: "Asistencias",
    href: "/attendance",
    description: "Horarios de entrenamiento y registros de asistencia",
  },
];

interface StatCardData {
  icon: LucideIcon;
  label: string;
  value: number;
  trend: "up" | "alert";
}

function buildStatCards(stats: DashboardStats): StatCardData[] {
  return [
    {
      icon: Users,
      label: "Miembros Registrados",
      value: stats.totalPersonas,
      trend: "up",
    },
    {
      icon: Clock,
      label: "Pagos Pendientes de Validar",
      value: stats.pendingPayments,
      trend: stats.pendingPayments > 0 ? "alert" : "up",
    },
    {
      icon: Calendar,
      label: "Horarios de Hoy",
      value: stats.todaySchedules,
      trend: "up",
    },
  ];
}

export default function DashboardPage(): React.ReactElement {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attendanceStats, setAttendanceStats] = useState<AttendanceDayStats | null>(null);

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

  // Best-effort: unrelated to the main stat cards' error/retry above — if
  // this fails, the "Distribución de Asistencias" section just doesn't render.
  const loadAttendance = useCallback(async (): Promise<void> => {
    try {
      setAttendanceStats(buildAttendanceStats(await fetchAttendanceRecords()));
    } catch {
      setAttendanceStats(null);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadAttendance();
  }, [loadStats, loadAttendance]);

  const statCards = stats ? buildStatCards(stats) : [];

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        eyebrow="Panel Administrativo"
        title="Panel de Control"
      >
        {error && (
          <ErrorState
            className="mb-6"
            title="No se pudieron cargar las estadísticas"
            message={error}
            onRetry={() => void loadStats()}
          />
        )}

        {/* Stats grid */}
        {loading && !stats ? (
          <LoadingState className="mb-12" label="Cargando estadísticas…" />
        ) : (
          <div className="mb-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {statCards.map((stat) => {
              const isAlert = stat.trend === "alert";
              return (
                <div
                  key={stat.label}
                  className={
                    isAlert
                      ? "card flex items-center gap-3 border-2 border-cata-red/40 bg-cata-yellow/10 p-4 shadow-elevated sm:p-5"
                      : "card flex items-center gap-3 p-4 sm:p-5"
                  }
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isAlert ? "bg-cata-yellow/25" : "bg-cata-red/15"
                    }`}
                  >
                    <stat.icon
                      size={20}
                      strokeWidth={isAlert ? 2 : 1.5}
                      className="text-cata-red"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
                    {stat.label}
                  </p>
                  <p className="flex shrink-0 items-center gap-1.5 text-2xl font-bold tracking-tight text-cata-text">
                    {stat.value}
                    {isAlert && (
                      <>
                        {/* The dot is a pure shape; the label is its sibling,
                            not its child. Nesting the `sr-only` text inside
                            an `aria-hidden` element hid it from assistive
                            tech too, so the alert reached nobody who could
                            not see the red dot. */}
                        <span className="h-2 w-2 rounded-full bg-cata-red" aria-hidden="true" />
                        <span className="sr-only">Atención</span>
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Quick Actions — full width now that Actividad Reciente (mock-only) has been removed */}
        <div className="mb-6 flex items-center gap-2">
          <Activity size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
          <h2 className="text-lg font-bold text-cata-text">Acciones Rápidas</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => (
            <Link key={action.href} href={action.href} className="h-full">
              <div className="card-hover group flex h-full items-start gap-4 p-4 sm:p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cata-red/15">
                  <action.icon
                    size={20}
                    strokeWidth={1.5}
                    className="text-cata-red"
                    aria-hidden="true"
                  />
                </div>
                <div className="flex-1">
                  <p className="font-bold text-cata-text">{action.label}</p>
                  <p className="mt-0.5 text-sm text-cata-text/65">
                    {action.description}
                  </p>
                </div>
                <ArrowRight
                  size={18}
                  strokeWidth={1.5}
                  className="mt-1 shrink-0 text-cata-text/30 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>
            </Link>
          ))}
        </div>

        {attendanceStats && attendanceStats.totalStudents > 0 && (
          <div className="mt-8">
            <div className="mb-6 flex items-center gap-2">
              <PieChart size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              <h2 className="text-lg font-bold text-cata-text">Distribución de Asistencias</h2>
            </div>
            <div className="card p-5 sm:p-6">
              <AttendanceStatusChart stats={attendanceStats} />
            </div>
          </div>
        )}
      </AppShell>
    </ProtectedRoute>
  );
}
