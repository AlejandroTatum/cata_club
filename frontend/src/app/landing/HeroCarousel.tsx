"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { HERO_PHOTOS } from "./landing-hero-photos";

/** Detail payload for the `landing:hero-slide-change` DOM event dispatched on
 * every slide switch; `LandingMotion` listens for it to animate additively. */
export interface HeroSlideChangeDetail {
  current: number;
  previous: number;
}

/**
 * How many slides, counted from the first, are released to the network.
 *
 * The inactive slides are fully transparent and fully clipped (`landing.css`
 * writes `opacity: 0` and `clip-path: inset(0 0 0 100%)` so GSAP can wipe
 * between them). Chromium's lazy-loader reads that as "will not be seen" and
 * declines to fetch them at all, while WebKit and Firefox fetch them anyway —
 * so in Chrome alone, pressing tab 02 revealed an empty frame while the photo
 * was still being downloaded.
 *
 * Marking all three eager would fix Chrome by making every visitor pay for
 * three hero photos, which is the opposite of what this carousel should cost.
 * Instead the slides are released in the order a visitor can reach them: the
 * first is `priority`, the second is released once the page goes idle, and
 * the rest follow the first interaction with the carousel — by then the
 * visitor is demonstrably browsing photos.
 */
const PRIORITY_SLIDE_REACH = 1;
const IDLE_SLIDE_REACH = 2;

/** Deadline for the idle release, so a permanently busy page still gets it. */
const IDLE_RELEASE_TIMEOUT_MS = 2000;

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * The hero's photo carousel. A plain React-state machine: previous/next
 * buttons swap the active slide synchronously with no GSAP, so it works
 * before the motion runtime loads and under reduced motion. The
 * `landing:hero-slide-change` event additively hooks GSAP's wipe crossing.
 */
export default function HeroCarousel(): React.ReactElement {
  const [current, setCurrent] = useState(0);
  const [slideReach, setSlideReach] = useState(PRIORITY_SLIDE_REACH);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const previousRef = useRef(0);

  useEffect((): (() => void) => {
    const release = (): void => {
      setSlideReach((reach): number => Math.max(reach, IDLE_SLIDE_REACH));
    };
    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(release, { timeout: IDLE_RELEASE_TIMEOUT_MS });
      return (): void => { idleWindow.cancelIdleCallback?.(handle); };
    }
    const timer = window.setTimeout(release, IDLE_RELEASE_TIMEOUT_MS);
    return (): void => { window.clearTimeout(timer); };
  }, []);

  useEffect((): void => {
    const previous = previousRef.current;
    if (previous !== current) {
      frameRef.current?.dispatchEvent(
        new CustomEvent<HeroSlideChangeDetail>("landing:hero-slide-change", { detail: { current, previous } }),
      );
    }
    previousRef.current = current;
  }, [current]);

  const go = (index: number): void => {
    const next = ((index % HERO_PHOTOS.length) + HERO_PHOTOS.length) % HERO_PHOTOS.length;
    setSlideReach(HERO_PHOTOS.length);
    setCurrent(next);
  };

  return (
    <div className="landing-hero-carousel">
      <button
        type="button"
        className="landing-hero-nav landing-hero-nav-prev"
        aria-label="Foto anterior"
        onClick={(): void => go(current - 1)}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <div className="landing-hero-frame" data-media-reveal ref={frameRef}>
        <div className="landing-hero-screen">
          <span className="landing-hero-frameball" data-frame-ball aria-hidden="true" />
          {HERO_PHOTOS.map((photo, index): React.ReactElement => (
            <Image
              key={photo.src}
              className="landing-hero-slide"
              src={photo.src}
              alt={photo.alt}
              fill
              priority={index === 0}
              loading={index === 0 ? undefined : index < slideReach ? "eager" : "lazy"}
              quality={90}
              sizes="(max-width: 768px) 86vw, (max-width: 1024px) 496px, 592px"
              style={{ objectPosition: photo.objectPosition }}
              data-slide={index}
              data-active={index === current}
              aria-hidden={index === current ? undefined : true}
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        className="landing-hero-nav landing-hero-nav-next"
        aria-label="Foto siguiente"
        onClick={(): void => go(current + 1)}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}
