"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { fetchPagosDePersona, type PagoPersona } from "@/services/api";
import { toUserMessage } from "@/lib/error-message";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import {
  describePagoEstado,
  formatPagoMonto,
  pagoFaltaComprobante,
  sortPagosByDate,
  TIPO_PAGO_LABEL,
} from "@/app/student/payments/payments-utils";

interface PaymentHistorySectionProps {
  /**
   * From `lg`, pad a short list with empty placeholder rows up to this many,
   * so a column beside a taller one (the Pagos dialog's actions) does not end
   * in a blank band. Placeholders are decorative and hidden from assistive tech.
   */
  minRows?: number;
  personaId: number;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pagos: PagoPersona[] };

/**
 * (Admin redesign v4) The history is a section of its own in the Pagos dialog:
 * it used to hide behind an unlabelled chevron and fetched lazily on the first
 * open. It is now always visible and fetched when the dialog opens — the dialog
 * is the only place it renders, and an account holds the one persona.
 *
 * Issue #615: the row above this only ever surfaced `student.ultimoPago` —
 * the SINGLE last payment. An admin checking whether a payment rejected two
 * months ago was ever fixed had no way to see it without leaving the members
 * screen. This is the full per-student payment history, read-only, opened
 * from the `PaymentsDialog`.
 *
 * Reuses `describePagoEstado` and its siblings from
 * `student/payments/payments-utils.ts` — the same status vocabulary the
 * student's own `/student/payments` screen already established and tested —
 * instead of introducing a second one for the admin side. The backend
 * endpoint this calls (`GET /membresias/pagos/persona/:id`) already
 * authorizes dueño, representante, OR admin (`listar_pagos_de_persona`,
 * membresia_pago_servicio.py); no backend change was needed for this issue.
 *
 * Loading/error/empty are distinct states — a payment's real
 * `estadoPago` is always what renders; nothing here defaults to a reassuring
 * "validado" while data is missing or still in flight.
 */
export default function PaymentHistorySection({
  personaId,
  minRows = 0,
}: PaymentHistorySectionProps): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  function load(): void {
    setState({ status: "loading" });
    fetchPagosDePersona(String(personaId))
      .then((pagos) => setState({ status: "ready", pagos: sortPagosByDate(pagos) }))
      .catch((err: unknown) => {
        setState({
          status: "error",
          message: toUserMessage(err, "No se pudo cargar el historial de pagos."),
        });
      });
  }

  useEffect(() => {
    load();
    // `load` only reads `personaId`, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  const titleId = `payment-history-${personaId}`;

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
        <History size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Historial de pagos
      </h3>

      {state.status === "loading" && <LoadingState label="Cargando historial…" />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={load} />}
      {state.status === "ready" && state.pagos.length === 0 && (
        <EmptyState title="Todavía no hay pagos registrados." surface="inset" />
      )}
      {state.status === "ready" && state.pagos.length > 0 && (
        <div className="overflow-hidden rounded-ctl border border-line">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[1fr_1.4fr_auto] gap-3 bg-sunken px-3 py-2 text-2xs font-semibold text-ink-3 sm:grid"
          >
            <span>Monto</span>
            <span>Cobertura</span>
            <span>Estado</span>
          </div>
          <ul className="divide-y divide-line">
            {state.pagos.map((pago) => {
              const estado = describePagoEstado(pago.estadoPago);
              const faltaComprobante = pagoFaltaComprobante(pago);
              return (
                <li key={pago.id} className="grid gap-1 px-3 py-2.5 text-xs sm:grid-cols-[1fr_1.4fr_auto] sm:gap-3">
                  <div>
                    <span className="font-bold text-ink">{formatPagoMonto(pago.monto)}</span>
                    <p className="text-2xs text-ink-3">{TIPO_PAGO_LABEL[pago.tipoPago]}</p>
                  </div>
                  <div className="text-2xs text-ink-3">
                    <p>Cubre {formatDateRange(pago.fechaInicio, pago.fechaFin)}</p>
                    <p>
                      Registrado el {formatDate(pago.fechaRegistro)}
                      {pago.estadoPago === "RECHAZADO" && pago.motivoRechazo
                        ? ` · Motivo: ${pago.motivoRechazo}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-1.5 sm:justify-end">
                    <Badge tone={estado.tone}>{estado.label}</Badge>
                    {faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
                  </div>
                </li>
              );
            })}
            {Array.from({ length: Math.max(0, minRows - state.pagos.length) }, (_, index) => (
              <li key={`ghost-${index}`} aria-hidden="true" className="hidden h-[3.375rem] items-center px-3 lg:flex">
                <span className="h-2 w-16 rounded-full bg-sunken" />
                <span className="ml-auto h-2 w-40 rounded-full bg-sunken" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
