"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { SplitText } from "gsap/SplitText";
import type { HeroSlideChangeDetail } from "./HeroCarousel";
import Lenis from "lenis";

interface CarouselLoop extends gsap.core.Timeline {
  /** Total travel of one full pass, in pixels. */
  loopWidth: number;
}

/**
 * Builds a seamless horizontal loop over `items` without cloning any nodes:
 * each element gets a tween that carries it off the left edge and a second one
 * that brings it back from the right, offset so the strip never shows a seam.
 *
 * Adapted from GSAP's published `horizontalLoop` helper, trimmed to the options
 * this carousel uses.
 */
function buildHorizontalLoop(items: HTMLElement[], speed: number, gap: number): CarouselLoop {
  const timeline = gsap.timeline({ repeat: -1, defaults: { ease: "none" } }) as CarouselLoop;
  const length = items.length;
  const startX = items[0].offsetLeft;
  const widths: number[] = [];
  const xPercents: number[] = [];
  const pixelsPerSecond = speed * 100;
  const snap = gsap.utils.snap(1);

  /*
   * Measure every item before writing to any of them. The upstream helper
   * computes each `xPercent` inside the `gsap.set` that applies it and then
   * zeroes `x` in a second pass, which reads a value it is about to overwrite
   * while the same batch is already mutating its siblings. Splitting the read
   * from the write keeps the two passes from depending on each other's order,
   * and leaves one write instead of two.
   */
  items.forEach((item, index): void => {
    widths[index] = parseFloat(gsap.getProperty(item, "width", "px") as string);
    xPercents[index] = snap(
      (parseFloat(gsap.getProperty(item, "x", "px") as string) / widths[index]) * 100 +
        (gsap.getProperty(item, "xPercent") as number),
    );
  });
  gsap.set(items, { x: 0, xPercent: (index: number): number => xPercents[index] });

  const last = items[length - 1];
  const loopWidth =
    last.offsetLeft + (xPercents[length - 1] / 100) * widths[length - 1] - startX + last.offsetWidth + gap;

  for (let index = 0; index < length; index += 1) {
    const item = items[index];
    const curX = (xPercents[index] / 100) * widths[index];
    const distanceToStart = item.offsetLeft + curX - startX;
    const distanceToLoop = distanceToStart + widths[index];
    timeline
      .to(item, {
        xPercent: snap(((curX - distanceToLoop) / widths[index]) * 100),
        duration: distanceToLoop / pixelsPerSecond,
      }, 0)
      .fromTo(item, {
        xPercent: snap(((curX - distanceToLoop + loopWidth) / widths[index]) * 100),
      }, {
        xPercent: xPercents[index],
        // `loopWidth - distanceToLoop`, never `loopWidth - width`: this is what
        // makes every item finish at exactly `loopWidth / pixelsPerSecond`, so
        // the timeline's duration equals one full pass and progress maps to
        // pixels 1:1. Break the invariant and a drag travels further than the
        // pointer by however far the last item's start is down the track.
        duration: (loopWidth - distanceToLoop) / pixelsPerSecond,
        immediateRender: false,
      }, distanceToLoop / pixelsPerSecond);
  }

  // Pre-render both ends so the first frame does not jump.
  timeline.progress(1, true).progress(0, true);
  timeline.loopWidth = loopWidth;
  return timeline;
}

/** Runs the gallery's autonomous presentation loop. There are no user input
 * listeners or mutable horizontal state; reduced motion never calls this. */
function enhanceCarousel(track: HTMLElement): () => void {
  const slides = gsap.utils.toArray<HTMLElement>(".landing-slide", track);
  if (slides.length === 0) return (): void => {};

  track.classList.add("is-enhanced");
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  const loop = buildHorizontalLoop(slides, 0.6, gap);
  loop.play();

  return (): void => {
    loop.kill();
    track.classList.remove("is-enhanced");
    gsap.set(slides, { clearProps: "all" });
  };
}

/**
 * Ball-crossing wipe for the hero tab-carousel, driven by the
 * `landing:hero-slide-change` event. React has already committed the new
 * active state when it fires; this rewinds the DOM and tweens forward to what
 * CSS declares, so it is purely additive.
 */
function enhanceHeroCarousel(frame: HTMLElement): () => void {
  // Rapid tab switching: finish-in-place beats stacking crossings.
  let timeline: gsap.core.Timeline | null = null;
  let busy = false;
  const ball = frame.querySelector<HTMLElement>("[data-frame-ball]");
  const caption = frame.querySelector<HTMLElement>("[data-hero-caption]");
  const screen = frame.querySelector<HTMLElement>(".landing-hero-screen");

  // Remove only the properties this layer writes; HeroCarousel owns objectPosition.
  const clearTransitionProps = (incoming: HTMLElement, outgoing: HTMLElement): void => {
    gsap.set([incoming, outgoing], { clearProps: "clipPath,opacity,zIndex" });
    gsap.set(ball, { clearProps: "opacity,x,y,rotation" });
  };

  const onSlideChange = (event: Event): void => {
    const { current, previous } = (event as CustomEvent<HeroSlideChangeDetail>).detail;
    const outgoing = frame.querySelector<HTMLElement>(`[data-slide="${previous}"]`);
    const incoming = frame.querySelector<HTMLElement>(`[data-slide="${current}"]`);
    if (!outgoing || !incoming || !ball || !screen) return;

    if (busy) {
      timeline?.kill();
      clearTransitionProps(incoming, outgoing);
      busy = false;
      return;
    }

    timeline?.kill();
    const forward = current > previous;
    const rect = screen.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Rewind to the pre-switch arrangement, then tween to the committed state.
    gsap.set(incoming, { zIndex: 2, clipPath: forward ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)", opacity: 1 });
    gsap.set(outgoing, { zIndex: 1, opacity: 1 });
    gsap.set(ball, { opacity: 0, x: forward ? -34 : w + 34, y: h * 0.5, rotation: 0 });

    const proxy = { p: 0 };
    busy = true;

    timeline = gsap.timeline({
      onComplete(): void {
        busy = false;
        clearTransitionProps(incoming, outgoing);
      },
    });

    timeline
      .to(ball, { opacity: 1, duration: 0.15, ease: "power1.out" }, 0)
      .to(proxy, {
        p: 1,
        duration: 0.9,
        ease: "power2.inOut",
        onUpdate(): void {
          const p = proxy.p;
          const x = forward ? -34 + p * (w + 68) : w + 34 - p * (w + 68);
          const y = h * 0.5 - Math.sin(p * Math.PI) * (h * 0.2);
          gsap.set(ball, {
            x,
            y,
            rotation: (forward ? 1 : -1) * p * 420,
          });
          const pct = ((1 - p) * 100).toFixed(2);
          gsap.set(incoming, {
            clipPath: forward ? `inset(0 0 0 ${pct}%)` : `inset(0 ${pct}% 0 0)`,
          });
        },
      }, 0)
      .to(ball, { opacity: 0, duration: 0.22, ease: "power1.in" }, 0.68);

    if (caption) {
      gsap.fromTo(caption, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power2.out", delay: 0.35 });
    }
  };

  frame.addEventListener("landing:hero-slide-change", onSlideChange);
  return (): void => {
    frame.removeEventListener("landing:hero-slide-change", onSlideChange);
    timeline?.kill();
  };
}

/* Optional GSAP handoff for the credentials ticker; CSS remains the baseline. */
function enhanceTicker(track: HTMLElement): () => void {
  track.classList.add("is-enhanced");
  const tween = gsap.to(track, {
    xPercent: -50,
    duration: 26,
    ease: "none",
    repeat: -1,
  });

  return (): void => {
    tween.kill();
    track.classList.remove("is-enhanced");
    gsap.set(track, { clearProps: "transform" });
  };
}

/* Independent decorative bounce for the hero's white ball; nothing else touches it. */
function playServe(): (() => void) | undefined {
  const serveBall = document.querySelector<HTMLElement>("[data-serve-ball]");
  if (!serveBall) return undefined;

  gsap.set(serveBall, { opacity: 1, x: 0, y: 0, rotation: 0 });
  const serve = gsap.to(serveBall, {
    y: -86,
    duration: 0.56,
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true,
  });

  return (): void => { serve.kill(); };
}

/* The motto is a self-contained entrance: its decorative paddle settles in,
   then the invitation and stars follow. It never shares a timeline with the
   ticker or any other landing section. */
function playRally(): void {
      const section = document.querySelector<HTMLElement>(".landing-values");
      const guide = section?.querySelector<SVGPathElement>("[data-rally-guide]");
      const ball = section?.querySelector<HTMLElement>("[data-rally-ball]");
      const impact = section?.querySelector<HTMLElement>("[data-rally-impact]");
      const stage = section?.querySelector<HTMLElement>("[data-rally]");
      const counter = section?.querySelector<HTMLElement>("[data-rally-counter]");
      const values = section ? gsap.utils.toArray<HTMLElement>("[data-value]", section) : [];
      if (!guide || !ball || !impact || !stage || !counter || values.length === 0) return;
      const hitAt = [0.19, 0.42, 0.62, 0.82];
      let reached = -1;
      gsap.set(guide, { drawSVG: "0%" });
      gsap.set(ball, { opacity: 0 });
      gsap.set(values.map((value): Element | null => value.querySelector(".landing-value-rule")), { scaleX: 0 });
      values.forEach((value): void => value.classList.add("dim"));
      const reach = (index: number): void => {
        if (index === reached) return;
        reached = index;
        counter.textContent = String(Math.max(0, index + 1));
        values.forEach((value, i): void => { value.classList.toggle("hit", i === index); value.classList.toggle("dim", i > index); });
        if (index < 0) return;
        const rule = values[index].querySelector<HTMLElement>(".landing-value-rule");
        if (rule) gsap.to(rule, { scaleX: 1, duration: 0.5, ease: "power3.out", overwrite: true });
        const b = ball.getBoundingClientRect();
        const s = stage.getBoundingClientRect();
        gsap.set(impact, { x: b.left - s.left + b.width / 2, y: b.top - s.top + b.height / 2, opacity: 1, scale: 0.4 });
        gsap.to(impact, { scale: 2.6, opacity: 0, duration: 0.55, ease: "power2.out" });
      };
      gsap.to(ball, { motionPath: { path: guide, align: guide, alignOrigin: [0.5, 0.5], start: 0, end: 1, autoRotate: false }, ease: "none", scrollTrigger: { trigger: section, start: "top top", end: "+=1900", pin: true, scrub: 0.7, onEnter(): void { gsap.to(ball, { opacity: 1, duration: 0.2 }); }, onLeaveBack(): void { gsap.to(ball, { opacity: 0, duration: 0.2 }); reach(-1); } }, onUpdate(this: gsap.core.Tween): void { const progress = this.progress(); gsap.set(guide, { drawSVG: `0% ${(progress * 100).toFixed(2)}%` }); let next = -1; for (let i = 0; i < hitAt.length; i += 1) if (progress >= hitAt[i]) next = i; reach(next); } });
    }

    function playMotto(): (() => void) | undefined {
  const motto = document.querySelector<HTMLElement>("[data-motto]");
  if (!motto) return undefined;

  const paddle = motto.querySelector<HTMLElement>("[data-motto-paddle]");
  const copy = motto.querySelector<HTMLElement>("[data-motto-copy]");
  const cta = motto.querySelector<HTMLElement>("[data-motto-cta]");
  const stars = motto.querySelector<HTMLElement>(".landing-stars");
  const timeline = gsap.timeline({
    paused: true,
    scrollTrigger: { trigger: motto, start: "top 82%", once: true },
  });

  if (paddle) timeline.from(paddle, { y: 28, rotation: -12, opacity: 0, duration: 0.7, ease: "back.out(1.6)" });
  if (copy) timeline.from(copy, { y: 18, opacity: 0, duration: 0.55, ease: "power3.out" }, "-=0.35");
  if (cta) timeline.from(cta, { y: 14, opacity: 0, duration: 0.45, ease: "power2.out" }, "-=0.22");
  if (stars) timeline.from(stars, { y: 10, opacity: 0, duration: 0.35, ease: "power2.out" }, "-=0.16");
  timeline.play();

  return (): void => {
    timeline.scrollTrigger?.kill();
    timeline.kill();
  };
}

export default function LandingMotion(): null {
  useEffect((): (() => void) => {
    gsap.registerPlugin(ScrollTrigger, MotionPathPlugin, DrawSVGPlugin, SplitText);
    const media = gsap.matchMedia();
    let lenis: Lenis | null = null;
    const updateLenis = (time: number): void => lenis?.raf(time * 1000);

    media.add("(prefers-reduced-motion: no-preference)", (): (() => void) => {
      lenis = new Lenis({ duration: 0.85, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(updateLenis);
      gsap.ticker.lagSmoothing(0);

      let split: SplitText | null = null;
      let teardownCarousel: (() => void) | undefined;
      let teardownHeroCarousel: (() => void) | undefined;
      let teardownTicker: (() => void) | undefined;
      let teardownServe: (() => void) | undefined;
      let teardownMotto: (() => void) | undefined;

      const context = gsap.context((): void => {
        const heading = document.querySelector<HTMLElement>("[data-split]");
        if (heading) {
          // Each line gets an overflow-hidden wrapper so it rises out of a
          // mask instead of simply fading.
          split = new SplitText(heading, { type: "lines", linesClass: "landing-line" });
          split.lines.forEach((line): void => {
            const mask = document.createElement("span");
            mask.style.cssText = "display:block;overflow:hidden";
            line.parentNode?.insertBefore(mask, line);
            mask.appendChild(line);
          });
          gsap.from(split.lines, { yPercent: 115, duration: 0.9, stagger: 0.09, ease: "power3.out" });
        }

        gsap.from("[data-media-reveal]", {
          clipPath: "inset(0% 0% 100% 0%)", duration: 1.1, ease: "power4.inOut",
        });

        gsap.utils.toArray<HTMLElement>("[data-motion-section]").forEach((section): void => {
          const targets = section.querySelectorAll<HTMLElement>("[data-reveal]:not([data-value])");
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

        /*
         * Rules animate FROM zero width to the width the stylesheet already
         * gives them. Seeding a value instead — the mistake the trust band's
         * count-up made — would leave them invisible whenever a trigger fails
         * to fire.
         */
        gsap.utils.toArray<HTMLElement>("[data-rule]:not(.landing-value-rule)").forEach((rule): void => {
          gsap.from(rule, {
            width: 0,
            duration: 0.7,
            ease: "power2.out",
            immediateRender: false,
            scrollTrigger: { trigger: rule, start: "top 90%", once: true },
          });
        });


        teardownServe = playServe();
          playRally();
        teardownMotto = playMotto();

        const ticker = document.querySelector<HTMLElement>("[data-credentials-ticker]");
        if (ticker) teardownTicker = enhanceTicker(ticker);

        const track = document.querySelector<HTMLElement>("[data-carousel]");
        if (track) teardownCarousel = enhanceCarousel(track);

        const heroFrame = document.querySelector<HTMLElement>("[data-media-reveal]");
        if (heroFrame) teardownHeroCarousel = enhanceHeroCarousel(heroFrame);

        // No count-up on the trust band. It seeded itself at 0 and overwrote
        // `textContent`, so any trigger that failed to fire left the real figure
        // replaced by 0 — the reveals carry `immediateRender: false` for exactly
        // that reason, and a two-digit odometer was not worth the same guard.
      });

      return (): void => {
        teardownCarousel?.();
        teardownHeroCarousel?.();
        teardownTicker?.();
        teardownServe?.();
        teardownMotto?.();
        split?.revert();
        context.revert();
      };
    });

    media.add("(prefers-reduced-motion: reduce)", (): void => {
      gsap.set("[data-reveal], [data-media-reveal], [data-rule]", { clearProps: "all" });
          document.querySelectorAll("[data-value]").forEach((value): void => value.classList.remove("dim", "hit"));
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
