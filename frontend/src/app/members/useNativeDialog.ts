"use client";

import { useEffect, useRef, type RefObject } from "react";

interface NativeDialogHandles {
  dialogRef: RefObject<HTMLDialogElement>;
  closeButtonRef: RefObject<HTMLButtonElement>;
}

/**
 * The `<dialog>` shell class shared by `MedicalRecordDialog`, `PaymentsDialog`,
 * and `MemberEditDialog` — previously hand-copied three times, which is how
 * issue #659's mobile viewport bugs shipped identically in all three:
 *
 * - `100dvh` instead of `100vh`: on mobile Safari/Chrome, `vh` is measured
 *   against the *layout* viewport, which sits under the browser's
 *   address bar/toolbar chrome even when that chrome is visible, so a
 *   `100vh`-based max-height allows the dialog to run under it. `dvh` tracks
 *   the *dynamic* (currently visible) viewport instead — the same fix
 *   `ChatWidget.tsx`'s sheet already uses for `--chat-sheet-height`.
 * - `env(safe-area-inset-*)` on every edge: nothing previously kept the
 *   dialog off a device notch or home-indicator strip, unlike `ChatWidget`,
 *   which already subtracts these on all four sides.
 * - `w-full` had no horizontal inset, so at a 320px viewport the dialog
 *   touched both screen edges exactly; the width now reserves a 2rem gutter
 *   on top of the safe-area insets, same idea as the height clamp.
 *
 * NOT a "add scrolling" fix — `MedicalRecordDialog` and `PaymentsDialog`
 * already had `flex-1 … overflow-y-auto` bodies before this change; issue
 * #659's "el cuerpo no ofrece scroll interno usable" premise did not hold.
 */
export const NATIVE_DIALOG_SHELL_CLASS =
  "fixed inset-0 z-50 m-auto flex h-fit " +
  "max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] " +
  "w-[calc(100%-2rem-env(safe-area-inset-left)-env(safe-area-inset-right))] max-w-2xl " +
  "flex-col overflow-hidden rounded-2xl border border-line bg-paper p-0 shadow-elevated backdrop:bg-coal/40";

/**
 * The scrolling BODY of those same three dialogs — one string for the same
 * reason the shell above is one string. It was hand-copied verbatim into
 * `PaymentsDialog`, `MedicalRecordDialog` and `MemberEditDialog`, which is
 * how issue #706 was present in all three at once while only one was
 * measured.
 *
 * `overscroll-contain` is that fix. Wheeling inside the body scrolls the body
 * correctly, but once it reaches its end the gesture CHAINED to the page
 * behind: measured on the QA build at 844x390, `window.scrollY` went 0 → 1020
 * in Chromium and 0 → 590 in Firefox, and the issue reports 682 → 1297 in
 * WebKit. The modal stays put, so nobody is trapped — but the page behind
 * silently loses its position, which on a phone is disorienting on return.
 *
 * `contain` (not `none`): the boundary is what matters, and `none` would also
 * kill the platform's own overscroll affordances inside the dialog for no
 * additional benefit. `ChatWidget`'s sheet and `AttendanceRosterList` already
 * carry the same utility, so this is the codebase's established spelling
 * rather than a new convention.
 */
export const NATIVE_DIALOG_BODY_CLASS =
  "flex-1 space-y-section overflow-y-auto overscroll-contain bg-canvas px-5 py-4";

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
