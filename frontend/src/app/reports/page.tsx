/**
 * Reportes — pick a report, set a range, see it, download it.
 *
 * The audit counted SEVEN controls between arriving here and seeing a single
 * result: three tab pills, then a per-tab form with its own date pair, its own
 * extra filter and its own "Buscar" button — and until you pressed Buscar the
 * whole canvas below was empty. Three date pairs also meant the range you had
 * just typed was thrown away the moment you switched report.
 *
 * `docs/ux/prototipos/18-reportes.html` collapses that: three preset cards at
 * even height (selection = coal + the yellow ball dot, never red), ONE
 * dd/mm/yyyy range shared by every preset, a "Generar PDF" button, and a
 * preview area that fills the canvas. The preview loads from picking the
 * report — "la vista previa se genera al elegir el reporte, antes de
 * descargar" — so there is no "Buscar" button left to press.
 *
 * Deviation from the prototype, on purpose: its first preset is "Etiquetas de
 * estudiantes". No such report exists — the backend exposes exactly three PDF
 * endpoints (`/personas/reportes/nuevos-por-periodo/pdf`,
 * `/asistencias/reportes/pdf`, `/payments/reportes/pdf`) and there is no
 * label/etiqueta generator anywhere in `backend/`. Inventing a fourth preset
 * that 404s would be worse than shipping the three that are real, so the
 * presets are Período, Asistencia and Pagos.
 *
 * Also removed: the período preview's local "Buscar / Edad mín / Edad máx"
 * filter strip. It filtered the table but NOT the PDF, which is why the screen
 * had to carry a paragraph explaining that the download would ignore what you
 * had just typed. Three controls whose only documented behaviour was "these do
 * not affect the thing you came here to produce" are three controls too many.
 *
 * ## PDF and CSV
 *
 * PDF is real and server-rendered: all three presets map to an endpoint that
 * exists (see the deviation note above), so the button downloads a document
 * the backend produced.
 *
 * CSV has NO backend. Grepping `backend/` for "csv" finds `.env.example` and
 * `configuracion.py` and nothing else — there is no route to call. The control
 * therefore builds the file in the browser, which is honest here and only
 * here: the page already holds the COMPLETE result set for the range (the
 * table's pagination is a client-side slice), so the CSV carries exactly the
 * rows the preview counts and the PDF renders. Faking a request, or shipping a
 * button that silently did nothing, were the two alternatives; a real file
 * built from data already in hand beats both. Server-side CSV is tracked as
 * backend work in issue #150, which is what removes the three limits this
 * approach really does have: column definitions that can drift from the PDF's,
 * no streaming, and an export the backend never sees.
 *
 * The `<h2>` level of the section headings was normalised in an earlier phase
 * and is preserved: `AppShell` owns the page `<h1>`.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Download,
  FileText,
  Loader2,
  Table2,
  Users,
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
  csvFilename,
  downloadCsv,
  toCsv,
  PERSONA_REPORT_PAGE_SIZE,
  ASISTENCIA_REPORT_PAGE_SIZE,
  PAGOS_REPORT_PAGE_SIZE,
} from "@/app/reports/reports-utils";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import { Badge, Button, EmptyState, LoadingState, Pagination, cn } from "@/components/ui";
import {
  PAGOS_ESTADO_OPTIONS,
  VALIDATION_STATUS_LABELS,
  VALIDATION_STATUS_TONES,
} from "@/lib/status-badges";
import type { PersonaReporte } from "@/types/domain";

type ReportPreset = "periodo" | "asistencia" | "pagos";

interface PresetDef {
  key: ReportPreset;
  title: string;
  description: string;
  /** Singular noun for the preview's scope badge. */
  noun: string;
}

const PRESETS: PresetDef[] = [
  {
    key: "periodo",
    title: "Reporte de período",
    description: "Personas registradas entre dos fechas.",
    noun: "persona",
  },
  {
    key: "asistencia",
    title: "Reporte de asistencia",
    description: "Presencias por estudiante, horario y fecha.",
    noun: "registro",
  },
  {
    key: "pagos",
    title: "Reporte de pagos",
    description: "Pagos y membresías entre dos fechas.",
    noun: "pago",
  },
];

/** Settling time before the preview re-queries after a filter edit. */
const PREVIEW_DEBOUNCE_MS = 250;

/** Plural of a preset noun — all three are regular. */
function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

export default function ReportsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <ReportsContent />
    </ProtectedRoute>
  );
}

function ReportsContent(): React.ReactElement {
  const [preset, setPreset] = useState<ReportPreset>("periodo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  /**
   * ONE range for every preset. The screen used to keep three independent
   * pairs, so switching report silently discarded the dates you had just set.
   */
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");

  /** The single preset-specific filter: horario for asistencia, estado for pagos. */
  const [horarioId, setHorarioId] = useState("");
  const [pagosEstado, setPagosEstado] = useState("");

  const [personaResults, setPersonaResults] = useState<PersonaReporte[]>([]);
  const [attendanceResults, setAttendanceResults] = useState<AttendanceRecord[]>([]);
  const [pagosResults, setPagosResults] = useState<PaymentValidationRequest[]>([]);
  const [horarios, setHorarios] = useState<TrainingSchedule[]>([]);

  const [page, setPage] = useState(1);

  const activePreset = PRESETS.find((p) => p.key === preset) as PresetDef;

  /**
   * The range is only "usable" once it is coherent. `periodo` needs both ends
   * (the endpoint takes no open range); the other two treat an empty range as
   * "everything", which is what their endpoints do.
   */
  const rangeInverted = fechaInicio !== "" && fechaFin !== "" && fechaInicio > fechaFin;
  const periodoRangeIncomplete =
    preset === "periodo" && (fechaInicio === "" || fechaFin === "" || fechaInicio >= fechaFin);
  const canQuery = !rangeInverted && !periodoRangeIncomplete;

  // Horarios feed the asistencia filter's dropdown (once, on mount).
  useEffect(() => {
    void fetchTrainingSchedules()
      .then(setHorarios)
      .catch(() => {});
  }, []);

  const runPreview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (preset === "periodo") {
        setPersonaResults(await fetchNuevosPorPeriodo(fechaInicio, fechaFin));
      } else if (preset === "asistencia") {
        const params: { fechaInicio?: string; fechaFin?: string; horarioId?: number } = {};
        if (fechaInicio) params.fechaInicio = fechaInicio;
        if (fechaFin) params.fechaFin = fechaFin;
        if (horarioId) params.horarioId = Number(horarioId);
        setAttendanceResults(await fetchAttendanceRecords(params));
      } else {
        const params: { fechaInicio?: string; fechaFin?: string; estadoPago?: string } = {};
        if (fechaInicio) params.fechaInicio = fechaInicio;
        if (fechaFin) params.fechaFin = fechaFin;
        if (pagosEstado) params.estadoPago = pagosEstado;
        setPagosResults(await fetchPagosReporte(params));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "No se pudo generar la vista previa.";
      setError(message);
      setPersonaResults([]);
      setAttendanceResults([]);
      setPagosResults([]);
    } finally {
      setLoading(false);
    }
  }, [preset, fechaInicio, fechaFin, horarioId, pagosEstado]);

  /**
   * The preview generates itself from the current selection. That is the whole
   * point of the redesign — the old screen made you press "Buscar" to find out
   * whether the filters you had chosen produced anything at all.
   *
   * Debounced because a range is edited one field at a time: typing "desde"
   * before "hasta" leaves a half-set, still-technically-valid range in state
   * for a moment, and firing on it would both waste a request and briefly
   * render results for a range the user never asked for.
   */
  useEffect(() => {
    if (!canQuery) return;
    const timer = setTimeout(() => {
      void runPreview();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [canQuery, runPreview]);

  // Reset to page 1 whenever what is being previewed changes.
  useEffect(() => {
    setPage(1);
  }, [preset, personaResults.length, attendanceResults.length, pagosResults.length]);

  const resultCount =
    preset === "periodo"
      ? personaResults.length
      : preset === "asistencia"
        ? attendanceResults.length
        : pagosResults.length;

  const totalPages = useMemo(() => {
    if (preset === "periodo") return getPersonaReportTotalPages(personaResults.length);
    if (preset === "asistencia") return getAsistenciaReportTotalPages(attendanceResults.length);
    return getPagosReportTotalPages(pagosResults.length);
  }, [preset, personaResults.length, attendanceResults.length, pagosResults.length]);

  const pageSize =
    preset === "periodo"
      ? PERSONA_REPORT_PAGE_SIZE
      : preset === "asistencia"
        ? ASISTENCIA_REPORT_PAGE_SIZE
        : PAGOS_REPORT_PAGE_SIZE;

  async function handleGeneratePdf(): Promise<void> {
    setExportingPdf(true);
    setError(null);
    try {
      if (preset === "periodo") {
        await exportNuevosPorPeriodoPdf(fechaInicio, fechaFin);
      } else if (preset === "asistencia") {
        const params: { fechaInicio?: string; fechaFin?: string; horarioId?: number } = {};
        if (fechaInicio) params.fechaInicio = fechaInicio;
        if (fechaFin) params.fechaFin = fechaFin;
        if (horarioId) params.horarioId = Number(horarioId);
        await exportAsistenciaReportePdf(params);
      } else {
        const params: { fechaInicio?: string; fechaFin?: string; estadoPago?: string } = {};
        if (fechaInicio) params.fechaInicio = fechaInicio;
        if (fechaFin) params.fechaFin = fechaFin;
        if (pagosEstado) params.estadoPago = pagosEstado;
        await exportPagosReportePdf(params);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "No se pudo generar el PDF del reporte.";
      setError(message);
    } finally {
      setExportingPdf(false);
    }
  }

  /**
   * The CSV of everything currently previewed. Columns mirror the preview's
   * own table exactly, so what you downloaded is what you were looking at —
   * and it covers the whole result set, not the visible page, because
   * `*Results` already hold every row for the range (see `reports-utils`).
   */
  function handleDownloadCsv(): void {
    setError(null);
    try {
      if (preset === "periodo") {
        downloadCsv(
          csvFilename("periodo"),
          toCsv(
            ["Nombres", "Apellidos", "Cédula", "Fecha de nacimiento", "Edad", "Teléfono"],
            personaResults.map((persona) => [
              persona.nombres,
              persona.apellidos,
              persona.cedula,
              formatDate(persona.fechaNacimiento),
              calcAge(persona.fechaNacimiento),
              persona.telefono,
            ]),
          ),
        );
      } else if (preset === "asistencia") {
        downloadCsv(
          csvFilename("asistencia"),
          toCsv(
            ["Fecha", "Horario", "Estudiante", "Estado", "Entrenador"],
            attendanceResults.map((record) => [
              formatDate(record.fecha),
              record.horario,
              record.estudiante,
              getAttendanceLabel(record.estado),
              record.entrenador,
            ]),
          ),
        );
      } else {
        downloadCsv(
          csvFilename("pagos"),
          toCsv(
            [
              "Estudiante",
              "Responsable de pago",
              "Período",
              "Monto",
              "Método",
              "Subido",
              "Estado",
            ],
            pagosResults.map((pago) => [
              pago.studentName,
              pago.responsablePagoName ?? "",
              pago.membershipPeriod,
              formatCurrency(pago.expectedAmount),
              pago.paymentMethod,
              formatDateTime(pago.uploadedAt),
              VALIDATION_STATUS_LABELS[pago.validationStatus],
            ]),
          ),
        );
      }
    } catch {
      setError("No se pudo generar el CSV del reporte.");
    }
  }

  return (
    <AppShell eyebrow="Documentos del club" title="Reportes">
      <BackLink href="/dashboard" label="Volver al Panel" />

      {/* Preset cards. Even height via `items-stretch` + `h-full`, selection
          marked with coal + the yellow ball dot — red is reserved for the
          primary CTA and for destructive/error states. */}
      <div
        role="radiogroup"
        aria-label="Tipo de reporte"
        className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] items-stretch gap-3.5"
      >
        {PRESETS.map((item) => {
          const selected = preset === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreset(item.key)}
              className={cn(
                "flex h-full flex-col items-start gap-[7px] rounded-card border bg-paper p-[17px_18px] text-left",
                selected ? "border-coal ring-1 ring-coal" : "border-line-2 hover:bg-canvas",
              )}
            >
              <b className="text-[14.5px] text-ink">{item.title}</b>
              <p className="text-[13px] text-ink-3">{item.description}</p>
              {selected ? (
                <span className="h-badge mt-1 inline-flex items-center gap-1.5 rounded-full bg-coal px-[11px] text-[11.5px] font-bold text-white">
                  <span
                    data-testid="preset-ball-dot"
                    aria-hidden="true"
                    className="h-1.5 w-1.5 flex-none rounded-full bg-ball"
                  />
                  Seleccionado
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Range + the single preset-specific filter + Generar PDF. */}
      <div className="card mb-3.5 flex flex-wrap items-end gap-3.5 p-[17px_18px]">
        <div className="flex min-w-[150px] flex-col gap-1.5">
          <label htmlFor="fechaInicio" className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            Desde
          </label>
          <input
            type="date"
            id="fechaInicio"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            className="input-field h-ctl"
          />
        </div>
        <div className="flex min-w-[150px] flex-col gap-1.5">
          <label htmlFor="fechaFin" className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            Hasta
          </label>
          <input
            type="date"
            id="fechaFin"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            className="input-field h-ctl"
          />
        </div>

        {preset === "asistencia" && (
          <div className="flex min-w-[150px] flex-col gap-1.5">
            <label htmlFor="horarioId" className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
              Horario
            </label>
            <select
              id="horarioId"
              value={horarioId}
              onChange={(e) => setHorarioId(e.target.value)}
              className="input-field h-ctl"
            >
              <option value="">Todos</option>
              {horarios.map((h) => (
                <option key={h.id} value={h.id}>
                  {formatDay(h.diaSemana)} {h.horaInicio}–{h.horaFin}
                </option>
              ))}
            </select>
          </div>
        )}

        {preset === "pagos" && (
          <div className="flex min-w-[150px] flex-col gap-1.5">
            <label htmlFor="pagosEstado" className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
              Estado
            </label>
            <select
              id="pagosEstado"
              value={pagosEstado}
              onChange={(e) => setPagosEstado(e.target.value)}
              className="input-field h-ctl"
            >
              {PAGOS_ESTADO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <span className="flex-1" />

        {/*
         * Two named actions rather than one button behind a format menu: the
         * PDF is the club's document (server-rendered, the one to hand in) and
         * the CSV is the same rows as data (built here in the browser). They
         * are different artefacts, so they say so. Red stays on the PDF alone
         * — it is the primary CTA of the screen and the only red control.
         */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="primary"
            onClick={() => void handleGeneratePdf()}
            disabled={exportingPdf || !canQuery || resultCount === 0}
          >
            {exportingPdf ? (
              <Loader2 size={14} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
            {exportingPdf ? "Generando…" : "Generar PDF"}
          </Button>

          <Button onClick={handleDownloadCsv} disabled={!canQuery || resultCount === 0}>
            <Table2 size={14} strokeWidth={1.5} aria-hidden="true" />
            Descargar CSV
          </Button>
        </div>
      </div>

      {rangeInverted && (
        <div className="alert-error mb-3.5" role="alert">
          <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>La fecha de inicio debe ser anterior a la fecha de fin.</span>
        </div>
      )}

      {error && (
        <div className="alert-error mb-3.5" role="alert">
          <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Preview — the canvas that used to sit empty until you pressed Buscar. */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-[15px]">
          <h2 className="flex-1 text-[13px] font-bold text-ink">
            Vista previa — {activePreset.title}
          </h2>
          {canQuery && !loading && (
            <Badge tone="neutral">
              {resultCount} {pluralize(activePreset.noun, resultCount)}
              {totalPages > 1 ? ` · ${totalPages} páginas` : ""}
            </Badge>
          )}
        </div>

        {!canQuery ? (
          <EmptyState
            icon={<FileText size={21} strokeWidth={1.5} aria-hidden="true" />}
            title="Elija un rango de fechas"
            description={
              preset === "periodo"
                ? "El reporte de período necesita una fecha de inicio y una de fin (dd/mm/aaaa) para generarse."
                : "Corrija el rango de fechas para ver la vista previa."
            }
          />
        ) : loading ? (
          <LoadingState label="Generando la vista previa…" />
        ) : preset === "periodo" ? (
          <PersonaPreview results={paginatePersonaResults(personaResults, page)} total={personaResults.length} />
        ) : preset === "asistencia" ? (
          <AsistenciaPreview
            results={paginateAsistenciaResults(attendanceResults, page)}
            total={attendanceResults.length}
          />
        ) : (
          <PagosPreview results={paginatePagosResults(pagosResults, page)} total={pagosResults.length} />
        )}

        {canQuery && !loading && resultCount > 0 && totalPages > 1 && (
          <Pagination
            className="mt-0 border-t border-line px-5 py-4"
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={resultCount}
            pageSize={pageSize}
            itemNoun={activePreset.noun}
          />
        )}

        <div className="border-t border-line px-5 py-3.5">
          <p className="text-[12px] text-ink-3">
            La vista previa se genera al elegir el reporte, antes de descargar. Tanto el PDF como el
            CSV incluyen los {resultCount} {pluralize(activePreset.noun, resultCount)} del rango
            seleccionado, no solo esta página. El PDF lo genera el servidor; el CSV se arma en su
            navegador con esos mismos datos.
          </p>
        </div>
      </section>
    </AppShell>
  );
}

/** Age in whole years at today's date. */
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

const TH = "h-thead whitespace-nowrap border-b border-line bg-[#FAFAFB] px-5 text-left text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3";
const TD = "border-b border-line px-5 py-3 text-[13.5px] text-ink-2";

function PersonaPreview({
  results,
  total,
}: {
  results: PersonaReporte[];
  total: number;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron personas"
        description="Ninguna persona se registró en este rango. Pruebe con un rango de fechas más amplio."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className={TH}>Nombre</th>
            <th scope="col" className={TH}>Cédula</th>
            <th scope="col" className={TH}>Fecha Nac.</th>
            <th scope="col" className={TH}>Edad</th>
            <th scope="col" className={TH}>Teléfono</th>
          </tr>
        </thead>
        <tbody>
          {results.map((persona) => (
            <tr key={persona.id}>
              <td className={TD}>
                <span className="font-semibold text-ink">
                  {persona.nombres} {persona.apellidos}
                </span>
              </td>
              <td className={TD}>{persona.cedula}</td>
              <td className={`${TD} tabular-nums`}>{formatDate(persona.fechaNacimiento)}</td>
              <td className={TD}>{calcAge(persona.fechaNacimiento)} años</td>
              <td className={TD}>{persona.telefono}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AsistenciaPreview({
  results,
  total,
}: {
  results: AttendanceRecord[];
  total: number;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<CheckCircle size={21} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron registros de asistencia"
        description="Ningún registro coincide con los filtros. Amplíe el rango de fechas o quite el filtro de horario."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className={TH}>Fecha</th>
            <th scope="col" className={TH}>Horario</th>
            <th scope="col" className={TH}>Estudiante</th>
            <th scope="col" className={TH}>Estado</th>
            <th scope="col" className={TH}>Entrenador</th>
          </tr>
        </thead>
        <tbody>
          {results.map((record) => (
            <tr key={record.id}>
              <td className={`${TD} tabular-nums`}>{formatDate(record.fecha)}</td>
              <td className={TD}>{record.horario}</td>
              <td className={TD}>
                <span className="font-semibold text-ink">{record.estudiante}</span>
              </td>
              <td className={TD}>
                <Badge tone={getAttendanceBadgeTone(record.estado)}>
                  {getAttendanceLabel(record.estado)}
                </Badge>
              </td>
              <td className={TD}>{record.entrenador}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PagosPreview({
  results,
  total,
}: {
  results: PaymentValidationRequest[];
  total: number;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState
        icon={<Wallet size={21} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron pagos"
        description="Ningún pago coincide con los filtros. Amplíe el rango de fechas o elija otro estado."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr>
            <th scope="col" className={TH}>Estudiante</th>
            <th scope="col" className={TH}>Responsable de Pago</th>
            <th scope="col" className={TH}>Período</th>
            <th scope="col" className={TH}>Monto</th>
            <th scope="col" className={TH}>Método</th>
            <th scope="col" className={TH}>Subido</th>
            <th scope="col" className={TH}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {results.map((pago) => (
            <tr key={pago.id}>
              <td className={TD}>
                <span className="font-semibold text-ink">{pago.studentName}</span>
              </td>
              <td className={TD}>{pago.responsablePagoName ?? "-"}</td>
              <td className={TD}>{pago.membershipPeriod}</td>
              <td className={`${TD} tabular-nums`}>{formatCurrency(pago.expectedAmount)}</td>
              <td className={TD}>{pago.paymentMethod}</td>
              <td className={`${TD} tabular-nums`}>{formatDateTime(pago.uploadedAt)}</td>
              <td className={TD}>
                <Badge tone={VALIDATION_STATUS_TONES[pago.validationStatus]}>
                  {VALIDATION_STATUS_LABELS[pago.validationStatus]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
