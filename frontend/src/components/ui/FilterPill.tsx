/**
 * FilterPill — the 40px filter chip.
 *
 * `_sistema.css` `.pill` (:178-183): `--h-ctl` 40px, fully rounded, 15px
 * horizontal padding, 12.5px/600 label on `--paper` with a `--line-2` border,
 * optional count in `--ink-3` with tabular figures.
 *
 * The active state is `.pill.on`: `--coal` fill plus a 6px `--ball` dot before
 * the label, with the count at `rgba(255,255,255,.6)`. It is NEVER red — red
 * is reserved for the primary CTA and for destructive/error states, so a red
 * "selected" pill would read as "this filter is broken".
 */

import type { ReactElement } from "react";
import { cn } from "./cn";

export interface FilterPillProps {
  label: string;
  /** Optional trailing count, e.g. the 44 in "Todos 44". */
  count?: number;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export default function FilterPill({
  label,
  count,
  active = false,
  onClick,
  disabled,
  className,
}: FilterPillProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-ctl inline-flex items-center gap-2 rounded-full border px-[15px] text-[12.5px] font-semibold",
        "transition-colors duration-150",
        // No focus ring here — see `Button`: the shared system ring in
        // `globals.css` carries it, because the bare ball fails on the light
        // surfaces a filter row sits on.
        "disabled:cursor-not-allowed disabled:opacity-45",
        active
          ? "bg-coal border-coal text-white"
          // `sunken`, not `canvas` — see `Button`: pills sit on the page
          // field, so hovering to the page field is not a hover.
          : "bg-paper border-line-2 text-ink-2 hover:bg-sunken",
        className,
      )}
    >
      {active ? (
        <span
          data-testid="filterpill-ball-dot"
          aria-hidden="true"
          className="h-1.5 w-1.5 flex-none rounded-full bg-ball"
        />
      ) : null}
      {label}
      {count !== undefined ? (
        <span className={cn("tabular-nums", active ? "text-white/60" : "text-ink-3")}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
