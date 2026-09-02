/**
 * ScrollableTable — the horizontally scrollable wrapper every "table that can
 * outgrow its column, so it scrolls sideways instead" container uses (#821).
 *
 * A bare `<div className="overflow-x-auto">` holds no focusable content of
 * its own: a keyboard user tabbing through the page has no way to reach it,
 * and therefore no way to trigger the scroll it exists for. On mobile — where
 * a wide table never fits and scrolling is the only way to read the rest of
 * it — that is exactly where axe's `scrollable-region-focusable` (serious)
 * fires: `/ayuda`'s schedule table and `/reports`' listing were both found
 * this way.
 *
 * `tabIndex={0}` puts the container in the tab order, `role="region"` +
 * `aria-label` names what is being scrolled so a screen reader announces a
 * landmark instead of an anonymous `<div>`, and the system-wide focus ring
 * (`globals.css`, the `[tabindex]:not([tabindex="-1"])` rule) paints on it
 * automatically once it is reachable — there is nothing extra to opt into
 * here. A container that happens to always fit its content is harmless to
 * still make focusable; it never receives `tabindex` on the surrounding
 * layout, only on the scroll region itself.
 */
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export interface ScrollableTableProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Names what is being scrolled for assistive tech, e.g.
   * "Horarios, tabla desplazable" or "Listado de pagos, tabla desplazable".
   */
  label: string;
  children: ReactNode;
}

export default function ScrollableTable({
  label,
  children,
  className,
  ...rest
}: ScrollableTableProps): ReactElement {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("overflow-x-auto", className)} {...rest}>
      {children}
    </div>
  );
}
