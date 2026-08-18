/**
 * useDismissablePopup — Escape, outside-click and a Tab focus cycle for the
 * shell's non-modal popups (notification bell, both user menus).
 *
 * These popups shipped with none of the three: keyboard users could Tab
 * straight out of an open dropdown into the page behind it, Escape did
 * nothing, and clicking elsewhere left the panel open on screen.
 *
 * The Tab cycle wraps at both edges — Shift+Tab on the first focusable goes to
 * the last, Tab on the last goes back to the first — and only those two edges
 * are intercepted; the browser walks the steps in between. `FOCUSABLE_SELECTOR`
 * comes from `focus-trap.ts`, which is where the modal version of this lives:
 * one definition of "what counts as focusable" for both.
 *
 * Focus returns to the trigger on Escape only. An outside click already put the
 * focus wherever the user clicked, and yanking it back to the trigger would
 * override a choice the user just made with the pointer.
 */

"use client";

import { useEffect, type RefObject } from "react";
import { FOCUSABLE_SELECTOR } from "./focus-trap";

export interface DismissablePopupOptions {
  open: boolean;
  /** Called for Escape and for a click outside both the panel and its trigger. */
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  /** The control that opens the popup — clicks on it are not "outside", and focus returns here on close. */
  triggerRef: RefObject<HTMLElement | null>;
}

export function useDismissablePopup({
  open,
  onClose,
  panelRef,
  triggerRef,
}: DismissablePopupOptions): void {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        // Escape is a keyboard dismissal, so focus must land somewhere
        // visible — the trigger the user came from.
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const insidePanel = active instanceof Node && panel.contains(active);

      if (event.shiftKey) {
        if (!insidePanel || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!insidePanel || active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      // The trigger toggles on its own click handler — treating it as
      // "outside" here would close and immediately reopen the panel.
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, onClose, panelRef, triggerRef]);
}
