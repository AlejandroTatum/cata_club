/**
 * Per-row "Corregir" action for the admin's `/attendance` history table
 * (issue #663) — the same correction door the trainer's roster already has
 * (`AttendanceCorrectionRow`, issue #389 slice 4b), reachable directly from
 * the log an admin actually reads instead of only from a live roll call.
 *
 * Reuses `AttendanceCorrectionDialog` (issue #508's shared modal) rather
 * than a second hand-rolled form — this component owns the same business
 * logic `AttendanceCorrectionRow` owns (estado/motivo/submitting/error, the
 * `correctAttendance` call, the in-place patch on success), scoped to one
 * table row instead of one roster list item.
 *
 * Admin-only enforcement is NOT duplicated here: `/attendance` is already
 * `ProtectedRoute allowedRoles={["admin"]}` (see `page.tsx`), so by the
 * time this ever renders the caller is already an admin. What this
 * component alone decides is the OTHER half of "can correct" — the 30-day
 * window, read straight off `record.correctable` (issue #663's DTO field,
 * `AsistenciaResponseDTO.correctable`) instead of re-deriving it from
 * `record.fecha` in TypeScript.
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import { correctAttendance } from "@/services/api";
import AttendanceCorrectionDialog from "@/app/trainer/attendance/AttendanceCorrectionDialog";
import { CORRECTION_WINDOW_CLOSED_REASON, type AttendanceRecord } from "./attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";

/** What changed on the record after a successful correction — the shape
 *  `page.tsx` needs to patch its `records` state with. */
export interface AttendanceCorrectionPatch {
  estado: EstadoAsistencia;
  justificativo: string | null;
  estadoJustificativo: boolean | null;
}

interface AttendanceCorrectionActionProps {
  readonly record: AttendanceRecord;
  readonly onCorrected: (recordId: string, patch: AttendanceCorrectionPatch) => void;
}

export default function AttendanceCorrectionAction({
  record,
  onCorrected,
}: AttendanceCorrectionActionProps): React.ReactElement {
  const { showSuccess } = useToast();
  const reasonId = `attendance-correction-closed-${record.id}`;

  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<EstadoAsistencia>(record.estado);
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog(): void {
    setEstado(record.estado);
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

    setSubmitting(true);
    setError(null);
    try {
      const result = await correctAttendance(Number(record.id), {
        estado,
        // Pass through the CURRENT values unchanged — same reason as
        // `AttendanceCorrectionRow`'s own module doc comment: the backend
        // overwrites all three mutable fields together, so omitting these
        // would silently wipe a real justificativo instead of preserving it.
        justificativo: record.justificativo ?? null,
        estadoJustificativo: record.estadoJustificativo ?? null,
        motivo: trimmed,
      });
      setOpen(false);
      onCorrected(record.id, {
        estado: result.asistencia.estado,
        justificativo: result.asistencia.justificativo ?? null,
        estadoJustificativo: result.asistencia.estadoJustificativo ?? null,
      });
      showSuccess("Corrección guardada.");
    } catch (err) {
      console.error("[attendance] correctAttendance failed", err);
      setError(toUserMessage(err, "No se pudo registrar la corrección."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!record.correctable) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Button type="button" variant="secondary" size="sm" disabled aria-describedby={reasonId}>
          Corregir
        </Button>
        <p id={reasonId} className="max-w-[200px] text-balance text-right text-2xs text-ink-3">
          {CORRECTION_WINDOW_CLOSED_REASON}
        </p>
      </div>
    );
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={openDialog}>
        Corregir
      </Button>
      <AttendanceCorrectionDialog
        open={open}
        studentName={record.estudiante}
        estado={estado}
        onEstadoChange={setEstado}
        motivo={motivo}
        onMotivoChange={setMotivo}
        submitting={submitting}
        error={error}
        onSubmit={() => void handleSubmit()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
