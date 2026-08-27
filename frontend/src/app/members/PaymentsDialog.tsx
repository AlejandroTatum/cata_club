"use client";

import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import { ICON } from "@/lib/icon-size";
import { useNativeDialog, NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "./useNativeDialog";
import StudentMembershipActions, { type MembresiaCallbacks } from "./StudentMembershipActions";
import type { MemberAccount } from "./members-utils";

interface PaymentsDialogProps extends MembresiaCallbacks {
  account: MemberAccount;
  onClose: () => void;
}

/**
 * Issue #505's second direct entry point: the row's "Pagos" trigger used to
 * require opening the generic account dialog first, scroll past roles and
 * estado, to reach the membership/payment forms buried in "Estudiantes a
 * cargo". This dialog renders `StudentMembershipActions` straight away for
 * each of `account.estudiantes` — the exact same forms, reused unchanged, no
 * intermediate dialog.
 */
export default function PaymentsDialog({
  account,
  onClose,
  ...membresiaCallbacks
}: PaymentsDialogProps): React.ReactElement {
  const { dialogRef, closeButtonRef } = useNativeDialog(onClose);
  const titleId = `payments-dialog-title-${account.id}`;

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
          Pagos — {account.nombres} {account.apellidos}
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
        {account.estudiantes.map((student) => (
          <section key={student.id} className="rounded-ctl border border-line bg-paper p-4">
            {account.estudiantes.length > 1 && (
              <h3 className="mb-2 text-sm font-bold text-ink">
                {student.nombres} {student.apellidos}
              </h3>
            )}
            <StudentMembershipActions
              personaId={Number(student.id)}
              student={student}
              {...membresiaCallbacks}
            />
          </section>
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">
        <Button onClick={onClose}>Cerrar</Button>
      </div>
    </dialog>,
    document.body,
  );
}
