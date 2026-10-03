"use client";

import { useEffect, useRef } from "react";

/**
 * The card grid of the Horarios section, plus the one scroll cue its entrance
 * needs. The grid renders fully visible (server render, no JavaScript, reduced
 * motion); once mounted and only if motion is welcome, it is "armed" — cards
 * hold back — and flips to "in" the first time it scrolls into view, which
 * lets landing.css play the staggered rise. Plain DOM attributes, so the cue
 * costs no re-render and no inline script.
 */
export default function ScheduleReveal({ children }: { children: React.ReactNode }): React.ReactElement {
  const grid = useRef<HTMLUListElement>(null);

  useEffect((): (() => void) | void => {
    const node = grid.current;
    if (node === null) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (calm || typeof IntersectionObserver === "undefined") return;
    node.dataset.scheduleReveal = "armed";
    const observer = new IntersectionObserver((entries): void => {
      if (!entries.some((entry): boolean => entry.isIntersecting)) return;
      node.dataset.scheduleReveal = "in";
      observer.disconnect();
    }, { threshold: 0.12 });
    observer.observe(node);
    return (): void => observer.disconnect();
  }, []);

  return <ul ref={grid} className="landing-schedule-grid" aria-label="Categorías">{children}</ul>;
}
