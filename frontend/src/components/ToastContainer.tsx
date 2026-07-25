/**
 * ToastContainer — presentational stack for `ToastProvider`'s live toasts.
 * Above `ConfirmDialog` (`z-50`) so a toast stays visible even while a confirm
 * dialog is open. Newest toast is prepended by `ToastContext`, so it renders
 * first (on top) in the stack. Each toast exposes a manual close button in
 * addition to its own auto-dismiss timer.
 *
 * Two things are deliberate here:
 *
 * 1. The container carries NO `aria-live`. Each toast already declares
 *    `role="alert"` or `role="status"`, which ARE live regions — a live
 *    container wrapping live children makes assistive technology announce the
 *    same message twice.
 * 2. It docks to the BOTTOM below `sm`. At `top-4 right-4 w-full max-w-sm` it
 *    spanned a 360px phone edge to edge and covered the shell topbar's "Menú"
 *    button and notification bell — the toast auto-dismisses, the blocked
 *    navigation did not.
 */

"use client";

import { X } from "lucide-react";
import { useToastState, type ToastItem } from "@/contexts/ToastContext";

const VARIANT_CLASSES: Record<ToastItem["variant"], string> = {
  error: "toast-error",
  success: "toast-success",
  info: "toast-info",
  warning: "toast-warning",
};

// Screen-reader role per variant: errors interrupt (alert), success/info confirm (status), warning interrupts (alert).
const VARIANT_ROLES: Record<ToastItem["variant"], "alert" | "status"> = {
  error: "alert",
  success: "status",
  info: "status",
  warning: "alert",
};

export default function ToastContainer(): React.ReactElement | null {
  const { toasts, removeToast } = useToastState();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-full sm:max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={VARIANT_ROLES[toast.variant]}
          className={`${VARIANT_CLASSES[toast.variant]} pointer-events-auto animate-toast-in`}
        >
          <p className="flex-1">{toast.message}</p>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Cerrar notificación"
            className="shrink-0 text-current/70 transition-colors hover:text-current"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
