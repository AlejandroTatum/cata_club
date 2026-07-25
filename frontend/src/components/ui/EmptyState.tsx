/**
 * EmptyState — the one empty-state treatment.
 *
 * `_sistema.css` `.emptyst` (:400-403): centered column, 10px gap, 44px/24px
 * padding, a 46px `--neutral-bg` disc holding a 21px icon, a 15px bold title
 * and a `.muted` line. `29-estados.html:67-72` completes the pattern: the body
 * copy is capped at 44ch and the action sits 4px below it.
 *
 * The audit found four different empty-state treatments across the app. This
 * is the one they collapse into. An empty state without a next action is a
 * dead end, so `action` should be supplied whenever one exists.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  /** A 21px lucide icon. Rendered inside the neutral disc. */
  icon?: ReactNode;
  /** What is empty, in one line. */
  title: string;
  /** What will fill it, in one sentence. */
  description?: string;
  /** The way out — usually a single `Button`. */
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 px-6 py-11 text-center",
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-state-neutral-bg text-ink-3"
        >
          {icon}
        </span>
      ) : null}
      <b className="text-[15px] font-bold text-ink">{title}</b>
      {description ? (
        <p className="max-w-[44ch] text-[13px] text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
