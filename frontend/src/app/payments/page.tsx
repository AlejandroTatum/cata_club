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
import PagoCorreccionSection from "@/app/payments/PagoCorreccionSection";
import { useModalFocusTrap } from "@/lib/focus-trap";
import { useAuth } from "@/contexts/AuthContext";
import {
  ShieldCheck,
  XCircle,
  X,
  User,
  Calendar,
  DollarSign,
  FileText,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import type {
  PaymentValidationRequest,
  ValidationStatus,
} from "@/services/api";
import {
  fetchPaymentValidationsPage,
  fetchAllPaymentValidations,
  fetchPaymentValidationById,
  updatePaymentValidation,
  type BackendEstadoPago,
} from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import { usePersistentPreference } from "@/lib/persistent-preference";
import { useToast } from "@/contexts/ToastContext";
import {
  getTotalPages,
  paginatePaymentRequests,
  PAYMENTS_PAGE_SIZE,
  humanizePaymentPeriod,
  findQueueNeighbours,
  getAutoAdvanceId,
  buildApprovalChecklist,
  composeRejectionReason,
  REJECTION_REASONS,
  REJECTION_NOTE_MAX_LENGTH,
  requiresExceptionReason,
  EXCEPTION_REASON_MAX_LENGTH,
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
  ResponsiveList,
  SearchInput,
  TableCell,
  TableHeaderCell,
  TableNameCell,
  TableRow,
} from "@/components/ui";
import {
  VALIDATION_STATUS_TONES,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUS_TONES,
} from "@/lib/status-badges";

type FilterKey = "all" | ValidationStatus;

/**
 * `activeFilter` -> the backend's `EstadoPago` filter (issue #400, criterio
 * 4/5) — `undefined` for "all" means "no filter", matching
 * `GET /membresias/pagos`'s own `estado_pago: Optional[EstadoPago]`. Moving
 * this server-side (instead of filtering the already-fetched batch
 * client-side, as before) is what makes `total` — and therefore the page
 * count — accurate for a SINGLE status instead of the whole table.
 */
const BACKEND_ESTADO_BY_FILTER: Record<ValidationStatus, BackendEstadoPago> = {
  pendiente: "PENDIENTE_VALIDACION",
  validado: "APROBADO",
  rechazado: "RECHAZADO",
};

/**
 * Pendientes first, and it is the default — the prototype's whole point is
 * that the screen opens on the work of the day.
 */
function isFilterKey(value: string): value is FilterKey {
  return FILTERS.some((filter) => filter.key === value);
}

const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
  pendiente: "Pendiente de validar",
  validado: "Validado",
  rechazado: "Rechazado",
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "pendiente", label: "Pendientes" },
  { key: "validado", label: "Validados" },
  { key: "rechazado", label: "Rechazados" },
  { key: "all", label: "Todos" },
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

/** The five row facts, already formatted — shared by both queue renderings. */
interface RowFields {
  studentName: string;
  payer: string;
  period: string;
  amount: string;
  method: string;
}

/**
 * Derives the five row facts ONCE (Sonar duplication follow-up, issue
 * #400): the desktop `<TableRow>` and the mobile `<li>` card render the
 * SAME five facts, in the SAME order, off the SAME `req` — only their
 * surrounding DOM shape differs (table cells vs a card layout, which is a
 * genuine difference this file keeps for a reason, see "the same rows as
 * cards" below). What used to duplicate was the field ACCESS/FORMATTING
 * itself — `payerLabel(req)`, `humanizePaymentPeriod(req.membershipPeriod)`,
 * `formatCurrency(req.expectedAmount)` — called out twice, once per
 * rendering. Computed here once; both renderings just read the result.
 */
function buildRowFields(req: PaymentValidationRequest): RowFields {
  return {
    studentName: req.studentName,
    payer: payerLabel(req),
    period: humanizePaymentPeriod(req.membershipPeriod),
    amount: formatCurrency(req.expectedAmount),
    method: req.paymentMethod,
  };
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

/**
 * Issue #868: the proof header used to show the file's own name — in
 * practice the last path segment of `voucherUrl`, which for a signed
 * download URL is a long, query-string-bearing technical id, not a name a
 * user ever chose. Neither the original name nor the URL is meaningful to an
 * admin deciding whether a payment is real, so both stay internal (used only
 * as the `src`/`href` of the preview and download links) and this neutral
 * label takes their place on screen.
 */
const PROOF_ATTACHED_LABEL = "Comprobante adjunto";

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
      {/* Issue #510: the two facts the decision turns on repeat here, right
          above the file itself — intentional redundancy (documented in the
          design artifact), not a stray duplicate. "Detalle de la solicitud"
          leads with the same pair; this caption means the admin never has to
          scroll away from the voucher to re-check what they're comparing it
          against. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-field border-b border-line bg-canvas px-4 py-2.5">
        <span className="text-sm font-extrabold tabular-nums text-ink">
          {formatCurrency(request.expectedAmount)}
        </span>
        <span className="text-xs font-semibold text-ink-2">
          {humanizePaymentPeriod(request.membershipPeriod)}
        </span>
      </div>
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
          {request.proofPreviewUrl ? PROOF_ATTACHED_LABEL : "Sin comprobante adjunto"}
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
          // Issue #453: this branch only ever renders when there is no
          // `proofPreviewUrl` at all — i.e. no comprobante was attached
          // (the header above already says so: "Sin comprobante adjunto").
          // The old copy here ("Vista previa no disponible para este tipo de
          // comprobante") implies a file DOES exist, just of an unpreviewable
          // type — a claim that contradicts the header instead of restating
          // it. That wording belongs to a file that exists but cannot be
          // rendered (handled by the `previewUnavailable` branch above),
          // never to the absence of one.
          <div className="space-y-section text-center">
            <FileText size={ICON.lg} strokeWidth={1.5} className="mx-auto text-ink-3" aria-hidden="true" />
            <p className="text-xs text-ink-3">Este pago no tiene ningún comprobante adjunto.</p>
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
  const { session, isLoading: authLoading } = useAuth();
  const { showSuccess, showError, showWarning } = useToast();
  /**
   * The queue remembers where the admin works from. Whoever validates payments
   * every morning opens on "Pendientes" because that is the job; making them
   * re-pick it daily is a tax on the screen they use most. `isFilterKey`
   * refuses a stored value the product no longer understands, so a renamed key
   * cannot leave them staring at an empty list under a highlighted pill.
   */
  const [activeFilter, setActiveFilter] = usePersistentPreference<FilterKey>(
    "payments-queue-filter",
    "all",
    isFilterKey,
  );
  const [query, setQuery] = useState("");
  /** Selection is by id, never by object: the object is replaced on every
   *  approve/reject, and holding the old one is how a detail view goes stale. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  /** Issue #459: motivo obligatorio para aprobar una TRANSFERENCIA sin
   *  comprobante adjunto (excepción auditada) — ver `requiresExceptionReason`. */
  const [exceptionReason, setExceptionReason] = useState("");
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
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  const voucherPanelRef = useRef<HTMLDivElement>(null);
  // `useCallback` (not an inline arrow at each call site) so this stays the
  // same function across renders: `useModalFocusTrap` re-arms its Escape/Tab
  // listener whenever `onClose` changes identity, and an unstable `onClose`
  // would steal focus back to "Ampliar" — the hook's own close-time
  // behaviour — on every unrelated re-render while the viewer is open.
  const closeVoucherModal = useCallback(() => setVoucherModalOpen(false), []);
  // Issue #464: `role="dialog"`/`aria-modal`/`aria-label` below were already
  // correct, but nothing backed them — Escape did nothing, focus never
  // entered the panel, Tab reached "Descargar" behind the overlay, and
  // closing dropped focus on `<body>`. Same hook `EmergencyCardDialog`
  // already proved (`focus-trap.ts`).
  useModalFocusTrap({
    open: voucherModalOpen,
    onClose: closeVoucherModal,
    panelRef: voucherPanelRef,
  });

  /**
   * The visible TABLE's real source — one backend page per UI page (issue
   * #400, criterio 4/5, "pagina de forma explícita"): correct for free
   * navigation through an arbitrarily large list, since nothing here needs
   * to hold the whole set at once. `pageTotal` is the backend's own count
   * for `activeFilter`, so pagination itself never truncates.
   */
  const [pageItems, setPageItems] = useState<PaymentValidationRequest[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  /**
   * The FULL pending queue, drained (issue #400, criterio 4/5, "drena la
   * paginación completa"): unlike the table above, the "Pendiente X de Y"
   * prev/next navigator and the "Pendientes" pill both need to operate on
   * the WHOLE set, not a window into it — a navigator that stops at
   * whatever page happened to be open would leave every pending request
   * past that point unreachable via "Siguiente", exactly the truncation
   * this fix exists to remove. `fetchAllPaymentValidations` makes as many
   * backend calls as it takes; see its own doc comment.
   */
  const [pendingAll, setPendingAll] = useState<PaymentValidationRequest[]>([]);
  const [pendingAllLoading, setPendingAllLoading] = useState(true);
  const [pendingAllError, setPendingAllError] = useState<string | null>(null);

  /**
   * The other three pills ("Todas", "Aprobados", "Rechazados") do NOT need
   * to drain — the backend's paginated response already carries an accurate
   * `total` for whatever `estadoPago` filter was applied, independent of
   * how many rows a given call actually fetched. One `limit=1` call per
   * pill reads that count without pulling any real rows.
   */
  const [lightTotals, setLightTotals] = useState<{ all: number; validado: number; rechazado: number }>({
    all: 0,
    validado: 0,
    rechazado: 0,
  });
  /**
   * Issue #454, hallazgo menor: `loadLightTotals` used to only log to the
   * console on failure and leave `lightTotals` at its stale/default 0s —
   * indistinguishable from "no hay pagos". Tracked so `filterCounts` can
   * surface `null` (rendered as "—" by `FilterPill`) instead of a bare 0.
   */
  const [lightTotalsError, setLightTotalsError] = useState(false);

  /**
   * The full drained set the search box searches over, for whichever filter
   * OTHER than "pendiente" is active (see `searchSource` below — "pendiente"
   * reuses `pendingAll` instead of draining a second time). Populated only
   * while a search term is actually typed (see the effect below): draining
   * "Todas" on every keystroke-free render would be work most admins never
   * trigger.
   */
  const [searchDrained, setSearchDrained] = useState<PaymentValidationRequest[]>([]);
  const [searchDrainLoading, setSearchDrainLoading] = useState(false);
  const [searchDrainError, setSearchDrainError] = useState<string | null>(null);

  const loadPage = useCallback(async (): Promise<void> => {
    try {
      setPageLoading(true);
      setPageError(null);
      const estadoPago = activeFilter === "all" ? undefined : BACKEND_ESTADO_BY_FILTER[activeFilter];
      const result = await fetchPaymentValidationsPage({
        skip: (page - 1) * PAYMENTS_PAGE_SIZE,
        limit: PAYMENTS_PAGE_SIZE,
        estadoPago,
      });
      setPageItems(result.items);
      setPageTotal(result.total);
    } catch (err) {
      console.error("[payments] fetchPaymentValidationsPage failed", err);
      setPageError("Error al cargar las solicitudes de validación de pago");
    } finally {
      setPageLoading(false);
    }
  }, [activeFilter, page]);

  const loadPendingAll = useCallback(async (): Promise<void> => {
    try {
      setPendingAllLoading(true);
      setPendingAllError(null);
      setPendingAll(await fetchAllPaymentValidations("PENDIENTE_VALIDACION"));
    } catch (err) {
      console.error("[payments] fetchAllPaymentValidations(pendiente) failed", err);
      setPendingAllError("Error al cargar la cola de pendientes");
    } finally {
      setPendingAllLoading(false);
    }
  }, []);

  const loadLightTotals = useCallback(async (): Promise<void> => {
    try {
      const [all, validado, rechazado] = await Promise.all([
        fetchPaymentValidationsPage({ skip: 0, limit: 1 }),
        fetchPaymentValidationsPage({ skip: 0, limit: 1, estadoPago: "APROBADO" }),
        fetchPaymentValidationsPage({ skip: 0, limit: 1, estadoPago: "RECHAZADO" }),
      ]);
      setLightTotals({ all: all.total, validado: validado.total, rechazado: rechazado.total });
      setLightTotalsError(false);
    } catch (err) {
      console.error("[payments] loadLightTotals failed", err);
      setLightTotalsError(true);
    }
  }, []);

  // Gate the fetch on the RESOLVED role — same fix as `/members` and
  // `/dashboard` (issue #319 hallazgo #49). `ProtectedRoute` redirects a
  // non-admin away, but its redirect runs in an effect of its own; a bare
  // mount effect here fired GET /api/payments before that redirect landed.
  const isAdmin = !authLoading && session?.user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    void loadPendingAll();
    void loadLightTotals();
  }, [isAdmin, loadPendingAll, loadLightTotals]);

  useEffect(() => {
    if (!isAdmin) return;
    void loadPage();
  }, [isAdmin, loadPage]);

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  /**
   * The full set the search box searches over for the CURRENTLY ACTIVE
   * filter (issue #400, criterio 4/5 — "drena la paginación completa"):
   * "pendiente" reuses `pendingAll` (already drained unconditionally for
   * the queue navigator below), so it is never drained twice. The other
   * three filters have no standing drained set, so the effect underneath
   * fills `searchDrained` on demand, only while a search term is typed.
   */
  const searchSource = activeFilter === "pendiente" ? pendingAll : searchDrained;
  const searchSourceLoading = activeFilter === "pendiente" ? pendingAllLoading : searchDrainLoading;
  const searchSourceError = activeFilter === "pendiente" ? pendingAllError : searchDrainError;

  /** Bumped by the retry button on a failed drain — included in the effect's
   *  deps below purely to force a re-run on demand, its value is unused. */
  const [searchDrainRetryToken, setSearchDrainRetryToken] = useState(0);

  const loadSearchDrain = useCallback(async (): Promise<void> => {
    if (activeFilter === "pendiente") return; // reuses `pendingAll` — nothing to fetch.
    try {
      setSearchDrainLoading(true);
      setSearchDrainError(null);
      const estadoPago = activeFilter === "all" ? undefined : BACKEND_ESTADO_BY_FILTER[activeFilter];
      setSearchDrained(await fetchAllPaymentValidations(estadoPago));
    } catch (err) {
      console.error("[payments] search drain failed", err);
      setSearchDrainError("Error al buscar en la cola completa");
    } finally {
      setSearchDrainLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    if (!isAdmin || !isSearching) return;
    void loadSearchDrain();
    // `searchDrainRetryToken` intentionally forces a re-run without being
    // read inside — see its own declaration.
  }, [isAdmin, isSearching, loadSearchDrain, searchDrainRetryToken]);

  const searchMatches = useMemo(
    () => searchSource.filter((r) => r.studentName.toLowerCase().includes(normalizedQuery)),
    [searchSource, normalizedQuery],
  );

  // Not searching: the table IS the server page, paginated EXPLICITLY
  // (`loadPage`, one real backend call per UI page — issue #400, criterio
  // 4/5). Searching: the table is a CLIENT-side page over the fully
  // DRAINED set that matches the query — the other half of that same
  // criterion ("drena la paginación completa o pagina de forma explícita").
  // Either way nothing is ever silently cut at 200.
  const visibleItems = isSearching ? paginatePaymentRequests(searchMatches, page) : pageItems;
  const visibleTotal = isSearching ? searchMatches.length : pageTotal;
  const visibleLoading = isSearching ? searchSourceLoading : pageLoading;
  const visibleError = isSearching ? searchSourceError : pageError;

  // `pageItems`/`pendingAll`/`searchDrained` together cover every source a
  // `selectedId` can come from: a click on a visible row (`pageItems` while
  // browsing, `searchDrained`/`pendingAll` while searching — see
  // `visibleItems` above), or the queue navigator's prev/next, which always
  // points into `pendingAll`.
  const selectedRequest = useMemo(
    () =>
      pageItems.find((r) => r.id === selectedId)
      ?? pendingAll.find((r) => r.id === selectedId)
      ?? searchDrained.find((r) => r.id === selectedId)
      ?? null,
    [pageItems, pendingAll, searchDrained, selectedId],
  );

  /**
   * Every per-request bit of local state resets when the request changes —
   * including on auto-advance. A checklist inherited from the previous payment
   * would be exactly the failure the checklist exists to prevent.
   */
  useEffect(() => {
    setChecked({});
    setExceptionReason("");
    setShowRejectForm(false);
    setRejectionReasonKey("");
    setRejectionNote("");
    setPreviewUnavailable(false);
    setVoucherModalOpen(false);
  }, [selectedId]);

  // Reset to page 1 whenever the filter or the search changes, so the
  // paginator never gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [activeFilter, normalizedQuery]);

  const totalPages = useMemo(() => getTotalPages(visibleTotal), [visibleTotal]);

  // `pendingAll` IS the pending queue already — drained whole, never a
  // window into it (issue #400, criterio 4/5): the "Pendientes" pill counts
  // it directly, and the prev/next navigator below walks it directly, so
  // neither can stop short of the real last pending request. The other
  // three pills read the backend's own `total` for their filter — accurate
  // without draining, since a count needs `total`, not every row.
  const pending = pendingAll;
  // Issue #454, hallazgo menor: `null` (not 0) while the count behind a pill
  // failed to load — `pendingAllError` already existed for the "Pendientes"
  // queue; the other three share one flag since one call
  // (`loadLightTotals`) fetches all three totals together.
  const filterCounts: Record<FilterKey, number | null> = {
    all: lightTotalsError ? null : lightTotals.all,
    pendiente: pendingAllError ? null : pendingAll.length,
    validado: lightTotalsError ? null : lightTotals.validado,
    rechazado: lightTotalsError ? null : lightTotals.rechazado,
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
  /** Issue #459: a TRANSFERENCIA with nothing attached also needs a
   *  non-blank exception reason before "Aprobar pago" unlocks — the
   *  checklist's checkboxes alone were pure self-attestation, with no gate
   *  that actually required evidence. */
  const needsExceptionReason = requiresExceptionReason(
    checklist.kind,
    Boolean(selectedRequest?.proofPreviewUrl),
  );
  const checklistComplete =
    remainingChecks === 0 && (!needsExceptionReason || exceptionReason.trim().length > 0);

  /**
   * Issue #400 supersedes issue #314 K6 hallazgos #11/#46. Those hallazgos
   * were about a "Período de vigencia" editor that let the admin pick a
   * different end date than what the member requested — the danger was a
   * silent MISMATCH between the two. That editor, and the question it
   * asked ("does the vigencia about to be saved match what was
   * requested?"), no longer exist: Administración cannot edit
   * `fecha_inicio`/`fecha_fin` at approval time at all (#400's rule).
   * Approval now always uses exactly what the month-based engine derived
   * at registration (`registrar_pago`) — by construction, there is nothing
   * left to compare against.
   */

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

  /**
   * Mirrors `updated` into the server-paginated `pageItems` (issue #400,
   * criterio 4/5): a plain `.map()` alone would leave an approved/rejected
   * row sitting in a "Pendientes" page with a badge that no longer matches
   * the tab — status filtering moved server-side, into `loadPage`'s
   * `estadoPago`, so nothing else would make the row disappear from view.
   * This restores the "the queue moves immediately" promise `decide()`'s
   * own doc comment describes, without waiting on a real refetch. It is a
   * LOCAL approximation, not the source of truth — `pageTotal` is not
   * adjusted, so it can read one high until the next real `loadPage()` (a
   * filter change, a page change, or simply reopening the screen)
   * reconciles it.
   */
  function applyToPageItems(updated: PaymentValidationRequest): void {
    setPageItems((prev) => {
      const mapped = prev.map((r) => (r.id === updated.id ? updated : r));
      if (activeFilter !== "all" && updated.validationStatus !== activeFilter) {
        return mapped.filter((r) => r.id !== updated.id);
      }
      return mapped;
    });
  }

  /**
   * Same mirroring, for the DRAINED `pendingAll` (issue #400, criterio
   * 4/5): the queue navigator and the "Pendientes" pill both read it
   * directly, so a decision has to leave it consistent too, immediately —
   * a payment that just left PENDIENTE_VALIDACION must stop being a
   * candidate for "Siguiente" and stop counting toward the pill in the same
   * tick the table's own optimistic update lands, not one real drain later.
   */
  function applyToPendingAll(updated: PaymentValidationRequest): void {
    setPendingAll((prev) => {
      const mapped = prev.map((r) => (r.id === updated.id ? updated : r));
      if (updated.validationStatus !== "pendiente") {
        return mapped.filter((r) => r.id !== updated.id);
      }
      return mapped;
    });
  }

  function applyDecision(updated: PaymentValidationRequest): void {
    applyToPageItems(updated);
    applyToPendingAll(updated);
    setSelectedId(getAutoAdvanceId(pendingBeforeDecision.current, updated.id));
  }

  /**
   * Decide for real, send for real — issue #456.
   *
   * This used to declare success and move the queue SYNCHRONOUSLY, before the
   * real `PUT` even existed on the wire (it was held for a few seconds by
   * `useDeferredCommit`, so "Deshacer" could still mean something).
   * Reproduced live, twice, under two different triggers:
   * `browser_network_requests` showed zero PUT/PATCH requests in flight at
   * the instant the success toast was already visible; and on a dropped
   * connection during the held commit, the write could land server-side
   * while the client only ever saw a network error. A product decision
   * settled the fix: the UI never asserts an approval/rejection the server
   * hasn't confirmed.
   *
   * So the hold is gone. The confirm dialog (approve) or the reason form
   * itself (reject) is now the ONLY cancel-before-send step — requirement
   * #456 explicitly allows retiring "deshacer diferido" once it becomes
   * redundant with an existing pre-send confirmation, and it does here. The
   * request fires the moment the admin confirms; `actionLoading` (already
   * wired into the two buttons' disabled state and "Procesando…" label, just
   * never set until now) is the honest in-flight indicator. The queue only
   * moves, and the toast only fires, once the real response lands.
   *
   * A failure — 400/409 conflict, timeout, dropped connection — does not
   * mean "nothing happened": the mutation may have reached the server
   * anyway. So `onFailure` always re-fetches the payment's REAL state
   * (`fetchPaymentValidationById`) before telling the admin anything. If
   * that confirms the decision landed after all, the admin is told the
   * truth (a delayed confirmation, not a fabricated failure) instead of a
   * "no se pudo" that contradicts what the server actually holds. If it
   * confirms the payment is still pending, the admin sees the real error
   * (via `toUserMessage`, never a hardcoded string) and a way to retry —
   * this never happened before either, since the old flow only had a dead
   * end.
   */
  async function decide(
    request: PaymentValidationRequest,
    loadingKey: "approve" | "reject",
    dto: Parameters<typeof updatePaymentValidation>[1],
    confirmation: { label: string; message: string; failure: string },
  ): Promise<void> {
    pendingBeforeDecision.current = pending;
    setActionLoading(loadingKey);
    try {
      const saved = await updatePaymentValidation(request.id, dto);
      applyDecision(saved);
      showSuccess(confirmation.message);
      // The other two pills ("Aprobados"/"Rechazados") only read an
      // accurate `total` after a real fetch — same "can read one high
      // until reconciled" posture `pageTotal` already documents above, now
      // settled for real.
      void loadLightTotals();
      // The decision itself (`saved.validationStatus`) is final and real
      // even when this is true — only the in-app notification failed. This
      // is a SEPARATE, honest follow-up: the admin needs to know the notice
      // didn't reach the student/guardian, not just see a silent success
      // (hallazgo en vivo, 2026-08-11).
      if (saved.notificationDeliveryFailed) {
        showWarning(`${confirmation.label}: la decisión se guardó, pero el aviso no llegó.`, {
          description: `${request.studentName} no recibió la notificación in-app. Si hace falta, avísele directamente.`,
        });
      }
    } catch (err: unknown) {
      console.error("[payments] decision failed", err);
      await reportRealOutcomeAfterFailure(request, loadingKey, dto, confirmation, err);
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * After a failed/timed-out mutation, learn the truth before saying
   * anything (issue #456, requisito 3): re-fetch the payment instead of
   * assuming "it failed" or "it succeeded".
   */
  async function reportRealOutcomeAfterFailure(
    request: PaymentValidationRequest,
    loadingKey: "approve" | "reject",
    dto: Parameters<typeof updatePaymentValidation>[1],
    confirmation: { label: string; message: string; failure: string },
    err: unknown,
  ): Promise<void> {
    let real: PaymentValidationRequest | null = null;
    try {
      real = await fetchPaymentValidationById(request.id);
    } catch (checkErr: unknown) {
      console.error("[payments] could not re-check the real payment state", checkErr);
    }

    if (real && real.validationStatus !== "pendiente") {
      // The write landed anyway — a ghost write on a dropped connection, or
      // another tab/admin got there first with the same outcome. Either way
      // the server's own record is now the truth, so sync to it and say so
      // honestly instead of contradicting the server with a fake failure.
      applyDecision(real);
      void loadLightTotals();
      showWarning(`${confirmation.label}: se confirmó, aunque la conexión falló.`, {
        description: `${request.studentName}: el cambio sí se guardó en el servidor.`,
      });
      return;
    }

    // Either the re-check confirms the payment is still pending, or the
    // re-check itself failed and there is nothing to trust either way — in
    // both cases this is a real, retriable failure, never a silent "maybe".
    showError(toUserMessage(err, confirmation.failure), {
      description: real
        ? `${request.studentName} sigue en la cola de pendientes.`
        : `${request.studentName}: no se pudo confirmar el estado real. Actualice la página antes de reintentar.`,
      action: {
        label: "Reintentar",
        onAction: () => void decide(request, loadingKey, dto, confirmation),
      },
    });
  }

  function handleApprove(): void {
    if (!selectedRequest || !checklistComplete) return;
    const request = selectedRequest;

    // `exceptionReason` only travels when this approval actually needs it
    // (issue #459) — sending it unconditionally would ask the BFF/backend
    // to ignore a value that means nothing for an ordinary approval.
    void decide(
      request,
      "approve",
      needsExceptionReason
        ? { action: "approved", exceptionReason: exceptionReason.trim() }
        : { action: "approved" },
      {
        label: `Aprobación de ${request.studentName}`,
        message: "Pago aprobado. La membresía ahora está activa.",
        failure: "No se pudo aprobar el pago.",
      },
    );
  }

  function handleRejectSubmit(): void {
    if (!selectedRequest) return;
    const rejectionReason = composeRejectionReason(rejectionReasonKey, rejectionNote);
    if (!rejectionReason) return;
    const request = selectedRequest;

    void decide(request, "reject", { action: "rejected", rejectionReason }, {
      label: `Rechazo de ${request.studentName}`,
      message: "Pago rechazado. Se le avisó al responsable con el motivo elegido.",
      failure: "No se pudo rechazar el pago.",
    });
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  /**
   * The action cluster at the end of a queue row — Sonar duplication
   * follow-up (issue #400): this was IDENTICAL, token for token, between
   * the desktop `<TableRow>` and the mobile `<li>` card below (the "same
   * rows as cards" pattern the file's own comment already names) — the
   * status badge (only under the "Todas" tab) plus the button that opens
   * the detail. The two renderings still differ in their surrounding
   * container (a `<TableCell>` vs a plain `<div>`, since a table row and a
   * card are genuinely different DOM shapes), so only this inner cluster
   * — the part that was actually copy-pasted — moved out.
   */
  function renderRowActions(req: PaymentValidationRequest): React.ReactElement {
    return (
      <>
        {/* Estado now has a dedicated column: the active tab already
            filters to one status, so repeating it per row would only echo
            the tab. Under "Todas" it is the one thing on the row that says
            what state a payment is in. */}
        {/* Estado is rendered in its dedicated column. */ false && (
          <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
            {VALIDATION_STATUS_LABELS[req.validationStatus]}
          </Badge>
        )}
        {/* LA REGLA DEL ROJO ÚNICO. This was `primary` for every pending row,
            and the default tab IS the pending queue: ten red buttons down one
            column. "Nunca hay dos botones rojos en una pantalla" — the real
            decision is "Aprobar pago" inside the detail, so this stays the
            neutral action that leads to it, not a second red. */}
        <Button
          size="sm"
          aria-label={actionLabel(req)}
          data-payment-action={req.id}
          onClick={() => setSelectedId(req.id)}
        >
          {req.validationStatus === "pendiente" ? "Revisar" : "Detalle"}
        </Button>
      </>
    );
  }

  function renderQueue(): React.ReactElement {
    return (
      <>
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
          // while carrying exactly the caveat it is for.
          //
          // Issue #400 (criterio 4/5): nothing on this screen caps at 200
          // anymore. The table pagina de forma explícita — each page is its
          // own real backend fetch (`loadPage`). The "Pendientes" pill and
          // the queue navigator drenan la paginación completa
          // (`fetchAllPaymentValidations`, `pendingAll`). The other three
          // pills read the backend's own `total` per filter (`loadLightTotals`).
          // The search box drains the active filter's full set before
          // matching. The old "esta cola trae hasta 200 solicitudes"
          // sentence described a real cap that no longer exists anywhere on
          // this page, so it was removed rather than left to mislead.
          help={
            <ContextualHelp title="Ayuda sobre el alcance de la cola">
              {/* #315 hallazgo #45: esta era la única ayuda de la cola y solo
                  hablaba del tope técnico de la consulta — nunca de en qué
                  consiste el trabajo que el administrador vino a hacer acá.
                  El primer párrafo dice eso. */}
              <p>
                Validar un pago es revisar lo que la familia declaró — monto, período y comprobante
                cuando corresponde — antes de decidir. Aprobar activa la membresía del período
                pagado; rechazar le pide a la familia un comprobante nuevo.
              </p>
            </ContextualHelp>
          }
        />

        {visibleLoading && <LoadingState label="Cargando solicitudes…" />}

        {visibleError && !visibleLoading && (
          <ErrorState
            message={visibleError}
            onRetry={() => {
              if (!isSearching) {
                void loadPage();
              } else if (activeFilter === "pendiente") {
                void loadPendingAll();
              } else {
                setSearchDrainRetryToken((t) => t + 1);
              }
            }}
          />
        )}

        {!visibleLoading && !visibleError && visibleItems.length === 0 && (
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

        {!visibleLoading && !visibleError && visibleItems.length > 0 && (
          <ResponsiveList
            breakpoint="md"
            order="tableFirst"
            tableTestId="payments-table"
            cardsTestId="payments-cards"
            items={visibleItems}
            getKey={(req) => req.id}
            columns={[
              <TableHeaderCell key="estudiante" type="text">Estudiante</TableHeaderCell>,
              <TableHeaderCell key="periodo" type="text">Período</TableHeaderCell>,
              <TableHeaderCell key="monto" type="number">Monto</TableHeaderCell>,
              <TableHeaderCell key="metodo" type="text">Método</TableHeaderCell>,
                  <TableHeaderCell key="estado" type="text">Estado</TableHeaderCell>,
              <TableHeaderCell key="accion" type="action">
                <span className="sr-only">Acción</span>
              </TableHeaderCell>,
            ]}
            renderRow={(req) => {
              const desktopNameId = `payment-name-desktop-${req.id}`;
              const fields = buildRowFields(req);
              return (
                <TableRow>
                  <TableNameCell
                    name={<span id={desktopNameId}>{fields.studentName}</span>}
                    sub={fields.payer}
                  />
                  <TableCell type="text">{fields.period}</TableCell>
                  <TableCell type="number">{fields.amount}</TableCell>
                  <TableCell type="text">{fields.method}</TableCell>
                      <TableCell type="text">
                        <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                          {VALIDATION_STATUS_LABELS[req.validationStatus]}
                        </Badge>
                      </TableCell>
                  <TableCell type="action">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {renderRowActions(req)}
                    </div>
                  </TableCell>
                </TableRow>
              );
            }}
            renderCard={(req) => {
              const mobileNameId = `payment-name-mobile-${req.id}`;
              const fields = buildRowFields(req);
              return (
                <li className="flex flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <p id={mobileNameId} className="truncate text-sm font-semibold text-ink">
                      {fields.studentName}
                    </p>
                    <p className="truncate text-2xs tracking-flat text-ink-3">{fields.payer}</p>
                  </div>
                  <p className="text-xs text-ink-2">
                    {fields.period} · {fields.method}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                          <DataBox variant="numeric">{fields.amount}</DataBox>
                          <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                            {VALIDATION_STATUS_LABELS[req.validationStatus]}
                          </Badge>
                        </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {renderRowActions(req)}
                    </div>
                  </div>
                </li>
              );
            }}
            pagination={{
              page,
              totalPages,
              onPageChange: setPage,
              totalItems: visibleTotal,
              pageSize: PAYMENTS_PAGE_SIZE,
              itemNoun: "solicitud",
              itemNounPlural: "solicitudes",
            }}
          />
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

              {/* Issue #510: the three former cards (Detalle / Antes de
                  aprobar / Decisión) are one panel now — a single `.card`
                  shell, its zones separated by `border-t` rules and internal
                  labels instead of independent borders/shadows per card.
                  Nothing about the checklist, the approval/rejection logic,
                  or the API calls below changed — only the container. */}
              {isPending && (
                <section aria-labelledby="antes-de-aprobar" className="border-t border-line">
                  <div className="flex items-center gap-3 border-b border-line px-[18px] py-4">
                    <h2 id="antes-de-aprobar" className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink">
                      Antes de aprobar
                    </h2>
                    <Badge tone={checklistComplete ? "ok" : "warn"}>
                      {checklist.items.length - remainingChecks} de {checklist.items.length}
                    </Badge>
                  </div>
                  {/* `checklist.note` ya no se dibuja acá. Explica POR QUÉ esta
                      lista trae estas preguntas y no otras — procedimiento, no
                      dato — y se mudó, entera, al desplegable «Cómo se decide» de
                      la tarjeta de Decisión, junto al aviso del deshacer: los dos
                      contestan la misma pregunta, y contestarla en dos lugares
                      distintos era parte del amontonamiento que el dueño leyó
                      como «demasiado».

                      Cuánto texto saca de acá depende del caso, y en el más
                      común no saca ninguno: `buildApprovalChecklist` solo pone
                      `note` cuando el pago es en efectivo o cuando es una
                      transferencia SIN comprobante adjunto. Una transferencia
                      CON comprobante — la que llena esta cola — nunca trajo
                      nota, así que en esa tarjeta lo que se aliviana es el
                      encabezado, no la prosa.
                      Los checkboxes se quedan enteros: son los que habilitan el
                      botón de aprobar. */}
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
                <div className="border-t border-line">
                {/* El título y su desplegable comparten fila. El desplegable
                    junta el procedimiento de LA DECISIÓN —por qué la lista de
                    verificación trae estas preguntas, cuando hay nota que lo
                    diga, y qué pasa después de aprobar— y deja a la vista solo
                    lo que es dato o riesgo.

                    No junta el procedimiento de toda la pantalla, y no es la
                    intención que lo haga: el alcance de la cola se explica en
                    su propia ayuda, arriba de la lista, y lo que implica
                    rechazar lo dice el aviso del formulario de rechazo, unas
                    líneas más abajo. Cada explicación vive pegada a la
                    decisión que explica; juntarlas acá sería el amontonamiento
                    otra vez, con otra dirección.
                    En modo rechazo este desplegable no se ofrece: lo que
                    explica adentro es del camino de aprobación, y un
                    desplegable que contesta otra pregunta es peor que
                    ninguno. */}
                <div className="flex items-center justify-between gap-3 border-b border-line px-[18px] py-4">
                  <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Decisión</h2>
                  {!showRejectForm && (
                    <ContextualHelp title="Cómo se decide">
                      {checklist.note && <p className="text-xs text-ink-2">{checklist.note}</p>}
                      <p className="text-xs text-ink-2">
                        Aprobar se envía de inmediato y activa la membresía; esta acción no se
                        puede deshacer una vez confirmada. Revise el comprobante antes de confirmar.
                      </p>
                    </ContextualHelp>
                  )}
                </div>

                <div className="flex flex-col gap-3 px-[18px] py-4">
                {!showRejectForm ? (
                  <>
                    {/* No editable "Período de vigencia" here (issue #400):
                        Administración cannot edit `fecha_inicio`/`fecha_fin`
                        at approval — the coverage the engine derived at
                        registration is already shown, read-only, in the
                        "Período" field above (`request.membershipPeriod`).
                        Approving confirms that period; it is never a value
                        this screen lets the admin change. */}
                    {/* Issue #459: aprobar una transferencia sin comprobante
                        es la excepción auditada, no un camino silencioso —
                        el motivo es tan obligatorio para desbloquear
                        "Aprobar pago" como cada checkbox de la lista de
                        arriba (ver `checklistComplete`). Vive acá, pegado al
                        botón que desbloquea, en vez de mezclado entre los
                        checkboxes: los checkboxes confirman hechos ya
                        verificados, esto es la justificación en texto de
                        POR QUÉ se aprueba sin la evidencia habitual. */}
                    {needsExceptionReason && (
                      <label className="flex flex-col gap-1.5">
                        <span className="flex items-baseline justify-between text-2xs font-bold uppercase text-ink-3">
                          <span>
                            Motivo de la excepción (transferencia sin comprobante){" "}
                            <span className="text-state-bad">*</span>
                          </span>
                          <span
                            className={`font-normal normal-case tabular-nums ${
                              exceptionReason.length >= EXCEPTION_REASON_MAX_LENGTH
                                ? "text-state-bad"
                                : ""
                            }`}
                          >
                            {exceptionReason.length}/{EXCEPTION_REASON_MAX_LENGTH}
                          </span>
                        </span>
                        <textarea
                          rows={2}
                          value={exceptionReason}
                          onChange={(e) =>
                            setExceptionReason(e.target.value.slice(0, EXCEPTION_REASON_MAX_LENGTH))
                          }
                          maxLength={EXCEPTION_REASON_MAX_LENGTH}
                          placeholder="Ej.: se verificó el depósito directamente en la cuenta del club el 18/08."
                          className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
                          disabled={actionLoading !== null}
                        />
                      </label>
                    )}
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
                    {/* El aviso del deshacer se movió al desplegable «Cómo se
                        decide», arriba en el encabezado de esta misma tarjeta.

                        Esto matiza el issue #314 (K6 hallazgo #17), que lo
                        había traído desde /ayuda porque allá estaba «a dos
                        clics y otra pantalla» del botón que lo necesita. Lo que
                        ese issue pedía sigue en pie: el dato está en la MISMA
                        tarjeta que el botón, a un clic que no navega ni pierde
                        el contexto. Lo que cambia es que ya no compite por la
                        mirada con la fecha de vigencia y el contador de puntos,
                        que es lo que el dueño leyó como «demasiado texto».

                        Lo que NO se plegó, a propósito: la línea de puntos
                        faltantes. Es estado, no procedimiento — se lee sin
                        abrir nada. (La alerta de vigencia divergente que
                        vivía acá se fue con el editor de "Período de
                        vigencia": issue #400 le saca a administración la
                        posibilidad de tipear la fecha al aprobar, así que ya
                        no hay nada que pueda divergir del período pedido.) */}
                    {!checklistComplete && (
                      <p className="text-xs text-ink-3">
                        {remainingChecks > 0 && needsExceptionReason
                          ? `Faltan ${remainingChecks} puntos de la lista y el motivo de la excepción para poder aprobar.`
                          : remainingChecks > 0
                          ? remainingChecks === 1
                            ? "Falta confirmar 1 punto de la lista para poder aprobar."
                            : `Faltan ${remainingChecks} puntos de la lista para poder aprobar.`
                          : "Falta indicar el motivo de la excepción para poder aprobar."}
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
                </div>
              </div>
              )}
            </section>

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

            {/* Comprobante oficial + correcciones (issue #400, criterios 7/8):
                solo para un pago YA validado — `corregir_pago` exige un pago
                APROBADO, y el comprobante oficial por construcción no existe
                hasta que se aprobó. `Number(request.id)` es seguro: el id
                siempre llega como un `Pago.id` numérico serializado a
                string (ver `PaymentValidationRequest.id`). */}
            {request.validationStatus === "validado" && (
              <PagoCorreccionSection
                pagoId={Number(request.id)}
                onCorrected={() => void loadPage()}
              />
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
          message="¿Confirma que aprueba este pago? La membresía pasará a activa de inmediato y esta acción no se puede deshacer."
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
              // No `onClick` here: a backdrop with a click-to-close handler
              // reads as an interactive element without keyboard support
              // (Sonar S6848 / jsx-a11y click-events-have-key-events). Escape
              // and the "Cerrar" button — both wired by `useModalFocusTrap`
              // above — already close this dialog by every accessible path;
              // "click outside to close" isn't a requirement from #464 or
              // #465, so the backdrop stays decorative instead of gaining
              // fake button semantics (role/tabIndex/onKeyDown) for a
              // non-essential interaction.
              className="fixed inset-0 z-50 flex items-center justify-center bg-coal/60 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label="Visor de comprobante"
            >
              <div
                ref={voucherPanelRef}
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
                    {PROOF_ATTACHED_LABEL}
                  </p>
                  <button
                    type="button"
                    onClick={closeVoucherModal}
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
