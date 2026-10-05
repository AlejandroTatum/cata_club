"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { ErrorState, FilterPanel, FilterPill, LoadingState, PAGE_RAIL, cn } from "@/components/ui";
import { fetchReportesError, fetchReporteError, type ReporteError } from "@/services/api";
import { EmptyInbox, GhostRows, HowItWorks, SelectPrompt, SummaryStrip } from "./InboxParts";
import { NO_DISPONIBLE, applyFilter, buildChips, formatFecha, resumirNavegador, summarize, type InboxFilter } from "./inbox";

/** Both columns reach the bottom of the screen (page header and padding above, ~24px margin below), so no dead band is left under a short inbox. */
const FILL_SCREEN = "lg:min-h-[calc(100dvh-10rem)]";

/** Below this many visible rows the list card is continued with skeleton rows. */
const GHOST_BELOW = 5;

/** Skeleton rows drawn to continue a short list; the card clips whatever exceeds its height. */
const GHOST_FILL = 14;

export default function ReportesErrorPage(): React.ReactElement {
  const [reports, setReports] = useState<ReporteError[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState(false);
  const [filtro, setFiltro] = useState<InboxFilter>("todos");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<ReporteError | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState(false);
  const detalleRef = useRef<HTMLElement>(null);
  // Guards against a slow response for a previous selection overwriting the current one.
  const ultimaSeleccion = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setCargando(true); setErrorLista(false);
    try { setReports(await fetchReportesError()); } catch { setErrorLista(true); }
    finally { setCargando(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const select = useCallback(async (id: number): Promise<void> => {
    ultimaSeleccion.current = id;
    setSelectedId(id); setDetalle(null); setErrorDetalle(false); setCargandoDetalle(true);
    detalleRef.current?.scrollIntoView?.({ block: "nearest" });
    try {
      const reporte = await fetchReporteError(id);
      if (ultimaSeleccion.current === id) setDetalle(reporte);
    } catch {
      if (ultimaSeleccion.current === id) setErrorDetalle(true);
    } finally {
      if (ultimaSeleccion.current === id) setCargandoDetalle(false);
    }
  }, []);

  const navegador = detalle ? resumirNavegador(detalle.user_agent) : null;
  // "Now" is fixed per load so the 7-day window does not shift between renders.
  const ahora = useMemo(() => Date.now(), [reports]); // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarize(reports, ahora), [reports, ahora]);
  const chips = useMemo(() => buildChips(reports, ahora), [reports, ahora]);
  const visibles = useMemo(() => applyFilter(reports, filtro, ahora), [reports, filtro, ahora]);
  const vacia = !cargando && !errorLista && reports.length === 0;

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell title="Errores reportados" subtitle="Avisos enviados por usuarios del club">
    {cargando ? <LoadingState label="Cargando reportes…" />
      : errorLista ? <ErrorState message="No se pudo cargar la bandeja." onRetry={() => void load()} />
      : <div className={cn(PAGE_RAIL, FILL_SCREEN)}>
        <div className="relative min-w-0 lg:self-stretch">
          <div className="flex min-w-0 flex-col gap-page lg:absolute lg:inset-0">
            {vacia ? <EmptyInbox /> : <>
              <SummaryStrip summary={summary} />
              <FilterPanel label="Filtrar reportes" chips={<div className="flex flex-wrap gap-2">
                {chips.map((chip) => <FilterPill key={chip.key} label={chip.label} count={chip.count} active={chip.key === filtro} onClick={() => setFiltro(chip.key)} />)}
              </div>} />
              <section aria-label="Reportes recibidos" className="card flex min-h-0 min-w-0 flex-col lg:flex-1">
                <div className="flex max-h-[32rem] min-h-0 flex-col overflow-y-auto lg:max-h-none lg:flex-1">
                  <ul className="flex flex-col divide-y divide-line">
                    {visibles.map((report) => <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => { void select(report.id); }}
                        aria-current={report.id === selectedId ? "true" : undefined}
                        className={cn("flex w-full flex-col gap-1 px-5 py-3 text-left hover:bg-sunken", report.id === selectedId && "bg-sunken")}
                      >
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                          <span className="font-semibold">Reporte #{report.id}</span>
                          <span className="text-xs text-ink-2">{formatFecha(report.fecha_creacion)}</span>
                        </span>
                        <span className="flex flex-wrap justify-between gap-x-3 text-xs text-ink-2">
                          <span>{report.ruta ?? "Ruta no indicada"}</span>
                          <span>{resumirNavegador(report.user_agent) ?? NO_DISPONIBLE}</span>
                        </span>
                        <span className="line-clamp-2 text-sm">{report.descripcion}</span>
                      </button>
                    </li>)}
                  </ul>
                  {visibles.length === 0 && <p className="px-5 py-6 text-sm text-ink-2">Ningún reporte coincide con este filtro.</p>}
                  {/* A short list keeps the card the rail's height: skeleton rows continue it. */}
                  {visibles.length < GHOST_BELOW && <GhostRows count={GHOST_FILL} className="hidden min-h-0 flex-1 border-t border-line lg:flex" />}
                </div>
              </section>
            </>}
          </div>
        </div>
        <aside ref={detalleRef} aria-label="Detalle" className="flex min-w-0 flex-col gap-page lg:self-stretch">
          {selectedId === null ? vacia ? null : <SelectPrompt total={reports.length} />
            : cargandoDetalle ? <LoadingState label="Cargando reporte…" />
            : errorDetalle ? <ErrorState message="No se pudo cargar el reporte." onRetry={() => void select(selectedId)} />
            : detalle && <section aria-label={`Detalle del reporte ${detalle.id}`} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="font-semibold">Reporte #{detalle.id}</h2>
                <p className="text-xs text-ink-2">{formatFecha(detalle.fecha_creacion)}</p>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{detalle.descripcion}</p>
              <dl className="mt-4 flex flex-col divide-y divide-line border-y border-line text-sm">
                <div className="flex items-baseline justify-between gap-4 py-2"><dt className="text-xs font-semibold text-ink-2">Ruta afectada</dt><dd className="min-w-0 break-all text-right">{detalle.ruta ?? NO_DISPONIBLE}</dd></div>
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <dt className="text-xs font-semibold text-ink-2">Dispositivo / navegador</dt>
                  <dd className="min-w-0 text-right">{navegador ?? detalle.user_agent ?? NO_DISPONIBLE}</dd>
                </div>
                {navegador && detalle.user_agent && <div className="py-2"><dd className="break-all text-xs text-ink-3">{detalle.user_agent}</dd></div>}
              </dl>
              <div className="mt-4 flex items-start justify-between gap-4 text-sm">
                <details className="min-w-0">
                  <summary className="cursor-pointer text-xs font-semibold text-ink-2">Código de seguimiento</summary>
                  <p className="mt-1 break-all font-mono text-xs">{detalle.request_id ?? NO_DISPONIBLE}</p>
                </details>
                {detalle.captura_mime
                  ? <a href={`/api/reportes-error/${detalle.id}/captura`} target="_blank" rel="noopener noreferrer" className="shrink-0 underline">Ver captura</a>
                  : <span className="shrink-0 text-xs text-ink-3">Sin captura</span>}
              </div>
            </section>}
          <HowItWorks />
        </aside>
      </div>}
  </AppShell></ProtectedRoute>;
}
