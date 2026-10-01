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
 * DEMO DATA. Both views read `demo-data.ts` through `getResumenDemo` /
 * `getAvanzadasDemo`; a visible badge says so. Replacing those two functions
 * with fetchers is the whole backend swap — the components take the typed
 * response and nothing else.
 */

"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { Badge, FilterGroup, FilterPanel, FilterPill, LoadingState } from "@/components/ui";
import AvanzadasView from "./AvanzadasView";
import ResumenView from "./ResumenView";
import { parseView, type ActivityView } from "./activity-utils";
import {
  getAvanzadasDemo,
  getResumenDemo,
  type AvanzadasRange,
  type ResumenRange,
} from "./demo-data";

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
        label="Vista y periodo"
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
            <FilterGroup label="Periodo">
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
            <FilterGroup label="Origen de las cifras">
              <div className="flex h-ctl items-center">
                <Badge>Datos de demostración</Badge>
              </div>
            </FilterGroup>
          </>
        }
      />

      {view === "resumen" ? (
        <ResumenView data={getResumenDemo(resumenRange)} />
      ) : (
        <AvanzadasView data={getAvanzadasDemo(avanzadasRange)} />
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
