/**
 * BackLink — the one back control for the whole system.
 *
 * Two rules from design review, both enforced here rather than left to each
 * screen's judgment:
 *
 * 1. A visible box, not a bare underlined link the user has to notice on their
 *    own. Issue #202 asked for that box — compact secondary navigation with a
 *    real edge — and the box stays. What the control no longer wears is the
 *    RED: see "The red is gone, the box is not" below.
 * 2. The label always names the destination ("Volver a Mi día", "Volver al
 *    Panel de Control"), never a bare "Volver" — a control that does not say
 *    where it goes is not a promise. That rule used to be a runtime guard over
 *    a string each caller wrote; the string is no longer a caller's to write.
 *    The control takes an `href` and asks `lib/destinations.ts` what that place
 *    is called, so the label cannot disagree with the rail that draws the same
 *    destination, and the guard now lives where the label is made — an href
 *    nobody registered throws there, for the same reason a bare "Volver" used
 *    to throw here.
 *
 * ## The red is gone, the box is not
 *
 * The original skin was an institutional red outline, chosen as "the primary
 * CTA's lighter echo". Two things were wrong with that, and D12b of
 * `docs/ux/rediseno-visual-2026-08.md` settles both.
 *
 * A red outline says *this matters*, and back is the LEAST important control on
 * any screen it appears on — it is the way out of a page the user is already
 * done with, sitting above a heading whose actual primary action is somewhere
 * to the right in filled red. The two were speaking at nearly the same volume.
 *
 * And it was a fifth vocabulary. The system has four button skins (`primary`,
 * `secondary`, `dark`, `tertiary`); a red-outlined 32px pill that is none of
 * them reads as a button anyway, so the screen offered five weights where the
 * design system declares four.
 *
 * The fix is not to take the box away — #202's decision survives intact, and
 * the product owner rejected boxless controls in as many words ("no me gustan
 * los botones vacíos o sin box"). It is to wear the QUIETEST box the system
 * already has: `Button`'s `tertiary` skin, reused rather than cloned, so the
 * lightest weight in the vocabulary is one recipe and not two that drift.
 *
 * ## Two skins, because there are two backgrounds
 *
 * The product had a SECOND back control, and this is what absorbs it: the auth
 * screens' coal panel carried a bare grey link, 24px tall, no box — under the
 * system's own control height and in flat contradiction of #202, purely because
 * the light skin would have been unreadable there. So the tone is a prop. On
 * coal the box is white at 10% with white text, hovering to 18% with a visible
 * white border; the numbers are measured in `lib/__tests__/color-contrast.test.ts`
 * alongside the light pair.
 *
 * The shape does not change with the tone: 32px (`h-ctl-sm`, the system's `sm`
 * control metric and comfortably over WCAG 2.2 SC 2.5.8's 24×24 target), 10px
 * radius, arrow then label.
 *
 * ## Placement, and the optional handler
 *
 * Placement is a page convention, not a CSS position: it renders above and to
 * the left of the page title, directly before `PageHeader` in the page's own
 * markup — same document flow every other page furniture uses. It carries no
 * margin of its own; the page's spacing rules apply (the retired
 * `components/BackLink.tsx` baked in `mb-6`, which screens now pass explicitly
 * when they need it).
 *
 * `onClick` is optional and additive to the navigation, not a replacement for
 * `href` — mirroring the guard the legacy `components/BackLink.tsx` already
 * exposed. It exists for the master-detail screens where "back" is an in-page
 * state reset rather than a route change (e.g. payments' queue ⇄ detail swap):
 * `href` still names a real, keyboard- and screen-reader-reachable fallback
 * destination, while `onClick` does the actual state change. That href is now
 * load-bearing twice over, since it is also what the label is read from.
 */

import Link from "next/link";
import type { MouseEvent, ReactElement } from "react";
import { ArrowLeft } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { backLabel } from "@/lib/destinations";
import { buttonSkin } from "./Button";
import { cn } from "./cn";

/** Which field the control is standing on — see the module doc. */
export type BackLinkTone = "light" | "coal";

export interface BackLinkProps {
  /**
   * Where the control navigates to, AND what it is called: the label is read
   * from `lib/destinations.ts` by this exact pathname. An href with no entry
   * there throws rather than rendering a control that cannot name its own
   * destination.
   */
  href: string;
  /** The field behind the control. Defaults to the light app surfaces. */
  tone?: BackLinkTone;
  className?: string;
  /** Runs alongside the navigation — see the module doc. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Shape and typography, shared by both tones — the `sm` control metrics.
 *
 * `self-start`: several screens render this as a direct child of `AppShell`'s
 * `<main>`, a flex column with the default `align-items: stretch` — without
 * this, the control stretches to the panel's full width instead of hugging its
 * own content. Row-context callers (`payments`' `items-center`, `enroll`'s
 * `items-baseline`) are unaffected for a narrower reason than "align-self does
 * nothing in a row" — it does govern vertical placement there. It changes
 * nothing because this control is the TALLEST item in both of those rows
 * (`h-ctl-sm` = 32px, against a 24px help trigger and 32px `sm` buttons), so it
 * already spans the whole flex line: start, center and baseline all resolve to
 * the same top edge.
 */
const SHAPE =
  "inline-flex h-ctl-sm items-center justify-center gap-1.5 self-start whitespace-nowrap " +
  "rounded-ctl border px-3 text-xs font-semibold transition-colors duration-150";

/**
 * The light skin IS `Button`'s `tertiary`, taken from the primitive rather than
 * copied out of it: `sunken` fill, transparent border, `ink-2` label, hovering
 * one rung up the surface ladder to `line` with `ink`. `buttonSkin` hands over
 * those colours without the button's shape, because a back control is a LINK
 * with a button's weight, not a button — the height, radius and gap are this
 * file's (D12b writes 32px at the 10px control radius, which is neither of the
 * two button sizes), the colours are the system's.
 *
 * `focus-visible` is not declared: `globals.css` paints the system focus
 * indicator from a 0,3,0 selector on every focusable element, which outranks a
 * `focus-visible:*` utility anyway. The old red skin declared its own wash and
 * it never rendered.
 */
const TONE: Record<BackLinkTone, string> = {
  light: buttonSkin("tertiary"),
  // On coal there is no `sunken` to sit in — the ladder's three surfaces are
  // defined for light fields only, which is why `Button` grew `onCoal` for the
  // same problem. This is that idea at the tertiary weight: a translucent white
  // fill instead of `onCoal`'s transparent one, because the box has to be
  // visible at rest here and `onCoal` only draws its border until you hover.
  coal:
    "bg-white/10 border-transparent text-white " +
    "hover:bg-white/[0.18] hover:border-white/30",
};

export default function BackLink({
  href,
  tone = "light",
  className,
  onClick,
}: BackLinkProps): ReactElement {
  return (
    <Link href={href} onClick={onClick} className={cn(SHAPE, TONE[tone], className)}>
      <ArrowLeft size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
      {backLabel(href)}
    </Link>
  );
}
