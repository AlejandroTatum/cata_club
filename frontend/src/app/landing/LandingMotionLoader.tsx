"use client";

import { useEffect, useState } from "react";

type MotionComponent = () => null;

/**
 * Loads `LandingMotion` (GSAP + its plugins + Lenis) as progressive
 * enhancement after the server-rendered landing has already painted.
 *
 * This is a plain `import()` behind a `useEffect`, not `next/dynamic`, for
 * two things `next/dynamic`'s `React.lazy` boundary cannot give us on its
 * own:
 *
 * - it lets a rejected import fail silently instead of throwing during
 *   render — there is no error boundary around the landing, so an uncaught
 *   `React.lazy` rejection would unmount the whole page;
 * - it lets the import never happen at all when the visitor prefers reduced
 *   motion, because the server-rendered markup already *is* the
 *   reduced-motion end state: none of `[data-reveal]`, `[data-split]`,
 *   `[data-hero-parallax]`, `[data-media-reveal]`, or `[data-rule]` carry a
 *   hidden-by-default rule in `landing.css` — the motion layer only ever
 *   animates content that is already visible without it.
 *
 * Re-checks the media query on every `change` event so a preference toggled
 * mid-session (not just at load) is honored in both directions: switching to
 * "reduce" unmounts the runtime (running its own cleanup), switching back
 * mounts it again from the (already cached) module.
 */
export default function LandingMotionLoader(): React.ReactElement | null {
  const [Motion, setMotion] = useState<MotionComponent | null>(null);

  useEffect((): (() => void) => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;

    const sync = (): void => {
      if (media.matches) {
        setMotion(null);
        return;
      }
      import("./LandingMotion")
        .then((mod): void => {
          if (!cancelled) setMotion((): MotionComponent => mod.default);
        })
        .catch((error: unknown): void => {
          // No fallback UI needed: the server-rendered page is already the
          // complete, usable static page this leaves in place.
          console.error("[landing] motion runtime failed to load", error);
        });
    };

    sync();
    media.addEventListener("change", sync);
    return (): void => {
      cancelled = true;
      media.removeEventListener("change", sync);
    };
  }, []);

  return Motion ? <Motion /> : null;
}
