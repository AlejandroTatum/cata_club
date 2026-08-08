/**
 * BackLink — the one back control for the whole system.
 *
 * Two rules from design review, both enforced here rather than left to each
 * screen's judgment:
 *
 * 1. A visible border, not a bare underlined link the user has to notice on
 *    their own. It borrows `Button`'s `secondary` skin — `Button.tsx` already
 *    documents that skin as exported "so anchors and next/link can wear the
 *    button skin without cloning the values" — so this is the same border
 *    every other secondary control in the product wears, not a new one.
 * 2. The label always names the destination ("Volver a la cola", "Volver a
 *    miembros"), never a bare "Volver" — a control that does not say where it
 *    goes is not a promise. That rule is a runtime guard, not a comment: a
 *    label that is empty or reduces to the bare verb throws in development,
 *    the same way a missing required prop would.
 *
 * Placement is a page convention, not a CSS position: it renders above and to
 * the left of the page title, directly before `PageHeader` in the page's own
 * markup — same document flow every other page furniture uses.
 */

import Link from "next/link";
import type { ReactElement } from "react";
import { ArrowLeft } from "lucide-react";
import { buttonClasses } from "./Button";
import { ICON } from "@/lib/icon-size";
import { cn } from "./cn";

export interface BackLinkProps {
  /** Where the control navigates to. */
  href: string;
  /** Must name the destination — see the module doc for the bare-"Volver" guard. */
  label: string;
  className?: string;
}

export default function BackLink({ href, label, className }: BackLinkProps): ReactElement {
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
    <Link href={href} className={buttonClasses("secondary", "sm", cn("gap-1.5", className))}>
      <ArrowLeft size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}
