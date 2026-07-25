/**
 * Reports Page — admin-only analytics and filtered views.
 *
 * Two report types (each backed by a real backend endpoint):
 * 1. Por Período — new members registered within a date range
 * 2. Asistencia — attendance records filtered by date range / horario
 *
 * Follows the dashboard/members page design patterns.
 */

"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Users,
  Calendar,
  Search,
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  Wallet,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import BackLink from "@/components/BackLink";
import {
  fetchNuevosPorPeriodo,
  fetchAttendanceRecords,
  fetchTrainingSchedules,
  fetchPagosReporte,
  exportNuevosPorPeriodoPdf,
  exportAsistenciaReportePdf,
  exportPagosReportePdf,
  type PaymentValidationRequest,
  type ValidationStatus,
} from "@/services/api";
import {
  getAttendanceBadgeTone,
  getAttendanceLabel,
  formatDay,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import {
  paginatePersonaResults,
  getPersonaReportTotalPages,
  paginateAsistenciaResults,
  getAsistenciaReportTotalPages,
  paginatePagosResults,
  getPagosReportTotalPages,
  PERSONA_REPORT_PAGE_SIZE,
  ASISTENCIA_REPORT_PAGE_SIZE,
  PAGOS_REPORT_PAGE_SIZE,
} from "@/app/reports/reports-utils";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import { Badge, EmptyState, FilterPill, Pagination } from "@/components/ui";
import {
  PAGOS_ESTADO_OPTIONS,
  VALIDATION_STATUS_LABELS,
  VALIDATION_STATUS_TONES,
} from "@/lib/status-badges";
import type { PersonaReporte } from "@/types/domain";

type ReportTab = "periodo" | "asistencia" | "pagos";

const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "periodo", label: "Por Período" },
  { key: "asistencia", label: "Asistencia" },
  { key: "pagos", label: "Pagos" },
];

// The payment status vocabulary (options, labels, badge tones) used to be
// re-declared here, with a comment admitting it was copied from
// `payments/page.tsx`. It now lives once in `@/lib/status-badges` — a copy
// that announces itself as a copy is still a second source of truth.

export default function ReportsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <ReportsContent />
    </ProtectedRoute>
  );
}

function ReportsContent(): React.ReactElement {
  const [tab, setTab] = useState<ReportTab>("periodo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Persona report results
  const [personaResults, setPersonaResults] = useState<PersonaReporte[]>([]);

  // Attendance report results
  const [attendanceResults, setAttendanceResults] = useState<AttendanceRecord[]>([]);
  const [horarios, setHorarios] = useState<TrainingSchedule[]>([]);

  // Pagos report results
  const [pagosResults, setPagosResults] = useState<PaymentValidationRequest[]>([]);

  // Periodo filters
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

  // Attendance filters
  const [attFechaInicio, setAttFechaInicio] = useState("");
  const [attFechaFin, setAttFechaFin] = useState("");
  const [attHorarioId, setAttHorarioId] = useState("");

  // Pagos filters
  const [pagosFechaInicio, setPagosFechaInicio] = useState("");
  const [pagosFechaFin, setPagosFechaFin] = useState("");
  const [pagosEstado, setPagosEstado] = useState("");

  // Local persona filters (applied client-side over results)
  const [searchTerm, setSearchTerm] = useState("");
  const [edadMin, setEdadMin] = useState("");
  const [edadMax, setEdadMax] = useState("");

  const [personaPage, setPersonaPage] = useState(1);
  const [asistenciaPage, setAsistenciaPage] = useState(1);
  const [pagosPage, setPagosPage] = useState(1);

  function switchTab(next: ReportTab): void {
    setTab(next);
    setPersonaResults([]);
    setAttendanceResults([]);
    setPagosResults([]);
    setError(null);
    setSearched(false);
    setSearchTerm("");
    setEdadMin("");
    setEdadMax("");
    setPersonaPage(1);
    setAsistenciaPage(1);
    setPagosPage(1);
  }

  /** Calculate age in years from a birth date string. */
  function calcAge(fechaNacimiento: string): number {
    const birth = new Date(fechaNacimiento);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  /** Persona results after applying local search + age filters. */
  const filteredPersonaResults = useMemo(() => {
    let results = personaResults;
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      results = results.filter(
        (p) =>
          p.nombres.toLowerCase().includes(term) ||
          p.apellidos.toLowerCase().includes(term) ||
          p.cedula.includes(term),
      );
    }
    if (edadMin !== "") {
      const min = Number(edadMin);
      results = results.filter((p) => calcAge(p.fechaNacimiento) >= min);
    }
    if (edadMax !== "") {
      const max = Number(edadMax);
      results = results.filter((p) => calcAge(p.fechaNacimiento) <= max);
    }
    return results;
  }, [personaResults, searchTerm, edadMin, edadMax]);

  // Reset to page 1 whenever the underlying filtered list changes, so the
  // paginator never gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setPersonaPage(1);
  }, [filteredPersonaResults.length]);

  useEffect(() => {
    setAsistenciaPage(1);
  }, [attendanceResults.length]);

  useEffect(() => {
    setPagosPage(1);
  }, [pagosResults.length]);

  const personaTotalPages = useMemo(
    () => getPersonaReportTotalPages(filteredPersonaResults.length),
    [filteredPersonaResults],
  );
  const paginatedPersonaResults = useMemo(
    () => paginatePersonaResults(filteredPersonaResults, personaPage),
    [filteredPersonaResults, personaPage],
  );

  const asistenciaTotalPages = useMemo(
    () => getAsistenciaReportTotalPages(attendanceResults.length),
    [attendanceResults],
  );
  const paginatedAttendanceResults = useMemo(
    () => paginateAsistenciaResults(attendanceResults, asistenciaPage),
    [attendanceResults, asistenciaPage],
  );

  const pagosTotalPages = useMemo(
    () => getPagosReportTotalPages(pagosResults.length),
    [pagosResults],
  );
  const paginatedPagosResults = useMemo(
    () => paginatePagosResults(pagosResults, pagosPage),
    [pagosResults, pagosPage],
  );

  // Fetch horarios for the attendance filter dropdown (once, on mount)
  useEffect(() => {
    void fetchTrainingSchedules()
      .then(setHorarios)
      .catch(() => {});
  }, []);

  async function handlePeriodoSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!fechaInicio || !fechaFin) {
      setError("Seleccione ambas fechas.");
      return;
    }
    if (fechaInicio >= fechaFin) {
      setError("La fecha de inicio debe ser anterior a la fecha de fin.");
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const data = await fetchNuevosPorPeriodo(fechaInicio, fechaFin);
      setPersonaResults(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al cargar reportes.";
      setError(message);
      setPersonaResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAsistenciaSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (attFechaInicio && attFechaFin && attFechaInicio > attFechaFin) {
      setError("La fecha de inicio debe ser anterior a la fecha de fin.");
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const params: { fechaInicio?: string; fechaFin?: string; horarioId?: number } = {};
      if (attFechaInicio) params.fechaInicio = attFechaInicio;
      if (attFechaFin) params.fechaFin = attFechaFin;
      if (attHorarioId) params.horarioId = Number(attHorarioId);
      const data = await fetchAttendanceRecords(params);
      setAttendanceResults(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al cargar reportes de asistencia.";
      setError(message);
      setAttendanceResults([]);
    } finally {
      setLoading(false);
    }
  }

  /** Export the currently-displayed persona report (periodo tab) as a PDF. */
  async function handleExportPersonasPdf(): Promise<void> {
    setExportingPdf(true);
    setError(null);
    try {
      await exportNuevosPorPeriodoPdf(fechaInicio, fechaFin);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "No se pudo generar el PDF del reporte.";
      setError(message);
    } finally {
      setExportingPdf(false);
    }
  }

  /** Export the currently-displayed attendance report as a PDF. */
  async function handleExportAsistenciaPdf(): Promise<void> {
    setExportingPdf(true);
    setError(null);
    try {
      const params: { fechaInicio?: string; fechaFin?: string; horarioId?: number } = {};
      if (attFechaInicio) params.fechaInicio = attFechaInicio;
      if (attFechaFin) params.fechaFin = attFechaFin;
      if (attHorarioId) params.horarioId = Number(attHorarioId);
      await exportAsistenciaReportePdf(params);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "No se pudo generar el PDF del reporte.";
      setError(message);
    } finally {
      setExportingPdf(false);
    }
  }

  async function handlePagosSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (pagosFechaInicio && pagosFechaFin && pagosFechaInicio > pagosFechaFin) {
      setError("La fecha de inicio debe ser anterior a la fecha de fin.");
      return;
    }

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const params: { fechaInicio?: string; fechaFin?: string; estadoPago?: string } = {};
      if (pagosFechaInicio) params.fechaInicio = pagosFechaInicio;
      if (pagosFechaFin) params.fechaFin = pagosFechaFin;
      if (pagosEstado) params.estadoPago = pagosEstado;
      const data = await fetchPagosReporte(params);
      setPagosResults(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al cargar reporte de pagos.";
      setError(message);
      setPagosResults([]);
    } finally {
      setLoading(false);
    }
  }

  /** Export the currently-displayed payments report as a PDF. */
  async function handleExportPagosPdf(): Promise<void> {
    setExportingPdf(true);
    setError(null);
    try {
      const params: { fechaInicio?: string; fechaFin?: string; estadoPago?: string } = {};
      if (pagosFechaInicio) params.fechaInicio = pagosFechaInicio;
      if (pagosFechaFin) params.fechaFin = pagosFechaFin;
      if (pagosEstado) params.estadoPago = pagosEstado;
      await exportPagosReportePdf(params);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "No se pudo generar el PDF del reporte.";
      setError(message);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <AppShell
      eyebrow="Documentos del club"
      title="Reportes"
    >
      <BackLink href="/dashboard" label="Volver al Panel" />

      {/* Report selector.
          Was a bespoke segmented bar whose selected state (white chip on a
          grey trough) was a fifth way of saying "this one is chosen". Same
          three options, same behaviour, now in the one selected-state idiom
          the rest of the app uses. The redesign into preset cards
          (`docs/ux/prototipos/18-reportes.html`) is a later phase. */}
      <div className="mb-6 flex flex-wrap gap-2">
        {REPORT_TABS.map((t) => (
          <FilterPill
            key={t.key}
            label={t.label}
            active={tab === t.key}
            onClick={() => switchTab(t.key)}
          />
        ))}
      </div>

      {/* ---- Periodo tab ---- */}
      {tab === "periodo" && (
        <form onSubmit={handlePeriodoSubmit} className="card mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cata-text/45">
            Nuevos miembros por período
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="fechaInicio" className="mb-1.5 block text-sm font-medium text-cata-text">
                Fecha inicio
              </label>
              <input
                type="date"
                id="fechaInicio"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                required
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="fechaFin" className="mb-1.5 block text-sm font-medium text-cata-text">
                Fecha fin
              </label>
              <input
                type="date"
                id="fechaFin"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                required
                className="input-field"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              <Search size={15} strokeWidth={1.5} />
              {loading ? "Buscando…" : "Buscar"}
            </button>
          </div>
        </form>
      )}

      {/* ---- Asistencia tab ---- */}
      {tab === "asistencia" && (
        <form onSubmit={handleAsistenciaSubmit} className="card mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cata-text/45">
            Reporte de asistencia
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="attFechaInicio" className="mb-1.5 block text-sm font-medium text-cata-text">
                Fecha inicio
              </label>
              <input
                type="date"
                id="attFechaInicio"
                value={attFechaInicio}
                onChange={(e) => setAttFechaInicio(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="attFechaFin" className="mb-1.5 block text-sm font-medium text-cata-text">
                Fecha fin
              </label>
              <input
                type="date"
                id="attFechaFin"
                value={attFechaFin}
                onChange={(e) => setAttFechaFin(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="attHorarioId" className="mb-1.5 block text-sm font-medium text-cata-text">
                Horario
              </label>
              <select
                id="attHorarioId"
                value={attHorarioId}
                onChange={(e) => setAttHorarioId(e.target.value)}
                className="input-field"
              >
                <option value="">Todos</option>
                {horarios.map((h) => (
                  <option key={h.id} value={h.id}>
                    {formatDay(h.diaSemana)} {h.horaInicio}–{h.horaFin}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              <Search size={15} strokeWidth={1.5} />
              {loading ? "Buscando…" : "Buscar"}
            </button>
          </div>
          <p className="mt-3 text-xs text-cata-text/45">
            Puede dejar los campos vacíos para ver todos los registros
          </p>
        </form>
      )}

      {/* ---- Pagos tab ---- */}
      {tab === "pagos" && (
        <form onSubmit={handlePagosSubmit} className="card mb-6 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cata-text/45">
            Reporte de pagos
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="pagosFechaInicio" className="mb-1.5 block text-sm font-medium text-cata-text">
                Fecha inicio
              </label>
              <input
                type="date"
                id="pagosFechaInicio"
                value={pagosFechaInicio}
                onChange={(e) => setPagosFechaInicio(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="pagosFechaFin" className="mb-1.5 block text-sm font-medium text-cata-text">
                Fecha fin
              </label>
              <input
                type="date"
                id="pagosFechaFin"
                value={pagosFechaFin}
                onChange={(e) => setPagosFechaFin(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label htmlFor="pagosEstado" className="mb-1.5 block text-sm font-medium text-cata-text">
                Estado
              </label>
              <select
                id="pagosEstado"
                value={pagosEstado}
                onChange={(e) => setPagosEstado(e.target.value)}
                className="input-field"
              >
                {PAGOS_ESTADO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex items-center gap-2"
            >
              <Search size={15} strokeWidth={1.5} />
              {loading ? "Buscando…" : "Buscar"}
            </button>
          </div>
          <p className="mt-3 text-xs text-cata-text/45">
            Puede dejar los campos vacíos para ver todos los registros
          </p>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="alert-error mb-6" role="alert">
          <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* ---- Persona results table (periodo) ---- */}
      {searched && !loading && tab === "periodo" && (
        <PersonaReportTable
          personaResults={personaResults}
          filteredPersonaResults={filteredPersonaResults}
          paginatedPersonaResults={paginatedPersonaResults}
          page={personaPage}
          totalPages={personaTotalPages}
          onPageChange={setPersonaPage}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          edadMin={edadMin}
          setEdadMin={setEdadMin}
          edadMax={edadMax}
          setEdadMax={setEdadMax}
          exportingPdf={exportingPdf}
          onExportPdf={() => void handleExportPersonasPdf()}
          calcAge={calcAge}
        />
      )}

      {/* ---- Attendance results table ---- */}
      {searched && !loading && tab === "asistencia" && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-cata-border px-6 py-4">
            <h2 className="text-sm font-semibold text-cata-text">
              {attendanceResults.length} registro{attendanceResults.length !== 1 ? "s" : ""} encontrado{attendanceResults.length !== 1 ? "s" : ""}
            </h2>
            {attendanceResults.length > 0 && (
              <button
                type="button"
                onClick={() => void handleExportAsistenciaPdf()}
                disabled={exportingPdf}
                className="btn-secondary flex items-center gap-2 text-xs"
              >
                {exportingPdf ? (
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                ) : (
                  <Download size={14} strokeWidth={1.5} />
                )}
                {exportingPdf ? "Generando…" : "Exportar PDF"}
              </button>
            )}
          </div>

          {attendanceResults.length > 0 && asistenciaTotalPages > 1 && (
            <p className="border-b border-cata-border bg-cata-bg/30 px-6 py-2 text-xs text-cata-text/55">
              El PDF incluye los {attendanceResults.length} registros encontrados, no solo esta página.
            </p>
          )}

          {attendanceResults.length === 0 ? (
            <EmptyState
              icon={<CheckCircle size={21} strokeWidth={1.5} aria-hidden="true" />}
              title="No se encontraron registros de asistencia"
              description="Ningún registro coincide con los filtros seleccionados. Amplíe el rango de fechas o quite el filtro de horario."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-cata-border bg-cata-bg/50">
                    <th className="px-6 py-3 font-medium text-cata-text/65">Fecha</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Horario</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Estudiante</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Estado</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Entrenador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cata-border">
                  {paginatedAttendanceResults.map((record) => (
                    <tr key={record.id} className="transition-colors hover:bg-cata-bg/30">
                      <td className="px-6 py-3 tabular-nums text-cata-text/65">{formatDate(record.fecha)}</td>
                      <td className="px-6 py-3 text-cata-text/65">{record.horario}</td>
                      <td className="px-6 py-3">
                        <span className="font-medium text-cata-text">{record.estudiante}</span>
                      </td>
                      <td className="px-6 py-3">
                        <Badge tone={getAttendanceBadgeTone(record.estado)}>
                          {getAttendanceLabel(record.estado)}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">{record.entrenador}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {attendanceResults.length > 0 && asistenciaTotalPages > 1 && (
            <Pagination
              className="mt-0 border-t border-cata-border px-6 py-4"
              page={asistenciaPage}
              totalPages={asistenciaTotalPages}
              onPageChange={setAsistenciaPage}
              totalItems={attendanceResults.length}
              pageSize={ASISTENCIA_REPORT_PAGE_SIZE}
              itemNoun="registro"
            />
          )}
        </div>
      )}

      {/* ---- Pagos results table ---- */}
      {searched && !loading && tab === "pagos" && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-cata-border px-6 py-4">
            <h2 className="text-sm font-semibold text-cata-text">
              {pagosResults.length} pago{pagosResults.length !== 1 ? "s" : ""} encontrado{pagosResults.length !== 1 ? "s" : ""}
            </h2>
            {pagosResults.length > 0 && (
              <button
                type="button"
                onClick={() => void handleExportPagosPdf()}
                disabled={exportingPdf}
                className="btn-secondary flex items-center gap-2 text-xs"
              >
                {exportingPdf ? (
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                ) : (
                  <Download size={14} strokeWidth={1.5} />
                )}
                {exportingPdf ? "Generando…" : "Exportar PDF"}
              </button>
            )}
          </div>

          {pagosResults.length > 0 && pagosTotalPages > 1 && (
            <p className="border-b border-cata-border bg-cata-bg/30 px-6 py-2 text-xs text-cata-text/55">
              El PDF incluye los {pagosResults.length} registros encontrados, no solo esta página.
            </p>
          )}

          {pagosResults.length === 0 ? (
            <EmptyState
              icon={<Wallet size={21} strokeWidth={1.5} aria-hidden="true" />}
              title="No se encontraron pagos"
              description="Ningún pago coincide con los filtros seleccionados. Amplíe el rango de fechas o elija otro estado."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-cata-border bg-cata-bg/50">
                    <th className="px-6 py-3 font-medium text-cata-text/65">Estudiante</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Responsable de Pago</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Período</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Monto</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Método</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Subido</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cata-border">
                  {paginatedPagosResults.map((pago) => (
                    <tr key={pago.id} className="transition-colors hover:bg-cata-bg/30">
                      <td className="px-6 py-3">
                        <span className="font-medium text-cata-text">{pago.studentName}</span>
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">
                        {pago.responsablePagoName ?? "-"}
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">{pago.membershipPeriod}</td>
                      <td className="px-6 py-3 tabular-nums text-cata-text/65">{formatCurrency(pago.expectedAmount)}</td>
                      <td className="px-6 py-3 text-cata-text/65">{pago.paymentMethod}</td>
                      <td className="px-6 py-3 tabular-nums text-cata-text/65">{formatDateTime(pago.uploadedAt)}</td>
                      <td className="px-6 py-3">
                        <Badge tone={VALIDATION_STATUS_TONES[pago.validationStatus]}>
                          {VALIDATION_STATUS_LABELS[pago.validationStatus]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pagosResults.length > 0 && pagosTotalPages > 1 && (
            <Pagination
              className="mt-0 border-t border-cata-border px-6 py-4"
              page={pagosPage}
              totalPages={pagosTotalPages}
              onPageChange={setPagosPage}
              totalItems={pagosResults.length}
              pageSize={PAGOS_REPORT_PAGE_SIZE}
              itemNoun="pago"
            />
          )}
        </div>
      )}
    </AppShell>
  );
}

/**
 * "Por Período" results panel: header + export button, local filters
 * (search/age range), and the results table itself.
 *
 * Extracted from `ReportsContent` to keep that component's cognitive
 * complexity within the project's threshold — this panel bundles several
 * independent conditionals (export button, filters, empty state, row map)
 * that don't need to live inline in the parent.
 */
function PersonaReportTable({
  personaResults,
  filteredPersonaResults,
  paginatedPersonaResults,
  page,
  totalPages,
  onPageChange,
  searchTerm,
  setSearchTerm,
  edadMin,
  setEdadMin,
  edadMax,
  setEdadMax,
  exportingPdf,
  onExportPdf,
  calcAge,
}: {
  personaResults: PersonaReporte[];
  filteredPersonaResults: PersonaReporte[];
  paginatedPersonaResults: PersonaReporte[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  edadMin: string;
  setEdadMin: (value: string) => void;
  edadMax: string;
  setEdadMax: (value: string) => void;
  exportingPdf: boolean;
  onExportPdf: () => void;
  calcAge: (fechaNacimiento: string) => number;
}): React.ReactElement {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-cata-border px-6 py-4">
        <h2 className="text-sm font-semibold text-cata-text">
          {filteredPersonaResults.length} persona{filteredPersonaResults.length !== 1 ? "s" : ""} encontrada{filteredPersonaResults.length !== 1 ? "s" : ""}
        </h2>
        {personaResults.length > 0 && (
          <button
            type="button"
            onClick={onExportPdf}
            disabled={exportingPdf}
            className="btn-secondary flex items-center gap-2 text-xs"
          >
            {exportingPdf ? (
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <Download size={14} strokeWidth={1.5} />
            )}
            {exportingPdf ? "Generando…" : "Exportar PDF"}
          </button>
        )}
      </div>

      {personaResults.length > 0 && (totalPages > 1 || searchTerm || edadMin || edadMax) && (
        <p className="border-b border-cata-border bg-cata-bg/30 px-6 py-2 text-xs text-cata-text/55">
          El PDF incluye los {personaResults.length} resultados del rango de fechas seleccionado — no se limita a esta página ni aplica la búsqueda o el filtro de edad.
        </p>
      )}

      {/* Local filters */}
      {personaResults.length > 0 && (
        <div className="flex flex-wrap items-end gap-4 border-b border-cata-border bg-cata-bg/30 px-6 py-3">
          <div>
            <label htmlFor="localSearch" className="mb-1 block text-xs font-medium text-cata-text/65">
              Buscar
            </label>
            <div className="relative">
              <Search size={14} strokeWidth={1.5} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cata-text/40" />
              <input
                id="localSearch"
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nombre, apellido o cédula…"
                className="input-field py-1.5 pl-8 text-xs"
              />
            </div>
          </div>
          <div>
            <label htmlFor="edadMin" className="mb-1 block text-xs font-medium text-cata-text/65">
              Edad mín
            </label>
            <input
              id="edadMin"
              type="number"
              min={0}
              max={120}
              value={edadMin}
              onChange={(e) => setEdadMin(e.target.value)}
              placeholder="0"
              className="input-field py-1.5 text-xs"
            />
          </div>
          <div>
            <label htmlFor="edadMax" className="mb-1 block text-xs font-medium text-cata-text/65">
              Edad máx
            </label>
            <input
              id="edadMax"
              type="number"
              min={0}
              max={120}
              value={edadMax}
              onChange={(e) => setEdadMax(e.target.value)}
              placeholder="120"
              className="input-field py-1.5 text-xs"
            />
          </div>
          {(searchTerm || edadMin || edadMax) && (
            <button
              type="button"
              onClick={() => { setSearchTerm(""); setEdadMin(""); setEdadMax(""); }}
              className="text-xs text-cata-red hover:underline"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {filteredPersonaResults.length === 0 ? (
        <EmptyState
          icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
          title="No se encontraron personas"
          description={
            personaResults.length > 0
              ? "Hay resultados en este rango de fechas, pero ninguno pasa los filtros locales de búsqueda y edad."
              : "Ninguna persona coincide con los filtros seleccionados. Pruebe con un rango de fechas más amplio."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-cata-border bg-cata-bg/50">
                <th className="px-6 py-3 font-medium text-cata-text/65">Nombre</th>
                <th className="px-6 py-3 font-medium text-cata-text/65">Cédula</th>
                <th className="px-6 py-3 font-medium text-cata-text/65">Fecha Nac.</th>
                <th className="px-6 py-3 font-medium text-cata-text/65">Edad</th>
                <th className="px-6 py-3 font-medium text-cata-text/65">Teléfono</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cata-border">
              {paginatedPersonaResults.map((persona) => (
                <tr key={persona.id} className="transition-colors hover:bg-cata-bg/30">
                  <td className="px-6 py-3">
                    <span className="font-medium text-cata-text">
                      {persona.nombres} {persona.apellidos}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-cata-text/65">
                    {persona.cedula}
                  </td>
                  <td className="px-6 py-3 tabular-nums text-cata-text/65">
                    {formatDate(persona.fechaNacimiento)}
                  </td>
                  <td className="px-6 py-3 text-cata-text/65">
                    {calcAge(persona.fechaNacimiento)} años
                  </td>
                  <td className="px-6 py-3 text-cata-text/65">
                    {persona.telefono}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filteredPersonaResults.length > 0 && totalPages > 1 && (
        <Pagination
          className="mt-0 border-t border-cata-border px-6 py-4"
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          totalItems={filteredPersonaResults.length}
          pageSize={PERSONA_REPORT_PAGE_SIZE}
          itemNoun="persona"
        />
      )}
    </div>
  );
}
