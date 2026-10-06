"use client";

/**
 * #1668 — a pending payment, approved or rejected on the member's own page.
 *
 * It calls the same validation endpoint as the `/payments` queue
 * (`PATCH /membresias/pagos/{id}/validar`) with the same typified rejection
 * reasons and the same audited exception for a transfer without voucher
 * (#459): the rules live in `payments-utils` and the backend, not here. What
 * the queue adds on top — the review checklist and the next-payment
 * navigation — belongs to reviewing many payments in a row, not to fixing one.
 */

import { useId, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { validarPago, type PagoPersona } from "@/services/api";
import { formatPagoMonto, TIPO_PAGO_LABEL } from "@/app/student/payments/payments-utils";
import {
  composeRejectionReason,
  EXCEPTION_REASON_MAX_LENGTH,
  rejectionReasonsFor,
  REJECTION_NOTE_MAX_LENGTH,
  requiresExceptionReason,
} from "@/app/payments/payments-utils";
import { describePeriodoPago } from "./members-utils";

interface PagoPendienteRevisionProps {
  pago: PagoPersona;
  /** Called after the payment was approved or rejected, so the page refetches. */
  onResolved: () => void;
}

export default function PagoPendienteRevision({ pago, onResolved }: PagoPendienteRevisionProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const fieldId = useId();
  const kind = pago.tipoPago === "EFECTIVO" ? "efectivo" : "transferencia";
  const needsException = requiresExceptionReason(kind, Boolean(pago.voucherUrl));
  const [exception, setException] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reasonKey, setReasonKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(
    kindOfDecision: "approve" | "reject",
    body: Parameters<typeof validarPago>[1],
    success: string,
  ): Promise<void> {
    setBusy(kindOfDecision);
    setError(null);
    try {
      await validarPago(pago.id, body);
      showSuccess(success);
      onResolved();
    } catch (err) {
      const message = toUserMessage(
        err,
        kindOfDecision === "approve" ? "No se pudo aprobar el pago." : "No se pudo rechazar el pago.",
      );
      setError(message);
      showError(message);
    } finally {
      setBusy(null);
    }
  }

  const rejectionReason = composeRejectionReason(reasonKey, note);

  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-3-strong">Monto</dt>
          <dd className="font-bold text-ink">{formatPagoMonto(pago.monto)}</dd>
        </div>
        <div>
          <dt className="text-ink-3-strong">Método</dt>
          <dd className="text-ink">{TIPO_PAGO_LABEL[pago.tipoPago]}</dd>
        </div>
        <div>
          <dt className="text-ink-3-strong">Período</dt>
          <dd className="text-ink">{describePeriodoPago(pago.fechaInicio, pago.fechaFin)}</dd>
        </div>
        <div>
          <dt className="text-ink-3-strong">Comprobante</dt>
          <dd>
            {pago.voucherUrl ? (
              <a
                href={pago.voucherUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-cata-red underline-offset-2 hover:underline"
              >
                Ver comprobante
                <ExternalLink size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              </a>
            ) : (
              <span className="text-ink-3">{kind === "efectivo" ? "No aplica (efectivo)" : "Sin comprobante"}</span>
            )}
          </dd>
        </div>
      </dl>

      {needsException && !rejecting && (
        <label htmlFor={`${fieldId}-exception`} className="grid gap-1 text-sm text-ink-2">
          Por qué lo apruebas sin comprobante
          <textarea
            id={`${fieldId}-exception`}
            rows={2}
            maxLength={EXCEPTION_REASON_MAX_LENGTH}
            value={exception}
            onChange={(e) => setException(e.target.value)}
            disabled={busy !== null}
            className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink-3"
          />
        </label>
      )}

      {rejecting ? (
        <div className="grid gap-3 rounded-ctl border border-line bg-sunken p-3">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">¿Por qué lo rechazas?</legend>
            {rejectionReasonsFor(kind).map((reason) => (
              <label key={reason.key} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={`${fieldId}-reason`}
                  checked={reasonKey === reason.key}
                  onChange={() => setReasonKey(reason.key)}
                  className="mt-1"
                />
                <span>
                  {reason.label}
                  {reason.description && <span className="block text-xs text-ink-3-strong">{reason.description}</span>}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1 text-sm text-ink-2">
            Nota para el responsable (opcional)
            <textarea
              rows={2}
              maxLength={REJECTION_NOTE_MAX_LENGTH}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy !== null}
              className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink-3"
            />
          </label>
          <p className="text-xs text-ink-2">El responsable recibe este motivo y puede registrar el pago de nuevo.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!rejectionReason || busy !== null}
              onClick={() => void decide("reject", { estadoPago: "RECHAZADO", motivoRechazo: rejectionReason }, "Pago rechazado. Se le avisó al responsable con el motivo elegido.")}
            >
              {busy === "reject" ? "Procesando…" : "Rechazar y avisar"}
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setRejecting(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy !== null || (needsException && !exception.trim())}
            onClick={() =>
              void decide(
                "approve",
                needsException
                  ? { estadoPago: "APROBADO", motivoExcepcionSinComprobante: exception.trim() }
                  : { estadoPago: "APROBADO" },
                "Pago aprobado.",
              )
            }
          >
            {busy === "approve" ? (
              <Loader2 size={ICON.base} className="animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
            )}
            {busy === "approve" ? "Procesando…" : "Aprobar pago"}
          </Button>
          <Button variant="secondary" disabled={busy !== null} onClick={() => setRejecting(true)}>
            Rechazar pago…
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-state-bad">
          {error}
        </p>
      )}
    </div>
  );
}
