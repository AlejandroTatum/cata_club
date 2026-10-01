/**
 * InfoPanel — the calm side card a short admin screen puts in its `PAGE_RAIL`
 * column: a title, then a few facts or a sentence of guidance.
 *
 * It exists so `/tarifas`, `/discounts`, `/groups` and the error-report inbox
 * fill the second column with the same card instead of four hand-rolled ones.
 * It is deliberately content-agnostic: callers pass what is already loaded on
 * their screen.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export interface InfoPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
  /**
   * `"div"` when the panel already sits inside a labelled `<aside>` of the
   * page, so the landmark is not nested inside itself.
   */
  as?: "aside" | "div";
}

export default function InfoPanel({
  title,
  children,
  className,
  as: Tag = "aside",
}: InfoPanelProps): ReactElement {
  return (
    <Tag
      aria-label={Tag === "aside" ? title : undefined}
      className={cn("card flex flex-col gap-section p-[18px]", className)}
    >
      <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
        {title}
      </h2>
      <div className="flex flex-col gap-2 text-sm text-ink-2">{children}</div>
    </Tag>
  );
}
