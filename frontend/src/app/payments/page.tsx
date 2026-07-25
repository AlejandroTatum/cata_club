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
 *   · The "Lista de Verificación" was static prose the admin had to hold in
 *     memory while looking at the proof in the other column — so a payment
 *     could be approved without ever checking the amount. It is now real
 *     checkboxes, and they gate the button.
 *
 * The stat-card row is gone: the filter pills already carry every one of those
 * four counts, and the surface is allowed one message.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  ShieldCheck,
  XCircle,
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
import {
  paginatePaymentRequests,
  getTotalPages,
  PAYMENTS_PAGE_SIZE,
  humanizePaymentPeriod,
  getPendingRequests,
  findQueueNeighbours,
  getAutoAdvanceId,
  buildApprovalChecklist,
  composeRejectionReason,
  REJECTION_REASONS,
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

/** One row of the 56px detail list (`_sistema.css` `.drow`). */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-drow flex-wrap items-center justify-between gap-2 border-b border-line px-[18px] py-3 last:border-b-0">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">{label}</span>
      <span className="text-[13.5px] font-semibold text-ink">{children}</span>
    </div>
  );
}

function ProofViewer({
  request,
  previewUnavailable,
  onPreviewError,
  onRetryPreview,
}: {
  request: PaymentValidationRequest;
  previewUnavailable: boolean;
  onPreviewError: () => void;
  onRetryPreview: () => void;
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={request.proofPreviewUrl}
            alt="Vista previa del comprobante de pago"
            onError={onPreviewError}
            className="max-h-[420px] w-full object-contain"
          />
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
          <a
            href={request.proofPreviewUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[12.5px] font-semibold text-ink-2 hover:text-ink"
          >
            Ampliar
          </a>
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
  }, [selectedId]);

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

  const checklist = useMemo(
    () => buildApprovalChecklist(formatCurrency(selectedRequest?.expectedAmount ?? 0)),
    [selectedRequest?.expectedAmount],
  );
  const remainingChecks = checklist.filter((item) => !checked[item.key]).length;
  const checklistComplete = remainingChecks === 0;

  /** The pending queue as it stood before the in-flight decision resolves. */
  const pendingBeforeDecision = useRef<PaymentValidationRequest[]>([]);

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
      applyDecision(await updatePaymentValidation(selectedRequest.id, { action: "approved" }));
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
                      <TableNameCell name={req.studentName} sub={payerLabel(req)} />
                      <TableCell>{humanizePaymentPeriod(req.membershipPeriod)}</TableCell>
                      <TableCell align="right" className="font-semibold tabular-nums text-ink">
                        {formatCurrency(req.expectedAmount)}
                      </TableCell>
                      <TableCell>{req.paymentMethod}</TableCell>
                      <TableCell>
                        <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                          {VALIDATION_STATUS_LABELS[req.validationStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="sm"
                          variant={req.validationStatus === "pendiente" ? "primary" : "secondary"}
                          aria-label={actionLabel(req)}
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
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{req.studentName}</p>
                      <p className="truncate text-[11.5px] text-ink-3">{payerLabel(req)}</p>
                    </div>
                    <Badge tone={VALIDATION_STATUS_TONES[req.validationStatus]}>
                      {VALIDATION_STATUS_LABELS[req.validationStatus]}
                    </Badge>
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
              <h2 className="border-b border-line px-[18px] py-4 text-[15px] font-bold text-ink">
                Detalle de la solicitud
              </h2>
              <DetailRow label="Estudiante">{request.studentName}</DetailRow>
              <DetailRow label="Responsable de pago">{payer}</DetailRow>
              <DetailRow label="Período">{humanizePaymentPeriod(request.membershipPeriod)}</DetailRow>
              <DetailRow label="Monto esperado">{formatCurrency(request.expectedAmount)}</DetailRow>
              <DetailRow label="Método">{request.paymentMethod}</DetailRow>
              <DetailRow label="Subido el">{formatDateTime(request.uploadedAt)}</DetailRow>
              <DetailRow label="Membresía">
                <Badge tone={MEMBERSHIP_STATUS_TONES[request.currentMembershipStatus]}>
                  {MEMBERSHIP_STATUS_LABELS[request.currentMembershipStatus]}
                </Badge>
              </DetailRow>
              <DetailRow label="Tipo">{request.membershipType}</DetailRow>
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
                    {checklist.length - remainingChecks} de {checklist.length}
                  </Badge>
                </div>
                <div
                  role="group"
                  aria-labelledby="antes-de-aprobar"
                  className="flex flex-col px-[18px] py-2"
                >
                  {checklist.map((item) => (
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={!checklistComplete || actionLoading !== null}
                        onClick={() => setConfirmApproveOpen(true)}
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
                    {!checklistComplete && (
                      <p className="text-[12.5px] text-ink-3">
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
      </AppShell>
    </ProtectedRoute>
  );
}
