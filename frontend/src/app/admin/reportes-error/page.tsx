"use client";

import { useEffect, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { fetchReportesError, fetchReporteError, type ReporteError } from "@/services/api";

export default function ReportesErrorPage(): React.ReactElement {
  const [reports, setReports] = useState<ReporteError[]>([]);
  const [selected, setSelected] = useState<ReporteError | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetchReportesError().then(setReports).catch(() => setError("No se pudo cargar la bandeja."));
  }, []);
  async function select(id: number): Promise<void> {
    try { setSelected(await fetchReporteError(id)); } catch { setError("No se pudo cargar el reporte."); }
  }
  return <ProtectedRoute allowedRoles={["admin"]}><AppShell title="Reportes de error" subtitle="Avisos enviados por usuarios del club">
    {error && <p role="alert">{error}</p>}
    {reports.length === 0 && !error && <p>No hay reportes.</p>}
    <ul className="flex flex-col gap-3">
      {reports.map((report) => <li key={report.id}>
        <button type="button" onClick={() => { void select(report.id); }} className="w-full rounded-xl border border-cata-border bg-cata-surface p-4 text-left">
          Reporte #{report.id} · {new Date(report.fecha_creacion).toLocaleString("es-EC")}
        </button>
      </li>)}
    </ul>
    {selected && <section aria-label={`Detalle del reporte ${selected.id}`} className="mt-6 rounded-xl border border-cata-border bg-cata-surface p-4">
      <h2 className="font-semibold">Reporte #{selected.id}</h2>
      <p className="mt-3 whitespace-pre-wrap">{selected.descripcion}</p>
      <dl className="mt-3">
        <dt>Request ID</dt><dd>{selected.request_id ?? "No disponible"}</dd>
        <dt>Ruta</dt><dd>{selected.ruta ?? "No disponible"}</dd>
        <dt>Navegador</dt><dd>{selected.user_agent ?? "No disponible"}</dd>
      </dl>
      {selected.captura_mime && <a href={`/api/reportes-error/${selected.id}/captura`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block underline">Ver captura</a>}
    </section>}
  </AppShell></ProtectedRoute>;
}
