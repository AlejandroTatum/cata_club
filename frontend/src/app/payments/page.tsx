/**
 * Membresías y Pagos — the validation queue (CU012), redesigned for Fase 3.
 *
 * Sources of truth: `docs/ux/prototipos/09-pagos-cola.html` (queue),
 * `10-pago-validar.html` (detail) and `11-pago-rechazar.html` (rejection).
 *
 * What changed, and why — every item below was a measured defect, not a taste
 * call (see `docs/ux/plan-implementacion-rediseno.md`, Fase 3 item 2):
 *
 *   · The filter opened on "Todas". Nobody comes to this screen to browse a
 *     history, so clearing the queue began with a click. It opens on
 *     Pendientes.
 *   · Rows were `<tr onClick>` with `cursor-pointer` and no tabIndex, role or
 *     onKeyDown: a keyboard or screen-reader admin could not open a single
 *     payment on the one screen whose entire purpose is clearing a queue. The
 *     action is now a real `<button>` in its own column, named after the
 *     student it acts on.
 *   · Seven columns carried three with no decision weight. Five remain, with
 *     the responsible payer demoted to a "Paga: …" subtitle.
 *   · Selecting a request replaced the whole list, so the admin lost their
 *     place with no way back. The detail header now states "Pendiente N de M"
 *     and carries prev/next, and a decision auto-advances to the next pending
 *     item.
 *   · "Detalle de la solicitud" was eight full-width 56px rows — label hard
 *     left, value hard right — so a ~500px card carried eight short facts and
 *     a gutter of nothing down its middle, while the voucher and the decision
 *     controls it competes with are what the admin came for. The two facts the
 *     decision turns on (monto esperado, período) now lead the card, and the
 *     other six are paired two-up. Nothing was dropped; the card lost ~45% of
 *     its height.
 *   · The "Lista de Verificación" was static prose the admin had to hold in
 *     memory while looking at the proof in the other column — so a payment
 *     could be approved without ever checking the amount. It is now real
 *     checkboxes, and they gate the button.
 *   · Those checkboxes were then the SAME three transfer questions for every
 *     payment: an Efectivo request showing "Sin comprobante adjunto" still
 *     demanded «El comprobante es legible» and «El monto del comprobante
 *     coincide con $25,00». A safeguard you have to falsify in order to
 *     proceed teaches people to tick blindly, which is precisely what breaks
 *     the checklist on the transfers where reading the voucher IS the job. The
 *     list is now derived from the payment (see `buildApprovalChecklist`); the
 *     gate did not move.
 *   · Thirteen pending payments were thirteen separate decisions with thirteen
 *     confirmations. There is now a batch path — but the only way into it is
 *     the detail view with that payment's own checklist complete, so a batch
 *     commits reviews that already happened instead of replacing them.
 *
 * The stat-card row is gone: the filter pills already carry every one of those
 * four counts, and the surface is allowed one message.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  ShieldCheck,
  XCircle,
  X,
  User,
  Calendar,
  DollarSign,
  FileText,
  Eye,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type {
  PaymentValidationRequest,
  ValidationStatus,
} from "@/services/api";
import { fetchPaymentValidations, updatePaymentValidation } from "@/services/api";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import { useToast } from "@/contexts/ToastContext";
import { calendarIsoDate } from "@/lib/club-date";
import {
  paginatePaymentRequests,
  getTotalPages,
  PAYMENTS_PAGE_SIZE,
  humanizePaymentPeriod,
  getPendingRequests,
  findQueueNeighbours,
  getAutoAdvanceId,
  getNextUnreviewedId,
  buildApprovalChecklist,
  describeBatchApproval,
  composeRejectionReason,
  REJECTION_REASONS,
  type BatchApprovalOutcome,
} from "@/app/payments/payments-utils";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterPill,
  LoadingState,
  Pagination,
  SearchInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import {
  VALIDATION_STATUS_LABELS,
  VALIDATION_STATUS_TONES,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_TONES,
} from "@/lib/status-badges";

type FilterKey = "all" | ValidationStatus;

/**
 * Pendientes first, and it is the default — the prototype's whole point is
 * that the screen opens on the work of the day.
 */
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "pendiente", label: "Pendientes" },
  { key: "validado", label: "Validados" },
  { key: "rechazado", label: "Rechazados" },
  { key: "all", label: "Todas" },
];

/** Feminine plural agreeing with "solicitudes", for the filtered empty state. */
const EMPTY_FILTER_NOUN: Record<ValidationStatus, string> = {
  pendiente: "pendientes",
  validado: "validadas",
  rechazado: "rechazadas",
};

/**
 * Who actually pays, for the "Paga: …" subtitle.
 *
 * The prototype writes "la misma estudiante" / "el mismo estudiante", which
 * needs a gender the DTO does not carry. Neutral Spanish instead of a guess.
 */
function payerLabel(request: PaymentValidationRequest): string {
  const payer = request.responsablePagoName || request.representativeName;
  if (!payer || payer === request.studentName) return "Paga: la misma persona";
  return `Paga: ${payer}`;
}

function actionLabel(request: PaymentValidationRequest): string {
  return request.validationStatus === "pendiente"
    ? `Revisar el pago de ${request.studentName}`
    : `Ver el detalle del pago de ${request.studentName}`;
}

// ---------------------------------------------------------------------------
// Detail sub-views
// ---------------------------------------------------------------------------

/** The one label style the detail card uses, in both of its shapes. */
function DetailLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">{children}</span>
  );
}

/**
 * One fact of the detail card — a 56px cell (`_sistema.css` `.drow`).
 *
 * Two shapes, and the breakpoint is the whole point. From `sm` the card is wide
 * enough for two of these side by side, so the label sits over the value and
 * the empty gutter that used to run down the middle of a full-width row
 * disappears. Below `sm` there is no gutter to reclaim — a 343px card is all
 * content — so it stays the compact label-left/value-right row, which is
 * shorter there than a stacked one would be.
 */
function DetailCell({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-drow flex-wrap items-center justify-between gap-x-3 gap-y-1 bg-paper px-[18px] py-3 sm:flex-col sm:items-start sm:justify-center sm:gap-y-0.5 sm:py-1.5">
      <dt>
        <DetailLabel>{label}</DetailLabel>
      </dt>
      <dd className="text-[13.5px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function ProofViewer({
  request,
  previewUnavailable,
  onPreviewError,
  onRetryPreview,
  onExpand,
}: {
  request: PaymentValidationRequest;
  previewUnavailable: boolean;
  onPreviewError: () => void;
  onRetryPreview: () => void;
  onExpand: () => void;
}): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-paper lg:sticky lg:top-6">
      <div className="flex items-center gap-2 border-b border-line bg-[#FAFAFB] px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
          {request.proofFileName}
        </span>
        <span className="shrink-0 text-[11.5px] text-ink-3">
          {request.proofFileType === "pdf" ? "PDF" : "Imagen"}
        </span>
      </div>

      <div className="flex min-h-[280px] items-center justify-center bg-canvas p-4">
        {request.proofPreviewUrl && !previewUnavailable ? (
          // A PDF never renders in an <img>; it needs its own viewport.
          request.proofFileType === "pdf" ? (
            <iframe
              src={request.proofPreviewUrl}
              title="Vista previa del comprobante de pago"
              className="h-[420px] w-full border-0"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={request.proofPreviewUrl}
              alt="Vista previa del comprobante de pago"
              onError={onPreviewError}
              className="max-h-[420px] w-full object-contain"
            />
          )
        ) : request.proofPreviewUrl ? (
          <div role="status" className="space-y-3 text-center text-[13px] text-ink-2">
            <p>Comprobante no disponible</p>
            <a
              href={request.proofPreviewUrl}
              download
              className="inline-flex font-semibold text-cata-red hover:underline"
            >
              Descargar comprobante
            </a>
            <button
              type="button"
              onClick={onRetryPreview}
              className="mx-auto block text-[12.5px] font-semibold text-ink-2 hover:text-ink"
            >
              Reintentar vista previa
            </button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <FileText size={32} strokeWidth={1.5} className="mx-auto text-ink-3" aria-hidden="true" />
            <p className="text-[12.5px] text-ink-3">
              <Eye size={12} strokeWidth={1.5} className="mr-1 inline-block -mt-0.5" aria-hidden="true" />
              Vista previa no disponible para este tipo de comprobante.
            </p>
          </div>
        )}
      </div>

      {request.proofPreviewUrl && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onExpand}
            className="text-[12.5px] font-semibold text-ink-2 hover:text-ink"
          >
            Ampliar
          </button>
          <a
            href={request.proofPreviewUrl}
            download
            className="text-[12.5px] font-semibold text-ink-2 hover:text-ink"
          >
            Descargar
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
// Focus management for the queue ⇄ detail swap
// ---------------------------------------------------------------------------

/** Marks a queue row's action button so focus can find it again on the way back. */
const QUEUE_ACTION_ATTR = "data-payment-action";

/**
 * Move focus back to the queue row action for `requestId`.
 *
 * The queue renders every request twice — once in the desktop table, once as a
 * mobile card — so the id alone does not identify a single element. Rather than
 * duplicating the `md:` breakpoint in JavaScript, this tries each candidate and
 * keeps the first one that actually took focus: a `display: none` element
 * ignores `focus()`, so the hidden view drops out on its own.
 *
 * Returns false when the row is gone (filtered out, or on another page), in
 * which case the caller leaves focus alone rather than sending it somewhere
 * arbitrary.
 */
function focusQueueAction(requestId: string | null): boolean {
  if (!requestId || typeof document === "undefined") return false;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(`[${QUEUE_ACTION_ATTR}]`),
  ).filter((el) => el.getAttribute(QUEUE_ACTION_ATTR) === requestId);
  for (const el of candidates) {
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

export default function PaymentsPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [requests, setRequests] = useState<PaymentValidationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("pendiente");
  const [query, setQuery] = useState("");
  /** Selection is by id, never by object: the object is replaced on every
   *  approve/reject, and holding the old one is how a detail view goes stale. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [rejectionReasonKey, setRejectionReasonKey] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [page, setPage] = useState(1);
  const [editStartDate, setEditStartDate] = useState("");
  const [editMonths, setEditMonths] = useState<number>(1);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  /**
   * Batch approval, and the reason it is not a bypass.
   *
   * `reviewed` holds only payments whose OWN checklist the admin completed, one
   * by one, in the detail view — together with the validity period they settled
   * on there. Nothing else can enter it, so "Aprobar N pagos" commits decisions
   * that were already made individually; it never makes them. What the batch
   * removes is the 13 confirmation dialogs and the 13 round trips, not the
   * review.
   */
  const [reviewed, setReviewed] = useState<Record<string, { startDate: string; endDate: string }>>({});
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchOutcome, setBatchOutcome] = useState<BatchApprovalOutcome | null>(null);
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);

  function calcEditEndDate(startDate: string, months: number): string {
    if (!startDate || months <= 0) return "";
    const d = new Date(startDate + "T12:00:00");
    d.setMonth(d.getMonth() + months);
    return calendarIsoDate(d);
  }

  const loadRequests = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      setRequests(await fetchPaymentValidations());
    } catch (err) {
      console.error("[payments] fetchPaymentValidations failed", err);
      setError("Error al cargar las solicitudes de validación de pago");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  /**
   * One feedback channel: the toast. An outcome the user just caused is a
   * toast; only state that must persist on the page (a field-level validation
   * message, a load that failed and can be retried) is rendered inline.
   */
  useEffect(() => {
    if (actionError) showError(actionError);
  }, [actionError, showError]);

  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  /**
   * Every per-request bit of local state resets when the request changes —
   * including on auto-advance. A checklist inherited from the previous payment
   * would be exactly the failure the checklist exists to prevent.
   */
  useEffect(() => {
    setChecked({});
    setShowRejectForm(false);
    setRejectionReasonKey("");
    setRejectionNote("");
    setActionError(null);
    setPreviewUnavailable(false);
    setVoucherModalOpen(false);
  }, [selectedId]);

  /**
   * Seed the editable validity period from whatever the request already
   * carries, so approving without touching the fields is a no-op change.
   * Keyed on the resolved request rather than the id alone: on auto-advance
   * the id and the list update together, and the period must come from the
   * request the admin is now looking at.
   */
  useEffect(() => {
    if (selectedRequest === null) return;
    setEditStartDate(selectedRequest.startDate);
    if (selectedRequest.startDate && selectedRequest.endDate) {
      const start = new Date(selectedRequest.startDate + "T12:00:00");
      const end = new Date(selectedRequest.endDate + "T12:00:00");
      const diffMonths =
        (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      setEditMonths(Math.max(1, diffMonths));
    } else {
      setEditMonths(1);
    }
  }, [selectedRequest]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      requests
        .filter((r) => activeFilter === "all" || r.validationStatus === activeFilter)
        .filter((r) => !normalizedQuery || r.studentName.toLowerCase().includes(normalizedQuery)),
    [requests, activeFilter, normalizedQuery],
  );

  // Reset to page 1 whenever the filter or the search changes, so the
  // paginator never gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [activeFilter, normalizedQuery]);

  const totalPages = useMemo(() => getTotalPages(filtered.length), [filtered]);
  const paginatedRequests = useMemo(
    () => paginatePaymentRequests(filtered, page),
    [filtered, page],
  );

  const pending = useMemo(() => getPendingRequests(requests), [requests]);
  const filterCounts: Record<FilterKey, number> = {
    all: requests.length,
    pendiente: pending.length,
    validado: requests.filter((r) => r.validationStatus === "validado").length,
    rechazado: requests.filter((r) => r.validationStatus === "rechazado").length,
  };

  const queue = findQueueNeighbours(pending, selectedId ?? "");

  /**
   * The questions come from the payment, not from a constant: a cash payment
   * has no voucher to read, so asking whether the voucher is legible is a box
   * the admin can only tick by lying. `paymentMethod` is the adapter's label
   * for the backend's `tipoPago`, and `proofPreviewUrl` is the only honest
   * signal for "there is a file attached".
   */
  const checklist = useMemo(
    () =>
      buildApprovalChecklist({
        paymentMethod: selectedRequest?.paymentMethod ?? "",
        expectedAmountLabel: formatCurrency(selectedRequest?.expectedAmount ?? 0),
        hasProof: Boolean(selectedRequest?.proofPreviewUrl),
      }),
    [selectedRequest?.paymentMethod, selectedRequest?.expectedAmount, selectedRequest?.proofPreviewUrl],
  );
  const remainingChecks = checklist.items.filter((item) => !checked[item.key]).length;
  const checklistComplete = remainingChecks === 0;

  // -------------------------------------------------------------------------
  // Batch approval
  // -------------------------------------------------------------------------

  const reviewedPending = useMemo(
    () => pending.filter((r) => reviewed[r.id]),
    [pending, reviewed],
  );
  const batchTargets = useMemo(
    () => reviewedPending.filter((r) => batchSelection.includes(r.id)),
    [reviewedPending, batchSelection],
  );
  const batchTotal = batchTargets.reduce((sum, r) => sum + r.expectedAmount, 0);
  const batchRunning = batchProgress !== null;

  /**
   * A review mark is only ever valid for a payment that is still pending: once
   * it is approved or rejected — here, elsewhere, or by another admin on the
   * next reload — the mark and the selection have to go with it, or the batch
   * bar would offer to approve something that is already resolved.
   */
  useEffect(() => {
    const pendingIds = new Set(pending.map((r) => r.id));
    setReviewed((prev) => {
      const entries = Object.entries(prev).filter(([id]) => pendingIds.has(id));
      return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
    });
    setBatchSelection((prev) => {
      const next = prev.filter((id) => pendingIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [pending]);

  function toggleBatchSelection(id: string): void {
    setBatchSelection((prev) =>
      prev.includes(id) ? prev.filter((other) => other !== id) : [...prev, id],
    );
  }

  /**
   * Park the current payment for a batch approval instead of committing it now.
   *
   * Requires exactly what "Aprobar pago" requires — a complete checklist — and
   * stores the period the admin chose, so the eventual batch call sends the
   * dates they saw rather than re-deriving them later.
   */
  function handleMarkReviewed(): void {
    if (!selectedRequest || !checklistComplete) return;
    const { id, studentName } = selectedRequest;
    const startDate = editStartDate || selectedRequest.startDate;
    setReviewed((prev) => ({
      ...prev,
      [id]: { startDate, endDate: calcEditEndDate(startDate, editMonths) },
    }));
    setBatchSelection((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setBatchOutcome(null);
    // Reviewed payments stay in the pending queue, so the plain auto-advance
    // would walk straight back into one the admin has already been through.
    setSelectedId(getNextUnreviewedId(pending, id, new Set([...Object.keys(reviewed), id])));
    showSuccess(`Revisado: ${studentName}. Queda listo para aprobar en lote.`);
  }

  /**
   * Approve every selected payment.
   *
   * There is no batch endpoint: the backend exposes
   * `PATCH /membresias/pagos/{id}/validar` per payment, proxied by
   * `PUT /api/payments/[id]`, so this is N sequential calls. Sequential rather
   * than parallel on purpose — each one is a membership activation, and a
   * partial failure has to be reportable item by item.
   */
  async function runBatchApproval(): Promise<void> {
    const targets = batchTargets;
    if (targets.length === 0) return;

    setBatchOutcome(null);
    setBatchProgress({ done: 0, total: targets.length });
    const approved: string[] = [];
    const failed: string[] = [];
    const failedIds: string[] = [];

    for (const target of targets) {
      try {
        const updated = await updatePaymentValidation(target.id, {
          action: "approved",
          ...reviewed[target.id],
        });
        // Applied one at a time: an interrupted batch still leaves every
        // already-approved row showing its real status.
        setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        approved.push(target.studentName);
      } catch (err) {
        console.error("[payments] batch approve failed", target.id, err);
        failed.push(target.studentName);
        failedIds.push(target.id);
      }
      setBatchProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setBatchProgress(null);
    // The ones that failed stay selected and stay marked as reviewed, so
    // retrying is one click and nothing has to be reviewed twice.
    setBatchSelection(failedIds);
    setBatchOutcome({ approved, failed });

    if (failed.length === 0) {
      showSuccess(
        approved.length === 1
          ? "1 pago aprobado. La membresía ya está activa."
          : `${approved.length} pagos aprobados. Las membresías ya están activas.`,
      );
    } else {
      showError(
        `Se aprobaron ${approved.length} de ${targets.length} pagos. Revise el detalle del lote.`,
      );
    }
  }

  /** The pending queue as it stood before the in-flight decision resolves. */
  const pendingBeforeDecision = useRef<PaymentValidationRequest[]>([]);

  /**
   * Opening a payment swaps the queue out for the detail IN PLACE — same URL,
   * same `<main>`, no dialog. Without help, that leaves focus on a button that
   * has just been unmounted, and the browser drops it to `<body>`: a keyboard
   * admin who pressed Enter on "Revisar" landed back at the top of the
   * document, ahead of the whole sidebar, with no idea the view had changed.
   *
   * So: focus moves to the detail's heading on open, and returns to the row
   * action it came from on the way back. Deliberately NOT `role="dialog"` and
   * NOT a focus trap — this is a view swap, and describing it as a modal would
   * promise a background that is still there and an Escape that closes it.
   */
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  /** The last request the detail showed — the row to hand focus back to. */
  const lastDetailId = useRef<string | null>(null);
  const detailWasOpen = useRef(false);

  useEffect(() => {
    const isOpen = selectedRequest !== null;
    if (isOpen) {
      lastDetailId.current = selectedRequest.id;
      // Only on open: prev/next keep focus on the pager the admin is clicking.
      if (!detailWasOpen.current) detailHeadingRef.current?.focus();
    } else if (detailWasOpen.current) {
      focusQueueAction(lastDetailId.current);
    }
    detailWasOpen.current = isOpen;
  }, [selectedRequest]);

  function applyDecision(updated: PaymentValidationRequest): void {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setSelectedId(getAutoAdvanceId(pendingBeforeDecision.current, updated.id));
  }

  async function handleApprove(): Promise<void> {
    if (!selectedRequest || !checklistComplete) return;
    pendingBeforeDecision.current = pending;
    setActionLoading("approve");
    setActionError(null);
    try {
      const startDate = editStartDate || selectedRequest.startDate;
      applyDecision(
        await updatePaymentValidation(selectedRequest.id, {
          action: "approved",
          startDate,
          endDate: calcEditEndDate(startDate, editMonths),
        }),
      );
      showSuccess("Pago aprobado. La membresía ahora está activa.");
    } catch (err) {
      console.error("[payments] approve failed", err);
      setActionError("Error al aprobar el pago");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRejectSubmit(): Promise<void> {
    if (!selectedRequest) return;
    const rejectionReason = composeRejectionReason(rejectionReasonKey, rejectionNote);
    if (!rejectionReason) return;

    pendingBeforeDecision.current = pending;
    setActionLoading("reject");
    setActionError(null);
    try {
      applyDecision(
        await updatePaymentValidation(selectedRequest.id, { action: "rejected", rejectionReason }),
      );
      showSuccess("Pago rechazado. Se le avisó al responsable con el motivo elegido.");
    } catch (err) {
      console.error("[payments] reject failed", err);
      setActionError("Error al rechazar el pago");
    } finally {
      setActionLoading(null);
    }
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  /**
   * The per-row batch checkbox.
   *
   * Rendered — and disabled — rather than hidden for a pending payment nobody
   * has reviewed yet: the affordance is what raises the question, and the
   * accessible name answers it. A resolved payment gets no control at all,
   * because there is nothing left to decide about it.
   */
  function renderBatchCheckbox(req: PaymentValidationRequest): React.ReactElement | null {
    if (req.validationStatus !== "pendiente") return null;
    const isReviewed = Boolean(reviewed[req.id]);
    return (
      <input
        type="checkbox"
        checked={batchSelection.includes(req.id)}
        disabled={!isReviewed || batchRunning}
        onChange={() => toggleBatchSelection(req.id)}
        aria-label={
          isReviewed
            ? `Incluir el pago de ${req.studentName} en el lote`
            : `Revise el pago de ${req.studentName} antes de incluirlo en un lote`
        }
        className="h-[18px] w-[18px] flex-none accent-coal disabled:cursor-not-allowed disabled:opacity-40"
      />
    );
  }

  function renderQueue(): React.ReactElement {
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <FilterPill
              key={f.key}
              label={f.label}
              count={filterCounts[f.key]}
              active={activeFilter === f.key}
              onClick={() => setActiveFilter(f.key)}
            />
          ))}
        </div>

        <SearchInput
          className="mb-6 max-w-[320px]"
          label="Buscar estudiante"
          placeholder="Buscar estudiante"
          value={query}
          onChange={setQuery}
        />

        {/* A batch that ended half-done is the one outcome a toast cannot
            carry: it names people the admin has to go back to. It stays on the
            page until they dismiss it. */}
        {batchOutcome && batchOutcome.failed.length > 0 && (
          <section
            aria-labelledby="lote-resultado"
            className="mb-4 rounded-card border border-state-bad/25 bg-state-bad-bg p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <XCircle size={15} strokeWidth={2} className="text-state-bad" aria-hidden="true" />
              <h2 id="lote-resultado" className="text-[13.5px] font-bold text-state-bad">
                El lote quedó a medias
              </h2>
            </div>
            {batchOutcome.approved.length > 0 && (
              <p className="text-[13px] text-ink-2">
                Se aprobaron {batchOutcome.approved.length}: {batchOutcome.approved.join(", ")}.
              </p>
            )}
            <p className="mt-1 text-[13px] text-ink-2">
              No se pudo aprobar {batchOutcome.failed.length === 1 ? "1 pago" : `${batchOutcome.failed.length} pagos`}:{" "}
              {batchOutcome.failed.join(", ")}. {batchOutcome.failed.length === 1 ? "Sigue" : "Siguen"} pendiente
              {batchOutcome.failed.length === 1 ? "" : "s"} y con la revisión hecha.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={batchRunning}
                onClick={() => setConfirmBatchOpen(true)}
              >
                Reintentar {batchOutcome.failed.length === 1 ? "el pago" : `los ${batchOutcome.failed.length} pagos`}
              </Button>
              <Button size="sm" onClick={() => setBatchOutcome(null)}>
                Descartar aviso
              </Button>
            </div>
          </section>
        )}

        {/* The batch bar exists only because payments got here one at a time,
            each with its own checklist completed. It commits; it never
            reviews. */}
        {reviewedPending.length > 0 && (
          <div
            role="group"
            aria-label="Aprobación por lote"
            className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-canvas px-4 py-3"
          >
            <p className="min-w-[240px] flex-1 text-[12.5px] text-ink-2">
              {batchTargets.length > 0 ? (
                <>
                  <span className="font-bold text-ink">{batchTargets.length}</span> de{" "}
                  {reviewedPending.length} pagos revisados seleccionados ·{" "}
                  <span className="font-semibold tabular-nums text-ink">
                    {formatCurrency(batchTotal)}
                  </span>
                </>
              ) : (
                `${reviewedPending.length} pagos revisados esperan aprobación. Elija cuáles aprobar juntos.`
              )}
            </p>
            {batchTargets.length < reviewedPending.length && (
              <Button
                size="sm"
                disabled={batchRunning}
                onClick={() => setBatchSelection(reviewedPending.map((r) => r.id))}
              >
                Seleccionar los {reviewedPending.length} revisados
              </Button>
            )}
            {batchTargets.length > 0 && (
              <Button size="sm" variant="ghost" disabled={batchRunning} onClick={() => setBatchSelection([])}>
                Limpiar selección
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={batchTargets.length === 0 || batchRunning}
              onClick={() => setConfirmBatchOpen(true)}
            >
              {batchProgress
                ? `Aprobando ${Math.min(batchProgress.done + 1, batchProgress.total)} de ${batchProgress.total}…`
                : batchTargets.length === 1
                  ? "Aprobar 1 pago"
                  : `Aprobar ${batchTargets.length} pagos`}
            </Button>
          </div>
        )}

        {loading && <LoadingState label="Cargando solicitudes…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => void loadRequests()} />}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-card border border-line bg-paper">
            <EmptyState
              icon={<ShieldCheck size={21} strokeWidth={1.5} aria-hidden="true" />}
              title={
                normalizedQuery
                  ? "Ningún estudiante coincide con la búsqueda"
                  : activeFilter === "all"
                    ? "Aún no hay solicitudes de validación de pago"
                    : `No hay solicitudes ${EMPTY_FILTER_NOUN[activeFilter]}`
              }
              description={
                normalizedQuery
                  ? "Revise el nombre o limpie la búsqueda para ver toda la cola."
                  : activeFilter === "all"
                    ? "Cuando un estudiante suba un comprobante, aparecerá aquí para su revisión."
                    : "Pruebe con otro estado para ver el resto de la cola."
              }
              action={
                activeFilter === "all" && !normalizedQuery ? undefined : (
                  <Button
                    onClick={() => {
                      setActiveFilter("all");
                      setQuery("");
                    }}
                  >
                    Ver todas
                  </Button>
                )
              }
            />
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line bg-paper">
            {/* Desktop: the five columns that carry a decision. */}
            <div data-testid="payments-table" className="hidden overflow-x-auto md:block">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell className="w-[52px] pr-0">
                      <span className="sr-only">Selección para el lote</span>
                    </TableHeaderCell>
                    <TableHeaderCell>Estudiante</TableHeaderCell>
                    <TableHeaderCell>Período</TableHeaderCell>
                    <TableHeaderCell align="right">Monto</TableHeaderCell>
                    <TableHeaderCell>Método</TableHeaderCell>
                    <TableHeaderCell>Estado</TableHeaderCell>
                    <TableHeaderCell align="right">
                      <span className="sr-only">Acción</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="pr-0">{renderBatchCheckbox(req)}</TableCell>
                      <TableNameCell name={req.studentName} sub={payerLabel(req)} />
                      <TableCell>{humanizePaymentPeriod(req.membershipPeriod)}</TableCell>
                      <TableCell align="right" className="font-semibold tabular-nums text-ink">
                        {formatCurrency(req.expectedAmount)}
                      </TableCell>
                      <TableCell>{req.paymentMethod}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                            {VALIDATION_STATUS_LABELS[req.validationStatus]}
                          </Badge>
                          {reviewed[req.id] && <Badge tone="ok">Revisado</Badge>}
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="sm"
                          variant={req.validationStatus === "pendiente" ? "primary" : "secondary"}
                          aria-label={actionLabel(req)}
                          data-payment-action={req.id}
                          onClick={() => setSelectedId(req.id)}
                        >
                          {req.validationStatus === "pendiente" ? "Revisar" : "Detalle"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: the same rows as cards, like members already does. */}
            <ul data-testid="payments-cards" className="divide-y divide-line md:hidden">
              {paginatedRequests.map((req) => (
                <li key={req.id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {renderBatchCheckbox(req)}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{req.studentName}</p>
                        <p className="truncate text-[11.5px] text-ink-3">{payerLabel(req)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                        {VALIDATION_STATUS_LABELS[req.validationStatus]}
                      </Badge>
                      {reviewed[req.id] && <Badge tone="ok">Revisado</Badge>}
                    </div>
                  </div>
                  <p className="text-[12.5px] text-ink-2">
                    {humanizePaymentPeriod(req.membershipPeriod)} · {req.paymentMethod}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-base font-bold tabular-nums text-ink">
                      {formatCurrency(req.expectedAmount)}
                    </span>
                    <Button
                      size="sm"
                      variant={req.validationStatus === "pendiente" ? "primary" : "secondary"}
                      aria-label={actionLabel(req)}
                      data-payment-action={req.id}
                      onClick={() => setSelectedId(req.id)}
                    >
                      {req.validationStatus === "pendiente" ? "Revisar" : "Detalle"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <Pagination
                className="mt-0 border-t border-line px-4 py-3"
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                totalItems={filtered.length}
                pageSize={PAYMENTS_PAGE_SIZE}
                itemNoun="solicitud"
                itemNounPlural="solicitudes"
              />
            )}
          </div>
        )}
      </>
    );
  }

  // -------------------------------------------------------------------------
  // Detail
  // -------------------------------------------------------------------------

  function renderDetail(request: PaymentValidationRequest): React.ReactElement {
    const payer = request.responsablePagoName || request.representativeName || request.studentName;
    const isPending = request.validationStatus === "pendiente";

    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="-ml-2" onClick={() => setSelectedId(null)}>
            <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
            Volver a la cola
          </Button>
          <span className="flex-1" />
          {queue.position > 0 && (
            <>
              <span className="text-[12.5px] font-semibold tabular-nums text-ink-3">
                Pendiente {queue.position} de {queue.total}
              </span>
              <Button
                size="sm"
                aria-label="Pendiente anterior"
                disabled={queue.previousId === null}
                onClick={() => setSelectedId(queue.previousId)}
              >
                <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
                Anterior
              </Button>
              <Button
                size="sm"
                aria-label="Pendiente siguiente"
                disabled={queue.nextId === null}
                onClick={() => setSelectedId(queue.nextId)}
              >
                Siguiente
                <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
              </Button>
            </>
          )}
          <Badge tone={VALIDATION_STATUS_TONES[request.validationStatus]}>
            {VALIDATION_STATUS_LABELS[request.validationStatus]}
          </Badge>
        </div>

        {/* Data left, proof right and always visible: validating is comparing
            a document against a set of numbers, and scrolling between the two
            was the problem (prototype 10). */}
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="flex flex-col gap-5 lg:col-span-3">
            <section className="overflow-hidden rounded-card border border-line bg-paper">
              {/* `tabIndex={-1}` so the effect above can put focus here when
                  the detail opens: reachable programmatically, never a Tab
                  stop of its own.

                  That is also why the ring is drawn by hand: the system rule
                  in globals.css excludes `[tabindex="-1"]`. It drew a bare
                  `outline-ball`, i.e. 1.41:1 on the paper card — the failure
                  that rule exists to correct. The coal band inside the outline
                  (18.54:1 on paper, 13.13:1 against the ball) is what carries
                  the 3:1 now. The whole ring is INSET because the section
                  clips its overflow, so an outward ring would be cut off. */}
              <h2
                ref={detailHeadingRef}
                tabIndex={-1}
                className="border-b border-line px-[18px] py-4 text-[15px] font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ball focus-visible:shadow-[inset_0_0_0_4px_#131316]"
              >
                Detalle de la solicitud
              </h2>
              {/* The two facts the decision actually turns on: the admin is
                  here to read a number and a period off the voucher and see
                  whether they match. They lead, at a size you can check
                  against the proof without hunting for them. */}
              <div className="grid grid-cols-2 gap-px border-b border-line bg-line">
                <div className="flex min-h-drow flex-col justify-center gap-1.5 bg-canvas px-[18px] py-3">
                  <DetailLabel>Monto esperado</DetailLabel>
                  <span className="text-[24px] font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink sm:text-[27px]">
                    {formatCurrency(request.expectedAmount)}
                  </span>
                </div>
                <div className="flex min-h-drow flex-col justify-center gap-1.5 bg-canvas px-[18px] py-3">
                  <DetailLabel>Período</DetailLabel>
                  <span className="text-[15px] font-bold leading-tight text-ink sm:text-[17px]">
                    {humanizePaymentPeriod(request.membershipPeriod)}
                  </span>
                </div>
              </div>

              {/* Everything else, paired two-up: still every field, at a third
                  of the height and with no gutter to read across. */}
              <dl className="grid gap-px bg-line sm:grid-cols-2">
                <DetailCell label="Estudiante">{request.studentName}</DetailCell>
                <DetailCell label="Responsable de pago">{payer}</DetailCell>
                <DetailCell label="Método">{request.paymentMethod}</DetailCell>
                <DetailCell label="Subido el">{formatDateTime(request.uploadedAt)}</DetailCell>
                <DetailCell label="Membresía">
                  <Badge tone={MEMBERSHIP_STATUS_TONES[request.currentMembershipStatus]}>
                    {MEMBERSHIP_STATUS_LABELS[request.currentMembershipStatus]}
                  </Badge>
                </DetailCell>
                <DetailCell label="Tipo">{request.membershipType}</DetailCell>
              </dl>
            </section>

            {isPending && (
              <section
                className="overflow-hidden rounded-card border border-line bg-paper"
                aria-labelledby="antes-de-aprobar"
              >
                <div className="flex items-center gap-3 border-b border-line px-[18px] py-4">
                  <h2 id="antes-de-aprobar" className="flex-1 text-[15px] font-bold text-ink">
                    Antes de aprobar
                  </h2>
                  <Badge tone={checklistComplete ? "ok" : "warn"}>
                    {checklist.items.length - remainingChecks} de {checklist.items.length}
                  </Badge>
                </div>
                {/* Why THIS list: the questions changed with the payment, and
                    an admin who saw three transfer questions yesterday is owed
                    the reason they are seeing two today. */}
                {checklist.note && (
                  <p className="border-b border-line bg-canvas px-[18px] py-2.5 text-[12.5px] text-ink-2">
                    {checklist.note}
                  </p>
                )}
                <div
                  role="group"
                  aria-labelledby="antes-de-aprobar"
                  className="flex flex-col px-[18px] py-2"
                >
                  {checklist.items.map((item) => (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-center gap-3 py-2.5 text-[13.5px] text-ink-2"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(checked[item.key])}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [item.key]: e.target.checked }))
                        }
                        className="h-[18px] w-[18px] flex-none accent-coal"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
              </section>
            )}

            {isPending && (
              <section className="flex flex-col gap-3 rounded-card border border-line bg-paper p-[18px]">
                <h2 className="text-[15px] font-bold text-ink">Decisión</h2>

                {!showRejectForm ? (
                  <>
                    {/* The membership's validity is the admin's call, not the
                        payer's: the uploaded proof states an intent, approval
                        is what fixes the dates. Pre-filled from the request,
                        so leaving it alone approves exactly what was asked. */}
                    <fieldset className="rounded-ctl border border-line bg-canvas p-3">
                      <legend className="px-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                        Período de vigencia
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                        <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
                          Fecha de inicio
                          <input
                            type="date"
                            value={editStartDate}
                            onChange={(e) => setEditStartDate(e.target.value)}
                            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[13.5px] text-ink"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[12.5px] text-ink-2">
                          Meses
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={editMonths}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              setEditMonths(Number.isNaN(parsed) || parsed < 1 ? 1 : parsed);
                            }}
                            className="rounded-ctl border border-line bg-paper px-3 py-2 text-[13.5px] tabular-nums text-ink"
                          />
                        </label>
                      </div>
                      {editStartDate && editMonths > 0 && (
                        <p className="mt-2 text-[12.5px] text-ink-3">
                          Vence el {formatDate(calcEditEndDate(editStartDate, editMonths))}
                        </p>
                      )}
                    </fieldset>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={!checklistComplete || actionLoading !== null}
                        onClick={() => setConfirmApproveOpen(true)}
                      >
                        {actionLoading === "approve" ? "Procesando…" : "Aprobar pago"}
                      </Button>
                      {/* The only door into a batch: a payment can be added to
                          one solely from here, with its own checklist complete,
                          which is what keeps "Aprobar N pagos" from becoming a
                          way around the review. */}
                      <Button
                        disabled={!checklistComplete || actionLoading !== null}
                        onClick={handleMarkReviewed}
                      >
                        Revisado, aprobar después
                      </Button>
                      <Button
                        disabled={actionLoading !== null}
                        onClick={() => setShowRejectForm(true)}
                      >
                        Rechazar pago…
                      </Button>
                    </div>
                    {!checklistComplete && (
                      <p className="text-[12.5px] text-ink-3">
                        {remainingChecks === 1
                          ? "Falta confirmar 1 punto de la lista para poder aprobar."
                          : `Faltan ${remainingChecks} puntos de la lista para poder aprobar.`}
                      </p>
                    )}
                    {reviewed[request.id] && (
                      <p className="text-[12.5px] text-ink-3">
                        Este pago ya está marcado como revisado y espera en la cola para aprobarse
                        en lote.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* Rejection is destructive for the payer — it stops their
                        enrolment — so the warning names them (prototype 11). */}
                    <p className="rounded-ctl border border-line bg-canvas px-3 py-2.5 text-[12.5px] text-ink-2">
                      {payer} va a recibir este motivo tal cual y va a tener que subir un comprobante
                      nuevo. La membresía de {request.studentName} sigue sin activarse hasta entonces.
                    </p>

                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                        Motivo <span className="text-cata-red">*</span>
                      </legend>
                      {REJECTION_REASONS.map((reason) => (
                        <label
                          key={reason.key}
                          className={`flex cursor-pointer gap-3 rounded-ctl border px-3.5 py-3 ${
                            rejectionReasonKey === reason.key
                              ? "border-coal bg-canvas"
                              : "border-line-2 bg-paper"
                          }`}
                        >
                          <input
                            type="radio"
                            name="rejection-reason"
                            value={reason.key}
                            checked={rejectionReasonKey === reason.key}
                            onChange={() => setRejectionReasonKey(reason.key)}
                            className="mt-0.5 h-4 w-4 flex-none accent-coal"
                          />
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold text-ink">
                              {reason.label}
                            </span>
                            {reason.description && (
                              <span className="mt-0.5 block text-[12px] text-ink-3">
                                {reason.description}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
                        Nota para el responsable (opcional)
                      </span>
                      <textarea
                        rows={3}
                        value={rejectionNote}
                        onChange={(e) => setRejectionNote(e.target.value)}
                        placeholder="Ej.: El comprobante dice $20,00 y la mensualidad es de $25,00."
                        className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
                        disabled={actionLoading !== null}
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={!rejectionReasonKey || actionLoading !== null}
                        onClick={() => void handleRejectSubmit()}
                      >
                        {actionLoading === "reject" ? "Procesando…" : "Rechazar y avisar"}
                      </Button>
                      <Button
                        disabled={actionLoading !== null}
                        onClick={() => {
                          setShowRejectForm(false);
                          setRejectionReasonKey("");
                          setRejectionNote("");
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {request.validationStatus === "rechazado" && request.rejectionReason && (
              <section className="rounded-card border border-state-bad/25 bg-state-bad-bg p-[18px]">
                <div className="mb-2 flex items-center gap-2">
                  <XCircle size={15} strokeWidth={2} className="text-state-bad" aria-hidden="true" />
                  <h2 className="text-[13.5px] font-bold text-state-bad">Motivo del rechazo</h2>
                </div>
                <p className="text-[13px] text-ink-2">{request.rejectionReason}</p>
              </section>
            )}

            {!isPending && (request.validatedBy || request.validatedAt) && (
              <p className="text-[12px] text-ink-3">
                {request.validationStatus === "validado" ? "Validado" : "Rechazado"}
                {request.validatedBy ? ` por ${request.validatedBy}` : ""}
                {request.validatedAt ? ` el ${formatDate(request.validatedAt)}` : ""}.
              </p>
            )}
          </div>

          <div className="lg:col-span-2">
            <ProofViewer
              request={request}
              previewUnavailable={previewUnavailable}
              onPreviewError={() => setPreviewUnavailable(true)}
              onRetryPreview={() => setPreviewUnavailable(false)}
              onExpand={() => setVoucherModalOpen(true)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell eyebrow="Cola de validación" title="Membresías y Pagos">
        {selectedRequest ? renderDetail(selectedRequest) : renderQueue()}

        <ConfirmDialog
          open={confirmApproveOpen}
          variant="state-ok"
          title="Aprobar pago"
          message="¿Confirma que aprueba este pago? La membresía pasará a activa."
          onConfirm={() => {
            setConfirmApproveOpen(false);
            void handleApprove();
          }}
          onCancel={() => setConfirmApproveOpen(false)}
        />

        {/* The batch confirmation says what it is about to do, to how many, and
            to whom — "¿Aprobar 7 pagos?" is not a decision anyone can make. */}
        <ConfirmDialog
          open={confirmBatchOpen}
          variant="state-ok"
          title={batchTargets.length === 1 ? "Aprobar 1 pago" : `Aprobar ${batchTargets.length} pagos`}
          message={describeBatchApproval(
            batchTargets.map((r) => r.studentName),
            formatCurrency(batchTotal),
          )}
          confirmLabel={batchTargets.length === 1 ? "Aprobar el pago" : `Aprobar los ${batchTargets.length}`}
          onConfirm={() => {
            setConfirmBatchOpen(false);
            void runBatchApproval();
          }}
          onCancel={() => setConfirmBatchOpen(false)}
        />

        {/* Fullscreen voucher viewer modal */}
        {voucherModalOpen && selectedRequest?.proofPreviewUrl &&
          createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-coal/60 backdrop-blur-sm"
              onClick={(): void => setVoucherModalOpen(false)}
              role="dialog"
              aria-modal="true"
              aria-label="Visor de comprobante"
            >
              <div
                className="relative mx-4 flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-line bg-paper shadow-elevated"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
                  <p className="truncate text-[13.5px] font-semibold text-ink">
                    {selectedRequest.proofFileName}
                  </p>
                  <button
                    type="button"
                    onClick={(): void => setVoucherModalOpen(false)}
                    aria-label="Cerrar"
                    className="rounded-ctl p-1.5 text-ink-3 transition-colors hover:bg-canvas hover:text-ink"
                  >
                    <X size={16} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </div>
                <div className="flex-1 overflow-auto bg-canvas p-2">
                  {selectedRequest.proofFileType === "pdf" ? (
                    <iframe
                      src={selectedRequest.proofPreviewUrl}
                      title="Comprobante de pago"
                      className="h-full w-full border-0"
                    />
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={selectedRequest.proofPreviewUrl}
                      alt="Comprobante de pago"
                      className="mx-auto h-full object-contain"
                    />
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )}
      </AppShell>
    </ProtectedRoute>
  );
}
