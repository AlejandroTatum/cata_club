/**
 * One row of the closed roster's read-only list, plus the "Corregir" door
 * issue #389 (slice 4b) adds beside it.
 *
 * Extracted out of `page.tsx`'s `renderMarkAttendance` readOnly branch:
 * the row owns three genuinely separate concerns (the static name/badge,
 * the correction form, and the correction history panel), and `page.tsx`
 * is already the largest file in this flow.
 *
 * Issue #508 moved the correction form itself out of the row's own layout
 * and into `AttendanceCorrectionDialog`, a dedicated `role="dialog"` modal —
 * the row no longer pushes every sibling row down the page while one form is
 * open. This is a container change only: the row still owns every bit of the
 * correction's business logic (validation, the API call, the in-place patch
 * on success). `AttendanceCorrectionDialog` renders what this file tells it
 * to and reports back through callbacks; it does not know what a correction
 * is.
 *
 * The correction form asks for `estado` + `motivo` only. `justificativo`/
 * `estadoJustificativo` are NOT exposed here as inputs — the original
 * registration wizard never captures them either (checked: `page.tsx` never
 * mentions them), so this form does not invent new surface for them. It
 * still has to PASS THEM THROUGH unchanged on every submit: the backend's
 * `corregir_asistencia` overwrites all three mutable fields together, as one
 * unit, so omitting them would silently wipe a real justificativo instead of
 * preserving it (see `AsistenciaCorreccionDTO`'s docstring).
 */

"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { getUserInitials } from "@/lib/auth-utils";
import { formatDateTime } from "@/lib/format-utils";
import { getAttendanceBadgeTone, CORRECTION_WINDOW_CLOSED_REASON } from "@/app/attendance/attendance-utils";
import {
  ATTENDANCE_LABELS,
  UNMARKED,
  isWithinCorrectionWindow,
  type SessionStudent,
} from "./attendance-utils";
import AttendanceCorrectionDialog from "./AttendanceCorrectionDialog";
import {
  correctAttendance,
  fetchAttendanceCorrections,
  type AttendanceCorrectionEntry,
  type CorrectAttendanceResult,
} from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";
import type { EstadoAsistencia } from "@/types/domain";

/** What changed on the roster row after a successful correction — the shape
 *  `page.tsx` needs to patch `students` AND `serverRosterRef.current` with,
 *  in the same operation (see that file's `handleRowCorrected`). */
export interface CorrectionPatch {
  attendance: EstadoAsistencia;
  justificativo: string | null;
  estadoJustificativo: boolean | null;
}

interface AttendanceCorrectionRowProps {
  student: SessionStudent;
  /** The session's date ("YYYY-MM-DD") — uniform across the whole roster,
   *  since a session is one horario + one date. Drives the 30-day gate. */
  sessionDate: string;
  /** ADMINISTRADOR-only in the backend (both `/corregir` and
   *  `/correcciones`) — a trainer sees the exact same static row this had
   *  before this slice, with no door that would 403 the moment it's used. */
  canCorrect: boolean;
  onCorrected: (personaId: string, patch: CorrectionPatch) => void;
}

export default function AttendanceCorrectionRow({
  student,
  sessionDate,
  canCorrect,
  onCorrected,
}: AttendanceCorrectionRowProps): React.ReactElement {
  const { showSuccess } = useToast();
  const asistenciaId = student.asistenciaId ?? null;
  const withinWindow = isWithinCorrectionWindow(sessionDate);
  const reasonId = `correccion-vencida-${student.id}`;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [estado, setEstado] = useState<EstadoAsistencia>(
    student.attendance === UNMARKED ? "present" : student.attendance,
  );
  const [motivo, setMotivo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCorrection, setLastCorrection] = useState<CorrectAttendanceResult | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const [history, setHistory] = useState<AttendanceCorrectionEntry[]>([]);

  function openDialog(): void {
    setEstado(student.attendance === UNMARKED ? "present" : student.attendance);
    setMotivo("");
    setError(null);
    setDialogOpen(true);
  }

  async function loadHistory(): Promise<void> {
    if (asistenciaId === null) return;
    setHistoryState("loading");
    try {
      const entries = await fetchAttendanceCorrections(asistenciaId);
      setHistory(entries);
      setHistoryState("idle");
    } catch (err) {
      console.error("[trainer/attendance] fetchAttendanceCorrections failed", err);
      setHistoryState("error");
    }
  }

  function toggleHistory(): void {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) void loadHistory();
  }

  async function handleSubmit(): Promise<void> {
    if (asistenciaId === null || submitting) return;
    const trimmed = motivo.trim();
    if (trimmed.length === 0) {
      setError("El motivo es obligatorio.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await correctAttendance(asistenciaId, {
        estado,
        // Pass through the CURRENT values unchanged — see the module doc
        // comment above for why this can never be omitted.
        justificativo: student.justificativo ?? null,
        estadoJustificativo: student.estadoJustificativo ?? null,
        motivo: trimmed,
      });
      setLastCorrection(result);
      setDialogOpen(false);
      onCorrected(student.id, {
        attendance: result.asistencia.estado,
        justificativo: result.asistencia.justificativo ?? null,
        estadoJustificativo: result.asistencia.estadoJustificativo ?? null,
      });
      showSuccess("Corrección guardada.");
      // A correction just landed — an open history panel showing the OLD
      // trail would contradict what the page just confirmed.
      if (historyOpen) void loadHistory();
    } catch (err) {
      console.error("[trainer/attendance] correctAttendance failed", err);
      setError(toUserMessage(err, "No se pudo registrar la corrección."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-ctl border border-line-2 bg-paper px-[13px] py-2">
      <div className="flex min-h-8 flex-wrap items-center gap-[11px]">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-2xs tracking-flat font-bold text-state-neutral"
        >
          {getUserInitials(student.name)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{student.name}</span>
        {student.attendance !== UNMARKED && (
          <Badge tone={getAttendanceBadgeTone(student.attendance)} className="flex-none">
            {ATTENDANCE_LABELS[student.attendance as EstadoAsistencia]}
          </Badge>
        )}
        {canCorrect && asistenciaId !== null && (
          <button
            type="button"
            onClick={toggleHistory}
            aria-expanded={historyOpen}
            className="flex-none text-xs font-semibold text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            {historyOpen ? "Ocultar historial" : "Ver historial"}
          </button>
        )}
        {canCorrect && asistenciaId !== null && withinWindow && (
          <Button type="button" variant="secondary" size="sm" onClick={openDialog}>
            Corregir
          </Button>
        )}
        {canCorrect && asistenciaId !== null && !withinWindow && (
          <Button type="button" variant="secondary" size="sm" disabled aria-describedby={reasonId}>
            Corregir
          </Button>
        )}
      </div>

      {canCorrect && asistenciaId !== null && !withinWindow && (
        <p id={reasonId} className="text-xs text-ink-3">
          {CORRECTION_WINDOW_CLOSED_REASON}
        </p>
      )}

      {canCorrect && (
        <AttendanceCorrectionDialog
          open={dialogOpen}
          studentName={student.name}
          estado={estado}
          onEstadoChange={setEstado}
          motivo={motivo}
          onMotivoChange={setMotivo}
          submitting={submitting}
          error={error}
          onSubmit={() => void handleSubmit()}
          onCancel={() => setDialogOpen(false)}
        />
      )}

      {lastCorrection && (
        <p className="text-xs text-ink-2">
          Corregido por {lastCorrection.corregidoPorNombre} el {formatDateTime(lastCorrection.corregidoEn)} ·
          antes: {ATTENDANCE_LABELS[lastCorrection.estadoAnterior]} · motivo: {lastCorrection.motivo}
        </p>
      )}

      {historyOpen && (
        <div className="rounded-ctl border border-line bg-canvas p-2">
          {historyState === "loading" && <p className="text-xs text-ink-3">Cargando historial…</p>}
          {historyState === "error" && (
            <p role="alert" className="text-xs text-state-bad">
              No se pudo cargar el historial de correcciones.
            </p>
          )}
          {historyState === "idle" && history.length === 0 && (
            <p className="text-xs text-ink-3">Sin correcciones previas.</p>
          )}
          {historyState === "idle" && history.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {history.map((entry) => (
                <li key={entry.id} className="text-xs text-ink-2">
                  {formatDateTime(entry.corregidoEn)} · {entry.corregidoPorNombre} · antes:{" "}
                  {ATTENDANCE_LABELS[entry.estadoAnterior]} · {entry.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
