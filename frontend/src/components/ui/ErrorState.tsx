/**
 * ErrorState — the one "this did not load" block.
 *
 * The audit found four treatments, only one of which was a shared component:
 * `card border-red-200 bg-red-50` + `XCircle` (attendance, trainer, payments,
 * trainer/attendance); an inline `rounded-xl border-cata-red/30` +
 * `AlertTriangle` (dashboard, members, nivel); the `.alert-error` class; and
 * the local `ErrorCard` in the student portal. Three of the four were dead
 * ends — they told you something broke and gave you nothing to do about it, so
 * the only recovery was a browser refresh that also lost your filters.
 *
 * Hence `onRetry`. It is optional in the type only because a couple of call
 * sites genuinely have nothing to re-run; if you are reaching for this
 * component you almost certainly have a loader to call again.
 *
 * Geometry matches `EmptyState` and `LoadingState` on purpose: the three are
 * the same slot in the same card, and a slot that resizes as it resolves makes
 * the page jump under the reader's eye.
 *
 * Scope note: `.alert-error` survives, but only for what it is good at — a
 * short inline message about something the user just typed. A failed fetch is
 * not a validation error and does not belong in the same shape.
 */

import type { ReactElement } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Button from "./Button";
import { cn } from "./cn";

export interface ErrorStateProps {
  /** What failed, in one line. Defaults to a neutral, honest fallback. */
  title?: string;
  /** The detail — usually the caught message. */
  message?: string;
  /** Re-run the thing that failed. Omit only when there is nothing to re-run. */
  onRetry?: () => void;
  /** @default "Reintentar" */
  retryLabel?: string;
  className?: string;
}

export default function ErrorState({
  title = "No se pudo cargar la información",
  message,
  onRetry,
  retryLabel = "Reintentar",
  className,
}: ErrorStateProps): ReactElement {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2.5 rounded-card border border-state-bad/25 bg-state-bad-bg px-6 py-9 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-paper text-state-bad"
      >
        <AlertTriangle size={21} strokeWidth={1.5} />
      </span>
      <b className="text-[15px] font-bold text-ink">{title}</b>
      {message ? <p className="max-w-[44ch] text-[13px] text-ink-2">{message}</p> : null}
      {onRetry ? (
        <div className="mt-1">
          <Button size="sm" onClick={onRetry}>
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
