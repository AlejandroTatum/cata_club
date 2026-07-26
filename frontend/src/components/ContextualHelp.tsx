"use client";

import { useState, type ReactNode } from "react";

interface ContextualHelpProps {
  title: string;
  children: ReactNode;
}

export default function ContextualHelp({ title, children }: ContextualHelpProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = `contextual-help-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="mt-3">
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
        className="text-xs font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
      >
        {isOpen ? "Ocultar ayuda" : "Ver ayuda"}
      </button>
      {isOpen && (
        <section
          id={panelId}
          role="region"
          aria-label={title}
          className="mt-2 rounded-lg border border-cata-border bg-cata-bg p-3 text-xs leading-relaxed text-ink-2"
        >
          {children}
        </section>
      )}
    </div>
  );
}
