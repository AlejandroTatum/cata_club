/**
 * PageHeader — eyebrow, visible page title, optional subtitle and actions.
 *
 * `_sistema.css`: `.rowline` (:160) for the row, `.eye` (:154 — 10.5px/700
 * /.13em uppercase `--ink-3`, 3px bottom margin) for the eyebrow, `.h-page`
 * (:153 — 26px/800/-.03em) for the title, `.muted` (:156 — 13px `--ink-3`)
 * for the subtitle. The pattern is used on 09, 07, 12, 13, 14, 18, 20, 21,
 * 23, 24 and 25.
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
  /** Small uppercase context line above the title, e.g. "Comunidad del club". */
  eyebrow?: string;
  title: string;
  /** One short sentence. Optional — most screens do not need it. */
  subtitle?: string;
  /** Trailing controls, typically a single primary or dark button. */
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps): ReactElement {
  return (
    <header className={cn("flex flex-wrap items-center gap-3", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          // `ink-3-strong`, not `ink-3`: the eyebrow is the smallest type in
          // the product (10.5px) and it always sits on the `canvas` grey the
          // shell paints behind the header, where `ink-3` measures 4.24:1 and
          // misses AA. One rule, so every screen's kicker is fixed at once.
          <p className="mb-[3px] text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-3-strong">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">{title}</h1>
        {/* Same surface as the eyebrow, same correction: 13px/400 `ink-3` on
            the `canvas` grey is 4.24:1, and the subtitle is normal-size text,
            so AA asks for the full 4.5:1 here too. */}
        {subtitle ? <p className="mt-1 text-[13px] text-ink-3-strong">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
