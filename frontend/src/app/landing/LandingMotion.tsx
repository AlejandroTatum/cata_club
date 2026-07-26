"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

export default function LandingMotion(): null {
  useEffect((): (() => void) => {
    gsap.registerPlugin(ScrollTrigger);
    const media = gsap.matchMedia();
    let lenis: Lenis | null = null;
    const updateLenis = (time: number): void => lenis?.raf(time * 1000);

    media.add("(prefers-reduced-motion: no-preference)", (): (() => void) => {
      lenis = new Lenis({ duration: 0.85, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(updateLenis);
      gsap.ticker.lagSmoothing(0);

      const context = gsap.context((): void => {
        gsap.utils.toArray<HTMLElement>("[data-motion-section]").forEach((section): void => {
          const targets = section.querySelectorAll<HTMLElement>("[data-reveal]");
          if (targets.length > 0) {
            gsap.from(targets, {
              y: 40,
              opacity: 0,
              duration: 0.7,
              stagger: 0.1,
              ease: "power3.out",
              immediateRender: false,
              scrollTrigger: { trigger: section, start: "top 82%", once: true },
            });
          }
        });

        gsap.to("[data-hero-parallax]", {
          yPercent: 8,
          ease: "none",
          scrollTrigger: { trigger: ".landing-hero", start: "top top", end: "bottom top", scrub: 0.5 },
        });

        // No count-up on the trust band. It seeded itself at 0 and overwrote
        // `textContent`, so any trigger that failed to fire left the real figure
        // replaced by 0 — the reveals carry `immediateRender: false` for exactly
        // that reason, and a two-digit odometer was not worth the same guard.
      });

      return (): void => context.revert();
    });

    media.add("(prefers-reduced-motion: reduce)", (): void => {
      gsap.set("[data-reveal], [data-hero-parallax]", { clearProps: "all" });
    });

    return (): void => {
      media.revert();
      gsap.ticker.remove(updateLenis);
      lenis?.destroy();
      ScrollTrigger.getAll().forEach((trigger): void => trigger.kill());
    };
  }, []);

  return null;
}
