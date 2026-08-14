/**
 * EmptyState — the one empty-state treatment.
 *
 * `_sistema.css` `.emptyst` (:400-403): centered column, 10px gap, 44px/24px
 * padding, a 46px `--neutral-bg` disc holding the icon, a 15px bold title and
 * a `.muted` line. `29-estados.html:67-72` completes the pattern: the body
 * copy is capped at 44ch and the action sits 4px below it.
 *
 * The icon is `ICON.lg` (24px), where the prototype declared 21px. Of the six
 * discs `_sistema.css` draws, this 46px one held the least ink of any — the
 * step brings it to the same fill as the 104px auth disc.
 *
 * The audit found four different empty-state treatments across the app. This
 * is the one they collapse into. An empty state without a next action is a
 * dead end, so `action` should be supplied whenever one exists.
 *
 * ## The surface belongs to the component now
 *
 * It used to draw no surface at all, which left every caller to supply one —
 * and twenty-two call sites produced FOUR answers: ten wrapped it in a card,
 * eleven let it fall inside a card the screen had already opened, and three
 * gave it nothing, so the state floated bare on the canvas while the same
 * state on the next screen sat on paper.
 *
 * The default is `card`, because "there is nothing here" is a statement the
 * product makes on a surface, like every other statement it makes. The escape
 * is `surface="inset"`, for the case that is genuinely different: the screen
 * already opened a card with its own header ("Actividad reciente", "Sesiones"),
 * and the empty state is the BODY of that card rather than a second one nested
 * inside it.
 *
 * ## The dead air under it, and why the statement is centred rather than split
 *
 * D11b made dead air a measured number that goes into the PR. `/members`
 * reports 25% — 227px — the moment a search finds nobody: three short lines
 * keep their own height and the rest of the column stays bare canvas
 * underneath. `fill` stretches the card to the column, so the surplus lands
 * inside the surface instead of under it.
 *
 * The obvious next move is to pin the action to the foot with `mt-auto`, and
 * this repo has already measured that one. `SessionCard.tsx:26-29` records QA
 * rejecting it in as many words — "`mt-auto` on the actions left the surplus
 * stranded as dead air in the middle instead of respiro under them" — on a
 * card whose body did not grow to meet the actions. The fix there was real
 * content (the rest of the day's sessions). An empty state has none by
 * definition: it is the state of having nothing to show, so it can never grow
 * into the gap, and `mt-auto` would move the hole from below the card to
 * between the description and its button.
 *
 * So the surplus is split above and below the statement. Half the air at each
 * end reads as margin; all of it at one end reads as a mistake.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export interface EmptyStateProps {
  /** A lucide icon at `ICON.lg`. Rendered inside the neutral disc. */
  icon?: ReactNode;
  /** What is empty, in one line. */
  title: string;
  /** What will fill it, in one sentence. */
  description?: string;
  /** The way out — usually a single `Button`. */
  action?: ReactNode;
  /**
   * `card` (default) draws the paper surface. `inset` draws none, for when the
   * screen has already opened a card and this is its body — a card inside a
   * card is a border and a shadow the design never asks for.
   */
  surface?: "card" | "inset";
  /**
   * Stretch to the column this stands in, and centre the statement inside the
   * stretched surface. See the note on dead air above.
   *
   * Off by default: the twenty-two existing call sites sit in columns that are
   * not full-height, and a `flex-1` there would stretch the card against
   * whatever happens to be beside it.
   */
  fill?: boolean;
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  surface = "card",
  fill = false,
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2.5 px-6 py-11 text-center",
        fill && "flex-1 justify-center",
        surface === "card" && "card",
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
      <b className="text-base font-bold text-ink">{title}</b>
      {description ? (
        <p className="max-w-[44ch] text-sm text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
