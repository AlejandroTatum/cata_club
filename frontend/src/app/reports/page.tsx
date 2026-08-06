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
import { ICON } from "@/lib/icon-size";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
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
import {
  Badge,
  Button,
  EmptyState,
  FilterPanel,
  LoadingState,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
  cn,
} from "@/components/ui";
import {
  PAGOS_ESTADO_OPTIONS,
  VALIDATION_STATUS_LABELS,
  VALIDATION_STATUS_TONES,
} from "@/lib/status-badges";
import type { PersonaReporte } from "@/types/domain";
import { toUserMessage } from "@/lib/error-message";

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
      const message = toUserMessage(err, "No se pudo generar la vista previa.");
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
      const message = toUserMessage(err, "No se pudo generar el PDF del reporte.");
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
            ["Fecha", "Horario", "Estudiante", "Estado"],
            attendanceResults.map((record) => [
              formatDate(record.fecha),
              record.horario,
              record.estudiante,
              getAttendanceLabel(record.estado),
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
    <AppShell
      title="Reportes"
      /*
       * Two named actions rather than one button behind a format menu: the PDF
       * is the club's document (server-rendered, the one to hand in) and the
       * CSV is the same rows as data (built here in the browser). They are
       * different artefacts, so they say so. Red stays on the PDF alone — it is
       * the primary CTA of the screen and the only red control.
       *
       * They used to live INSIDE the filter card, which made "generar" read as
       * one more filter control rather than as the thing the screen is for.
       */
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => void handleGeneratePdf()}
            disabled={exportingPdf || !canQuery || resultCount === 0}
          >
            {exportingPdf ? (
              <Loader2 size={ICON.sm} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
            ) : (
              <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            )}
            {exportingPdf ? "Generando…" : "Generar PDF"}
          </Button>

          <Button onClick={handleDownloadCsv} disabled={!canQuery || resultCount === 0}>
            <Table2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Descargar CSV
          </Button>
        </>
      }
    >
      {/* Preset cards. Even height via `items-stretch` + `h-full`, selection
          marked with coal + the yellow ball dot — red is reserved for the
          primary CTA and for destructive/error states. */}
      <div
        role="radiogroup"
        aria-label="Tipo de reporte"
        className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] items-stretch gap-section"
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
              <b className="text-base text-ink">{item.title}</b>
              <p className="text-sm text-ink-3">{item.description}</p>
              {selected ? (
                <span className="h-badge mt-1 inline-flex items-center gap-1.5 rounded-full bg-coal px-[11px] text-2xs tracking-flat font-bold text-white">
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

      {/* Range + the single preset-specific filter. The frame used to be a
          hand-written card with its own `p-[17px_18px]` and no caption — one
          pixel off the panel every other screen filters through. */}
      <FilterPanel
        label="Filtros del reporte"
        fields={
          <div className="flex flex-wrap items-end gap-section">
            <div className="flex min-w-[150px] flex-col gap-1.5">
              <label htmlFor="fechaInicio" className="text-2xs font-bold uppercase text-ink-3">
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
              <label htmlFor="fechaFin" className="text-2xs font-bold uppercase text-ink-3">
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
                <label htmlFor="horarioId" className="text-2xs font-bold uppercase text-ink-3">
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
                <label htmlFor="pagosEstado" className="text-2xs font-bold uppercase text-ink-3">
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

          </div>
        }
      />

      {rangeInverted && (
        <div className="alert-error" role="alert">
          <AlertCircle size={ICON.sm} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>La fecha de inicio debe ser anterior a la fecha de fin.</span>
        </div>
      )}

      {error && (
        <div className="alert-error" role="alert">
          <AlertCircle size={ICON.sm} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Preview — the canvas that used to sit empty until you pressed Buscar. */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-[15px]">
          <h2 className="flex-1 text-sm font-bold text-ink">
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
          <EmptyState surface="inset"
            icon={<FileText size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
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
            variant="footer"
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={resultCount}
            pageSize={pageSize}
            itemNoun={activePreset.noun}
          />
        )}
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


function PersonaPreview({
  results,
  total,
}: {
  results: PersonaReporte[];
  total: number;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState surface="inset"
        icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron personas"
        description="Ninguna persona se registró en este rango. Pruebe con un rango de fechas más amplio."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Nombre</TableHeaderCell>
            <TableHeaderCell>Cédula</TableHeaderCell>
            <TableHeaderCell>Fecha Nac.</TableHeaderCell>
            <TableHeaderCell>Edad</TableHeaderCell>
            <TableHeaderCell>Teléfono</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {results.map((persona) => (
            <TableRow key={persona.id}>
              <TableNameCell name={`${persona.nombres} ${persona.apellidos}`} />
              <TableCell>{persona.cedula}</TableCell>
              <TableCell className="tabular-nums">{formatDate(persona.fechaNacimiento)}</TableCell>
              <TableCell>{calcAge(persona.fechaNacimiento)} años</TableCell>
              <TableCell>{persona.telefono}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <EmptyState surface="inset"
        icon={<CheckCircle size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron registros de asistencia"
        description="Ningún registro coincide con los filtros. Amplíe el rango de fechas o quite el filtro de horario."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Fecha</TableHeaderCell>
            <TableHeaderCell>Horario</TableHeaderCell>
            <TableHeaderCell>Estudiante</TableHeaderCell>
            <TableHeaderCell>Estado</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {results.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="tabular-nums">{formatDate(record.fecha)}</TableCell>
              <TableCell>{record.horario}</TableCell>
              <TableNameCell name={record.estudiante} />
              <TableCell>
                <Badge tone={getAttendanceBadgeTone(record.estado)}>
                  {getAttendanceLabel(record.estado)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
      <EmptyState surface="inset"
        icon={<Wallet size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron pagos"
        description="Ningún pago coincide con los filtros. Amplíe el rango de fechas o elija otro estado."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>Estudiante</TableHeaderCell>
            <TableHeaderCell>Responsable de Pago</TableHeaderCell>
            <TableHeaderCell>Período</TableHeaderCell>
            <TableHeaderCell>Monto</TableHeaderCell>
            <TableHeaderCell>Método</TableHeaderCell>
            <TableHeaderCell>Subido</TableHeaderCell>
            <TableHeaderCell>Estado</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {results.map((pago) => (
            <TableRow key={pago.id}>
              <TableNameCell name={pago.studentName} />
              <TableCell>{pago.responsablePagoName ?? "-"}</TableCell>
              <TableCell>{pago.membershipPeriod}</TableCell>
              <TableCell className="tabular-nums">{formatCurrency(pago.expectedAmount)}</TableCell>
              <TableCell>{pago.paymentMethod}</TableCell>
              <TableCell className="tabular-nums">{formatDateTime(pago.uploadedAt)}</TableCell>
              <TableCell>
                <Badge tone={VALIDATION_STATUS_TONES[pago.validationStatus]}>
                  {VALIDATION_STATUS_LABELS[pago.validationStatus]}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
