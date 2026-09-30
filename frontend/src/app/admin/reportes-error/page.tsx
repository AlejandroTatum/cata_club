"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { EmptyState, ErrorState, InfoPanel, LoadingState, PAGE_RAIL, cn } from "@/components/ui";
import { CLUB_TIME_ZONE } from "@/lib/club-date";
import { fetchReportesError, fetchReporteError, type ReporteError } from "@/services/api";

const DATE_FORMAT = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: CLUB_TIME_ZONE });
const NO_DISPONIBLE = "No disponible";

/** Timestamps without an offset are UTC on the backend; parse them as such. */
function formatFecha(iso: string): string {
  const conOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  return DATE_FORMAT.format(new Date(conOffset));
}

/** "Chrome · Windows" style summary; falls back to null when unrecognised. */
function resumirNavegador(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const navegador = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\/|CriOS\//.test(userAgent) ? "Chrome"
    : /Safari\//.test(userAgent) ? "Safari" : null;
  const sistema = /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad|iOS/.test(userAgent) ? "iOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Mac OS X|Macintosh/.test(userAgent) ? "macOS"
    : /Linux|X11/.test(userAgent) ? "Linux" : null;
  const partes = [navegador, sistema].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(" · ") : null;
}

export default function ReportesErrorPage(): React.ReactElement {
  const [reports, setReports] = useState<ReporteError[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorLista, setErrorLista] = useState(false);
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

  return <ProtectedRoute allowedRoles={["admin"]}><AppShell title="Reportes de error" subtitle="Avisos enviados por usuarios del club">
    {cargando ? <LoadingState label="Cargando reportes…" />
      : errorLista ? <ErrorState message="No se pudo cargar la bandeja." onRetry={() => void load()} />
      : reports.length === 0 ? <EmptyState title="Aún no hay reportes de error" description="Cuando un usuario use «Reportar un problema», su aviso aparecerá aquí." />
      : <div className={PAGE_RAIL}>
        <section aria-label="Reportes recibidos" className="card min-w-0 p-2">
          <ul className="divide-y divide-line">
            {reports.map((report) => <li key={report.id}>
              <button
                type="button"
                onClick={() => { void select(report.id); }}
                aria-current={report.id === selectedId ? "true" : undefined}
                className={cn("flex w-full flex-col gap-1 rounded-ctl px-3 py-3 text-left hover:bg-sunken", report.id === selectedId && "bg-sunken")}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-semibold">Reporte #{report.id}</span>
                  <span className="text-xs text-ink-2">{formatFecha(report.fecha_creacion)}</span>
                </span>
                <span className="text-xs text-ink-2">{report.ruta ?? "Ruta no indicada"}</span>
                <span className="line-clamp-2 text-sm">{report.descripcion}</span>
              </button>
            </li>)}
          </ul>
        </section>
        <aside ref={detalleRef} aria-label="Detalle" className="min-w-0 lg:sticky lg:top-4">
          {selectedId === null ? <InfoPanel as="div" title="Detalle del reporte">
              <p>Seleccione un reporte de la lista para ver su detalle.</p>
              <p>
                Cada aviso trae lo que escribió la persona, la ruta afectada y el dispositivo; si
                adjuntó una captura, se abre desde aquí.
              </p>
              <p>{reports.length === 1 ? "Hay 1 reporte recibido." : `Hay ${reports.length} reportes recibidos.`}</p>
            </InfoPanel>
            : cargandoDetalle ? <LoadingState label="Cargando reporte…" />
            : errorDetalle ? <ErrorState message="No se pudo cargar el reporte." onRetry={() => void select(selectedId)} />
            : detalle && <section aria-label={`Detalle del reporte ${detalle.id}`} className="card p-5">
              <h2 className="font-semibold">Reporte #{detalle.id}</h2>
              <p className="text-xs text-ink-2">{formatFecha(detalle.fecha_creacion)}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm">{detalle.descripcion}</p>
              <dl className="mt-4 flex flex-col gap-3 text-sm">
                <div><dt className="text-xs font-semibold text-ink-2">Ruta afectada</dt><dd>{detalle.ruta ?? NO_DISPONIBLE}</dd></div>
                <div>
                  <dt className="text-xs font-semibold text-ink-2">Dispositivo / navegador</dt>
                  <dd>{navegador ?? detalle.user_agent ?? NO_DISPONIBLE}</dd>
                  {navegador && detalle.user_agent && <dd className="break-all text-xs text-ink-3">{detalle.user_agent}</dd>}
                </div>
              </dl>
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-ink-2">Código de seguimiento</summary>
                <p className="mt-1 break-all font-mono text-xs">{detalle.request_id ?? NO_DISPONIBLE}</p>
              </details>
              {detalle.captura_mime && <a href={`/api/reportes-error/${detalle.id}/captura`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block underline">Ver captura</a>}
            </section>}
        </aside>
      </div>}
  </AppShell></ProtectedRoute>;
}
