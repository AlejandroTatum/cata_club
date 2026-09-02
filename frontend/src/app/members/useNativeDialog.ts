"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

import { useVisualViewportGeometry } from "@/lib/useVisualViewport";

interface NativeDialogHandles {
  dialogRef: RefObject<HTMLDialogElement>;
  closeButtonRef: RefObject<HTMLButtonElement>;
  /**
   * The measured visual viewport, as the custom properties
   * `NATIVE_DIALOG_SHELL_CLASS` reads. `undefined` until there is something to
   * say — which is also what a browser with no `visualViewport` gives, and is
   * why every property below has a fallback that is the pre-#767 value.
   */
  shellStyle: CSSProperties | undefined;
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
 *
 * ## Issue #767: `dvh` is still not what the user can see
 *
 * `100dvh` answers the URL bar and says NOTHING about the software keyboard —
 * `dvh` is a layout-viewport unit, and the layout viewport does not shrink when
 * the keys come up. So the dialog kept centring itself in ~590px while half the
 * screen was keyboard, and the only scrollable thing left on the visible strip
 * was its own body. That is why the report reads "one line at a time".
 *
 * The three custom properties below are the visible box, published by
 * `useNativeDialog` from `useVisualViewportGeometry` — the same measurement
 * `ChatWidget`'s sheet has used since #644, now shared rather than copied. The
 * dialog centres between `top` and the keyboard instead of between 0 and the
 * bottom of a viewport it cannot see.
 *
 * Every fallback is the value this class carried before #767, so a browser with
 * no `visualViewport` — and jsdom, and the server render — draws exactly the
 * old box: `top: 0`, `bottom: 0`, `100dvh`. Nothing here is a second layout to
 * maintain; it is the same one with the numbers made honest when they exist.
 *
 * `env(safe-area-inset-bottom)` is still subtracted while the keyboard is open,
 * which over-reserves by the home indicator the keyboard is already covering.
 * That direction is the safe one — a slightly shorter dialog, never one under
 * the keys — and it costs a handful of pixels in a state that lasts as long as
 * someone is typing.
 *
 * ## Issue #856: `h-fit` is a non-definite height, and WebKit knows it
 *
 * `h-fit` (`height: fit-content`) never gave this box a definite height — it
 * asked the browser to size the dialog to its own content instead, the same
 * intrinsic sizing keyword CSS uses for a `<div>` with no height at all. Every
 * major engine mostly tolerates that when a flex-grow child inside asks for a
 * share of it (`NATIVE_DIALOG_BODY_CLASS`'s `flex-1`), but WebKit is the one
 * that resolves an indefinite-height flex container's `flex-basis` as if the
 * child had nothing to grow into: the body collapsed to its `min-height`
 * (browser default `auto`, i.e. its own content height with nowhere to
 * shrink), and on a tall form that pushed the footer off both the visible
 * area and the dialog's own clipped box. Header and close button stayed
 * visible because they are `shrink-0` siblings measured before the body ever
 * gets a size — exactly the report's "header renders, body does not".
 *
 * Removing `h-fit` leaves `height` at its CSS default, `auto` — genuinely
 * auto, not `fit-content` — bounded by the `max-h-[…]` above, which IS a
 * definite length (a `calc()` of concrete viewport/inset values). A definite
 * `max-height` on an `auto`-height flex container is what every engine,
 * WebKit included, needs to resolve the `flex-1` body against: short content
 * still shrink-wraps below the cap, and anything taller is clamped at the cap
 * with the excess going to the body's own scrollbar instead of off-screen.
 */
export const NATIVE_DIALOG_SHELL_CLASS =
  "fixed inset-x-0 top-[var(--dialog-viewport-top,0px)] " +
  "bottom-[var(--dialog-keyboard-inset,0px)] z-50 m-auto flex " +
  "max-h-[calc(var(--dialog-viewport-height,100dvh)-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] " +
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
 *
 * `min-h-0` (issue #856) is the other half of the shell's `h-fit` removal: a
 * flex item's `min-height` defaults to `auto`, which means "never shrink
 * below your content" — the opposite of what a `flex-1 overflow-y-auto`
 * scroll body needs. Without it, WebKit sized this body to fit its full,
 * unscrolled content and only THEN discovered there was no room left inside
 * the shell's `max-h-[…]`, so the overflow it clipped was the body itself
 * rather than something the body's own scrollbar could reach. `ChatWidget`'s
 * history pane (`ChatWidget.tsx`) already carries `min-h-0` next to its own
 * `flex-1 overflow-y-auto` for the identical reason.
 */
export const NATIVE_DIALOG_BODY_CLASS =
  "flex-1 min-h-0 space-y-section overflow-y-auto overscroll-contain bg-canvas px-5 py-4";

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
  // Always measuring: this hook only runs while a dialog is mounted, and these
  // dialogs are mounted only while open. There is no closed state to gate.
  const viewport = useVisualViewportGeometry(true);

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

  return {
    dialogRef,
    closeButtonRef,
    shellStyle:
      viewport === null
        ? undefined
        : ({
            "--dialog-viewport-top": `${viewport.top}px`,
            "--dialog-viewport-height": `${viewport.height}px`,
            "--dialog-keyboard-inset": `${viewport.keyboardInset}px`,
          } as CSSProperties),
  };
}
