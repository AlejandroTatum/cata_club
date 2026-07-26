/**
 * ToastContext — root-mounted transient toast notifications (error/success).
 *
 * Two separate contexts share one provider:
 *  - the public `showToast`/`showError`/`showSuccess` actions (`useToast()`),
 *    consumed by pages that need to surface feedback — mirrors `useAuth()`'s
 *    "throw outside provider" contract.
 *  - the internal `toasts` array + `removeToast` (`useToastState()`),
 *    consumed by the presentational `ToastContainer` (added separately) to
 *    render the stack and wire its manual close button.
 *
 * ## A toast carries two lines, not one
 *
 * The product owner's note on the login confirmation — *"quisiera un toast
 * para todo pero más claro que le haga saber al usuario"* — is a legibility
 * requirement, not a placement one. One sentence has to do two jobs at once
 * (say what happened AND say what it means) and usually does neither, so
 * every toast may carry an optional `description` under its `message`:
 * `message` names the outcome, `description` names the consequence or the
 * next step. Callers that only have one clause keep passing one string.
 *
 * ## Dwell time is measured, not fixed
 *
 * A fixed 4.5s is generous for "Nivel asignado" and too short for a two-line
 * explanation of a failed payment. `toastDurationFor` scales with the text it
 * has to let someone read — floored at `TOAST_DURATION_MS` so nothing ever
 * flashes past, capped at `TOAST_MAX_DURATION_MS` so nothing camps on screen.
 * A short one-line toast still resolves to exactly the old 4500ms.
 *
 * Timers are tracked per-toast in a ref map, cleared on manual close
 * (`removeToast`) and swept on provider unmount so no `setState` fires after
 * unmount.
 */

"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = "error" | "success" | "info" | "warning";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  /** The outcome, in one short clause. Rendered as the toast's title. */
  message: string;
  /** The consequence or the next step. Rendered under the title. */
  description?: string;
}

/** The optional second argument every `show*` shortcut accepts. */
export interface ToastDetail {
  /** Supporting line under the message. Omit when one clause says it all. */
  description?: string;
  /** Overrides the measured dwell time for this toast only. */
  duration?: number;
}

export interface ShowToastOptions extends ToastDetail {
  variant: ToastVariant;
  message: string;
}

export interface ToastContextValue {
  showToast: (options: ShowToastOptions) => void;
  showError: (message: string, detail?: ToastDetail) => void;
  showSuccess: (message: string, detail?: ToastDetail) => void;
  showInfo: (message: string, detail?: ToastDetail) => void;
  showWarning: (message: string, detail?: ToastDetail) => void;
}

export interface ToastStateValue {
  toasts: ToastItem[];
  removeToast: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Dwell time
// ---------------------------------------------------------------------------

/**
 * The floor. Nothing dismisses faster than this, however short it is — below
 * ~4s a confirmation is gone before a user who was looking at the button they
 * just pressed has moved their eyes to it.
 */
export const TOAST_DURATION_MS = 4500;

/** The ceiling. Past this a toast stops being transient and starts nagging. */
export const TOAST_MAX_DURATION_MS = 10000;

/** Time to notice the toast at all, before any of it has been read. */
const NOTICE_MS = 1500;

/** ~55ms per character ≈ 200 wpm, the usual figure for interrupted reading. */
const MS_PER_CHARACTER = 55;

/**
 * How long a toast carrying this text should stay up. Clamped at both ends,
 * so a one-line confirmation resolves to exactly `TOAST_DURATION_MS` and only
 * genuinely long copy earns more time.
 */
export function toastDurationFor(message: string, description?: string): number {
  const characters = message.length + (description ? description.length : 0);
  const readingTime = NOTICE_MS + characters * MS_PER_CHARACTER;
  return Math.min(TOAST_MAX_DURATION_MS, Math.max(TOAST_DURATION_MS, readingTime));
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const ToastActionsContext = createContext<ToastContextValue | null>(null);
const ToastStateContext = createContext<ToastStateValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ variant, message, description, duration }: ShowToastOptions) => {
      const id = `toast-${++counterRef.current}`;
      setToasts((prev) => [{ id, variant, message, description }, ...prev]);

      const timer = setTimeout(
        () => removeToast(id),
        duration ?? toastDurationFor(message, description),
      );
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  const showError = useCallback(
    (message: string, detail?: ToastDetail) => {
      showToast({ variant: "error", message, ...detail });
    },
    [showToast],
  );

  const showSuccess = useCallback(
    (message: string, detail?: ToastDetail) => {
      showToast({ variant: "success", message, ...detail });
    },
    [showToast],
  );

  const showInfo = useCallback(
    (message: string, detail?: ToastDetail) => {
      showToast({ variant: "info", message, ...detail });
    },
    [showToast],
  );

  const showWarning = useCallback(
    (message: string, detail?: ToastDetail) => {
      showToast({ variant: "warning", message, ...detail });
    },
    [showToast],
  );

  // Sweep all pending timers on unmount so no removeToast/setState fires
  // after the provider is gone.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const actions: ToastContextValue = { showToast, showError, showSuccess, showInfo, showWarning };
  const state: ToastStateValue = { toasts, removeToast };

  return (
    <ToastActionsContext.Provider value={actions}>
      <ToastStateContext.Provider value={state}>{children}</ToastStateContext.Provider>
    </ToastActionsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the toast actions. Must be called within a ToastProvider.
 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastActionsContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

/**
 * Internal — the current toast stack + manual dismiss, for `ToastContainer`
 * only. Not part of the public `useToast()` contract.
 */
export function useToastState(): ToastStateValue {
  const ctx = useContext(ToastStateContext);
  if (!ctx) {
    throw new Error("useToastState must be used within a ToastProvider");
  }
  return ctx;
}
