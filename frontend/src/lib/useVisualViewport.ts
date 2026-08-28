"use client";

import { useEffect, useState } from "react";

export interface VisualViewportGeometry {
  /** Where the visible area starts inside the layout viewport. */
  top: number;
  /** How tall the visible area is right now. */
  height: number;
  /** How much of the layout viewport the virtual keyboard is eating. */
  keyboardInset: number;
}

/**
 * What the user can actually SEE, measured from `visualViewport` rather than
 * assumed.
 *
 * `100vh` — and `100%`, and `inset-0` — are the LAYOUT viewport, which on a
 * phone browser is deliberately not what the user can see: it stays tall behind
 * a collapsed URL bar, and it does not move at all when the virtual keyboard
 * opens. A surface sized to it puts its own composer under the keys, which is
 * the exact complaint in #644. `100dvh` fixes the URL bar and still says
 * nothing about the keyboard.
 *
 * `visualViewport` is the only surface that answers both questions, so the two
 * numbers it gives — `offsetTop` and `height` — become the surface's `top` and
 * `height`, republished by the caller as CSS variables so a breakpoint can
 * still override them (an inline style cannot carry a media query; a variable
 * it reads can be left unread).
 *
 * ## Why this is here and not in `ChatWidget`
 *
 * It WAS in `ChatWidget`, as a private `useSheetGeometry`, and that was the
 * whole of issue #767's second cause: `visualViewport` appeared in exactly one
 * file in the repository, so the three `/members` dialogs — `position: fixed`,
 * promoted to the top layer, clamped in `dvh` — stayed centred at full height
 * with the keyboard covering half the screen. Moving the hook rather than
 * writing a second one is the point: two mechanisms for one measurement drift,
 * and the arithmetic below (particularly `keyboardInset`, which is a
 * subtraction nobody should redo from memory) is the part that must not.
 *
 * `active` gates the subscription so a closed sheet or an unmounted dialog
 * holds no listeners, and returns `null` — which every caller must render as
 * "use the ordinary box", because that is also what a browser with no
 * `visualViewport` at all gives them.
 */
export function useVisualViewportGeometry(active: boolean): VisualViewportGeometry | null {
  const [geometry, setGeometry] = useState<VisualViewportGeometry | null>(null);

  useEffect((): undefined | (() => void) => {
    if (!active) {
      setGeometry(null);
      return undefined;
    }
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    function measure(): void {
      const visible = viewport as VisualViewport;
      const top = Math.max(0, visible.offsetTop);
      setGeometry({
        top,
        height: visible.height,
        // What is left of the layout viewport once the visible area and the
        // offset above it are accounted for: on a phone that is the keyboard.
        keyboardInset: Math.max(0, window.innerHeight - visible.height - top),
      });
    }

    measure();
    // BOTH events. `resize` alone catches the keyboard and misses a pinch-pan,
    // which is the case that leaves a fixed surface anchored off the visible
    // area — the same gesture the 16px floor now prevents from starting.
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    return (): void => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
    };
  }, [active]);

  return geometry;
}
