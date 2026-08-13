/**
 * BackLink — the one back control for the whole system.
 *
 * Two rules from design review, both enforced here rather than left to each
 * screen's judgment:
 *
 * 1. A visible border, not a bare underlined link the user has to notice on
 *    their own. It wears the institutional red outline specified by issue
 *    #202 — compact secondary navigation — rather than `Button`'s `secondary`
 *    skin, because the two controls have different jobs: a secondary button
 *    and a back link can sit on the same screen, and a back link that dressed
 *    as a button would blur the hierarchy the issue draws. The filled
 *    `primary` CTA keeps the only solid red; this control is its lighter
 *    outline echo, so it never competes with the screen's primary action.
 * 2. The label always names the destination ("Volver a la cola", "Volver a
 *    miembros"), never a bare "Volver" — a control that does not say where it
 *    goes is not a promise. That rule is a runtime guard, not a comment: a
 *    label that is empty or reduces to the bare verb throws in development,
 *    the same way a missing required prop would.
 *
 * ## The red, chosen for AA, not for looks
 *
 * `tailwind.config.ts` documents `cata-red` as a FILL: white on it is 5.0:1,
 * but as 12–14px text on the deepened canvas it measures 4.10:1 — under AA.
 * So the skin wears the same ramp's darker stop for text and icon
 * (`cata-red-dark`, 7.0:1 on canvas, 7.7:1 on paper) and keeps the fill red
 * for the border, which only needs 3:1 against the page. Hover and
 * focus-visible share a light red wash (`bg-cata-red/10`) — clearly visible,
 * still secondary.
 *
 * The control shape is the system's `sm` control metric (`h-ctl-sm`, 32px),
 * which is also the accessible minimum pointer/touch target (WCAG 2.2
 * SC 2.5.8 wants 24×24; 32px is the product's own compact control height).
 *
 * Placement is a page convention, not a CSS position: it renders above and to
 * the left of the page title, directly before `PageHeader` in the page's own
 * markup — same document flow every other page furniture uses. It carries no
 * margin of its own; the page's spacing rules apply (the retired
 * `components/BackLink.tsx` baked in `mb-6`, which screens now pass
 * explicitly when they need it).
 *
 * `onClick` is optional and additive to the navigation, not a replacement for
 * `href` — mirroring the guard the legacy `components/BackLink.tsx` already
 * exposed. It exists for the master-detail screens where "back" is an in-page
 * state reset rather than a route change (e.g. payments' queue ⇄ detail
 * swap): `href` still names a real, keyboard- and screen-reader-reachable
 * fallback destination, while `onClick` does the actual state change.
 */

import Link from "next/link";
import type { MouseEvent, ReactElement } from "react";
import { ArrowLeft } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { cn } from "./cn";

export interface BackLinkProps {
  /** Where the control navigates to. */
  href: string;
  /** Must name the destination — see the module doc for the bare-"Volver" guard. */
  label: string;
  className?: string;
  /** Runs alongside the navigation — see the module doc. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** Compact secondary navigation: red outline, transparent resting surface. */
const SKIN =
  // Shape + typography + focus transition, matching the `sm` button metrics.
  // `self-start`: several screens render this as a direct child of
  // `AppShell`'s `<main>`, a flex column with the default `align-items:
  // stretch` — without this, the control stretches to the panel's full
  // width instead of hugging its own content. Row-context callers
  // (`payments`, `enroll`) are unaffected: `align-self` only governs the
  // cross axis, which is height there, and this control's height is already
  // pinned by `h-ctl-sm`.
  "inline-flex h-ctl-sm items-center justify-center gap-1.5 self-start whitespace-nowrap rounded-lg border px-3 text-xs font-semibold " +
  "transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 " +
  // Resting: institutional red outline on a transparent surface.
  "border-cata-red bg-transparent text-cata-red-dark " +
  // Hover/focus: a clearly visible red wash, still lighter than the primary CTA.
  "hover:bg-cata-red/10 hover:border-cata-red-dark hover:text-cata-red-dark " +
  "focus-visible:bg-cata-red/10 focus-visible:border-cata-red-dark focus-visible:text-cata-red-dark";

export default function BackLink({
  href,
  label,
  className,
  onClick,
}: BackLinkProps): ReactElement {
  if (process.env.NODE_ENV !== "production") {
    const bare = label.trim().toLowerCase();
    if (bare === "" || bare === "volver") {
      throw new Error(
        'BackLink requires a label that names its destination (e.g. "Volver a la cola") ' +
          '— a bare "Volver" is not a promise of where it goes.',
      );
    }
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(SKIN, className)}
    >
      <ArrowLeft size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}
