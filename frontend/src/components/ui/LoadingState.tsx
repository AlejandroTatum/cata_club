/**
 * LoadingState — the one "we are fetching this" block.
 *
 * The audit found three treatments: a spinning `Clock` icon (dashboard,
 * attendance, trainer, payments, trainer/attendance) — a clock is a schedule,
 * not a spinner, and on an attendance screen full of real clock icons it reads
 * as data; a spinning `Loader2` (members, reports, chatbot); and plain text
 * with no indicator at all (members, student, groups, profile), which is
 * indistinguishable from an empty result.
 *
 * `Loader2` wins: it is the only one of the three that is unambiguously a
 * spinner. Geometry is deliberately `EmptyState`'s — same 46px disc, same
 * 15px/13px type — because loading, empty and error are the same slot in the
 * same card, and a slot that changes size as it resolves makes the page jump.
 *
 * Scope note: this is the BLOCK state. A `Loader2` inside a button that is
 * mid-submit is a different thing (a busy control, not a busy region) and is
 * left alone.
 */

import type { ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

export interface LoadingStateProps {
  /** What is being fetched, e.g. "Cargando miembros…". Ends with U+2026. */
  label: string;
  className?: string;
}

export default function LoadingState({ label, className }: LoadingStateProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-2.5 px-6 py-11 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-state-neutral-bg text-ink-3"
      >
        <Loader2 size={21} strokeWidth={1.5} className="animate-spin" />
      </span>
      <p className="text-sm text-ink-3">{label}</p>
    </div>
  );
}
