"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";
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
  personaId: number;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pagos: PagoPersona[] };

/**
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
 * Collapsed by default and fetched lazily on first open, same contract as
 * the per-row accordion in `student/payments/page.tsx` (issue #513): a
 * `PaymentsDialog` can hold several students at once, and eagerly fetching
 * every one of their full histories on open would be several unwanted round
 * trips. Loading/error/empty are distinct states — a payment's real
 * `estadoPago` is always what renders; nothing here defaults to a reassuring
 * "validado" while data is missing or still in flight.
 */
export default function PaymentHistorySection({
  personaId,
}: PaymentHistorySectionProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });

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

  function toggle(): void {
    const next = !open;
    setOpen(next);
    if (next && state.status === "idle") load();
  }

  const panelId = `payment-history-${personaId}`;

  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-ink"
      >
        <span className="inline-flex items-center gap-1.5">
          <History size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Historial de pagos
        </span>
        {open ? (
          <ChevronUp size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronDown size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div id={panelId} className="mt-2">
          {state.status === "loading" && <LoadingState label="Cargando historial…" />}
          {state.status === "error" && <ErrorState message={state.message} onRetry={load} />}
          {state.status === "ready" && state.pagos.length === 0 && (
            <EmptyState title="Todavía no hay pagos registrados." surface="inset" />
          )}
          {state.status === "ready" && state.pagos.length > 0 && (
            <ul className="flex flex-col gap-2">
              {state.pagos.map((pago) => {
                const estado = describePagoEstado(pago.estadoPago);
                const faltaComprobante = pagoFaltaComprobante(pago);
                return (
                  <li key={pago.id} className="rounded-lg border border-line bg-sunken p-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-ink">{formatPagoMonto(pago.monto)}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={estado.tone}>{estado.label}</Badge>
                        {faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
                      </div>
                    </div>
                    <p className="mt-1 text-2xs text-ink-3">
                      {TIPO_PAGO_LABEL[pago.tipoPago]} · Cubre {formatDateRange(pago.fechaInicio, pago.fechaFin)}
                    </p>
                    <p className="text-2xs text-ink-3">
                      Registrado el {formatDate(pago.fechaRegistro)}
                      {pago.estadoPago === "RECHAZADO" && pago.motivoRechazo
                        ? ` · Motivo: ${pago.motivoRechazo}`
                        : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
