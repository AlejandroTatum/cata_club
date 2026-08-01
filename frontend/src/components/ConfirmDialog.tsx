/**
 * ConfirmDialog — shared plain click-to-confirm dialog for high-consequence
 * actions (payments approve, groups remove-from-group). No typed-reason
 * input; that stays exclusive to payments' reject flow. Local `useState`
 * per consumer — no context/store/portal (no Button/Card/Input layer yet).
 */

"use client";

import { useEffect, useRef } from "react";
import Button, { type ButtonVariant } from "./ui/Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** @default "Confirmar" */
  confirmLabel?: string;
  /** @default "Cancelar" */
  cancelLabel?: string;
  variant: "state-ok" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Variant → `Button` variant.
 *
 * `danger` used to map to `btn-secondary`, which made a destructive confirm
 * visually QUIETER than its own Cancel button — the button that deletes
 * something forever looked less consequential than the one that changes
 * nothing. Red is exactly what the design system reserves for destructive
 * actions, so `danger` is the primary (red) button and Cancel is the muted
 * one. Emphasis now matches consequence.
 */
const CONFIRM_BUTTON_VARIANT: Record<ConfirmDialogProps["variant"], ButtonVariant> = {
  "state-ok": "dark",
  danger: "primary",
};

const HEADING_ACCENT_CLASSES: Record<ConfirmDialogProps["variant"], string> = {
  "state-ok": "text-cata-state-ok",
  danger: "text-cata-red",
};

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  // Focus trap: focus confirm on open, Tab/Shift+Tab cycles the 2 buttons,
  // Escape cancels, focus returns to the trigger on close.
  useEffect(() => {
    if (!open) return;

    triggerElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [confirmButtonRef.current, cancelButtonRef.current].filter(
        (el): el is HTMLButtonElement => el !== null,
      );
      if (focusable.length === 0) return;

      event.preventDefault();
      const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        (currentIndex + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[nextIndex].focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerElementRef.current?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      // `m-0`: this overlay renders inline, so it is a first-level child of
      // `<main>` and its `space-y-page` rhythm would reach it. A margin on a
      // `fixed inset-0` box offsets AND shrinks it, uncovering a strip at the
      // top. Centring here is flex, never margin, so zero is exact.
      className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-cata-black/40 px-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
        className="card w-full max-w-sm p-6"
      >
        <h2
          id="confirm-dialog-title"
          className={`text-base font-semibold ${HEADING_ACCENT_CLASSES[variant]}`}
        >
          {title}
        </h2>
        <p
          id="confirm-dialog-message"
          className="mt-2 text-sm text-cata-text/65"
        >
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelButtonRef} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={CONFIRM_BUTTON_VARIANT[variant]}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
