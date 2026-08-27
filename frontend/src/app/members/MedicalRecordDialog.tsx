"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { useNativeDialog, NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "./useNativeDialog";
import MedicalRecordEditor from "./MedicalRecordEditor";
import type { MemberAccount } from "./members-utils";

interface MedicalRecordDialogProps {
  account: MemberAccount;
  onClose: () => void;
}

/**
 * Issue #505's first direct entry point: the row's "Ficha médica" trigger
 * used to require opening the generic account dialog first and then an
 * internal "Ficha médica" toggle per student before `MedicalRecordEditor`
 * ever appeared. This dialog renders that same editor straight away — no
 * intermediate click, no roles/estado/datos-personales content in the way.
 *
 * One section per student in `account.estudiantes` (a represented minor's
 * row still surfaces one persona — issue #388 — but the shape supports more
 * than one, same as `StudentEditPanel` always has).
 */
export default function MedicalRecordDialog({
  account,
  onClose,
}: MedicalRecordDialogProps): React.ReactElement {
  const { dialogRef, closeButtonRef } = useNativeDialog(onClose);
  const titleId = `medical-record-title-${account.id}`;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
      className={NATIVE_DIALOG_SHELL_CLASS}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-sunken px-5 py-4">
        <h2
          id={titleId}
          // `min-w-0` is load-bearing: without it, this flex item's
          // min-width defaults to its un-wrapped text width, so `truncate`
          // never gets a chance to shrink it and the header row overflows
          // instead (issue #659) — see `NATIVE_DIALOG_SHELL_CLASS`'s comment.
          className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-flat text-ink"
        >
          Ficha médica — {account.nombres} {account.apellidos}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar ventana"
          className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div className={NATIVE_DIALOG_BODY_CLASS}>
        {/* Additive, explicit status (user-approved wording): the fact that no
            emergency record exists yet is announced here, never as hidden text
            on the table trigger. The form below stays fully available. */}
        {account.sinDatosEmergencia ? (
          <p role="status" className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm font-semibold text-ink-2">
            Sin ficha médica
          </p>
        ) : null}
        {account.estudiantes.map((student) => (
          <MedicalRecordEditor
            key={student.id}
            personaId={Number(student.id)}
            studentName={`${student.nombres} ${student.apellidos}`}
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">
        <Button onClick={onClose}>Cerrar</Button>
      </div>
    </dialog>,
    document.body,
  );
}
