"use client";

import { useEffect, useRef, type RefObject } from "react";

interface NativeDialogHandles {
  dialogRef: RefObject<HTMLDialogElement>;
  closeButtonRef: RefObject<HTMLButtonElement>;
}

/**
 * Wires a native `<dialog>` the way every modal on the Miembros page behaves:
 * shown via `showModal()` (the browser traps Tab focus and renders the
 * `::backdrop` for us), closed on Escape, closed on a backdrop click, and
 * focus restored to whatever was focused when the dialog mounted — the row
 * or card trigger that opened it.
 *
 * Extracted from `MemberEditDialog` (issue #505): `MedicalRecordDialog` and
 * `PaymentsDialog` are two new direct entry points that need the exact same
 * open/close/focus contract `MemberEditDialog` already had, so this is the
 * one place that contract lives instead of three hand-copied effects.
 */
export function useNativeDialog(onClose: () => void): NativeDialogHandles {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    function handleBackdropClick(event: MouseEvent): void {
      if (event.target === dialog) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    dialog.addEventListener("click", handleBackdropClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      dialog.removeEventListener("click", handleBackdropClick);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return { dialogRef, closeButtonRef };
}
