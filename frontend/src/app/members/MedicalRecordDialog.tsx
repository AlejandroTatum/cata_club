"use client";

import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import MemberDialogHeader from "./MemberDialogHeader";
import { useNativeDialog, NATIVE_DIALOG_WIDE_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "./useNativeDialog";
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
  const { dialogRef, closeButtonRef, shellStyle } = useNativeDialog(onClose);
  const titleId = `medical-record-title-${account.id}`;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => event.preventDefault()}
      className={NATIVE_DIALOG_WIDE_SHELL_CLASS}
      style={shellStyle}
    >
      <MemberDialogHeader
        account={account}
        titleId={titleId}
        purpose="Ficha médica"
        closeButtonRef={closeButtonRef}
        onClose={onClose}
      />

      <div className={NATIVE_DIALOG_BODY_CLASS}>
        {/* The "Nueva" chip on each editor already says there is no record yet;
            this line only tells the user what to do, so the status is never
            stated twice. The form below stays fully available. */}
        {account.sinDatosEmergencia ? (
          <p role="status" className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm font-semibold text-ink-2">
            Completa los datos y guárdalos.
          </p>
        ) : null}
        {account.estudiantes.map((student) => (
          <MedicalRecordEditor
            key={student.id}
            personaId={Number(student.id)}
            studentName={`${student.nombres} ${student.apellidos}`}
            hideNewNotice={account.sinDatosEmergencia}
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
