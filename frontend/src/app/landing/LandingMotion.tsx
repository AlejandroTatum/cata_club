"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { SplitText } from "gsap/SplitText";
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

  // Pre-render both ends so the first interaction does not jump.
  timeline.progress(1, true).progress(0, true);
  timeline.loopWidth = loopWidth;
  return timeline;
}

/**
 * Upgrades the server-rendered strip into a draggable infinite loop and returns
 * its teardown. The markup is usable as a plain scroll container before this
 * runs, so everything here is additive.
 */
function enhanceCarousel(track: HTMLElement): () => void {
  const slides = gsap.utils.toArray<HTMLElement>(".landing-slide", track);
  if (slides.length === 0) return (): void => {};

  // Added before measuring: the class drops the scroll padding, and measuring
  // first would bake that padding into every slide's offsetLeft.
  track.classList.add("is-enhanced");
  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  const loop = buildHorizontalLoop(slides, 0.6, gap);
  loop.play();

  // Draggable writes to a detached proxy, never to the track: the track's own
  // transform belongs to the loop timeline, and two writers fight every frame.
  const proxy = document.createElement("div");
  const wrap = gsap.utils.wrap(0, 1);
  const progressFor = (drag: Draggable): number =>
    wrap((drag as Draggable & { startProgress: number }).startProgress + (drag.startX - drag.x) / loop.loopWidth);

  const [draggable] = Draggable.create(proxy, {
    type: "x",
    trigger: track,
    inertia: true,
    onPress(this: Draggable): void {
      (this as Draggable & { startProgress: number }).startProgress = loop.progress();
      track.classList.add("is-dragging");
      loop.pause();
    },
    onDrag(this: Draggable): void { loop.progress(progressFor(this)); },
    onThrowUpdate(this: Draggable): void { loop.progress(progressFor(this)); },
    onRelease(): void { track.classList.remove("is-dragging"); },
    onThrowComplete(): void { loop.play(); },
  });

  let resume: gsap.core.Tween | undefined;
  const onWheel = (event: WheelEvent): void => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 1) return;
    event.preventDefault();
    loop.pause();
    loop.progress(wrap(loop.progress() + delta * 0.0004));
    resume?.kill();
    resume = gsap.delayedCall(0.5, (): void => { loop.play(); });
  };
  track.addEventListener("wheel", onWheel, { passive: false });

  return (): void => {
    track.removeEventListener("wheel", onWheel);
    resume?.kill();
    draggable?.kill();
    loop.kill();
    track.classList.remove("is-enhanced", "is-dragging");
    gsap.set(slides, { clearProps: "all" });
  };
}

export default function LandingMotion(): null {
  useEffect((): (() => void) => {
    gsap.registerPlugin(ScrollTrigger, Draggable, InertiaPlugin, SplitText);
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
        gsap.from("[data-hero-parallax]", { scale: 1.2, duration: 1.4, ease: "power3.out" });

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

        /*
         * Rules animate FROM zero width to the width the stylesheet already
         * gives them. Seeding a value instead — the mistake the trust band's
         * count-up made — would leave them invisible whenever a trigger fails
         * to fire.
         */
        gsap.utils.toArray<HTMLElement>("[data-rule]").forEach((rule): void => {
          gsap.from(rule, {
            width: 0,
            duration: 0.7,
            ease: "power2.out",
            immediateRender: false,
            scrollTrigger: { trigger: rule, start: "top 90%", once: true },
          });
        });

        gsap.to("[data-hero-parallax]", {
          yPercent: 8,
          ease: "none",
          scrollTrigger: { trigger: ".landing-hero", start: "top top", end: "bottom top", scrub: 0.5 },
        });

        const track = document.querySelector<HTMLElement>("[data-carousel]");
        if (track) teardownCarousel = enhanceCarousel(track);

        // No count-up on the trust band. It seeded itself at 0 and overwrote
        // `textContent`, so any trigger that failed to fire left the real figure
        // replaced by 0 — the reveals carry `immediateRender: false` for exactly
        // that reason, and a two-digit odometer was not worth the same guard.
      });

      return (): void => {
        teardownCarousel?.();
        split?.revert();
        context.revert();
      };
    });

    media.add("(prefers-reduced-motion: reduce)", (): void => {
      gsap.set("[data-reveal], [data-hero-parallax], [data-media-reveal], [data-rule]", { clearProps: "all" });
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
