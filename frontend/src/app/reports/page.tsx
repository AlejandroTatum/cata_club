/**
 * Reports Page — admin-only analytics and filtered views.
 *
 * Three report types (each backed by a real backend endpoint):
 * 1. Por Etiquetas — filter personas by prioridad_municipal / becado tags
 * 2. Por Período — new members registered within a date range
 * 3. Asistencia — attendance records filtered by date range / horario
 *
 * Follows the dashboard/members page design patterns.
 */

"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Users,
  Calendar,
  Search,
  Filter,
  AlertCircle,
  Building2,
  GraduationCap,
  CheckCircle,
  Download,
  Loader2,
} from "lucide-react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import {
  fetchPersonasPorEtiquetas,
  fetchNuevosPorPeriodo,
  fetchAttendanceRecords,
  fetchTrainingSchedules,
  exportPersonasPorEtiquetasPdf,
  exportNuevosPorPeriodoPdf,
  exportAsistenciaReportePdf,
} from "@/services/api";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_BADGE_TOKENS,
  formatDay,
  type AttendanceRecord,
  type TrainingSchedule,
} from "@/app/attendance/attendance-utils";
import type { PersonaReporte } from "@/types/domain";

type ReportTab = "etiquetas" | "periodo" | "asistencia";

export default function ReportsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <ReportsContent />
    </ProtectedRoute>
  );
}

function ReportsContent(): React.ReactElement {
  const [tab, setTab] = useState<ReportTab>("etiquetas");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Persona report results
  const [personaResults, setPersonaResults] = useState<PersonaReporte[]>([]);

  // Attendance report results
  const [attendanceResults, setAttendanceResults] = useState<AttendanceRecord[]>([]);
  const [horarios, setHorarios] = useState<TrainingSchedule[]>([]);

  // Etiquetas filters
  const [prioridadMunicipal, setPrioridadMunicipal] = useState(false);
  const [becado, setBecado] = useState(false);
  const [useFilters, setUseFilters] = useState(false);

  // Periodo filters
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

  // Attendance filters
  const [attFechaInicio, setAttFechaInicio] = useState("");
  const [attFechaFin, setAttFechaFin] = useState("");
  const [attHorarioId, setAttHorarioId] = useState("");

  // Local persona filters (applied client-side over results)
  const [searchTerm, setSearchTerm] = useState("");
  const [edadMin, setEdadMin] = useState("");
  const [edadMax, setEdadMax] = useState("");

  function switchTab(next: ReportTab): void {
    setTab(next);
    setPersonaResults([]);
    setAttendanceResults([]);
    setError(null);
    setSearched(false);
    setSearchTerm("");
    setEdadMin("");
    setEdadMax("");
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

  // Fetch horarios for the attendance filter dropdown (once, on mount)
  useEffect(() => {
    void fetchTrainingSchedules()
      .then(setHorarios)
      .catch(() => {});
  }, []);

  async function handleEtiquetasSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const filtros: { prioridadMunicipal?: boolean; becado?: boolean } = {};
      if (useFilters) {
        if (prioridadMunicipal) filtros.prioridadMunicipal = true;
        if (becado) filtros.becado = true;
      }
      const data = await fetchPersonasPorEtiquetas(filtros);
      setPersonaResults(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al cargar reportes.";
      setError(message);
      setPersonaResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function handlePeriodoSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!fechaInicio || !fechaFin) {
      setError("Seleccione ambas fechas.");
      return;
    }
    if (fechaInicio > fechaFin) {
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

  /** Export the currently displayed persona report (etiquetas or periodo tab) as a PDF. */
  async function handleExportPersonasPdf(): Promise<void> {
    setExportingPdf(true);
    setError(null);
    try {
      if (tab === "periodo") {
        await exportNuevosPorPeriodoPdf(fechaInicio, fechaFin);
      } else {
        const filtros: { prioridadMunicipal?: boolean; becado?: boolean } = {};
        if (useFilters) {
          if (prioridadMunicipal) filtros.prioridadMunicipal = true;
          if (becado) filtros.becado = true;
        }
        await exportPersonasPorEtiquetasPdf(filtros);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al exportar el reporte en PDF.";
      setError(message);
    } finally {
      setExportingPdf(false);
    }
  }

  /** Export the currently displayed attendance report as a PDF. */
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
      const message = err instanceof Error ? err.message : "Error al exportar el reporte en PDF.";
      setError(message);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <AppShell
      eyebrow="Reportes"
      title="Reportes y Analítica"
    >
      {/* Tab selector */}
      <div className="mb-6 flex gap-1 rounded-xl bg-cata-bg p-1">
        <button
          onClick={() => switchTab("etiquetas")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === "etiquetas"
              ? "bg-white text-cata-text shadow-soft"
              : "text-cata-text/65 hover:text-cata-text"
          }`}
        >
          <Filter size={15} strokeWidth={1.5} />
          Por Etiquetas
        </button>
        <button
          onClick={() => switchTab("periodo")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === "periodo"
              ? "bg-white text-cata-text shadow-soft"
              : "text-cata-text/65 hover:text-cata-text"
          }`}
        >
          <Calendar size={15} strokeWidth={1.5} />
          Por Período
        </button>
        <button
          onClick={() => switchTab("asistencia")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === "asistencia"
              ? "bg-white text-cata-text shadow-soft"
              : "text-cata-text/65 hover:text-cata-text"
          }`}
        >
          <CheckCircle size={15} strokeWidth={1.5} />
          Asistencia
        </button>
      </div>

      {/* ---- Etiquetas tab ---- */}
      {tab === "etiquetas" && (
        <form onSubmit={handleEtiquetasSubmit} className="card mb-6 p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cata-text/45">
            Filtrar por etiquetas
          </h3>
          <div className="flex flex-wrap items-end gap-6">
            <label className="flex items-center gap-2.5 text-sm text-cata-text">
              <input
                type="checkbox"
                checked={useFilters && prioridadMunicipal}
                onChange={(e) => {
                  setUseFilters(true);
                  setPrioridadMunicipal(e.target.checked);
                }}
                className="h-4 w-4 rounded border-cata-border text-cata-red focus:ring-cata-red"
              />
              <Building2 size={15} strokeWidth={1.5} className="text-cata-text/50" />
              Prioridad Municipal
            </label>
            <label className="flex items-center gap-2.5 text-sm text-cata-text">
              <input
                type="checkbox"
                checked={useFilters && becado}
                onChange={(e) => {
                  setUseFilters(true);
                  setBecado(e.target.checked);
                }}
                className="h-4 w-4 rounded border-cata-border text-cata-red focus:ring-cata-red"
              />
              <GraduationCap size={15} strokeWidth={1.5} className="text-cata-text/50" />
              Becado
            </label>
            {!useFilters && (
              <p className="text-xs text-cata-text/45">
                Sin filtros: se listarán todas las personas
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary ml-auto flex items-center gap-2"
            >
              <Search size={15} strokeWidth={1.5} />
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </form>
      )}

      {/* ---- Periodo tab ---- */}
      {tab === "periodo" && (
        <form onSubmit={handlePeriodoSubmit} className="card mb-6 p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cata-text/45">
            Nuevos miembros por período
          </h3>
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
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </form>
      )}

      {/* ---- Asistencia tab ---- */}
      {tab === "asistencia" && (
        <form onSubmit={handleAsistenciaSubmit} className="card mb-6 p-6">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-cata-text/45">
            Reporte de asistencia
          </h3>
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
              {loading ? "Buscando..." : "Buscar"}
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

      {/* ---- Persona results table (etiquetas / periodo) ---- */}
      {searched && !loading && (tab === "etiquetas" || tab === "periodo") && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-cata-border px-6 py-4">
            <h3 className="text-sm font-semibold text-cata-text">
              {filteredPersonaResults.length} persona{filteredPersonaResults.length !== 1 ? "s" : ""} encontrada{filteredPersonaResults.length !== 1 ? "s" : ""}
            </h3>
            {personaResults.length > 0 && (
              <button
                type="button"
                onClick={() => void handleExportPersonasPdf()}
                disabled={exportingPdf}
                className="btn-secondary flex items-center gap-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingPdf ? (
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                ) : (
                  <Download size={14} strokeWidth={1.5} />
                )}
                {exportingPdf ? "Exportando..." : "Exportar PDF"}
              </button>
            )}
          </div>

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
                    placeholder="Nombre, apellido o cédula..."
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
            <div className="px-6 py-12 text-center">
              <Users size={32} className="mx-auto mb-3 text-cata-text/25" strokeWidth={1.5} />
              <p className="text-sm text-cata-text/55">
                {personaResults.length > 0
                  ? "No se encontraron personas con los filtros locales aplicados."
                  : "No se encontraron personas con los filtros seleccionados."}
              </p>
            </div>
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
                    <th className="px-6 py-3 font-medium text-cata-text/65">Prioridad Municipal</th>
                    <th className="px-6 py-3 font-medium text-cata-text/65">Beca</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cata-border">
                  {filteredPersonaResults.map((persona) => (
                    <tr key={persona.id} className="transition-colors hover:bg-cata-bg/30">
                      <td className="px-6 py-3">
                        <span className="font-medium text-cata-text">
                          {persona.nombres} {persona.apellidos}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">
                        {persona.cedula}
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">
                        {persona.fechaNacimiento}
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">
                        {calcAge(persona.fechaNacimiento)} años
                      </td>
                      <td className="px-6 py-3 text-cata-text/65">
                        {persona.telefono}
                      </td>
                      <td className="px-6 py-3">
                        {persona.prioridadMunicipal ? (
                          <span className="inline-flex items-center rounded-full bg-cata-state-ok/10 px-2.5 py-0.5 text-xs font-medium text-cata-state-ok">
                            Sí
                          </span>
                        ) : (
                          <span className="text-xs text-cata-text/40">No</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {persona.porcentajeBeca > 0 ? (
                          <span className="inline-flex items-center rounded-full bg-cata-navy/10 px-2.5 py-0.5 text-xs font-medium text-cata-navy">
                            {persona.porcentajeBeca}%
                          </span>
                        ) : (
                          <span className="text-xs text-cata-text/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---- Attendance results table ---- */}
      {searched && !loading && tab === "asistencia" && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-cata-border px-6 py-4">
            <h3 className="text-sm font-semibold text-cata-text">
              {attendanceResults.length} registro{attendanceResults.length !== 1 ? "s" : ""} encontrado{attendanceResults.length !== 1 ? "s" : ""}
            </h3>
            {attendanceResults.length > 0 && (
              <button
                type="button"
                onClick={() => void handleExportAsistenciaPdf()}
                disabled={exportingPdf}
                className="btn-secondary flex items-center gap-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingPdf ? (
                  <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                ) : (
                  <Download size={14} strokeWidth={1.5} />
                )}
                {exportingPdf ? "Exportando..." : "Exportar PDF"}
              </button>
            )}
          </div>

          {attendanceResults.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CheckCircle size={32} className="mx-auto mb-3 text-cata-text/25" strokeWidth={1.5} />
              <p className="text-sm text-cata-text/55">
                No se encontraron registros de asistencia con los filtros seleccionados.
              </p>
            </div>
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
                  {attendanceResults.map((record) => {
                    const tokens = ATTENDANCE_BADGE_TOKENS[record.estado] ?? {
                      badgeClass: "bg-cata-border/40 text-cata-text/65",
                      iconClass: "text-cata-text/65",
                    };
                    return (
                      <tr key={record.id} className="transition-colors hover:bg-cata-bg/30">
                        <td className="px-6 py-3 text-cata-text/65">{record.fecha}</td>
                        <td className="px-6 py-3 text-cata-text/65">{record.horario}</td>
                        <td className="px-6 py-3">
                          <span className="font-medium text-cata-text">{record.estudiante}</span>
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tokens.badgeClass}`}>
                            {ATTENDANCE_LABELS[record.estado] ?? record.estado}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-cata-text/65">{record.entrenador}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
