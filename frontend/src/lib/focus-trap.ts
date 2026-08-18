/**
 * useModalFocusTrap — Escape, initial focus, a Tab cycle that cannot leave the
 * panel, and focus restored to the trigger on close, for dialogs that declare
 * `aria-modal="true"`.
 *
 * `ConfirmDialog.tsx` proved the pattern, but it proved it over a hardcoded
 * two-ref array, which only works because that dialog always renders exactly
 * two buttons. `EmergencyCardDialog` needs the same trap over a focusable set
 * that changes with the load state — two controls while the fetch is failing
 * (Reintentar plus Cerrar), one once the ficha is on screen. So this hook reads
 * its focusables out of the DOM at each keypress instead of holding refs.
 *
 * `ConfirmDialog` and `AgeUpConfirmation` keep their two-ref copies on purpose:
 * they are proven, tested, and they gate the payments and groups actions, so
 * rewriting them is its own change. This hook exists so the next dialog does
 * not hand-roll a fourth copy.
 *
 * ## Why Tab is always preventDefault-ed
 *
 * The trap never lets the browser move focus and never delegates to a native
 * `<dialog>`: it calls `preventDefault()` on every Tab and moves focus itself.
 * jsdom implements neither native Tab navigation nor `<dialog>` focus trapping,
 * so a trap built on either would be unprovable — the tests would pass on an
 * empty implementation and the regression would ship. Moving focus by hand
 * behaves the same in jsdom and in a browser, which is what makes it testable.
 *
 * `useDismissablePopup` shares `FOCUSABLE_SELECTOR` from here and wraps its
 * cycle too, but it preventDefaults only at the two edges and lets the browser
 * walk the steps between — a dropdown can afford that; this cannot.
 */

"use client";

import { useEffect, useRef, type RefObject } from "react";

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalFocusTrapOptions {
  readonly open: boolean;
  /** Called on Escape. The dialog owns what closing means. */
  readonly onClose: () => void;
  /** The modal panel — its focusable descendants are the whole cycle. */
  readonly panelRef: RefObject<HTMLElement | null>;
  /** Where focus lands on open. Defaults to the panel's first focusable. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useModalFocusTrap({
  open,
  onClose,
  panelRef,
  initialFocusRef,
}: ModalFocusTrapOptions): void {
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    triggerElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const initial = initialFocusRef?.current;
    if (initial) {
      initial.focus();
    } else {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      // Swallowed before the empty check on purpose: a panel with nothing to
      // focus still must not let Tab walk into the page behind an
      // `aria-modal="true"` dialog. Nowhere to move focus to is not a reason to
      // hand it back to the document.
      event.preventDefault();

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const active = document.activeElement;
      const currentIndex = focusable.findIndex((el) => el === active);
      if (currentIndex === -1) {
        // Focus is not on anything in the cycle — pull it to whichever end the
        // user was heading towards.
        focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
        return;
      }
      const nextIndex =
        (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return (): void => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerElementRef.current?.focus();
    };
  }, [open, onClose, panelRef, initialFocusRef]);
}
