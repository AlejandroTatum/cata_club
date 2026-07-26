/**
 * BackLink — shared in-page "back" navigation control.
 *
 * Always navigates to a fixed, known parent route via next/link, matching
 * the visual style already used in payments/forgot-password/reset-password
 * (ArrowLeft icon, size 14, strokeWidth 1.5).
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface BackLinkProps {
  href: string;
  label: string;
  className?: string;
  /**
   * Optional guard for screens where leaving costs something (the roll call's
   * in-progress marks). Call `preventDefault()` to hold the navigation and ask
   * first; doing nothing leaves the link behaving exactly as it always has.
   */
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export default function BackLink({ href, label, className, onClick }: BackLinkProps): React.ReactElement {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={
        className ??
        // No colour of its own: `.btn-ghost` owns it. The `text-cata-text/65`
        // that used to sit here composited to 4.34:1 on the page field once
        // the canvas deepened (it was 4.58:1 on the old near-white one), and
        // it overrode the class it was decorating on all seven screens that
        // render this link.
        "btn-ghost mb-6 -ml-2 inline-flex items-center gap-1 text-xs"
      }
    >
      <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
      {label}
    </Link>
  );
}
