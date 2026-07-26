/**
 * A one-time explanation for a convention the screen cannot make obvious.
 *
 * ## What earns one
 *
 * Not "how do I use this" — that is a design failure, and a hint is not the
 * fix for it. What earns a hint is a rule that is genuinely arbitrary and that
 * the interface has no way to state in place: the levels ladder puts nivel 1
 * at the TOP because at this club 1 is the best, which is the opposite of what
 * a numbered list normally means. Nobody can deduce that from looking, and
 * nobody needs to be told twice.
 *
 * ## Why a callout and not a floating coach-mark
 *
 * A popover anchored to an element has to be positioned, re-positioned on
 * scroll and resize, kept inside the viewport, and taken out of the way of a
 * screen reader that is already reading the thing it points at. All of that is
 * machinery in service of an arrow. This sits in the flow, immediately above
 * what it explains, and reads correctly in DOM order for anyone who cannot see
 * where an arrow is pointing.
 *
 * ## Dismissal is a promise
 *
 * Once dismissed it never returns, on any device where the same browser
 * profile is used, because `localStorage` outlives the tab. A hint that comes
 * back is worse than no hint at all — it teaches that dismissing controls
 * nothing.
 */

"use client";

import { useEffect, useState } from "react";
import { Lightbulb, X } from "lucide-react";

/** Namespaced alongside the other remembered preferences. */
export function hintKey(id: string): string {
  return `cata:hint:${id}`;
}

export interface FirstRunHintProps {
  /** Stable id. Changing it shows the hint again to everyone — treat as a version. */
  id: string;
  /** The rule, in one sentence. */
  children: React.ReactNode;
  className?: string;
}

export default function FirstRunHint({
  id,
  children,
  className = "",
}: FirstRunHintProps): React.ReactElement | null {
  /**
   * Starts hidden and reveals itself once storage has been read, rather than
   * starting visible and hiding. The other order flashes a hint at every
   * returning user on every page load, which is exactly the "it came back"
   * failure this component promises not to have.
   */
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(hintKey(id)) === null) setVisible(true);
    } catch {
      // Storage unavailable: show nothing rather than show it forever.
    }
  }, [id]);

  function dismiss(): void {
    setVisible(false);
    try {
      window.localStorage.setItem(hintKey(id), "1");
    } catch {
      // It stays gone for this session at least.
    }
  }

  if (!visible) return null;

  return (
    <div
      className={`flex items-start gap-2.5 rounded-ctl border border-line-2 bg-sunken px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-ink-2 ${className}`}
    >
      <Lightbulb size={15} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0 text-ink-3" />
      <p className="min-w-0 flex-1">{children}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Entendido, no mostrar de nuevo"
        className="focus-ring -m-1 shrink-0 rounded p-1 text-ink-3 transition-colors hover:text-ink"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
