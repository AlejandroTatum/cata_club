/**
 * AttendanceCorrectionDialog — issue #508.
 *
 * The correction form used to sit inline in `AttendanceCorrectionRow`,
 * expanding the roster row itself. That grew the row into three stacked
 * concerns competing for the same narrow column (static badge, form, history
 * panel) and pushed every other row down the page while one was open. This
 * pulls the form into a dedicated `role="dialog"` modal — same shell
 * `EmergencyCardDialog` already uses in this same module (backdrop as a
 * SIBLING of the panel, not its wrapper, and `useModalFocusTrap` for
 * Escape/Tab/focus-return), so a second dialog in this file does not
 * hand-roll a third focus contract next to `ConfirmDialog`'s.
 *
 * This component owns none of the correction's business logic — no fetch,
 * no validation beyond what the row already enforces via `error`. It is a
 * pure container: the row still decides estado/motivo/submitting/error and
 * what a successful save does to the roster. Only WHERE the form renders
 * changed, not what it asks or how it saves (issue #508 is `type:refactor`).
 */

"use client";

import { useRef } from "react";
import { Button } from "@/components/ui";
import { useModalFocusTrap } from "@/lib/focus-trap";
import { ATTENDANCE_LABELS, ATTENDANCE_STATES } from "./attendance-utils";
import type { EstadoAsistencia } from "@/types/domain";

export const MOTIVO_MAX_LENGTH = 500;

export interface AttendanceCorrectionDialogProps {
  readonly open: boolean;
  readonly studentName: string;
  readonly estado: EstadoAsistencia;
  readonly onEstadoChange: (estado: EstadoAsistencia) => void;
  readonly motivo: string;
  readonly onMotivoChange: (motivo: string) => void;
  readonly submitting: boolean;
  readonly error: string | null;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

export default function AttendanceCorrectionDialog({
  open,
  studentName,
  estado,
  onEstadoChange,
  motivo,
  onMotivoChange,
  submitting,
  error,
  onSubmit,
  onCancel,
}: AttendanceCorrectionDialogProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "attendance-correction-title";

  // Same trap as EmergencyCardDialog: Escape closes, Tab/Shift+Tab cycle
  // inside the panel, focus returns to whatever opened it. No fixed initial
  // focus ref — the panel's first focusable (the "Presente" radio) is fine.
  useModalFocusTrap({
    open,
    onClose: onCancel,
    panelRef,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Sibling of the panel, not its wrapper — see EmergencyCardDialog's
       *  own comment on why: a click inside the panel then has no bubble
       *  path to this element, so it never needs a stopPropagation guard. */}
      <div
        aria-hidden="true"
        data-testid="attendance-correction-backdrop"
        onClick={onCancel}
        className="absolute inset-0 bg-cata-black/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card relative flex w-full max-w-md flex-col gap-3 p-5"
      >
        <h2 id={titleId} className="text-base font-bold text-ink">
          Corregir asistencia de {studentName}
        </h2>

        <div
          role="radiogroup"
          aria-label={`Nuevo estado de ${studentName}`}
          className="flex flex-wrap gap-1.5"
        >
          {ATTENDANCE_STATES.map((state) => (
            <button
              key={state}
              type="button"
              role="radio"
              aria-checked={estado === state}
              onClick={() => onEstadoChange(state)}
              className={`h-badge rounded-full border px-3 text-2xs font-semibold ${
                estado === state
                  ? "border-transparent bg-coal text-white"
                  : "border-line-2 bg-paper text-ink-2 hover:border-ink-3"
              }`}
            >
              {ATTENDANCE_LABELS[state]}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-2xs font-bold uppercase text-ink-3">
            Motivo <span aria-hidden="true" className="text-state-bad">*</span>
          </span>
          <textarea
            rows={2}
            required
            value={motivo}
            onChange={(e) => onMotivoChange(e.target.value.slice(0, MOTIVO_MAX_LENGTH))}
            maxLength={MOTIVO_MAX_LENGTH}
            placeholder="Por qué se corrige este registro"
            className="resize-y rounded-ctl border border-line-2 bg-paper px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
            disabled={submitting}
          />
        </label>

        {error && (
          <p role="alert" className="text-xs text-state-bad">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={submitting} onClick={onSubmit}>
            {submitting ? "Guardando…" : "Guardar corrección"}
          </Button>
        </div>
      </div>
    </div>
  );
}
