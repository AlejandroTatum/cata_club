"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { GALLERY_PHOTOS, slideSizes } from "./landing-gallery";

/** Detail payload for the `landing:gallery-lightbox` event dispatched on the
 * carousel track whenever the lightbox opens or closes; `LandingMotion`
 * listens for it to pause and resume the loop additively — the same DOM-event
 * channel the hero carousel uses for its wipe crossing. */
export interface GalleryLightboxDetail {
  open: boolean;
}

/**
 * The photo gallery. Ships as a plain overflow-scrolling strip of slide
 * buttons; the motion layer upgrades it to a seamless drag-and-inertia loop
 * by adding `is-enhanced`, so the gallery is fully usable before that script
 * runs, if it never runs, and when the visitor prefers reduced motion.
 *
 * Every slide opens a lightbox: a plain React-state dialog with keyboard
 * navigation (Escape closes, arrow keys move between photos) that pauses the
 * motion loop while open, so the photo under study does not drift away.
 */
export default function Gallery(): React.ReactElement {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const previousIndex = useRef<number | null>(null);

  useEffect((): void => {
    const previous = previousIndex.current;
    if (previous === openIndex) return;

    // Tell the motion layer before anything else moves: an open lightbox must
    // meet a frozen carousel, not one mid-tween.
    trackRef.current?.dispatchEvent(
      new CustomEvent<GalleryLightboxDetail>("landing:gallery-lightbox", { detail: { open: openIndex !== null } }),
    );

    if (openIndex !== null) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      closeRef.current?.focus();
    } else {
      triggerRef.current?.focus();
    }
    // The page behind a modal has nothing useful to scroll to; freeze it for
    // the duration instead of letting wheel input fight the overlay.
    document.body.style.overflow = openIndex !== null ? "hidden" : "";
    previousIndex.current = openIndex;
  }, [openIndex]);

  useEffect((): (() => void) => (): void => {
    document.body.style.overflow = "";
  }, []);

  const go = (index: number): void => {
    setOpenIndex(((index % GALLERY_PHOTOS.length) + GALLERY_PHOTOS.length) % GALLERY_PHOTOS.length);
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (openIndex === null) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpenIndex(null);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(openIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(openIndex - 1);
    }
  };

  return (
    <section className="landing-section landing-gallery" id="galeria" data-motion-section data-testid="motion-section">
      {/* Own section header markup, as every landing section component does. */}
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Nuestra academia</span>
        <h2>Galería</h2>
      </header>
      <div className="landing-carousel-wrap">
        <div className="landing-carousel" data-carousel role="group" aria-label="Galería de fotos del club" ref={trackRef}>
          {GALLERY_PHOTOS.map((photo, index): React.ReactElement => (
            <figure className="landing-slide" key={photo.src} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
              <button
                type="button"
                className="landing-slide-open"
                onClick={(): void => {
                  triggerRef.current = null;
                  setOpenIndex(index);
                }}
                aria-label={`Ampliar foto: ${photo.caption}`}
              >
                <Image
                  src={photo.src}
                  alt={photo.alt}
                  width={photo.width}
                  height={photo.height}
                  loading="lazy"
                  quality={85}
                  sizes={slideSizes(photo)}
                  draggable={false}
                />
              </button>
              <figcaption>{photo.caption}</figcaption>
            </figure>
          ))}
        </div>
      </div>
      {openIndex !== null && (
        <div
          className="landing-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={GALLERY_PHOTOS[openIndex].caption}
          onKeyDown={onDialogKeyDown}
          data-testid="gallery-lightbox"
        >
          {/* Click-away target: behind the figure and controls, so only the
              empty area around the photo can reach it. */}
          <button type="button" className="landing-lightbox-backdrop" aria-label="Cerrar imagen ampliada" tabIndex={-1} onClick={(): void => setOpenIndex(null)} />
          <figure className="landing-lightbox-figure">
            <Image
              key={GALLERY_PHOTOS[openIndex].src}
              src={GALLERY_PHOTOS[openIndex].src}
              alt={GALLERY_PHOTOS[openIndex].alt}
              width={GALLERY_PHOTOS[openIndex].width}
              height={GALLERY_PHOTOS[openIndex].height}
              quality={85}
            />
            <figcaption>{GALLERY_PHOTOS[openIndex].caption}</figcaption>
          </figure>
          <div className="landing-lightbox-controls">
            <button type="button" className="landing-lightbox-button landing-lightbox-prev" aria-label="Imagen anterior" onClick={(): void => go(openIndex - 1)}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="landing-lightbox-button landing-lightbox-close" aria-label="Cerrar imagen ampliada" ref={closeRef} onClick={(): void => setOpenIndex(null)}>
              <X aria-hidden="true" />
            </button>
            <button type="button" className="landing-lightbox-button landing-lightbox-next" aria-label="Imagen siguiente" onClick={(): void => go(openIndex + 1)}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
