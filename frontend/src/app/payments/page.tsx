/**
 * Membresías y Pagos — the validation queue (CU012), redesigned for Fase 3.
 *
 * Sources of truth: `docs/archive/prototypes/prototipos/09-pagos-cola.html` (queue),
 * `10-pago-validar.html` (detail) and `11-pago-rechazar.html` (rejection).
 *
 * What changed, and why — every item below was a measured defect, not a taste
 * call (see `docs/archive/prototypes/plan-implementacion-rediseno.md`, Fase 3 item 2):
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
 *
 * The stat-card row is gone: the filter pills already carry every one of those
 * four counts, and the surface is allowed one message.
 *
 * ## One payment, one decision
 *
 * A batch path used to sit alongside this: a per-row checkbox in the queue,
 * enabled only once that payment's own detail checklist had been completed and
 * parked, feeding an "Aprobar N pagos" bar. The safeguard worked — nothing
 * could enter a batch unreviewed — but the affordance did not. The column
 * rendered disabled for every admin who had parked nothing yet, which is every
 * admin opening the screen, and the single muted line above the list was the
 * only thing explaining why. It read as decoration, and decoration that looks
 * like a control is worse than no control.
 *
 * It was removed rather than re-signposted (product decision, QA de agosto
 * 2026): a payment is reviewed and decided in its own detail view, and nowhere
 * else. The cost is explicit — N pending payments are N confirmations again,
 * which is the pain the batch was built for. If that cost bites, the answer is
 * a better batch, not this one back.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import ContextualHelp from "@/components/ContextualHelp";
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
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import type {
  PaymentValidationRequest,
  ValidationStatus,
} from "@/services/api";
import { fetchPaymentValidations, updatePaymentValidation } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import { usePersistentPreference } from "@/lib/persistent-preference";
import { useToast } from "@/contexts/ToastContext";
import { useDeferredCommit } from "@/lib/deferred-commit";
import { calendarIsoDate } from "@/lib/club-date";
import {
  paginatePaymentRequests,
  getTotalPages,
  PAYMENTS_FETCH_LIMIT,
  PAYMENTS_PAGE_SIZE,
  humanizePaymentPeriod,
  getPendingRequests,
  findQueueNeighbours,
  getAutoAdvanceId,
  buildApprovalChecklist,
  composeRejectionReason,
  REJECTION_REASONS,
  REJECTION_NOTE_MAX_LENGTH,
} from "@/app/payments/payments-utils";
import {
  BackLink,
  buttonClasses,
  Badge,
  Button,
  DataBox,
  EmptyState,
  ErrorState,
  FilterPanel,
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
function isFilterKey(value: string): value is FilterKey {
  return FILTERS.some((filter) => filter.key === value);
}

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
    <span className="text-2xs font-bold uppercase text-ink-3">{children}</span>
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
    <div className="flex min-h-drow flex-wrap items-center justify-between gap-x-3 gap-y-field bg-paper px-[18px] py-3 sm:flex-col sm:items-start sm:justify-center sm:gap-y-field sm:py-1.5">
      <dt>
        <DetailLabel>{label}</DetailLabel>
      </dt>
      <dd className="text-sm font-semibold text-ink">{children}</dd>
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
    <div className="card overflow-hidden lg:sticky lg:top-6">
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
          {request.proofFileName}
        </span>
        <span className="shrink-0 text-2xs tracking-flat text-ink-3">
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
          <div role="status" className="space-y-section text-center text-sm text-ink-2">
            <p>Comprobante no disponible</p>
            <a
              href={request.proofPreviewUrl}
              download
              className="inline-flex font-semibold text-state-bad hover:underline"
            >
              Descargar comprobante
            </a>
            <button
              type="button"
              onClick={onRetryPreview}
              className="mx-auto block text-xs font-semibold text-ink-2 hover:text-ink"
            >
              Reintentar vista previa
            </button>
          </div>
        ) : (
          <div className="space-y-section text-center">
            <FileText size={ICON.lg} strokeWidth={1.5} className="mx-auto text-ink-3" aria-hidden="true" />
            <p className="text-xs text-ink-3">
              <Eye size={ICON.sm} strokeWidth={1.5} className="mr-1 inline-block -mt-0.5" aria-hidden="true" />
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
            className="text-xs font-semibold text-ink-2 hover:text-ink"
          >
            Ampliar
          </button>
          <a
            href={request.proofPreviewUrl}
            download
            className="text-xs font-semibold text-ink-2 hover:text-ink"
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
  const { showSuccess, showError, showWarning } = useToast();
  const [requests, setRequests] = useState<PaymentValidationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The queue remembers where the admin works from. Whoever validates payments
   * every morning opens on "Pendientes" because that is the job; making them
   * re-pick it daily is a tax on the screen they use most. `isFilterKey`
   * refuses a stored value the product no longer understands, so a renamed key
   * cannot leave them staring at an empty list under a highlighted pill.
   */
  const [activeFilter, setActiveFilter] = usePersistentPreference<FilterKey>(
    "payments-queue-filter",
    "pendiente",
    isFilterKey,
  );
  const [query, setQuery] = useState("");
  /** Selection is by id, never by object: the object is replaced on every
   *  approve/reject, and holding the old one is how a detail view goes stale. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [rejectionReasonKey, setRejectionReasonKey] = useState("");
  const [rejectionNote, setRejectionNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  /**
   * Re-entrancy guard for the approve confirmation dialog (issue #313, K5
   * hallazgo #12). `setConfirmApproveOpen(false)` unmounts the dialog, but
   * that unmount only lands on the NEXT render — a real fast triple-click
   * (or a script clicking faster than React repaints) can fire `onConfirm`
   * more than once against the SAME still-mounted button before that
   * happens. Two `decide()` calls meant two real PUTs for the same payment:
   * the first landed, the second came back 400 ("ya está aprobado") and
   * that error handler reverted the row and told the admin it "volvió a la
   * cola de pendientes" — a state that never happened. A ref (synchronous,
   * unlike state) makes every click after the first a no-op regardless of
   * render timing.
   */
  const confirmApproveInFlightRef = useRef(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [page, setPage] = useState(1);
  const [editStartDate, setEditStartDate] = useState("");
  const [editMonths, setEditMonths] = useState<number>(1);
  /**
   * True once the admin has actually touched either "Período de vigencia"
   * field for the request now open. Issue #314 (K6 hallazgos #11/#46):
   * `handleApprove` used to ALWAYS recompute the end date from
   * `editStartDate`/`editMonths`, even when the admin never touched either —
   * and that seed is a lossy calendar-month approximation of the real
   * `selectedRequest.endDate` (see the seeding effect below), so an untouched
   * approval could silently save a shorter period than the one requested.
   * While this stays false, the exact requested period is what gets
   * submitted and previewed — the recomputed value only takes over once the
   * admin has deliberately changed something.
   */
  const [editPeriodTouched, setEditPeriodTouched] = useState(false);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);

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
    setEditPeriodTouched(false);
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

  /**
   * Issue #314 (K6 hallazgos #11/#46): the "Período de vigencia" editor seeds
   * `editMonths` from a calendar-month difference — `(end.month - start.month)`,
   * which floors away the day-of-month when the real gap is not a whole
   * number of months (e.g. 1 ago → 5 sep, 35 days, floors to "1 mes"). On
   * approve, `handleApprove` submits `calcEditEndDate(editStartDate,
   * editMonths)`, NOT `selectedRequest.endDate` — so that floor silently
   * shortened the recorded vigencia by days the family already paid for
   * (verified live: pagos 50/62/58/46/36, each losing exactly the days its
   * requested endDate fell short of a whole month).
   *
   * The period the backend derived at registration (`registrar_pago`,
   * `membresia_pago_servicio.py`) IS the amount of coverage the payment
   * bought — it is what `PERÍODO` up top shows, from the very same
   * `pago.fechaInicio`/`fechaFin` this component seeds the editor from (see
   * `buildPaymentValidationRequest`). That period wins by default: the editor
   * exists so an admin can deliberately choose a different vigencia, not to
   * silently re-derive a shorter one nobody asked for. When the two disagree
   * the screen has to say which one is about to be grabbed, instead of
   * leaving it for a `curl` after the fact to discover (#46).
   */
  // While untouched, the requested period wins outright (see
  // `editPeriodTouched`'s doc comment) — the preview shows the EXACT value
  // that will be submitted, not the lossy recompute. Once touched, the
  // recompute is the admin's own deliberate choice and is shown as such.
  const vigenciaEndDateToSave =
    editPeriodTouched || !selectedRequest
      ? calcEditEndDate(editStartDate, editMonths)
      : selectedRequest.endDate;
  const vigenciaDiffersFromRequestedPeriod = Boolean(
    selectedRequest && editPeriodTouched && vigenciaEndDateToSave !== selectedRequest.endDate,
  );

  /** The pending queue as it stood before the in-flight decision resolves. */
  const pendingBeforeDecision = useRef<PaymentValidationRequest[]>([]);

  /** Holds a decision for a few seconds so "Deshacer" can still mean something. */
  const deferredDecision = useDeferredCommit();

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

  /**
   * Decide now, send in a moment — the only honest undo for this screen.
   *
   * Approving flips the payment, activates the membership and hands a receipt
   * to a worker that generates a PDF. Reverting that afterwards would not be
   * an undo, it would be a compensating transaction with visible fallout: a
   * membership that blinked active, a receipt already sent for a payment now
   * pending again. So the decision is held for a few seconds instead, the
   * queue moves immediately, and "Deshacer" cancels something that never
   * happened. `useDeferredCommit` guarantees the hold is never silently
   * dropped: another decision, leaving the page, or closing the tab all send
   * it rather than discard it.
   */
  function decide(
    request: PaymentValidationRequest,
    optimistic: PaymentValidationRequest,
    dto: Parameters<typeof updatePaymentValidation>[1],
    confirmation: { label: string; message: string; description: string; failure: string },
  ): void {
    const previousRequests = requests;
    const previousSelectedId = selectedId;

    pendingBeforeDecision.current = pending;
    applyDecision(optimistic);

    const putItBack = (): void => {
      setRequests(previousRequests);
      setSelectedId(previousSelectedId);
    };

    showSuccess(confirmation.message, {
      description: confirmation.description,
      action: { label: "Deshacer", onAction: deferredDecision.undo },
    });

    deferredDecision.schedule({
      label: confirmation.label,
      commit: async () => {
        const saved = await updatePaymentValidation(request.id, dto);
        // The server owns the canonical row — dates it normalised, the
        // validation timestamp, the validator's name.
        setRequests((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
        // The decision itself (`saved.validationStatus`) is final and real
        // even when this is true — only the in-app notification failed. The
        // optimistic success toast above already fired and is gone by the
        // time this resolves, so this is a SEPARATE, honest follow-up: the
        // admin needs to know the notice didn't reach the student/guardian,
        // not just see a silent success (hallazgo en vivo, 2026-08-11).
        if (saved.notificationDeliveryFailed) {
          showWarning(`${confirmation.label}: la decisión se guardó, pero el aviso no llegó.`, {
            description: `${request.studentName} no recibió la notificación in-app. Si hace falta, avísele directamente.`,
          });
        }
      },
      onUndo: putItBack,
      onError: (err: unknown) => {
        console.error("[payments] decision failed", err);
        putItBack();
        // The window is gone and the admin has moved on, so there is no
        // control left to attach this to: it has to travel to them. It used
        // to always be `confirmation.failure` — a generic "no se pudo" even
        // when the backend named the real reason (e.g. a rejection note over
        // 255 characters) — so `err` never reached the admin. `toUserMessage`
        // is the one place that decides whether `err` is safe to show.
        // For 400/409/422 it may surface the backend's own detail, falling
        // back to `confirmation.failure` only when that detail isn't safe to
        // show. For any 5xx it always returns the generic server-failure
        // message before `fallback` is even looked at, so `confirmation.failure`
        // is never used in that case (see `error-message.ts`).
        showError(toUserMessage(err, confirmation.failure), {
          description: `${request.studentName} volvió a la cola de pendientes.`,
        });
      },
    });
  }

  function handleApprove(): void {
    if (!selectedRequest || !checklistComplete) return;
    const request = selectedRequest;
    const startDate = editStartDate || request.startDate;
    // Untouched → the exact requested period, never the lossy recompute
    // (issue #314, K6 hallazgo #11). See `editPeriodTouched`.
    const endDate = editPeriodTouched ? calcEditEndDate(startDate, editMonths) : request.endDate;

    decide(
      request,
      { ...request, validationStatus: "validado", startDate, endDate },
      { action: "approved", startDate, endDate },
      {
        label: `Aprobación de ${request.studentName}`,
        message: "Pago aprobado. La membresía ahora está activa.",
        description: "Puede deshacerlo durante unos segundos.",
        failure: "No se pudo aprobar el pago.",
      },
    );
  }

  function handleRejectSubmit(): void {
    if (!selectedRequest) return;
    const rejectionReason = composeRejectionReason(rejectionReasonKey, rejectionNote);
    if (!rejectionReason) return;
    const request = selectedRequest;

    decide(
      request,
      { ...request, validationStatus: "rechazado", rejectionReason },
      { action: "rejected", rejectionReason },
      {
        label: `Rechazo de ${request.studentName}`,
        message: "Pago rechazado. Se le avisó al responsable con el motivo elegido.",
        description: "Puede deshacerlo durante unos segundos.",
        failure: "No se pudo rechazar el pago.",
      },
    );
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  function renderQueue(): React.ReactElement {
    return (
      <>
        {/*
         * A decision that is still reversible is a state the admin is IN, and
         * a toast is a state that scrolls away — it dismisses itself, and the
         * next one buries it. This row lasts exactly as long as the hold does,
         * so "did that go through yet?" has an answer on the screen rather
         * than only in a notification that may already be gone.
         *
         * No focus class on the button: the system indicator in `globals.css`
         * already paints every button, and outranks Tailwind's utilities.
         */}
        {deferredDecision.pendingLabel && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-ctl border border-line-2 bg-sunken px-4 py-2.5 text-xs font-semibold text-ink-2"
          >
            <Clock size={ICON.sm} strokeWidth={2} aria-hidden="true" className="shrink-0 text-ink-3" />
            <span>{deferredDecision.pendingLabel} — se envía en unos segundos.</span>
            <button
              type="button"
              onClick={deferredDecision.undo}
              className="ml-auto rounded-ctl px-2 py-1 font-bold text-ink underline underline-offset-2"
            >
              Deshacer
            </button>
          </div>
        )}

        {/* This screen used to read the other way round — chips first, search
            on its own line underneath — which was the exact inverse of
            Members. `FilterPanel` renders the slots in one fixed order, so the
            two screens cannot disagree again. */}
        {/* No `mb-6`. `<main>` is a `gap-page` column, so a margin here was
            24px added ON TOP of the 20px step — a fourth distance, and the one
            the panel's own doc says it never carries. */}
        <FilterPanel
          label="Filtros de pagos"
          search={
            <SearchInput
              label="Buscar estudiante"
              placeholder="Buscar estudiante"
              value={query}
              onChange={setQuery}
            />
          }
          chips={
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Filtrar pagos por estado"
            >
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
          }
          // D11c, and the panel's fourth slot, which this screen left empty
          // while carrying exactly the caveat it is for. The four pill counts
          // read as the club's totals — "Todas 62" — but they are counts of
          // what this page FETCHED, and the request is capped. `/members` has
          // the same cap and already discloses it here; this screen is the one
          // where the number is a queue somebody is working through, so an
          // undisclosed ceiling is worth more.
          help={
            <ContextualHelp title="Ayuda sobre el alcance de la cola">
              {/* #315 hallazgo #45: esta era la única ayuda de la cola y solo
                  hablaba del tope técnico de la consulta — nunca de en qué
                  consiste el trabajo que el administrador vino a hacer acá.
                  El primer párrafo dice eso; el segundo, que ya estaba,
                  sigue con el límite. */}
              <p className="mb-2">
                Validar un pago es revisar lo que la familia declaró — monto, período y comprobante
                cuando corresponde — antes de decidir. Aprobar activa la membresía del período
                pagado; rechazar le pide a la familia un comprobante nuevo.
              </p>
              <p>
                Esta cola trae hasta {PAYMENTS_FETCH_LIMIT} solicitudes por consulta, y los números
                de las pestañas cuentan sobre lo traído. Si el club supera ese volumen, use el
                buscador o el reporte de pagos para llegar a una solicitud puntual.
              </p>
            </ContextualHelp>
          }
        />

        {loading && <LoadingState label="Cargando solicitudes…" />}

        {error && !loading && <ErrorState message={error} onRetry={() => void loadRequests()} />}

        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            // A search that finds nobody left 397px of bare canvas under a
            // three-line statement — 44%. `fill` puts the surplus inside the
            // surface, which is the same move `/members` measured on its own
            // "found nobody" state.
            fill
            icon={<ShieldCheck size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
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
                  : "La cola está al día."
            }
            action={
              activeFilter === "all" && !normalizedQuery ? (
                // The one branch that shipped WITHOUT a way out — "an empty
                // state without a next action is a dead end", in the shared
                // component's own words. It is the club with no requests at
                // all, so there is nothing to un-filter; what there is, is the
                // reason the queue is empty, which is that nobody has uploaded
                // a proof. The way out is the screen where a payment gets
                // registered, which is the same destination the rest of the
                // panel already names.
                <Link href="/members" className={buttonClasses("secondary")}>
                  Ir a Miembros
                </Link>
              ) : (
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
        )}

        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="card overflow-hidden">
            {/* Desktop: the five columns that carry a decision. */}
            <div data-testid="payments-table" className="hidden overflow-x-auto md:block">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell type="text">Estudiante</TableHeaderCell>
                    <TableHeaderCell type="text">Período</TableHeaderCell>
                    <TableHeaderCell type="number">Monto</TableHeaderCell>
                    <TableHeaderCell type="text">Método</TableHeaderCell>
                    <TableHeaderCell type="action">
                      <span className="sr-only">Acción</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRequests.map((req) => {
                    const desktopNameId = `payment-name-desktop-${req.id}`;
                    return (
                    <TableRow key={req.id}>
                      <TableNameCell
                        name={<span id={desktopNameId}>{req.studentName}</span>}
                        sub={payerLabel(req)}
                      />
                      <TableCell type="text">{humanizePaymentPeriod(req.membershipPeriod)}</TableCell>
                      <TableCell type="number">{formatCurrency(req.expectedAmount)}</TableCell>
                      <TableCell type="text">{req.paymentMethod}</TableCell>
                      <TableCell type="action">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* No "Estado" column: the active tab already filters
                              to one status, so repeating it per row would only
                              echo the tab. What is left is context for the
                              action button, not a column of its own — see the
                              "Todas" case below, where it is the one thing on
                              the row that says what state a payment is in. */}
                          {activeFilter === "all" && (
                            <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                              {VALIDATION_STATUS_LABELS[req.validationStatus]}
                            </Badge>
                          )}
                          {/* LA REGLA DEL ROJO ÚNICO. This was `primary` for
                              every pending row, and the default tab IS the
                              pending queue: ten red buttons down one column,
                              fifteen in the badge beside the nav item. "Nunca
                              hay dos botones rojos en una pantalla" — and at
                              ten, red has stopped meaning "the one thing to
                              press" and become the colour of the column.

                              What it opens is the detail, where the decision
                              actually happens and where "Aprobar pago" is the
                              one red control on screen. Spending the CTA colour
                              on the step BEFORE the decision left the real
                              decision wearing the same red as the ten links
                              that lead to it. */}
                          <Button
                            size="sm"
                            aria-label={actionLabel(req)}
                            data-payment-action={req.id}
                            onClick={() => setSelectedId(req.id)}
                          >
                            {req.validationStatus === "pendiente" ? "Revisar" : "Detalle"}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: the same rows as cards, like members already does. */}
            <ul data-testid="payments-cards" className="divide-y divide-line md:hidden">
              {paginatedRequests.map((req) => {
                const mobileNameId = `payment-name-mobile-${req.id}`;
                return (
                <li key={req.id} className="flex flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <p id={mobileNameId} className="truncate text-sm font-semibold text-ink">
                      {req.studentName}
                    </p>
                    <p className="truncate text-2xs tracking-flat text-ink-3">{payerLabel(req)}</p>
                  </div>
                  <p className="text-xs text-ink-2">
                    {humanizePaymentPeriod(req.membershipPeriod)} · {req.paymentMethod}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <DataBox variant="numeric">{formatCurrency(req.expectedAmount)}</DataBox>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {/* Same rule as the desktop table: the active tab
                          already fixes the status for every visible row, and
                          what is left is context for the action button, not a
                          column of its own. */}
                      {activeFilter === "all" && (
                        <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                          {VALIDATION_STATUS_LABELS[req.validationStatus]}
                        </Badge>
                      )}
                      {/* The narrow rendering of the same row — see the note on
                          the table's copy. The two are separate JSX, so the
                          red had to be removed twice or the phone would keep
                          the column of CTAs the desktop just lost. */}
                      <Button
                        size="sm"
                        aria-label={actionLabel(req)}
                        data-payment-action={req.id}
                        onClick={() => setSelectedId(req.id)}
                      >
                        {req.validationStatus === "pendiente" ? "Revisar" : "Detalle"}
                      </Button>
                    </div>
                  </div>
                </li>
                );
              })}
            </ul>

            {totalPages > 1 && (
              <Pagination
                variant="footer"
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
          </>
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
          {/* A view swap, not a route: `selectedId` is local state, so the
              detail and the queue share one URL. `href` still names a real
              fallback destination for a screen reader or a "open in new
              tab" — but the actual "back" is the `onClick` state reset.
              `preventDefault` stops `next/link` from also pushing a second
              history entry for the SAME url, which — left unstopped — would
              make the browser's own Back button need an extra press per
              queue⇄detail round trip to actually leave the page. */}
          <BackLink
            href="/payments"
            onClick={(e) => {
              e.preventDefault();
              setSelectedId(null);
            }}
          />
          <span className="flex-1" />
          {queue.position > 0 && (
            <>
              <span className="text-xs font-semibold tabular-nums text-ink-3">
                Pendiente {queue.position} de {queue.total}
              </span>
              <Button
                size="sm"
                aria-label="Pendiente anterior"
                disabled={queue.previousId === null}
                onClick={() => setSelectedId(queue.previousId)}
              >
                <ChevronLeft size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                Anterior
              </Button>
              <Button
                size="sm"
                aria-label="Pendiente siguiente"
                disabled={queue.nextId === null}
                onClick={() => setSelectedId(queue.nextId)}
              >
                Siguiente
                <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
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
            <section className="card overflow-hidden">
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
                className="border-b border-line px-[18px] py-4 font-display text-lg uppercase leading-tight tracking-flat text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ball focus-visible:shadow-focus-band-inset"
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
                  <span className="text-xl font-extrabold leading-none tabular-nums text-ink">
                    {formatCurrency(request.expectedAmount)}
                  </span>
                </div>
                <div className="flex min-h-drow flex-col justify-center gap-1.5 bg-canvas px-[18px] py-3">
                  <DetailLabel>Período</DetailLabel>
                  <span className="text-base font-bold leading-tight text-ink">
                    {humanizePaymentPeriod(request.membershipPeriod)}
                  </span>
                </div>
              </div>

              {/* Everything else, paired two-up: still every field, at a third
                  of the height and with no gutter to read across. */}
              <dl className="grid gap-px bg-line sm:grid-cols-2">
                {/* Estudiante and Responsable stay plain text — an identity,
                    not a value: the same rule `DataRow` already draws
                    between a name and its boxed metadata. Método, Subido el
                    and Tipo are values, so they get the box. */}
                <DetailCell label="Estudiante">{request.studentName}</DetailCell>
                <DetailCell label="Responsable de pago">{payer}</DetailCell>
                <DetailCell label="Método">
                  <DataBox>{request.paymentMethod}</DataBox>
                </DetailCell>
                <DetailCell label="Subido el">
                  <DataBox>{formatDateTime(request.uploadedAt)}</DataBox>
                </DetailCell>
                <DetailCell label="Membresía">
                  <Badge tone={MEMBERSHIP_STATUS_TONES[request.currentMembershipStatus]}>
                    {MEMBERSHIP_STATUS_LABELS[request.currentMembershipStatus]}
                  </Badge>
                </DetailCell>
                <DetailCell label="Tipo">
                  <DataBox>{request.membershipType}</DataBox>
                </DetailCell>
              </dl>
            </section>

            {isPending && (
              <section
                className="card overflow-hidden"
                aria-labelledby="antes-de-aprobar"
              >
                <div className="flex items-center gap-3 border-b border-line px-[18px] py-4">
                  <h2 id="antes-de-aprobar" className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink">
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
                  <p className="border-b border-line bg-canvas px-[18px] py-2.5 text-xs text-ink-2">
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
                      className="flex cursor-pointer items-center gap-3 py-2.5 text-sm text-ink-2"
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
              <section className="flex flex-col gap-3 card p-[18px]">
                <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Decisión</h2>

                {!showRejectForm ? (
                  <>
                    {/* The membership's validity is the admin's call, not the
                        payer's: the uploaded proof states an intent, approval
                        is what fixes the dates. Pre-filled from the request,
                        so leaving it alone approves exactly what was asked. */}
                    <fieldset className="rounded-ctl border border-line bg-canvas p-3">
                      <legend className="px-1 text-2xs font-bold uppercase text-ink-3">
                        Período de vigencia
                      </legend>
                      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                        <label className="flex flex-col gap-1 text-xs text-ink-2">
                          Fecha de inicio
                          <input
                            type="date"
                            value={editStartDate}
                            onChange={(e) => {
                              setEditStartDate(e.target.value);
                              setEditPeriodTouched(true);
                            }}
                            className="rounded-ctl border border-line bg-paper px-3 py-2 text-sm text-ink"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-ink-2">
                          Meses
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={editMonths}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              setEditMonths(Number.isNaN(parsed) || parsed < 1 ? 1 : parsed);
                              setEditPeriodTouched(true);
                            }}
                            className="rounded-ctl border border-line bg-paper px-3 py-2 text-sm tabular-nums text-ink"
                          />
                        </label>
                      </div>
                      {editStartDate && editMonths > 0 && (
                        <p className="mt-2 text-xs text-ink-3">
                          Vence el {formatDate(vigenciaEndDateToSave)}
                        </p>
                      )}
                      {/* Issue #314 (K6 hallazgo #46): the checklist's "La fecha
                          de la transferencia cae dentro del período" never said
                          which period it meant. Once the admin edits this away
                          from the requested one, say so explicitly and name
                          which value is about to be recorded. */}
                      {vigenciaDiffersFromRequestedPeriod && (
                        <p className="mt-2 text-xs font-semibold text-state-bad" role="alert">
                          Esta vigencia ({formatDate(vigenciaEndDateToSave)}) no coincide con el
                          PERÍODO que pidió el socio ({formatDate(request.endDate)}). Se va a grabar
                          la vigencia de aquí abajo, no el período de arriba.
                        </p>
                      )}
                    </fieldset>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={!checklistComplete || actionLoading !== null}
                        onClick={() => {
                          confirmApproveInFlightRef.current = false;
                          setConfirmApproveOpen(true);
                        }}
                      >
                        {actionLoading === "approve" ? "Procesando…" : "Aprobar pago"}
                      </Button>
                      <Button
                        disabled={actionLoading !== null}
                        onClick={() => setShowRejectForm(true)}
                      >
                        Rechazar pago…
                      </Button>
                    </div>
                    {/* Issue #314 (K6 hallazgo #17): this fact lived only in
                        /ayuda, two clicks and a different screen away from the
                        button that needs it. It has to be visible BEFORE that
                        click, not discoverable after. */}
                    <p className="text-xs text-ink-3">
                      Tras aprobar va a tener unos segundos para deshacerlo con &quot;Deshacer&quot;.
                      Pasado ese momento el pago queda registrado y ya no se puede revertir.
                    </p>
                    {!checklistComplete && (
                      <p className="text-xs text-ink-3">
                        {remainingChecks === 1
                          ? "Falta confirmar 1 punto de la lista para poder aprobar."
                          : `Faltan ${remainingChecks} puntos de la lista para poder aprobar.`}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* Rejection is destructive for the payer — it stops their
                        enrolment — so the warning names them (prototype 11). */}
                    <p className="rounded-ctl border border-line bg-canvas px-3 py-2.5 text-xs text-ink-2">
                      {payer} va a recibir este motivo tal cual y va a tener que subir un comprobante
                      nuevo. La membresía de {request.studentName} sigue sin activarse hasta entonces.
                    </p>

                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-1 text-2xs font-bold uppercase text-ink-3">
                        Motivo <span className="text-state-bad">*</span>
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
                            <span className="block text-sm font-semibold text-ink">
                              {reason.label}
                            </span>
                            {reason.description && (
                              <span className="mt-0.5 block text-xs text-ink-3">
                                {reason.description}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>

                    <label className="flex flex-col gap-1.5">
                      <span className="flex items-baseline justify-between text-2xs font-bold uppercase text-ink-3">
                        <span>Nota para el responsable (opcional)</span>
                        <span
                          className={`font-normal normal-case tabular-nums ${
                            rejectionNote.length >= REJECTION_NOTE_MAX_LENGTH ? "text-state-bad" : ""
                          }`}
                        >
                          {rejectionNote.length}/{REJECTION_NOTE_MAX_LENGTH}
                        </span>
                      </span>
                      <textarea
                        rows={3}
                        value={rejectionNote}
                        onChange={(e) => setRejectionNote(e.target.value.slice(0, REJECTION_NOTE_MAX_LENGTH))}
                        maxLength={REJECTION_NOTE_MAX_LENGTH}
                        placeholder="Ej.: El comprobante dice $20,00 y la mensualidad es de $25,00."
                        className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
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
                  <XCircle size={ICON.sm} strokeWidth={2} className="text-state-bad" aria-hidden="true" />
                  <h2 className="text-sm font-bold text-state-bad">Motivo del rechazo</h2>
                </div>
                <p className="text-sm text-ink-2">{request.rejectionReason}</p>
              </section>
            )}

            {!isPending && (request.validatedBy || request.validatedAt) && (
              <p className="text-xs text-ink-3">
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
      <AppShell title="Membresías y Pagos">
        {selectedRequest ? renderDetail(selectedRequest) : renderQueue()}

        <ConfirmDialog
          open={confirmApproveOpen}
          variant="state-ok"
          title="Aprobar pago"
          message={
            vigenciaDiffersFromRequestedPeriod
              ? `¿Confirma que aprueba este pago? La membresía pasará a activa con vigencia hasta ${formatDate(vigenciaEndDateToSave)}, distinta del período solicitado (${selectedRequest ? formatDate(selectedRequest.endDate) : ""}). Va a tener unos segundos para deshacerlo; pasado ese momento no se puede revertir.`
              : "¿Confirma que aprueba este pago? La membresía pasará a activa. Va a tener unos segundos para deshacerlo; pasado ese momento no se puede revertir."
          }
          onConfirm={() => {
            if (confirmApproveInFlightRef.current) return;
            confirmApproveInFlightRef.current = true;
            setConfirmApproveOpen(false);
            void handleApprove();
          }}
          onCancel={() => {
            confirmApproveInFlightRef.current = false;
            setConfirmApproveOpen(false);
          }}
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
                className="relative mx-4 flex h-[90vh] w-full max-w-4xl flex-col card overflow-hidden shadow-elevated"
                /* The panel is a layout box, not a control: its only handler
                   keeps a click INSIDE the sheet from reaching the backdrop's
                   close handler above. `role="none"` says that out loud, so
                   the element stops reading as a home-made interactive one
                   that owes the keyboard an equivalent — there is nothing here
                   to activate. A div has no semantics to give up, and every
                   child (the close button, the viewer) keeps its own. */
                role="none"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
                  <p className="truncate text-sm font-semibold text-ink">
                    {selectedRequest.proofFileName}
                  </p>
                  <button
                    type="button"
                    onClick={(): void => setVoucherModalOpen(false)}
                    aria-label="Cerrar"
                    className="rounded-ctl p-1.5 text-ink-3 transition-colors hover:bg-canvas hover:text-ink"
                  >
                    <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
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
