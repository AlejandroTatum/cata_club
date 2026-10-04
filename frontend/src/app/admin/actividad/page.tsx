/**
 * Actividad del club — what the club does in the app and how the app is doing.
 *
 * Admin only and read-only. Two views behind one toggle, linkable through
 * `?vista=avanzadas`:
 *
 *   · Resumen (default): plain-language usage figures and a three-line verdict
 *     on the system, for any administrator.
 *   · Métricas avanzadas: aggregated service and server readings, for the
 *     technical follow-up.
 *
 * Each view loads its own endpoint (`fetchActividadResumen` / `fetchActividadAvanzadas`)
 * for the chosen range and fails on its own: a notice with a retry, never an
 * empty chart. Resumen reloads only when the range changes; Métricas avanzadas
 * also refreshes every minute while the tab is visible.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import DashboardSection from "@/components/dashboard/DashboardSection";
import SectionNotice from "@/components/dashboard/SectionNotice";
import { FilterGroup, FilterPanel, FilterPill, LoadingState } from "@/components/ui";
import { fetchActividadAvanzadas, fetchActividadResumen } from "@/services/api";
import AvanzadasView from "./AvanzadasView";
import ResumenView from "./ResumenView";
import { parseView, type ActivityView } from "./activity-utils";
import type { AvanzadasRange, ResumenRange } from "./actividad-types";
import { useActividad } from "./useActividad";

/** How often the advanced view refreshes while the tab is visible. */
const POLL_MS = 60_000;

const VIEWS: { value: ActivityView; label: string }[] = [
  { value: "resumen", label: "Resumen" },
  { value: "avanzadas", label: "Métricas avanzadas" },
];

const RESUMEN_RANGES: { value: ResumenRange; label: string }[] = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
];

const AVANZADAS_RANGES: { value: AvanzadasRange; label: string }[] = [
  { value: "1h", label: "1 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 días" },
];

/** What a failed load tells the reader: a missing permission is not a flaky network. */
function failureMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return status === 403
    ? "No tiene permiso para ver la actividad del club."
    : "No se pudo cargar la actividad del club. Intente nuevamente.";
}

function FailedBlock({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }): React.ReactElement {
  return (
    <DashboardSection title={title}>
      <SectionNotice message={failureMessage(error)} onRetry={onRetry} />
    </DashboardSection>
  );
}

const asInstant = (millis: number): string => new Date(millis).toISOString();

function ResumenPane({ range }: { range: ResumenRange }): React.ReactElement {
  const { state, retry } = useActividad(fetchActividadResumen, range);
  // «Estado del sistema» must not say everything is fine while the advanced
  // metrics are unreadable (ADMB-01): probe them once, never block on it.
  const [metricsUnavailable, setMetricsUnavailable] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.resolve(fetchActividadAvanzadas("1h")).then(
      () => live && setMetricsUnavailable(false),
      () => live && setMetricsUnavailable(true),
    );
    return (): void => {
      live = false;
    };
  }, []);
  if (state.status === "loading") return <LoadingState label="Cargando actividad…" />;
  if (state.status === "error") return <FailedBlock title="Resumen" error={state.error} onRetry={retry} />;
  return <ResumenView data={state.data} now={asInstant(state.loadedAt)} metricsUnavailable={metricsUnavailable} />;
}

function AvanzadasPane({ range }: { range: AvanzadasRange }): React.ReactElement {
  const { state, retry } = useActividad(fetchActividadAvanzadas, range, POLL_MS);
  if (state.status === "loading") return <LoadingState label="Cargando métricas…" />;
  if (state.status === "error") return <FailedBlock title="Métricas avanzadas" error={state.error} onRetry={retry} />;
  return <AvanzadasView data={state.data} now={asInstant(state.loadedAt)} />;
}

function ActividadContent(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const view = parseView(useSearchParams().get("vista"));
  const [resumenRange, setResumenRange] = useState<ResumenRange>("7d");
  const [avanzadasRange, setAvanzadasRange] = useState<AvanzadasRange>("1h");

  const chooseView = (next: ActivityView): void => {
    router.replace(next === "avanzadas" ? `${pathname}?vista=avanzadas` : pathname, { scroll: false });
  };

  return (
    <>
      <FilterPanel
        label="Vista y período"
        layout="row"
        chips={
          <>
            <FilterGroup label="Vista">
              <div className="flex flex-wrap gap-2">
                {VIEWS.map((option) => (
                  <FilterPill
                    key={option.value}
                    label={option.label}
                    active={view === option.value}
                    onClick={() => chooseView(option.value)}
                  />
                ))}
              </div>
            </FilterGroup>
            <FilterGroup label="Período">
              <div className="flex flex-wrap gap-2">
                {view === "resumen"
                  ? RESUMEN_RANGES.map((option) => (
                      <FilterPill
                        key={option.value}
                        label={option.label}
                        active={resumenRange === option.value}
                        onClick={() => setResumenRange(option.value)}
                      />
                    ))
                  : AVANZADAS_RANGES.map((option) => (
                      <FilterPill
                        key={option.value}
                        label={option.label}
                        active={avanzadasRange === option.value}
                        onClick={() => setAvanzadasRange(option.value)}
                      />
                    ))}
              </div>
            </FilterGroup>
          </>
        }
      />

      {view === "resumen" ? (
        <ResumenPane key={resumenRange} range={resumenRange} />
      ) : (
        <AvanzadasPane key={avanzadasRange} range={avanzadasRange} />
      )}
    </>
  );
}

export default function ActividadPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell title="Actividad del club" subtitle="Uso de la aplicación y estado del sistema">
        {/* `useSearchParams` needs a boundary so the static shell can render without it. */}
        <Suspense fallback={<LoadingState label="Cargando actividad…" />}>
          <ActividadContent />
        </Suspense>
      </AppShell>
    </ProtectedRoute>
  );
}
