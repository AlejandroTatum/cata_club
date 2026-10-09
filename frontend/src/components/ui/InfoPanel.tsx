/**
 * InfoPanel — the calm side card a short admin screen puts in its `PAGE_RAIL`
 * column: a title, then a few facts or a sentence of guidance.
 *
 * It exists so `/tarifas`, `/discounts`, `/groups` and the error-report inbox
 * fill the second column with the same card instead of four hand-rolled ones.
 * It is deliberately content-agnostic: callers pass what is already loaded on
 * their screen.
 */

"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ICON } from "@/lib/icon-size";
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
  /**
   * Help is collapsed below `lg` behind a disclosure (from `lg` it is always
   * open). A panel that holds the screen's own data — what to review, what is
   * pending — passes `false`: it must never hide on a phone.
   */
  collapsible?: boolean;
}

/**
 * The panel is the quiet voice of the screen (T14 RC3): a flat sunken surface
 * with a hairline, no sticker outline or shadow, so the data card beside it is
 * the one thing that carries the weight. Whether the body is hidden is a pure
 * CSS matter from `lg` (`lg:flex`), so a desktop never waits for a hydration
 * pass to see the help it always had.
 */
export default function InfoPanel({
  title,
  children,
  className,
  as: Tag = "aside",
  collapsible = true,
}: InfoPanelProps): ReactElement {
  const [open, setOpen] = useState(false);
  const hidden = collapsible && !open;

  return (
    <Tag
      aria-label={Tag === "aside" ? title : undefined}
      className={cn("relative flex flex-col gap-3 rounded-card border border-line bg-sunken p-4", className)}
    >
      <h2 className="font-display text-base leading-tight tracking-flat text-ink max-lg:pr-9">{title}</h2>
      {collapsible && (
        // Spans the header row (title included) so the whole row is the tap
        // target below `lg`; from `lg` it is gone and the body is always shown.
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Ocultar" : "Mostrar"} ${title}`}
          onClick={(): void => setOpen((value) => !value)}
          className="absolute inset-x-0 top-0 flex h-[52px] items-center justify-end rounded-card px-3 text-ink-3 hover:text-ink lg:hidden"
        >
          <ChevronDown
            size={ICON.base}
            strokeWidth={2}
            aria-hidden="true"
            className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
      )}
      <div className={cn("flex flex-col gap-2 text-sm text-ink-2 lg:flex", hidden && "max-lg:hidden")}>
        {children}
      </div>
    </Tag>
  );
}
