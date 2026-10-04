"use client";

import { useEffect, useRef, useState } from "react";
import {
  galleryImageSrc,
  galleryImageSrcSet,
  GALLERY_EMPTY_EVENT,
  mapGallery,
  type GalleryEntry,
} from "./landing-gallery";
import { repetitionsFor } from "./Sponsors";

type GalleryState =
  | { kind: "loading" }
  | { kind: "ready"; entries: GalleryEntry[] }
  | { kind: "empty" }
  | { kind: "error" };

type BrowseDirection = "next" | "prev";

/** Tile widths mirror `.landing-sponsors-item` (clamp(300px, 30vw, 416px)) at the two ends of the range. */
const IMAGE_SIZES = "(max-width: 768px) 300px, 416px";
/** The tile's frame; photos are cropped to it with `object-fit: cover`, so no ratio has to be measured first. */
const SLIDE_ASPECT = "4 / 3";
/** How long an arrow takes to carry the strip one photo along. */
const STEP_DURATION_MS = 380;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Wraps a playback time into [0, duration) so a backward step crosses the loop seam. */
export function wrapTime(time: number, duration: number): number {
  return ((time % duration) + duration) % duration;
}

/**
 * The landing's gallery: the same CSS marquee as the sponsors strip (issue
 * #1372 fed it from `GET /api/galeria`; the QA round of 2026-10-04 moved its
 * motion out of JavaScript).
 *
 * The earlier strip was positioned by a GSAP loop that measured every slide at
 * build time, and it only rendered once EVERY photo had been downloaded in a
 * throwaway `Image` probe (up to four seconds) — so the section sat blank
 * first, and on a phone the loop's measured geometry left the track with one
 * sliver of a slide and an empty stretch until the pattern wrapped. Here each
 * tile has a fixed CSS frame, the strip is an identical pair of copies
 * translated by a keyframe (`landing-sponsors-marquee`, the sponsors' own
 * rule), and nothing waits on the photos: a slow image only fills its own tile.
 *
 * Previous/next arrows nudge that same animation's clock by one tile (Web
 * Animations API), so the arrows and the autoplay share one authority and can
 * never fight over the transform. Under `prefers-reduced-motion` the keyframe
 * is off (sponsors' stylesheet rule): the strip is a plain horizontally
 * scrollable row and the arrows scroll it by one tile.
 *
 * Empty is the gallery's real initial state: the section renders nothing and
 * tells the page (`GALLERY_EMPTY_EVENT`) to drop its nav entries.
 */
export default function Gallery(): React.ReactElement {
  const [state, setState] = useState<GalleryState>({ kind: "loading" });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const browseIndexRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  useEffect((): (() => void) => {
    let cancelled = false;
    fetch("/api/galeria", { cache: "no-store" })
      .then((response): Promise<unknown> => {
        if (!response.ok) throw new Error(`galeria ${response.status}`);
        return response.json();
      })
      .then((payload: unknown): void => {
        if (cancelled) return;
        const entries = mapGallery(payload);
        setState(entries.length > 0 ? { kind: "ready", entries } : { kind: "empty" });
      })
      .catch((): void => {
        if (!cancelled) setState({ kind: "error" });
      });
    return (): void => { cancelled = true; };
  }, []);

  useEffect((): void => {
    if (state.kind === "empty") document.dispatchEvent(new CustomEvent(GALLERY_EMPTY_EVENT));
  }, [state.kind]);

  useEffect((): (() => void) => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query) return (): void => {};
    const sync = (): void => setReducedMotion(query.matches);
    sync();
    query.addEventListener?.("change", sync);
    return (): void => { query.removeEventListener?.("change", sync); };
  }, []);

  const cancelStep = (): void => {
    if (frameRef.current === null) return;
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };
  useEffect((): (() => void) => cancelStep, []);

  // A tap pins a caption open; a tap anywhere outside the strip releases it.
  useEffect((): (() => void) => {
    if (openKey === null) return (): void => {};
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (viewportRef.current?.contains(target) || navRef.current?.contains(target)) return;
      setOpenKey(null);
    };
    document.addEventListener("click", onDocumentClick);
    return (): void => { document.removeEventListener("click", onDocumentClick); };
  }, [openKey]);

  /** Carries the strip one tile along: the marquee's clock moves, or the row scrolls when motion is off. */
  const step = (direction: BrowseDirection): void => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const tile = track?.querySelector<HTMLElement>(".landing-sponsors-item");
    const copy = track?.querySelector<HTMLElement>(".landing-sponsors-copy");
    if (!viewport || !track || !tile || !copy) return;
    const gap = parseFloat(getComputedStyle(copy).columnGap) || 0;
    const span = tile.offsetWidth + gap;
    const sign = direction === "next" ? 1 : -1;

    const animation = reducedMotion ? undefined : track.getAnimations?.()[0];
    const duration = Number(animation?.effect?.getComputedTiming().duration);
    if (!animation || !Number.isFinite(duration) || duration <= 0 || copy.offsetWidth <= 0) {
      viewport.scrollBy({ left: sign * span, behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
    // One copy is the marquee's whole -50% travel, so a tile is this share of the clock.
    const delta = (duration * span) / copy.offsetWidth;
    cancelStep();
    const from = Number(animation.currentTime ?? 0);
    const started = performance.now();
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - started) / STEP_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      animation.currentTime = wrapTime(from + sign * delta * eased, duration);
      frameRef.current = progress < 1 ? window.requestAnimationFrame(tick) : null;
    };
    frameRef.current = window.requestAnimationFrame(tick);
  };

  const browse = (direction: BrowseDirection): void => {
    if (state.kind !== "ready" || state.entries.length < 2) return;
    const count = state.entries.length;
    const target = direction === "next"
      ? (browseIndexRef.current + 1) % count
      : (browseIndexRef.current - 1 + count) % count;
    browseIndexRef.current = target;
    step(direction);
    setAnnouncement(`Foto ${target + 1} de ${count}: ${state.entries[target].title}`);
  };

  let accessibleStatus: string;
  if (state.kind === "ready") {
    accessibleStatus = `Galería: ${state.entries.map((entry): string => entry.title).join(", ")}.`;
  } else if (state.kind === "empty") {
    accessibleStatus = "Aún no hay fotos en la galería.";
  } else if (state.kind === "error") {
    accessibleStatus = "No se pudieron cargar las fotos de la galería.";
  } else {
    accessibleStatus = "Cargando la galería…";
  }

  if (state.kind === "empty") return <></>;

  // Only the first pass of the first copy is exposed (focusable, announced);
  // every repeat is decoration, exactly like the sponsors strip.
  const renderCopy = (duplicate: boolean): React.ReactElement[] => {
    if (state.kind !== "ready") return [];
    const { entries } = state;
    return Array.from({ length: repetitionsFor(entries.length) }, (_, pass): React.ReactElement[] =>
      entries.map((entry): React.ReactElement => {
        const decorative = duplicate || pass > 0;
        const key = `${entry.id}-${duplicate ? "duplicate" : "primary"}-${pass}`;
        const srcSet = galleryImageSrcSet(entry.imageSrc);
        return (
          <div className="landing-sponsors-item" key={key} aria-hidden={decorative || undefined}>
            <figure
              className={openKey === key ? "landing-slide is-open" : "landing-slide"}
              style={{ height: "auto", aspectRatio: SLIDE_ASPECT }}
              tabIndex={decorative ? undefined : 0}
              onClick={(): void => setOpenKey(openKey === key ? null : key)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset (same pattern as the landing's sponsor logos) */}
              <img
                src={galleryImageSrc(entry.imageSrc, 800)}
                srcSet={srcSet}
                sizes={srcSet ? IMAGE_SIZES : undefined}
                alt={entry.description}
                loading="lazy"
                decoding="async"
                draggable={false}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <figcaption className="landing-slide-caption">
                <span className="landing-slide-title">{entry.title}</span>
                <span className="landing-slide-description">{entry.description}</span>
              </figcaption>
            </figure>
          </div>
        );
      }),
    ).flat();
  };

  return (
    <section className="landing-section landing-gallery" id="galeria" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Nuestra academia</span>
        <h2>Galería</h2>
      </header>
      {state.kind === "loading" || state.kind === "ready" ? <p className="sr-only">{accessibleStatus}</p> : null}
      {state.kind === "ready" ? (
        <div className="landing-carousel-wrap">
          <div
            className="landing-sponsors-viewport"
            role="group"
            aria-label="Galería de fotos del club"
            ref={viewportRef}
            // Without the keyframe the row has to scroll by hand.
            style={reducedMotion ? { overflowX: "auto" } : undefined}
            onKeyDown={(event): void => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                browse("next");
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                browse("prev");
              }
            }}
          >
            <div
              className="landing-sponsors-track"
              id="galeria-track"
              ref={trackRef}
              style={openKey !== null ? { animationPlayState: "paused" } : undefined}
            >
              <div className="landing-sponsors-copy">{renderCopy(false)}</div>
              <div className="landing-sponsors-copy" aria-hidden="true" style={reducedMotion ? { display: "none" } : undefined}>
                {renderCopy(true)}
              </div>
            </div>
          </div>
          {state.entries.length > 1 ? (
            <>
              <div
                className="landing-gallery-nav"
                role="group"
                aria-label="Navegar por la galería"
                ref={navRef}
                // The stylesheet hides the arrows under reduced motion; the
                // scrollable row still needs them, so they stay.
                style={reducedMotion ? { display: "flex" } : undefined}
              >
                <button
                  type="button"
                  className="landing-gallery-nav-button"
                  aria-label="Foto anterior"
                  aria-controls="galeria-track"
                  onClick={(): void => browse("prev")}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="landing-gallery-nav-button"
                  aria-label="Foto siguiente"
                  aria-controls="galeria-track"
                  onClick={(): void => browse("next")}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {announcement ? <p className="sr-only" aria-live="polite">{announcement}</p> : null}
            </>
          ) : null}
        </div>
      ) : state.kind === "loading" ? null : (
        <p className="landing-gallery-status" role="status">{accessibleStatus}</p>
      )}
    </section>
  );
}
