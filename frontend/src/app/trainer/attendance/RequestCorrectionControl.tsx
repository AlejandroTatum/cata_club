/**
 * «Pedir corrección» on one closed-list row (QA4 ENT-25).
 *
 * A trainer cannot correct a filed row (the backend is admin-only), so this is
 * the trainer's door: write the right status and a reason, and administration
 * answers. It renders the state of the LATEST request for the row — pending,
 * approved, or rejected with administration's reason — and offers the button
 * only while no request is pending and the 30-day correction window is open.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { CORRECTION_WINDOW_CLOSED_REASON } from "@/app/attendance/attendance-utils";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { createCorrectionRequest, type CorrectionRequest } from "@/services/api";
import type { EstadoAsistencia } from "@/types/domain";
import AttendanceCorrectionDialog from "./AttendanceCorrectionDialog";
import { ATTENDANCE_LABELS, UNMARKED, type SessionStudent } from "./attendance-utils";

interface RequestCorrectionControlProps {
  student: SessionStudent;
  asistenciaId: number;
  withinWindow: boolean;
  /** This row's requests, in any order. */
  requests: readonly CorrectionRequest[];
  onCreated: (request: CorrectionRequest) => void;
}

function latestOf(requests: readonly CorrectionRequest[]): CorrectionRequest | null {
  return requests.reduce<CorrectionRequest | null>((a, b) => (a === null || b.id > a.id ? b : a), null);
}

function OutcomeLine({ request }: { request: CorrectionRequest }): React.ReactElement {
  const wanted = ATTENDANCE_LABELS[request.estadoSolicitado];
  if (request.estado === "PENDIENTE") {
    return (
      <p className="text-xs text-ink-2">
        Corrección pedida: {wanted} · pendiente de administración
      </p>
    );
  }
  if (request.estado === "APROBADA") {
    return <p className="text-xs text-state-ok">Corrección aprobada: {wanted}. Ya figura en la lista.</p>;
  }
  return (
    <p className="text-xs text-state-bad">
      Corrección rechazada: {wanted}.
      {request.motivoResolucion ? ` ${request.motivoResolucion}` : ""}
    </p>
  );
}

export default function RequestCorrectionControl({
  student,
  asistenciaId,
  withinWindow,
  requests,
  onCreated,
}: RequestCorrectionControlProps): React.ReactElement {
  const { showSuccess } = useToast();
  const latest = latestOf(requests);
  const pending = latest?.estado === "PENDIENTE";
  const current: EstadoAsistencia = student.attendance === UNMARKED ? "present" : student.attendance;

  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<EstadoAsistencia>(current);
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog(): void {
    setEstado(current);
    setMotivo("");
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    const trimmed = motivo.trim();
    if (trimmed.length === 0) {
      setError("El motivo es obligatorio.");
      return;
    }
    if (estado === current) {
      setError("Elige un estado distinto del que figura hoy.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await createCorrectionRequest({ asistenciaId, estado, motivo: trimmed });
      onCreated(created);
      setOpen(false);
      showSuccess("Solicitud enviada a administración.");
    } catch (err) {
      console.error("[trainer/attendance] createCorrectionRequest failed", err);
      setError(toUserMessage(err, "No se pudo enviar la solicitud."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {latest && <OutcomeLine request={latest} />}
      {!pending && withinWindow && (
        <Button type="button" variant="secondary" size="sm" onClick={openDialog}>
          Pedir corrección
        </Button>
      )}
      {!pending && !withinWindow && <p className="text-xs text-ink-3">{CORRECTION_WINDOW_CLOSED_REASON}</p>}
      <AttendanceCorrectionDialog
        variant="request"
        open={open}
        studentName={student.name}
        estado={estado}
        onEstadoChange={setEstado}
        motivo={motivo}
        onMotivoChange={setMotivo}
        submitting={submitting}
        error={error}
        onSubmit={() => void handleSubmit()}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
