/**
 * ToastContainer — presentational stack for `ToastProvider`'s live toasts.
 * Above `ConfirmDialog` (`z-50`) so a toast stays visible even while a confirm
 * dialog is open. Newest toast is prepended by `ToastContext`, so it renders
 * first (on top) in the stack. Each toast exposes a manual close button in
 * addition to its own auto-dismiss timer.
 *
 * ## What a toast has to make obvious
 *
 * Three signals, in the order they are read: an icon that says *which kind of
 * thing happened* before any word is parsed, a semibold first line naming the
 * outcome, and — when the caller supplied one — a lighter second line saying
 * what that means or what to do next. The icon is redundant with the fill
 * colour on purpose: colour alone is not a channel everyone receives.
 *
 * Both lines are painted in solid `currentColor`. On `.toast-success`'s
 * #15803D, pure white measures 5.01:1 and any dimming of it (85% → 4.09:1,
 * 90% → 4.38:1) drops the supporting line below AA, so the two tiers are
 * separated by weight and size instead of by opacity. The close glyph is a
 * non-text control, so it may sit at 80% — 3.81:1 on that same green, above
 * the 3:1 floor for UI components.
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

import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { useToastState, type ToastItem } from "@/contexts/ToastContext";

const VARIANT_CLASSES: Record<ToastItem["variant"], string> = {
  error: "toast-error",
  success: "toast-success",
  info: "toast-info",
  warning: "toast-warning",
};

/**
 * The second, non-colour channel. Each glyph names its variant's category on
 * its own, for anyone who cannot rely on the fill to do it.
 */
const VARIANT_ICONS: Record<ToastItem["variant"], LucideIcon> = {
  error: XCircle,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
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
      {toasts.map((toast) => {
        const Icon = VARIANT_ICONS[toast.variant];

        return (
          <div
            key={toast.id}
            role={VARIANT_ROLES[toast.variant]}
            className={`${VARIANT_CLASSES[toast.variant]} pointer-events-auto animate-toast-in`}
          >
            <Icon
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              className="mt-px shrink-0 text-current"
            />

            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold leading-[1.35]">{toast.message}</p>
              {toast.description && (
                <p className="mt-1 text-[12.5px] font-normal leading-[1.45]">{toast.description}</p>
              )}
            </div>

            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label="Cerrar notificación"
              /* `-m-1 … p-1` is hit area, not spacing: it lifts the 16px glyph
                 to a 24x24 target (WCAG 2.2 SC 2.5.8) without moving it.
                 No focus ring is declared — the system indicator in
                 `globals.css` outranks Tailwind's `focus-visible:*` utilities
                 (0,3,0 vs 0,2,0), so the `outline-current` this button used to
                 carry never rendered. */
              className="-m-1 shrink-0 rounded p-1 text-current/80 transition-colors hover:text-current"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
