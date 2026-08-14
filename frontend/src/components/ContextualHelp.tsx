"use client";

import { useState, type ReactNode } from "react";

interface ContextualHelpProps {
  title: string;
  children: ReactNode;
}

export default function ContextualHelp({ title, children }: ContextualHelpProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `contextual-help-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  // No margin of its own. `docs/ux/ritmo-vertical.md` is explicit that no rule
  // in the system separates two blocks with a margin — the distance is a `gap`
  // on the column that holds them. The `mt-3` this used to carry was a fourth
  // distance nobody declared: under the shell's `gap-page` column it simply
  // added 12px on top of the 20px step, and inside a panel it fought that
  // panel's own gap. `FilterPanel` states the same rule for itself.
  return (
    <div>
      <button
        type="button"
        onClick={(): void => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={title}
        // Not red. The brand red is reserved for the primary CTA and for
        // destructive intent, and as 12px type it measures 4.10:1 on the page
        // field (it was 4.59:1 on the old near-white canvas, i.e. always
        // marginal). Ink plus an underline says "control" without spending
        // the CTA colour on a disclosure toggle: 7.16:1 on canvas.
        className="text-xs font-semibold text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        {isOpen ? "Ocultar ayuda" : "Ver ayuda"}
      </button>
      {isOpen && (
        <section
          id={panelId}
          role="region"
          aria-label={title}
          // An area HUNDIDA inside the block that opened it — `sunken` plus a
          // `line` hairline, at the control radius. It used to be `rounded-lg`
          // (8px) over `cata-bg`/`cata-border`, i.e. a radius the system does
          // not have filled with the palette the foundation retired. The panel
          // is not a card: it is the inside of one, so it takes the same
          // treatment the system gives every other sunken area.
          //
          // `mt-2` stays, and it is not the `mt-3` this component lost. That
          // one separated the disclosure from its NEIGHBOURS, which is the
          // column's job; this one separates the panel from the toggle that
          // owns it, inside one block, which is the field step.
          className="mt-field rounded-ctl border border-line bg-sunken p-3 text-xs leading-relaxed text-ink-2"
        >
          {children}
        </section>
      )}
    </div>
  );
}
