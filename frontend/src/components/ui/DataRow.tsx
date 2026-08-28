/**
 * DataRow — the dense list row design review picked over the avatar card.
 *
 * With 86 members on one screen, a card forces twice the scrolling a row
 * does. `DataRowList` is the outer frame (a border, hairline separators
 * between rows); `DataRow` is one row: identity in semibold, metadata boxed
 * by the caller (typically `DataBox`), an optional status badge, and trailing
 * actions.
 *
 * `variant="two-line"` is the SAME component at a second density, not a
 * second component — it swaps the metadata slot for a single muted subtitle
 * under the name, for the case where there is exactly one more fact to show
 * and it reads better as a caption than as a second box.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export type DataRowVariant = "dense" | "two-line";

export interface DataRowProps {
  /** The row's identity — rendered in semibold. */
  name: ReactNode;
  /**
   * Dense variant only: the row's boxed metadata (typically one or more
   * `DataBox` values). Ignored in the two-line variant — use `subtitle`.
   */
  meta?: ReactNode;
  /** Two-line variant only: the muted line under the name. */
  subtitle?: ReactNode;
  /** An optional status badge. */
  status?: ReactNode;
  /** Trailing actions. */
  actions?: ReactNode;
  variant?: DataRowVariant;
  /**
   * Opt-in only — DataRow is shared by six pages (discounts, groups, members,
   * payments, student/enroll, tarifas), and flipping the default here would
   * change name rendering everywhere at once. Set this on the caller that
   * needs the full name (e.g. Tarifas, #660); everyone else keeps truncating.
   */
  nameWrap?: boolean;
  className?: string;
}

export default function DataRow({
  name,
  meta,
  subtitle,
  status,
  actions,
  variant = "dense",
  nameWrap = false,
  className,
}: DataRowProps): ReactElement {
  const twoLine = variant === "two-line";

  return (
    <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-field px-4 py-3", className)}>
      {/*
       * `basis-56` (14rem) is what makes this row's `flex-wrap` do anything.
       *
       * With `flex-1` alone the name's flex-basis is 0, so its hypothetical
       * size never contributes to the line-breaking decision: the meta and
       * status groups — `flex-none`, sized to their content — claim the row
       * first and the name absorbs every pixel of the squeeze. (The action
       * group stopped being `flex-none` in #767; see its own comment below.)
       * Measured on `/tarifas` at 390px, that left the name a
       * 50px column: the seeded "Mensual Infantil" wrapped onto two lines
       * and a long tariff name broke mid-syllable across nine (issue #660,
       * and #677's `break-words` only changed HOW the 50px column failed).
       * `/members` measured the same 52px at that width.
       *
       * A floor on the basis makes the break happen where it belongs. Below
       * it the line no longer fits, so the meta group drops to the next line
       * (which `flex-wrap` + `gap-y-field` were already there to handle) and
       * the name gets the full row. Above it nothing changes at all — the
       * name still grows into whatever space is left, exactly as before.
       *
       * The floor goes on the NAME rather than letting the meta group shrink
       * because shrinking it compresses the chips and the "Editar precio"
       * button — trading an unreadable name for an unreliable touch target.
       */}
      <div className="min-w-0 flex-1 basis-56">
        <p
          className={cn(
            "text-sm font-semibold text-ink",
            nameWrap ? "break-words" : "truncate",
          )}
        >
          {name}
        </p>
        {twoLine && subtitle ? (
          <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>
        ) : null}
      </div>

      {!twoLine && meta ? (
        <div className="flex flex-none flex-wrap items-center gap-2">{meta}</div>
      ) : null}

      {status ? <div className="flex-none">{status}</div> : null}
      {/*
       * `flex-wrap`, and NOT `flex-none` — issue #767.
       *
       * Measured on `/members` at 360px: `AppShell`'s `px-4` leaves 328, the
       * card border 326, and this row's own `px-4` 294px of usable line. The
       * three row triggers ("Ficha médica", "Pagos", "Editar") need ~286. It
       * fit by eight pixels.
       *
       * At 320px, or at 360px with the OS text size above 100%, it does not,
       * and both halves of the old declaration made that unrecoverable:
       * `flex-none` sizes this box to its content so it overflows the line
       * whole rather than letting its children move down, and `Button`'s
       * `whitespace-nowrap` stops each one shrinking. `card overflow-hidden`
       * on the page behind then clipped the result with no scrollbar —
       * "Editar" was simply not reachable.
       *
       * `justify-end` keeps the group against the row's trailing edge on the
       * line it wraps onto, which is where it sits when it does not wrap.
       */}
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </li>
  );
}

/** The outer frame every `DataRow` list shares: a border and inner hairlines. */
export function DataRowList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <ul className={cn("divide-y divide-line overflow-hidden rounded-card border border-line", className)}>
      {children}
    </ul>
  );
}
