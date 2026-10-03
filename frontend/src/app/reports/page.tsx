/**
 * Reportes — pick a report, set a range, see it, download it.
 *
 * The audit counted SEVEN controls between arriving here and seeing a single
 * result: three tab pills, then a per-tab form with its own date pair, its own
 * extra filter and its own "Buscar" button — and until you pressed Buscar the
 * whole canvas below was empty. Three date pairs also meant the range you had
 * just typed was thrown away the moment you switched report.
 *
 * `docs/archive/prototypes/prototipos/18-reportes.html` collapses that: three preset cards at
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
 * ## PDF and Excel
 *
 * PDF is real and server-rendered: all three presets map to an endpoint that
 * exists (see the deviation note above), so the button downloads a document
 * the backend produced.
 *
 * The Excel (`.xlsx`) export has NO backend either — same gap the CSV export
 * it replaced (issue #864) had, and the same reason: grepping `backend/` for
 * "csv" or "xlsx" finds no export route. The control builds the file in the
 * browser with `exceljs` (`@/app/reports/xlsx-export`), which is honest here
 * and only here: the page already holds the COMPLETE result set for the range
 * (the table's pagination is a client-side slice), so the workbook carries
 * exactly the rows the preview counts and the PDF renders — typed date,
 * number and currency cells instead of the CSV's plain text. Faking a
 * request, or shipping a button that silently did nothing, were the two
 * alternatives; a real file built from data already in hand beats both.
 * Server-side export is tracked as backend work in issue #150, which is what
 * removes the three limits this approach really does have: column
 * definitions that can drift from the PDF's, no streaming, and an export the
 * backend never sees.
 *
 * The `<h2>` level of the section headings was normalised in an earlier phase
 * and is preserved: `AppShell` owns the page `<h1>`.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Check,
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
import StudentSearch from "@/components/StudentSearch";
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
  buildReportDateRange,
  REPORT_DATE_PRESETS,
  buildScheduleSlots,
  daysForSlot,
  resolveHorarioIds,
  splitMembershipPeriod,
  type ReportRangePreset,
} from "@/app/reports/reports-utils";
import {
  buildWorkbook,
  downloadXlsx,
  xlsxFilename,
  type XlsxColumn,
} from "@/app/reports/xlsx-export";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import {
  Badge,
  Button,
  EmptyState,
  FILTER_LABEL,
  FilterGroup,
  FilterPanel,
  FilterPill,
  InfoPanel,
  LoadingState,
  Pagination,
  ScrollableTable,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
  PAGE_RAIL,
  cn,
} from "@/components/ui";
import {
  PAGOS_ESTADO_OPTIONS,
  VALIDATION_STATUS_LABELS,
  VALIDATION_STATUS_TONES,
} from "@/lib/status-badges";
import type { LucideIcon } from "lucide-react";
import type { PersonaBusqueda, PersonaReporte } from "@/types/domain";
import { toUserMessage } from "@/lib/error-message";

type ReportPreset = "periodo" | "asistencia" | "pagos";

interface PresetDef {
  key: ReportPreset;
  title: string;
  description: string;
  /** Singular noun for the preview's scope badge. */
  noun: string;
  icon: LucideIcon;
}

const PRESETS: PresetDef[] = [
  {
    key: "periodo",
    title: "Reporte de período",
    description: "Personas registradas entre dos fechas.",
    noun: "persona",
    icon: Users,
  },
  {
    key: "asistencia",
    title: "Reporte de asistencia",
    description: "Presencias por estudiante, horario y fecha.",
    noun: "registro",
    icon: CheckCircle,
  },
  {
    key: "pagos",
    title: "Reporte de pagos",
    description: "Pagos y membresías entre dos fechas.",
    noun: "pago",
    icon: Wallet,
  },
];

/** Sticky head for the bounded preview tables — the scroll region is the table's own. */
const STICKY_TH = "sticky top-0 z-10";
/** The preview lists one page (10 rows) at a time, so no max height: a bound used to cut the last row in half (ADMB-29). */
const PREVIEW_SCROLL = "overflow-y-auto";

/** Numbered heading of the three-step flow (type, range, download). */
function StepHeading({ step, title }: { step: number; title: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 flex-none place-items-center rounded-full bg-coal text-2xs font-bold text-white"
      >
        {step}
      </span>
      <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">{title}</h2>
    </div>
  );
}

/** Settling time before the preview re-queries after a filter edit. */
const PREVIEW_DEBOUNCE_MS = 250;

/** Plural of a preset noun — all three are regular. */
function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

/**
 * `.xlsx` column specs, one per report — the only report-specific piece of
 * the export. Headers and coverage mirror the preview table exactly, same as
 * the CSV export they replace (issue #864); `buildWorkbook` (`xlsx-export.ts`)
 * is the one generic builder every report shares.
 */
const PERSONA_XLSX_COLUMNS: XlsxColumn[] = [
  { header: "Nombres", key: "nombres", type: "text" },
  { header: "Apellidos", key: "apellidos", type: "text" },
  { header: "Cédula", key: "cedula", type: "text" },
  { header: "Fecha de nacimiento", key: "fechaNacimiento", type: "date" },
  { header: "Edad", key: "edad", type: "number" },
  { header: "Teléfono", key: "telefono", type: "text" },
];

const ASISTENCIA_XLSX_COLUMNS: XlsxColumn[] = [
  { header: "Fecha", key: "fecha", type: "date" },
  { header: "Horario", key: "horario", type: "text" },
  { header: "Estudiante", key: "estudiante", type: "text" },
  { header: "Estado", key: "estado", type: "text" },
];

const PAGOS_XLSX_COLUMNS: XlsxColumn[] = [
  { header: "Estudiante", key: "estudiante", type: "text" },
  { header: "Responsable de pago", key: "responsable", type: "text" },
  { header: "Desde", key: "desde", type: "date" },
  { header: "Hasta", key: "hasta", type: "date" },
  { header: "Monto", key: "monto", type: "currency" },
  { header: "Método", key: "metodo", type: "text" },
  { header: "Fecha de registro", key: "fechaRegistro", type: "date" },
  { header: "Estado", key: "estado", type: "text" },
];

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
  const [exportingXlsx, setExportingXlsx] = useState(false);

  /**
   * ONE range for every preset. The screen used to keep three independent
   * pairs, so switching report silently discarded the dates you had just set.
   *
   * `rangePreset` starts at "this_month" (issue #201's mandated default) and
   * resolves eagerly so the FIRST render already has a usable range — no
   * separate mount effect, no extra render, no flash of the empty state.
   * "full_history" is deliberately excluded from this initializer: it is
   * reached only by an explicit click, never by mounting the screen.
   */
  const [rangePreset, setRangePreset] = useState<ReportRangePreset>("this_month");
  const [fechaInicio, setFechaInicio] = useState(() => buildReportDateRange("this_month").fechaInicio);
  const [fechaFin, setFechaFin] = useState(() => buildReportDateRange("this_month").fechaFin);

  /**
   * A quick-preset click resolves both ends of the range in the same handler
   * — one state update batch, so the debounced preview effect below fires
   * exactly once per click, never twice for "desde" then "hasta". Switching
   * TO "custom" clears the range instead of keeping the last preset's dates:
   * the two pickers are then the only source of truth, and a stale prefilled
   * range would read as already-chosen when it was not.
   */
  const selectRangePreset = useCallback((key: ReportRangePreset): void => {
    setRangePreset(key);
    const range = key === "custom" ? { fechaInicio: "", fechaFin: "" } : buildReportDateRange(key);
    setFechaInicio(range.fechaInicio);
    setFechaFin(range.fechaFin);
  }, []);

  /** The single preset-specific filter: horario for asistencia, estado for pagos. */
  const [slotKey, setSlotKey] = useState("");
  /** Specific day within the slot; "" = every day of the slot. */
  const [horarioId, setHorarioId] = useState("");
  const [pagosEstado, setPagosEstado] = useState("");

  /**
   * The asistencia preset's alumno filter — the same `StudentSearch` used on
   * `/trainer/attendance/history`, not a second lookup built for this screen.
   * Backend already accepts `persona_id`; this was the only piece missing.
   */
  const [student, setStudent] = useState<PersonaBusqueda | null>(null);
  const clearStudent = useCallback((): void => {
    setStudent(null);
  }, []);

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
   *
   * "Incomplete" means missing an end, and nothing more: an inverted range is
   * `rangeInverted`'s job, for all three reports alike. This used to also
   * reject `fechaInicio === fechaFin`, mirroring a backend that has since been
   * corrected — every report endpoint filters inclusively on both ends, so a
   * single day is a legitimate query, and refusing it here made the "Hoy" pill
   * a dead end on the report selected by default.
   */
  const rangeInverted = fechaInicio !== "" && fechaFin !== "" && fechaInicio > fechaFin;
  const periodoRangeIncomplete = preset === "periodo" && (fechaInicio === "" || fechaFin === "");
  // ADMB-31 (pagos): an empty "Personalizado" range is not "everything" — the user has
  // not chosen a range yet, so nothing is previewed or downloadable.
  const customRangeEmpty = preset === "pagos" && rangePreset === "custom" && fechaInicio === "" && fechaFin === "";
  const canQuery = !rangeInverted && !periodoRangeIncomplete && !customRangeEmpty;

  // Horarios feed the asistencia filter's dropdown (once, on mount).
  useEffect(() => {
    void fetchTrainingSchedules()
      .then(setHorarios)
      .catch(() => {});
  }, []);

  const slots = useMemo(() => buildScheduleSlots(horarios), [horarios]);
  const slotDays = useMemo(() => daysForSlot(horarios, slotKey), [horarios, slotKey]);
  const horarioIds = useMemo(
    () => resolveHorarioIds(horarios, slotKey, horarioId),
    [horarios, slotKey, horarioId],
  );

  function chooseSlot(key: string): void {
    setSlotKey(key);
    setHorarioId("");
  }

  function clearHorario(): void {
    setSlotKey("");
    setHorarioId("");
  }

  const runPreview = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (preset === "periodo") {
        setPersonaResults(await fetchNuevosPorPeriodo(fechaInicio, fechaFin));
      } else if (preset === "asistencia") {
        const params: { fechaInicio?: string; fechaFin?: string; horarioId?: number; personaId?: number } = {};
        if (fechaInicio) params.fechaInicio = fechaInicio;
        if (fechaFin) params.fechaFin = fechaFin;
        if (student) params.personaId = student.id;
        // One id is the common case; a slot with several days is one call per day.
        const batches = await Promise.all(
          (horarioIds.length ? horarioIds : [undefined]).map((id) =>
            fetchAttendanceRecords(id === undefined ? params : { ...params, horarioId: id }),
          ),
        );
        setAttendanceResults(batches.flat());
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
  }, [preset, fechaInicio, fechaFin, horarioIds, pagosEstado, student]);

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

  /**
   * The way out every empty state on this screen described and none offered.
   *
   * "Histórico completo" is the widest range the screen has, and it is not
   * unbounded — it resolves to the club's founding date — so it is a real
   * answer to "pruebe con un rango más amplio" rather than a promise. It is
   * `secondary`: "Generar PDF" in the header is this screen's one red control.
   */
  const widenRangeAction =
    rangePreset === "full_history" ? undefined : (
      <Button onClick={() => selectRangePreset("full_history")}>Ver el histórico completo</Button>
    );

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
        const params: { fechaInicio?: string; fechaFin?: string; horarioId?: number; personaId?: number } = {};
        if (fechaInicio) params.fechaInicio = fechaInicio;
        if (fechaFin) params.fechaFin = fechaFin;
        if (student) params.personaId = student.id;
        if (horarioIds.length === 0) {
          await exportAsistenciaReportePdf(params);
        } else {
          // The PDF endpoint filters by a single horario: one file per day.
          for (const id of horarioIds) await exportAsistenciaReportePdf({ ...params, horarioId: id });
        }
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
   * The Excel workbook of everything currently previewed. Columns mirror the
   * preview's own table exactly, so what you downloaded is what you were
   * looking at — and it covers the whole result set, not the visible page,
   * because `*Results` already hold every row for the range (see
   * `reports-utils`). Dates and money are handed over raw (not through
   * `formatDate`/`formatCurrency`) so `buildWorkbook` writes them as typed
   * cells instead of pre-formatted text.
   */
  async function handleDownloadXlsx(): Promise<void> {
    setExportingXlsx(true);
    setError(null);
    try {
      if (preset === "periodo") {
        const workbook = await buildWorkbook(
          "Personas",
          PERSONA_XLSX_COLUMNS,
          personaResults.map((persona) => ({
            nombres: persona.nombres,
            apellidos: persona.apellidos,
            cedula: persona.cedula,
            fechaNacimiento: persona.fechaNacimiento,
            edad: calcAge(persona.fechaNacimiento),
            telefono: persona.telefono,
          })),
        );
        await downloadXlsx(xlsxFilename("periodo"), workbook);
      } else if (preset === "asistencia") {
        const workbook = await buildWorkbook(
          "Asistencia",
          ASISTENCIA_XLSX_COLUMNS,
          attendanceResults.map((record) => ({
            fecha: record.fecha,
            horario: record.horario,
            estudiante: record.estudiante,
            estado: getAttendanceLabel(record.estado),
          })),
        );
        await downloadXlsx(xlsxFilename("asistencia"), workbook);
      } else {
        const workbook = await buildWorkbook(
          "Pagos",
          PAGOS_XLSX_COLUMNS,
          pagosResults.map((pago) => ({
            estudiante: pago.studentName,
            responsable: pago.responsablePagoName ?? "",
            ...splitMembershipPeriod(pago.membershipPeriod),
            monto: pago.expectedAmount,
            metodo: pago.paymentMethod,
            fechaRegistro: pago.uploadedAt,
            estado: VALIDATION_STATUS_LABELS[pago.validationStatus],
          })),
        );
        await downloadXlsx(xlsxFilename("pagos"), workbook);
      }
    } catch {
      setError("No se pudo generar el archivo de Excel. Intente nuevamente.");
    } finally {
      setExportingXlsx(false);
    }
  }

  /** "Reporte de período · Este mes · 12 personas · 2 páginas" — what the downloads will contain. */
  const rangeLabel =
    rangePreset === "custom"
      ? fechaInicio && fechaFin
        ? `${formatDate(fechaInicio)} – ${formatDate(fechaFin)}`
        : "Rango sin definir"
      : (REPORT_DATE_PRESETS.find((option) => option.key === rangePreset)?.label ?? "");
  const summaryParts = [activePreset.title, rangeLabel];
  if (canQuery && !loading) {
    summaryParts.push(`${resultCount} ${pluralize(activePreset.noun, resultCount)}`);
    if (resultCount > 0) summaryParts.push(`${totalPages} ${totalPages === 1 ? "página" : "páginas"}`);
  }
  const summary = customRangeEmpty ? "Elija Desde y Hasta para continuar" : summaryParts.join(" · ");
  const downloadHint =
    canQuery && !loading && resultCount > 0
      ? "Listo: descargue con «Generar PDF» o «Exportar a Excel», arriba."
      : "La descarga se habilita cuando la vista previa tiene resultados.";

  return (
    <AppShell
      title="Reportes"
      subtitle="Los listados del club por rango de fechas, para descargar en PDF o Excel."
      /*
       * Both exports live in ONE group in the header slot, same size: "Generar
       * PDF" is the red primary (the club's server-rendered document), "Exportar
       * a Excel" the secondary. Both stay disabled until the preview has rows,
       * and the rail's summary names exactly which report/range they act on —
       * which is what issue A4 (Excel reading as available before the scope was
       * chosen) was really asking for.
       */
      actions={
        <div className="flex flex-wrap gap-2">
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
          <Button
            onClick={() => void handleDownloadXlsx()}
            disabled={exportingXlsx || !canQuery || resultCount === 0}
          >
            {exportingXlsx ? (
              <Loader2 size={ICON.sm} strokeWidth={1.5} className="animate-spin" aria-hidden="true" />
            ) : (
              <Table2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            )}
            {exportingXlsx ? "Generando…" : "Exportar a Excel"}
          </Button>
        </div>
      }
    >
      <div data-testid="reports-split" className={PAGE_RAIL}>
        <div className="flex min-w-0 flex-col gap-page lg:min-h-[calc(100dvh-10rem)]">
      <section className="card grid gap-section p-4">
        <StepHeading step={1} title="Tipo de reporte" />
        <div
          role="radiogroup"
          aria-label="Tipo de reporte"
          className="grid items-stretch gap-field sm:grid-cols-3"
        >
          {PRESETS.map((item) => {
            const selected = preset === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPreset(item.key)}
                className={cn(
                  "relative flex h-full items-start gap-3 rounded-card border p-3 text-left",
                  selected ? "border-coal bg-canvas ring-1 ring-coal" : "border-line-2 bg-paper hover:bg-canvas",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-9 w-9 flex-none place-items-center rounded-card",
                    selected ? "bg-coal text-white" : "bg-sunken text-ink-3",
                  )}
                >
                  <Icon size={ICON.base} strokeWidth={1.5} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 pr-5">
                  <b className="text-sm text-ink">{item.title}</b>
                  <span className="text-xs text-ink-3">{item.description}</span>
                </span>
                {selected ? (
                  <span
                    data-testid="preset-ball-dot"
                    aria-hidden="true"
                    className="absolute right-3 top-3 grid h-4 w-4 place-items-center rounded-full bg-ball text-coal"
                  >
                    <Check size={ICON.sm} strokeWidth={2} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-field">
        <StepHeading step={2} title="Rango de fechas" />
      {/* Range + the single preset-specific filter. The frame used to be a
          hand-written card with its own `p-[17px_18px]` and no caption — one
          pixel off the panel every other screen filters through. */}
      <FilterPanel
        label="Filtros del reporte"
        chips={
          <FilterGroup label="Rango de fechas">
            <div className="flex flex-wrap gap-2">
              {REPORT_DATE_PRESETS.map((option) => (
                <FilterPill
                  key={option.key}
                  label={option.label}
                  active={rangePreset === option.key}
                  onClick={() => selectRangePreset(option.key)}
                />
              ))}
            </div>

            {rangePreset === "custom" && (
              <div className="flex flex-wrap items-end gap-section">
                <div className="flex min-w-[150px] flex-col gap-field">
                  <label htmlFor="fechaInicio" className={FILTER_LABEL}>
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
                <div className="flex min-w-[150px] flex-col gap-field">
                  <label htmlFor="fechaFin" className={FILTER_LABEL}>
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
              </div>
            )}
          </FilterGroup>
        }
        fields={
          <div className="flex flex-wrap items-end gap-section">
            {preset === "asistencia" && (
              <>
                <div className="flex min-w-[150px] flex-col gap-field">
                  <label htmlFor="horarioId" className={FILTER_LABEL}>
                    Horario
                  </label>
                  <select
                    id="horarioId"
                    value={slotKey}
                    onChange={(e) => chooseSlot(e.target.value)}
                    className="input-field h-ctl"
                  >
                    <option value="">Todos</option>
                    {slots.map((slot) => (
                      <option key={slot.key} value={slot.key}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex min-w-[150px] flex-col gap-field">
                  <label htmlFor="horarioDia" className={FILTER_LABEL}>
                    Día
                  </label>
                  <select
                    id="horarioDia"
                    value={horarioId}
                    onChange={(e) => setHorarioId(e.target.value)}
                    disabled={!slotKey}
                    className="input-field h-ctl"
                  >
                    <option value="">Todos los días</option>
                    {slotDays.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex min-w-[220px] flex-col gap-field">
                  <span className={FILTER_LABEL}>Alumno</span>
                  <StudentSearch
                    onSelect={setStudent}
                    onClear={clearStudent}
                    placeholder="Buscar alumno…"
                  />
                </div>
              </>
            )}

            {preset === "pagos" && (
              <div className="flex min-w-[150px] flex-col gap-field">
                <label htmlFor="pagosEstado" className={FILTER_LABEL}>
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
      </div>

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
      <section className="card flex flex-1 flex-col overflow-hidden" aria-label="Vista previa del reporte">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-[15px]">
          <h2 className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink">
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
              customRangeEmpty
                ? "Elija Desde y Hasta (dd/mm/aaaa) para ver la vista previa y habilitar la descarga."
                : preset === "periodo"
                ? "El reporte de período necesita una fecha de inicio y una de fin (dd/mm/aaaa) para generarse."
                : "Corrija el rango de fechas para ver la vista previa."
            }
          />
        ) : loading ? (
          <LoadingState label="Generando la vista previa…" />
        ) : preset === "periodo" ? (
          <PersonaPreview
            results={paginatePersonaResults(personaResults, page)}
            total={personaResults.length}
            action={widenRangeAction}
          />
        ) : preset === "asistencia" ? (
          <AsistenciaPreview
            results={paginateAsistenciaResults(attendanceResults, page)}
            total={attendanceResults.length}
            // The filter that is actually narrowing gets priority: if a horario
            // is selected, clearing it is a smaller and more likely fix than
            // widening the range, and offering the range first would send the
            // reader past the control that is holding the result at zero.
            action={
              slotKey ? (
                <Button onClick={clearHorario}>Quitar el filtro de horario</Button>
              ) : (
                widenRangeAction
              )
            }
          />
        ) : (
          <PagosPreview
            results={paginatePagosResults(pagosResults, page)}
            total={pagosResults.length}
            action={
              pagosEstado ? (
                <Button onClick={() => setPagosEstado("")}>Ver todos los estados</Button>
              ) : (
                widenRangeAction
              )
            }
          />
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
        </div>

        <div data-testid="reports-rail" className="grid content-start gap-page lg:sticky lg:top-4">
          <InfoPanel title="Resumen del reporte">
            <p data-testid="report-summary" className="font-bold text-ink">
              {summary}
            </p>
            <p>{downloadHint}</p>
          </InfoPanel>
          <InfoPanel title="Qué contiene cada reporte">
            <dl className="grid gap-2">
              <div>
                <dt className="font-semibold text-ink">Período</dt>
                <dd>Personas registradas entre dos fechas, con cédula, edad y teléfono.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Asistencia</dt>
                <dd>Presencias por estudiante, horario y fecha; admite filtrar por horario y alumno.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Pagos</dt>
                <dd>Pagos y membresías con monto, método y estado; admite filtrar por estado.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">PDF</dt>
                <dd>El documento del club, listo para imprimir o entregar.</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink">Excel</dt>
                <dd>Una hoja con todas las filas del rango, para ordenar o analizar.</dd>
              </div>
            </dl>
          </InfoPanel>
        </div>
      </div>
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
  action,
}: {
  results: PersonaReporte[];
  total: number;
  /**
   * The way out, supplied by the page because only the page holds the
   * handlers. All four empty states on this screen named a next move in prose
   * — "pruebe con un rango más amplio", "quite el filtro de horario", "elija
   * otro estado" — and none of them offered it as a control, while every one
   * of those moves is a single call the page already owns. "An empty state
   * without a next action is a dead end", in the shared component's own words,
   * and this screen had four.
   */
  action?: React.ReactNode;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState surface="inset"
        fill
        icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron personas"
        description="Ninguna persona se registró en este rango. Pruebe con un rango de fechas más amplio."
        action={action}
      />
    );
  }
  return (
    <ScrollableTable label="Listado de personas, tabla desplazable" className={PREVIEW_SCROLL}>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className={STICKY_TH}>Nombre</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Cédula</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Fecha de nacimiento</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Edad</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Teléfono</TableHeaderCell>
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
    </ScrollableTable>
  );
}

function AsistenciaPreview({
  results,
  total,
  action,
}: {
  results: AttendanceRecord[];
  total: number;
  /** See `PersonaPreview`. */
  action?: React.ReactNode;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState surface="inset"
        fill
        icon={<CheckCircle size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron registros de asistencia"
        description="Ningún registro coincide con los filtros. Amplíe el rango de fechas o quite el filtro de horario."
        action={action}
      />
    );
  }
  return (
    <ScrollableTable label="Listado de asistencia, tabla desplazable" className={PREVIEW_SCROLL}>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className={STICKY_TH}>Fecha</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Horario</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Estudiante</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Estado</TableHeaderCell>
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
    </ScrollableTable>
  );
}

/** "Desde" and "Hasta" cells of a payment row; falls back to the raw text when the period is not two ISO days. */
function PagoPeriodCells({ period }: { period: string }): React.ReactElement {
  const { desde, hasta } = splitMembershipPeriod(period);
  return (
    <>
      <TableCell className="tabular-nums">{desde ? formatDate(desde) : period || "-"}</TableCell>
      <TableCell className="tabular-nums">{hasta ? formatDate(hasta) : "-"}</TableCell>
    </>
  );
}

function PagosPreview({
  results,
  total,
  action,
}: {
  results: PaymentValidationRequest[];
  total: number;
  /** See `PersonaPreview`. */
  action?: React.ReactNode;
}): React.ReactElement {
  if (total === 0) {
    return (
      <EmptyState surface="inset"
        fill
        icon={<Wallet size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron pagos"
        description="Ningún pago coincide con los filtros. Amplíe el rango de fechas o elija otro estado."
        action={action}
      />
    );
  }
  return (
    <ScrollableTable label="Listado de pagos, tabla desplazable" className={PREVIEW_SCROLL}>
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell className={STICKY_TH}>Estudiante</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Responsable de pago</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Desde</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Hasta</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Monto</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Método</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Fecha de registro</TableHeaderCell>
            <TableHeaderCell className={STICKY_TH}>Estado</TableHeaderCell>
          </tr>
        </TableHead>
        <TableBody>
          {results.map((pago) => (
            <TableRow key={pago.id}>
              <TableNameCell name={pago.studentName} />
              <TableCell>{pago.responsablePagoName ?? "-"}</TableCell>
              <PagoPeriodCells period={pago.membershipPeriod} />
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
    </ScrollableTable>
  );
}
