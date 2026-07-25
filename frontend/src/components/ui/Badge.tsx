/**
 * Badge — the 26px status pill.
 *
 * `_sistema.css` `.badge` (:199-203): `--h-badge` 26px, fully rounded, 11px
 * horizontal padding, 11.5px/700 label, and a 6px `currentColor` dot before
 * the text. Default tone is `--neutral` on `--neutral-bg`; `ok`, `warn` and
 * `bad` swap in their state pair.
 *
 * This is where color is allowed to live. Attendance maps onto it directly:
 * presente → ok, tardanza → warn, justificado → neutral, ausente → bad.
 * "Sin membresía" is neutral, never bad.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "ok" | "warn" | "bad";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-state-neutral-bg text-state-neutral",
  ok: "bg-state-ok-bg text-state-ok",
  warn: "bg-state-warn-bg text-state-warn",
  bad: "bg-state-bad-bg text-state-bad",
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export default function Badge({
  children,
  tone = "neutral",
  className,
}: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        "h-badge inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] text-[11.5px] font-bold",
        TONE[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 flex-none rounded-full bg-current"
      />
      {children}
    </span>
  );
}
