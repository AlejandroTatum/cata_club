"use client";

import { useEffect } from "react";

/**
 * Open locks, shared so stacked overlays (a dialog opened from the drawer)
 * restore the page only when the LAST one closes.
 */
let activeLocks = 0;
let previousOverflow = "";

/**
 * Freezes the page behind a modal surface while `locked` is true. Without it,
 * wheeling or dragging over the backdrop scrolls the document underneath
 * (measured: `scrollY` 0 → 600 on a phone with a dialog open).
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    if (activeLocks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    activeLocks += 1;
    return () => {
      activeLocks -= 1;
      if (activeLocks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [locked]);
}
