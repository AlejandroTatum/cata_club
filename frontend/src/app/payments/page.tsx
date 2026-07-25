/**
 * Memberships & Payments — Payment validation queue and detail panel (CU012).
 *
 * Implements CU012 "Validar o rechazar comprobante de pago":
 *   1. Admin enters Gestión de Membresías y Pagos.
 *   2. System shows list of proofs pending validation.
 *   3. Admin selects a pending proof.
 *   4. System shows payment request detail, current membership status,
 *      and attached proof file.
 *   5. Admin verifies the payment corresponds to student, period, amount,
 *      and method.
 *   6. Admin approves or rejects with required reason.
 */

"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import BackLink from "@/components/BackLink";
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Filter,
  User,
  Calendar,
  DollarSign,
  FileText,
  CreditCard,
  BadgeCheck,
  AlertTriangle,
  Eye,
  ThumbsUp,
  ThumbsDown,
  ArrowLeft,
  Paperclip,
  Building2,
  Hash,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type {
  PaymentValidationRequest,
  MembershipStatus,
  ValidationStatus,
} from "@/services/api";
import { fetchPaymentValidations, updatePaymentValidation } from "@/services/api";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format-utils";
import { useToast } from "@/contexts/ToastContext";
import { paginatePaymentRequests, getTotalPages } from "@/app/payments/payments-utils";

type FilterKey = "all" | "pendiente" | "validado" | "rechazado";

const filters: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "pendiente", label: "Pendientes" },
  { key: "validado", label: "Validados" },
  { key: "rechazado", label: "Rechazados" },
];

const membershipStatusLabels: Record<MembershipStatus, string> = {
  activa: "Activa",
  vencida: "Vencida",
  suspendida: "Suspendida",
};

const membershipStatusStyles: Record<MembershipStatus, string> = {
  activa: "badge-success",
  vencida: "badge-error",
  suspendida: "badge-error",
};

const validationStatusStyles: Record<ValidationStatus, string> = {
  pendiente: "badge-warning",
  validado: "badge-success",
  rechazado: "badge-error",
};

export default function PaymentsPage(): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [requests, setRequests] = useState<PaymentValidationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [selectedRequest, setSelectedRequest] = useState<PaymentValidationRequest | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectionValidationError, setRejectionValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [page, setPage] = useState(1);

  const loadRequests = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchPaymentValidations();
      setRequests(data);
    } catch (err) {
      console.error("[payments] fetchPaymentValidations failed", err);
      setError("Error al cargar las solicitudes de validación de pago");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    if (actionError) showError(actionError);
  }, [actionError, showError]);

  const filtered =
    activeFilter === "all"
      ? requests
      : requests.filter((r) => r.validationStatus === activeFilter);

  // Reset to page 1 whenever the filter changes, so the paginator never
  // gets stuck on a stale/out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [activeFilter]);

  const totalPages = useMemo(() => getTotalPages(filtered.length), [filtered]);
  const paginatedRequests = useMemo(
    () => paginatePaymentRequests(filtered, page),
    [filtered, page],
  );

  const counts = {
    total: requests.length,
    pending: requests.filter((r) => r.validationStatus === "pendiente").length,
    approved: requests.filter((r) => r.validationStatus === "validado").length,
    rejected: requests.filter((r) => r.validationStatus === "rechazado").length,
  };

  function handleSelect(request: PaymentValidationRequest): void {
    setSelectedRequest(request);
    setShowRejectForm(false);
    setRejectionReason("");
    setRejectionValidationError(null);
    setActionError(null);
    setSuccessMessage(null);
    setPreviewUnavailable(false);
  }

  function handleBack(): void {
    setSelectedRequest(null);
    setShowRejectForm(false);
    setRejectionReason("");
    setRejectionValidationError(null);
    setActionError(null);
    setSuccessMessage(null);
  }

  async function handleApprove(): Promise<void> {
    if (!selectedRequest) return;
    setActionLoading("approve");
    setActionError(null);
    setSuccessMessage(null);
    try {
      const updated = await updatePaymentValidation(selectedRequest.id, {
        action: "approved",
      });
      setRequests((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r)),
      );
      setSelectedRequest(updated);
      setSuccessMessage("Pago aprobado. La membresía ahora está activa.");
      showSuccess("Pago aprobado. La membresía ahora está activa.");
    } catch (err) {
      console.error("[payments] approve failed", err);
      setActionError(
        "Error al aprobar el pago",
      );
    } finally {
      setActionLoading(null);
    }
  }

  function handleRejectClick(): void {
    setShowRejectForm(true);
    setRejectionValidationError(null);
    setActionError(null);
  }

  function handleRejectCancel(): void {
    setShowRejectForm(false);
    setRejectionReason("");
    setRejectionValidationError(null);
  }

  async function handleRejectSubmit(): Promise<void> {
    if (!selectedRequest) return;

    // Client-side validation: rejection reason must not be empty
    if (!rejectionReason.trim()) {
      setRejectionValidationError("El motivo de rechazo es obligatorio.");
      return;
    }

    setActionLoading("reject");
    setActionError(null);
    setRejectionValidationError(null);
    setSuccessMessage(null);
    try {
      const updated = await updatePaymentValidation(selectedRequest.id, {
        action: "rejected",
        rejectionReason: rejectionReason.trim(),
      });
      setRequests((prev) =>
        prev.map((r) => (r.id === updated.id ? updated : r)),
      );
      setSelectedRequest(updated);
      setShowRejectForm(false);
      setSuccessMessage("Pago rechazado. El estado de la membresía se mantiene sin cambios.");
      showSuccess("Pago rechazado. El estado de la membresía se mantiene sin cambios.");
    } catch (err) {
      console.error("[payments] reject failed", err);
      setActionError(
        "Error al rechazar el pago",
      );
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <ProtectedRoute allowedRoles={["admin"]}>
      <AppShell
        eyebrow="Cola de validación"
        title="Membresías y Pagos"
      >
        {!selectedRequest && <BackLink href="/dashboard" label="Volver al Panel" />}

        {/* Stats cards */}
        <div className="mb-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-red/15">
              <ShieldCheck size={20} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
              Total Solicitudes
            </p>
            <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{counts.total}</p>
          </div>
          <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50">
              <Clock size={20} strokeWidth={1.5} className="text-amber-700" aria-hidden="true" />
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
              Pendientes
            </p>
            <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{counts.pending}</p>
          </div>
          <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cata-state-ok/10">
              <CheckCircle2 size={20} strokeWidth={1.5} className="text-cata-state-ok" aria-hidden="true" />
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
              Aprobados
            </p>
            <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{counts.approved}</p>
          </div>
          <div className="card-hover flex items-center gap-3 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50">
              <XCircle size={20} strokeWidth={1.5} className="text-red-700" aria-hidden="true" />
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wider text-cata-text/65">
              Rechazados
            </p>
            <p className="shrink-0 text-2xl font-bold tracking-tight text-cata-text">{counts.rejected}</p>
          </div>
        </div>

        {/* Main content: split layout */}
        {!selectedRequest ? (
          <>
            {/* Filters — must wrap: the heading plus four chips are wider
                than a 390px viewport, and `flex` alone (nowrap) pushed the
                whole page into horizontal scroll. */}
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <Filter size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
              <h2 className="text-lg font-bold text-cata-text mr-2">Filtrar por Estado</h2>
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setActiveFilter(f.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    activeFilter === f.key
                      ? "bg-cata-red/15 text-cata-red"
                      : "bg-cata-bg text-cata-text/65 hover:bg-cata-border/60"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Loading state */}
            {loading && (
              <div className="flex items-center justify-center py-16">
                <div className="flex items-center gap-2">
                  <Clock size={16} strokeWidth={1.5} className="animate-spin text-cata-text/65" aria-hidden="true" />
                  <p className="text-sm text-cata-text/50">Cargando solicitudes...</p>
                </div>
              </div>
            )}

            {/* Error state */}
            {error && !loading && (
              <div className="card border border-red-200 bg-red-50 p-6 text-center">
                <XCircle size={32} strokeWidth={1.5} className="mx-auto mb-3 text-red-700" aria-hidden="true" />
                <p className="text-sm text-cata-red">{error}</p>
                <button
                  type="button"
                  onClick={() => loadRequests()}
                  className="btn-ghost mt-3 text-xs text-cata-red"
                >
                  Reintentar
                </button>
              </div>
            )}

            {/* Empty state */}
            {!loading && !error && filtered.length === 0 && (
              <div className="card flex flex-col items-center py-16 text-center">
                <ShieldCheck
                  size={32}
                  strokeWidth={1.5}
                  className="mb-3 text-cata-text/20"
                  aria-hidden="true"
                />
                <p className="text-sm text-cata-text/50">
                  {activeFilter === "all"
                    ? "Aún no hay solicitudes de validación de pago."
                    : `No hay solicitudes ${activeFilter === "pendiente" ? "pendientes" : activeFilter === "validado" ? "validadas" : "rechazadas"}.`}
                </p>
              </div>
            )}

            {/* Request table */}
            {!loading && !error && filtered.length > 0 && (
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-cata-border bg-cata-bg text-xs font-medium uppercase tracking-wider text-cata-text/65">
                        <th className="px-4 py-3 font-medium">Estudiante</th>
                        <th className="px-4 py-3 font-medium">Responsable de pago</th>
                        <th className="px-4 py-3 font-medium">Período</th>
                        <th className="px-4 py-3 font-medium text-right">Monto</th>
                        <th className="px-4 py-3 font-medium">Método</th>
                        <th className="px-4 py-3 font-medium">Subido</th>
                        <th className="px-4 py-3 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cata-border">
                      {paginatedRequests.map((req) => (
                        <tr
                          key={req.id}
                          onClick={() => handleSelect(req)}
                          className="cursor-pointer transition-colors hover:bg-cata-bg"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <User size={14} strokeWidth={1.5} className="shrink-0 text-cata-text/65" aria-hidden="true" />
                              <span className="font-medium text-cata-text">{req.studentName}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-cata-text/65">
                            {req.responsablePagoName || req.representativeName || (
                              <span className="text-cata-text/30">&mdash;</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-cata-text/65">{req.membershipPeriod}</td>
                          <td className="px-4 py-3 text-right font-medium text-cata-text">
                            {formatCurrency(req.expectedAmount)}
                          </td>
                          <td className="px-4 py-3 text-cata-text/65">{req.paymentMethod}</td>
                          <td className="px-4 py-3 text-xs text-cata-text/40">
                            {formatDateTime(req.uploadedAt)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={validationStatusStyles[req.validationStatus]}>
                              {req.validationStatus === "pendiente" && (
                                <Clock size={12} strokeWidth={2} aria-hidden="true" />
                              )}
                              {req.validationStatus === "validado" && (
                                <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                              )}
                              {req.validationStatus === "rechazado" && (
                                <XCircle size={12} strokeWidth={2} aria-hidden="true" />
                              )}
                              {req.validationStatus === "pendiente"
                                ? "Pendiente"
                                : req.validationStatus === "validado"
                                  ? "Validado"
                                  : "Rechazado"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex flex-col items-center justify-between gap-3 border-t border-cata-border px-4 py-3 sm:flex-row">
                    <p className="text-sm font-semibold text-cata-text">
                      Página {page} de {totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="btn-secondary px-4 py-2 text-xs"
                      >
                        <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                        Anterior
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="btn-secondary px-4 py-2 text-xs"
                      >
                        Siguiente
                        <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          /* Detail Panel */
          <div>
            {/* Back button */}
            <button
              type="button"
              onClick={handleBack}
              className="btn-ghost mb-6 -ml-2 gap-1 text-xs text-cata-text/65"
            >
              <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
              Volver a la lista
            </button>

            {/* Success feedback */}
            {successMessage && (
              <div className="mb-6 flex items-center gap-2 rounded-xl border border-cata-state-ok/30 bg-cata-state-ok/10 px-4 py-3 text-sm text-cata-state-ok">
                <CheckCircle2 size={16} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
                {successMessage}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-5">
              {/* Left: Payment details */}
              <div className="lg:col-span-3 space-y-6">
                {/* Membership status card */}
                <div className="card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <BadgeCheck size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                    <h2 className="text-base font-semibold text-cata-text">Estado de la Membresía</h2>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Estado Actual</p>
                      <span className={`mt-1 inline-flex items-center gap-1.5 ${membershipStatusStyles[selectedRequest.currentMembershipStatus]}`}>
                        {selectedRequest.currentMembershipStatus === "activa" && (
                          <CheckCircle2 size={12} strokeWidth={2} aria-hidden="true" />
                        )}
                        {(selectedRequest.currentMembershipStatus === "vencida" || selectedRequest.currentMembershipStatus === "suspendida") && (
                          <XCircle size={12} strokeWidth={2} aria-hidden="true" />
                        )}
                        {membershipStatusLabels[selectedRequest.currentMembershipStatus]}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Tipo de Membresía</p>
                      <p className="mt-1 text-sm font-medium text-cata-text">{selectedRequest.membershipType}</p>
                    </div>
                  </div>
                </div>

                {/* Payment request detail */}
                <div className="card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <DollarSign size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                    <h2 className="text-base font-semibold text-cata-text">Detalle de Solicitud de Pago</h2>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Estudiante</p>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-cata-text">
                        <User size={14} strokeWidth={1.5} className="shrink-0 text-cata-text/65" aria-hidden="true" />
                        {selectedRequest.studentName}
                      </div>
                    </div>
                    {(selectedRequest.responsablePagoName || selectedRequest.representativeName) && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Responsable de pago</p>
                        <div className="mt-1 flex items-center gap-1.5 text-sm text-cata-text">
                          <Building2 size={14} strokeWidth={1.5} className="shrink-0 text-cata-text/65" aria-hidden="true" />
                          {selectedRequest.responsablePagoName || selectedRequest.representativeName}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Período</p>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-cata-text">
                        <Calendar size={14} strokeWidth={1.5} className="shrink-0 text-cata-text/65" aria-hidden="true" />
                        {selectedRequest.membershipPeriod}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Monto Esperado</p>
                      <div className="mt-1 flex items-center gap-1.5 text-lg font-bold text-cata-text">
                        <DollarSign size={16} strokeWidth={2} className="shrink-0 text-cata-text/65" aria-hidden="true" />
                        {formatCurrency(selectedRequest.expectedAmount)}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Método de Pago</p>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-cata-text">
                        <CreditCard size={14} strokeWidth={1.5} className="shrink-0 text-cata-text/65" aria-hidden="true" />
                        {selectedRequest.paymentMethod}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-cata-text/40">Subido el</p>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-cata-text/65">
                        <Clock size={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
                        {formatDate(selectedRequest.uploadedAt)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Validation criteria */}
                {selectedRequest.validationStatus === "pendiente" && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                    <div className="mb-2 flex items-center gap-2">
                      <AlertTriangle size={14} strokeWidth={1.5} className="text-amber-700" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-amber-700">Lista de Verificación</h3>
                    </div>
                    <ul className="space-y-1 text-sm text-amber-700">
                      <li className="flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-amber-700" />
                        Verifique que el nombre del estudiante corresponda a un miembro registrado
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-amber-700" />
                        Confirme que el período corresponda al ciclo de membresía actual
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-amber-700" />
                        Compruebe que el monto coincida con la cuota de membresía esperada
                      </li>
                      <li className="flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-amber-700" />
                        Verifique que el método de pago sea correcto
                      </li>
                    </ul>
                  </div>
                )}

                {/* Rejection reason (displayed when already rejected) */}
                {selectedRequest.validationStatus === "rechazado" && selectedRequest.rejectionReason && (
                  <div className="card border-red-200 bg-red-50 p-5">
                    <div className="mb-2 flex items-center gap-2">
                      <XCircle size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-cata-red">Motivo de Rechazo</h3>
                    </div>
                    <p className="text-sm text-cata-red/80">{selectedRequest.rejectionReason}</p>
                    {selectedRequest.validatedBy && selectedRequest.validatedAt && (
                      <p className="mt-2 text-xs text-cata-text/65">
                        Rechazado por {selectedRequest.validatedBy} el {formatDate(selectedRequest.validatedAt)}
                      </p>
                    )}
                  </div>
                )}

                {/* Validation metadata */}
                {(selectedRequest.validationStatus === "validado" || selectedRequest.validationStatus === "rechazado") && (
                  <div className="text-xs text-cata-text/40">
                    {selectedRequest.validatedBy && (
                      <p>Validado por: {selectedRequest.validatedBy}</p>
                    )}
                    {selectedRequest.validatedAt && (
                      <p>Fecha de validación: {formatDate(selectedRequest.validatedAt)}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Proof file and actions */}
              <div className="lg:col-span-2 space-y-6">
                {/* Proof file block */}
                <div className="card p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Paperclip size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                    <h2 className="text-base font-semibold text-cata-text">Comprobante de Pago</h2>
                  </div>

                  <div className="mb-4 rounded-xl border-2 border-dashed border-cata-border bg-cata-bg p-6 text-center">
                    {selectedRequest.proofPreviewUrl && !previewUnavailable ? (
                      <div className="relative mx-auto mb-3 h-48 w-full overflow-hidden rounded-lg bg-cata-border/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedRequest.proofPreviewUrl}
                           alt="Vista previa del comprobante de pago"
                          onError={(): void => setPreviewUnavailable(true)}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : selectedRequest.proofPreviewUrl ? (
                      <div role="status" className="space-y-3 text-sm text-cata-text/65">
                        <p>Comprobante no disponible</p>
                        <a href={selectedRequest.proofPreviewUrl} download className="inline-flex font-medium text-cata-red hover:text-cata-red-light">
                          Descargar comprobante
                        </a>
                        <button type="button" onClick={(): void => setPreviewUnavailable(false)} className="block mx-auto text-xs font-medium text-cata-red hover:text-cata-red-light">
                          Reintentar vista previa
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 flex items-center justify-center">
                          <div
                            className={`flex h-16 w-16 items-center justify-center rounded-full ${
                              selectedRequest.proofFileType === "pdf"
                                ? "bg-cata-red/15"
                                : "bg-cata-border/40"
                            }`}
                          >
                            <FileText
                              size={28}
                              strokeWidth={1.5}
                              className={selectedRequest.proofFileType === "pdf" ? "text-cata-red" : "text-cata-text/65"}
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                        <p className="mt-4 text-xs text-cata-text/40">
                          <Eye size={12} strokeWidth={1.5} className="inline-block -mt-0.5 mr-1" aria-hidden="true" />
                          Vista previa no disponible para este tipo de comprobante.
                        </p>
                      </>
                    )}

                    <div className="flex items-center justify-center gap-2">
                      <Hash size={12} strokeWidth={1.5} className="text-cata-text/65" aria-hidden="true" />
                      <span className="text-sm font-medium text-cata-text">
                        {selectedRequest.proofFileName}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-cata-text/65">
                      {selectedRequest.proofFileType === "pdf" ? "Documento PDF" : "Archivo de imagen"}
                    </p>
                  </div>
                </div>

                {/* Actions (only for pending requests) */}
                {selectedRequest.validationStatus === "pendiente" && (
                  <div className="card p-6">
                    <div className="mb-4 flex items-center gap-2">
                      <ShieldCheck size={16} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
                      <h2 className="text-base font-semibold text-cata-text">Acción de Validación</h2>
                    </div>

                    {!showRejectForm ? (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setConfirmApproveOpen(true)}
                          disabled={actionLoading !== null}
                          className="btn-primary w-full bg-cata-state-ok shadow-soft hover:bg-cata-state-ok/90"
                        >
                          {actionLoading === "approve" ? (
                            "Procesando..."
                          ) : (
                            <>
                              <ThumbsUp size={15} strokeWidth={2} aria-hidden="true" />
                              Aprobar Pago
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={handleRejectClick}
                          disabled={actionLoading !== null}
                          className="btn-secondary w-full border-cata-red/30 text-cata-red hover:bg-cata-red/10 hover:border-cata-red/50"
                        >
                          <ThumbsDown size={15} strokeWidth={2} aria-hidden="true" />
                          Rechazar Pago
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div>
                          <label
                            htmlFor="rejection-reason"
                            className="mb-1.5 block text-sm font-medium text-cata-text"
                          >
                            Motivo de Rechazo <span className="text-cata-red">*</span>
                          </label>
                          <textarea
                            id="rejection-reason"
                            rows={3}
                            value={rejectionReason}
                            onChange={(e) => {
                              setRejectionReason(e.target.value);
                              setRejectionValidationError(null);
                            }}
                            placeholder="Explique por qué se rechaza el comprobante de pago..."
                            className="input-field resize-y"
                            disabled={actionLoading !== null}
                          />
                          {rejectionValidationError && (
                            <p className="mt-1 text-xs text-cata-red">{rejectionValidationError}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleRejectSubmit}
                            disabled={actionLoading !== null}
                            className="btn-primary flex-1 shadow-soft"
                          >
                            {actionLoading === "reject" ? (
                              "Procesando..."
                            ) : (
                              "Confirmar Rechazo"
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleRejectCancel}
                            disabled={actionLoading !== null}
                            className="btn-secondary"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Already resolved — show validado/rechazado badge */}
                {selectedRequest.validationStatus !== "pendiente" && (
                  <div className="card p-6 text-center">
                    <div className={`mb-3 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
                      selectedRequest.validationStatus === "validado"
                        ? "bg-cata-state-ok/10 text-cata-state-ok"
                        : "bg-red-50 text-red-700"
                    }`}>
                      {selectedRequest.validationStatus === "validado" ? (
                        <CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <XCircle size={16} strokeWidth={2} aria-hidden="true" />
                      )}
                      {selectedRequest.validationStatus === "validado" ? "Validado" : "Rechazado"}
                    </div>
                    <p className="text-xs text-cata-text/65">
                      Esta solicitud ya ha sido procesada.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirmApproveOpen}
          variant="state-ok"
          title="Aprobar pago"
          message="¿Confirma que aprueba este pago? La membresía pasará a activa."
          onConfirm={() => {
            setConfirmApproveOpen(false);
            handleApprove();
          }}
          onCancel={() => setConfirmApproveOpen(false)}
        />
      </AppShell>
    </ProtectedRoute>
  );
}
