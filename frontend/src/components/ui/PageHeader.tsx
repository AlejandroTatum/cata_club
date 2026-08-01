/**
 * PageHeader — visible page title, optional subtitle and actions.
 *
 * `_sistema.css`: `.rowline` (:160) for the row, `.h-page` (:153 —
 * 26px/800/-.03em) for the title, `.muted` (:156 — 13px `--ink-3`) for the
 * subtitle. The pattern is used on 09, 07, 12, 13, 14, 18, 20, 21, 23, 24
 * and 25.
 *
 * Why it matters: `AppShell` currently renders its `<h1>` as `sr-only`, so no
 * authenticated screen shows its own name on screen. This component renders a
 * REAL, visible `<h1>` — Phase 3 wires it into each page.
 *
 * The prototypes tag the title `<h2 class="h-page">` only because the review
 * chrome around each mock already owns the document `<h1>`. In the app there
 * is no such wrapper, so the element here is an `<h1>`.
 */

import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  title: string;
  /** One short sentence. Optional — most screens do not need it. */
  subtitle?: string;
  /** Trailing controls, typically a single primary or dark button. */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps): ReactElement {
  return (
    <header className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-extrabold text-ink">{title}</h1>
        {/* `ink-3-strong`, not `ink-3`: 13px/400 `ink-3` on the `canvas` grey
            the shell paints behind the header is 4.24:1, and the subtitle is
            normal-size text, so AA asks for the full 4.5:1 here. */}
        {subtitle ? <p className="mt-1 text-[13px] text-ink-3-strong">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
