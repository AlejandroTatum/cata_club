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
    <header
      className={cn(
        // Stacked by default: at narrow widths, actions competing for space
        // shrank the title's box toward zero (`min-w-0` below) while its
        // text kept painting at full width past that box — the header's own
        // `flex-wrap` never fired because the shrunken boxes still fit on
        // one line. Matches `Pagination`'s `flex-col ... sm:flex-row`: share
        // a row only once a breakpoint gives both parts real room.
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {/* DESIGN.md's `headline` step: Graduate at 26px, uppercase, weight
            400. Three things are deliberate and none of them is decoration.

            · `font-display` has to be ASKED for. The foundation made Barlow the
              default `sans`, so every other string on the screen changed family
              on its own — this one resolved to Barlow and kept resolving to it,
              which is how the product came to contradict its own system in the
              one element that names each screen.
            · `uppercase` is a `text-transform`, never a rewritten `title`.
              Graduate has no lowercase design (`lib/fonts.ts`), so the case is
              part of the face; putting it in the STRING would take the sentence
              away from the code and from the screen reader that announces this
              heading.
            · No weight utility. Graduate ships a single 400 cut, so the
              `font-extrabold` this line used to carry could only have produced a
              synthesised bold — thickened by the browser, not drawn.

            `tracking-flat` contradicts the -0.03em `text-xl` carries: that value
            is calibrated for Barlow's lowercase, and uppercase Graduate is wide
            and flat enough that tightening it closes the counters. The leading
            stays at the step's own 1.15 (DESIGN.md `headline`) — the face has
            almost no vertical range, so a wrapped title needs no extra room. */}
        <h1 className="font-display text-xl uppercase tracking-flat text-ink">{title}</h1>
        {/* `ink-3-strong`, not `ink-3`: 13px/400 `ink-3` on the `canvas` grey
            the shell paints behind the header is 4.24:1, and the subtitle is
            normal-size text, so AA asks for the full 4.5:1 here. */}
        {subtitle ? <p className="mt-1 text-sm text-ink-3-strong">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
