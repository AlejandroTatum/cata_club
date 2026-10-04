/**
 * Administration's inbox of trainers' correction requests (QA4 ENT-25).
 *
 * A trainer cannot correct a closed list, so they ask; this is where
 * administration answers. Approving applies the audited correction in the
 * backend, rejecting needs a reason the trainer will read. It lists only the
 * PENDING requests and draws nothing when there are none, so the Asistencias
 * screen stays as it was on a quiet day. A failed load also draws nothing: the
 * records below are the screen's purpose, not this garnish.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { ATTENDANCE_LABELS } from "@/app/attendance/attendance-utils";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { formatDate } from "@/lib/format-utils";
import {
  approveCorrectionRequest,
  fetchCorrectionRequests,
  rejectCorrectionRequest,
  type CorrectionRequest,
} from "@/services/api";

interface CorrectionRequestsInboxProps {
  /** Called after a request is approved or rejected, so the page can reload its records. */
  readonly onResolved: () => void;
}

interface RowProps {
  readonly request: CorrectionRequest;
  readonly onResolved: (id: number, approved: boolean) => void;
}

function RequestRow({ request, onResolved }: RowProps): React.ReactElement {
  const { showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function approve(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await approveCorrectionRequest(request.id);
      showSuccess("Corrección aplicada.");
      onResolved(request.id, true);
    } catch (err) {
      console.error("[attendance] approveCorrectionRequest failed", err);
      setError(toUserMessage(err, "No se pudo aprobar la solicitud."));
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (busy) return;
    const trimmed = motivo.trim();
    if (trimmed.length === 0) {
      setError("Indica por qué se rechaza.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rejectCorrectionRequest(request.id, trimmed);
      showSuccess("Solicitud rechazada.");
      onResolved(request.id, false);
    } catch (err) {
      console.error("[attendance] rejectCorrectionRequest failed", err);
      setError(toUserMessage(err, "No se pudo rechazar la solicitud."));
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-line px-[18px] py-3 text-sm last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <b className="font-semibold text-ink">{request.personaNombre}</b>
          <p className="m-0 text-xs text-ink-2">
            {request.horarioEtiqueta} · {formatDate(request.fecha)}
          </p>
          <p className="m-0 text-xs font-semibold text-ink">
            Figura {ATTENDANCE_LABELS[request.estadoActual]} · pide {ATTENDANCE_LABELS[request.estadoSolicitado]}
          </p>
          <p className="m-0 text-ink-2">{request.motivo}</p>
          <p className="m-0 text-xs text-ink-3">Pedido por {request.solicitadoPorNombre}</p>
        </div>
        {!rejecting && (
          <div className="flex flex-none gap-2">
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void approve()}>
              Aprobar
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                setRejecting(true);
              }}
            >
              Rechazar
            </Button>
          </div>
        )}
      </div>

      {rejecting && (
        <div className="flex flex-col gap-2">
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={2}
            aria-label="Motivo del rechazo"
            placeholder="Motivo que verá el entrenador"
            disabled={busy}
            className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
          />
          <div className="flex gap-2">
            <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void reject()}>
              Confirmar rechazo
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setMotivo("");
                setError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 text-xs text-state-bad">
          {error}
        </p>
      )}
    </li>
  );
}

export default function CorrectionRequestsInbox({ onResolved }: CorrectionRequestsInboxProps): React.ReactElement | null {
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);

  useEffect((): (() => void) => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const rows = await fetchCorrectionRequests({ estado: "PENDIENTE" });
        if (!cancelled) setRequests(Array.isArray(rows) ? rows : []);
      } catch (err: unknown) {
        console.error("[attendance] fetchCorrectionRequests failed", err);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const handleResolved = useCallback(
    (id: number, approved: boolean): void => {
      setRequests((current) => current.filter((r) => r.id !== id));
      if (approved) onResolved();
    },
    [onResolved],
  );

  if (requests.length === 0) return null;

  const count = requests.length;
  return (
    <section className="card flex flex-col" aria-labelledby="correction-requests-title">
      <header className="flex items-center gap-2 border-b border-line px-[18px] py-3">
        <h2 id="correction-requests-title" className="m-0 text-base font-bold text-ink">
          Solicitudes de corrección
        </h2>
        <span role="img" aria-label={`${count} ${count === 1 ? "solicitud pendiente" : "solicitudes pendientes"}`}>
          <Badge tone="warn">{count}</Badge>
        </span>
      </header>
      <ul className="m-0 flex list-none flex-col p-0">
        {requests.map((request) => (
          <RequestRow key={request.id} request={request} onResolved={handleResolved} />
        ))}
      </ul>
    </section>
  );
}
