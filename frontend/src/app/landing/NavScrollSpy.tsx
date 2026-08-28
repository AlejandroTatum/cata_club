"use client";

import { useEffect, useRef } from "react";
import { SITE_NAV_SECTIONS } from "@/lib/site-navigation";

/**
 * Read from the navbar's own definition, never re-listed here: a spy watching a
 * different set of sections than the bar it highlights is a silent failure —
 * the link is drawn, it just never lights up.
 */
const SECTION_IDS = SITE_NAV_SECTIONS.map((section): string => section.id);

/**
 * Highlights the navbar anchor that matches the section currently in view.
 *
 * Uses a native `IntersectionObserver` with the prototype's `rootMargin` so the
 * active link updates as a section's middle band crosses the viewport centre.
 * It does not depend on GSAP, Lenis, or scroll-event listeners, and it only
 * touches the six navbar anchors — nothing else.
 *
 * SSR leaves the `Inicio` link active (the server-rendered markup already does),
 * and this effect only takes over after hydration.
 */
export default function NavScrollSpy(): React.ReactElement | null {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect((): (() => void) => {
    if (typeof IntersectionObserver === "undefined") return (): void => {};

    const nav = document.querySelector<HTMLElement>(".landing-nav-links");
    if (!nav) return (): void => {};

    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>("a[href^=\"#\"]"));
    const targets = SECTION_IDS
      .map((id): { id: string; element: HTMLElement | null } => ({ id, element: document.getElementById(id) }))
      .filter((entry): entry is { id: string; element: HTMLElement } => entry.element !== null);

    const setActive = (activeId: string): void => {
      links.forEach((link): void => {
        const href = link.getAttribute("href") ?? "";
        const isActive = href === `#${activeId}`;
        link.classList.toggle("active", isActive);
        if (isActive) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]): void => {
      // Pick the intersecting entry with the largest ratio; if none, leave the
      // current active link alone. Store the target id rather than an entry so
      // TypeScript does not have to reason across the callback boundary.
      let bestId: string | null = null;
      let bestRatio = -1;
      entries.forEach((entry): void => {
        if (!entry.isIntersecting || entry.intersectionRatio <= bestRatio) return;
        bestId = entry.target.id;
        bestRatio = entry.intersectionRatio;
      });
      if (bestId) setActive(bestId);
    };

    observerRef.current = new IntersectionObserver(handleIntersection, {
      rootMargin: "-45% 0px -50% 0px",
      threshold: [0, 0.25, 0.5, 0.75, 1],
    });

    targets.forEach(({ element }): void => observerRef.current?.observe(element));

    return (): void => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return null;
}
