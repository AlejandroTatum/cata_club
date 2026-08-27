"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { HERO_PHOTOS } from "./landing-hero-photos";

/** Detail payload for the `landing:hero-slide-change` DOM event dispatched on
 * every slide switch; `LandingMotion` listens for it to animate additively. */
export interface HeroSlideChangeDetail {
  current: number;
  previous: number;
}

/**
 * The hero's 01/02/03 photo tab-carousel. A plain React-state machine:
 * tabs swap slide and `aria-selected` synchronously with no GSAP, so it
 * works before the motion runtime loads and under reduced motion. The
 * `landing:hero-slide-change` event additively hooks GSAP's wipe crossing.
 */
export default function HeroCarousel(): React.ReactElement {
  const [current, setCurrent] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const previousRef = useRef(0);

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
    setCurrent(next);
    tabRefs.current[next]?.focus();
  };

  const onTablistKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(current - 1);
    }
  };


  return (
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
            quality={90}
            sizes="(max-width: 768px) 86vw, (max-width: 1024px) 496px, 592px"
            style={{ objectPosition: photo.objectPosition }}
            data-slide={index}
            data-active={index === current}
          />
        ))}
        <div className="landing-hero-screen-bar">
          <div
            className="landing-hero-screen-dots"
            role="tablist"
            aria-label="Fotos del club"
            onKeyDown={onTablistKeyDown}
          >
            {HERO_PHOTOS.map((photo, index): React.ReactElement => (
              <button
                key={photo.src}
                type="button"
                role="tab"
                ref={(element): void => { tabRefs.current[index] = element; }}
                aria-selected={index === current}
                aria-label={`Foto ${index + 1}, ${photo.tabDescription}`}
                tabIndex={index === current ? 0 : -1}
                onClick={(): void => go(index)}
              >
                {String(index + 1).padStart(2, "0")}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
