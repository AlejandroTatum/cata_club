"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_SLIDE_ASPECT,
  GALLERY_BROWSE_HOLD_MS,
  GALLERY_HOLD_EVENT,
  GALLERY_READY_EVENT,
  GALLERY_SEEK_EVENT,
  SLIDE_HEIGHT_BREAKPOINT,
  mapGallery,
  planSlideRun,
  type GalleryEntry,
  type GallerySeekDetail,
  type GallerySeekDirection,
  type PlannedSlide,
} from "./landing-gallery";

type GalleryState =
  | { kind: "loading" }
  | { kind: "ready"; entries: GalleryEntry[]; run: PlannedSlide[]; aspects: Map<number, number> }
  | { kind: "empty" }
  | { kind: "error" };

/**
 * How long a photograph gets to declare its native ratio before the strip
 * gives up waiting and starts with the shared fallback ratio. Motion must
 * start reliably even when one photo hangs; the slide's own frame keeps the
 * layout stable either way.
 */
const MEASURE_TIMEOUT_MS = 4000;

/**
 * Measures each photo's native aspect ratio off the render pass, so the
 * strip can size every slide before the motion runtime measures it — the
 * bundled gallery had this geometry for free from `next/image`'s declared
 * dimensions, and managed photos carry none in their payload. The probe is
 * a throwaway `Image` per entry; the rendered slide then reuses the cached
 * bytes through its own `loading="lazy"` request. Every failure path
 * (network error, timeout) resolves with the shared fallback ratio, so
 * async data always reaches a ready, moving strip.
 */
function measureRatios(entries: GalleryEntry[]): Promise<Map<number, number>> {
  const measure = (entry: GalleryEntry): Promise<[number, number]> =>
    new Promise((resolve): void => {
      const img = new Image();
      let settled = false;
      const finish = (aspect: number): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve([entry.id, aspect]);
      };
      const timer = window.setTimeout((): void => finish(DEFAULT_SLIDE_ASPECT), MEASURE_TIMEOUT_MS);
      img.onload = (): void => {
        finish(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : DEFAULT_SLIDE_ASPECT);
      };
      img.onerror = (): void => finish(DEFAULT_SLIDE_ASPECT);
      img.src = entry.imageSrc;
    });
  return Promise.all(entries.map(measure)).then((pairs): Map<number, number> => new Map(pairs));
}

/**
 * The landing's gallery — the pre-#1372 full-bleed moving strip, now fed by
 * managed entries from `GET /api/galeria` (issue #1372).
 *
 * The motion contract is deliberately inverted from the bundled-photo days:
 * instead of `LandingMotion` measuring the strip once at its own mount and
 * every slide having to exist by then, this component declares the track
 * `[data-ready]` and fires `landing:gallery-ready` only after the fetch has
 * settled AND every photo's ratio has been measured AND the slide run
 * (repeats included, see `planSlideRun`) has been committed. The runtime
 * enhances a ready track in either mount order, so asynchronous data can
 * start the loop but can never race it.
 *
 * Reading holds the loop still: hover, keyboard focus and a touch tap (the
 * `.is-open` pin) each raise `landing:gallery-hold`, which the runtime
 * answers by pausing. The previous/next controls browse by UNIQUE photo —
 * clones never count — pinning the requested caption through a short
 * reading window (`GALLERY_BROWSE_HOLD_MS`) before the loop resumes on its
 * own; hover or focus inside the strip extends the hold past the window.
 * Reduced motion never loads the runtime at all and the stylesheet drops
 * the controls with the clones; the same markup presents as a complete
 * wrapped strip where every photo and caption stays reachable without one
 * pixel of motion.
 *
 * Empty is the gallery's real initial state — the club publishes entries
 * from `/galeria` — so the section says so honestly instead of shipping
 * placeholder photographs.
 */
export default function Gallery(): React.ReactElement {
  const [state, setState] = useState<GalleryState>({ kind: "loading" });
  const trackRef = useRef<HTMLUListElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const openRef = useRef<number | null>(null);
  const heldRef = useRef(false);
  const browseIndexRef = useRef(0);
  const browseTimerRef = useRef<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect((): (() => void) => {
    let cancelled = false;
    fetch("/api/galeria", { cache: "no-store" })
      .then((response): Promise<unknown> => {
        if (!response.ok) throw new Error(`galeria ${response.status}`);
        return response.json();
      })
      .then((payload: unknown): Promise<void> => {
        if (cancelled) return Promise.resolve();
        const entries = mapGallery(payload);
        if (entries.length === 0) {
          setState({ kind: "empty" });
          return Promise.resolve();
        }
        return measureRatios(entries).then((aspects): void => {
          if (cancelled) return;
          const viewport = window.innerWidth;
          const run = planSlideRun(
            entries,
            (entry): number => aspects.get(entry.id) ?? DEFAULT_SLIDE_ASPECT,
            viewport,
            viewport <= SLIDE_HEIGHT_BREAKPOINT,
          );
          setState({ kind: "ready", entries, run, aspects });
        });
      })
      .catch((): void => {
        if (!cancelled) setState({ kind: "error" });
      });
    return (): void => { cancelled = true; };
  }, []);

  // Fired after the ready commit, so the track already holds its full run.
  // A runtime mounted later still finds it via the `data-ready` attribute.
  useEffect((): void => {
    if (state.kind !== "ready") return;
    document.dispatchEvent(new CustomEvent(GALLERY_READY_EVENT));
  }, [state.kind]);

  /** Hover, focus and the tap pin each count as "someone is reading". */
  const syncHold = (): void => {
    const held = hoverRef.current || focusRef.current || openRef.current !== null;
    if (heldRef.current === held) return;
    heldRef.current = held;
    document.dispatchEvent(new CustomEvent(GALLERY_HOLD_EVENT, { detail: { held } }));
  };

  const toggleOpen = (index: number): void => {
    const next = openRef.current === index ? null : index;
    openRef.current = next;
    setOpenIndex(next);
    syncHold();
  };

  const clearBrowseWindow = (): void => {
    if (browseTimerRef.current === null) return;
    window.clearTimeout(browseTimerRef.current);
    browseTimerRef.current = null;
  };

  // A pending browse window must not outlive the section.
  useEffect((): (() => void) => clearBrowseWindow, []);

  /**
   * Brings the previous/next UNIQUE photo to the strip's edge: pin its
   * caption, announce it, and ask the runtime to align it. The pin lasts
   * through a reading window, then the loop resumes exactly where the seek
   * left it — the marquee never restarts from zero. Hover or focus inside
   * the strip outlives the window; a click elsewhere on the page ends it
   * early; browsing again re-anchors pin and window to the new photo.
   */
  const browse = (direction: GallerySeekDirection): void => {
    if (state.kind !== "ready" || state.entries.length < 2) return;
    const count = state.entries.length;
    const target = direction === "next"
      ? (browseIndexRef.current + 1) % count
      : (browseIndexRef.current - 1 + count) % count;
    browseIndexRef.current = target;

    clearBrowseWindow();
    openRef.current = target;
    setOpenIndex(target);
    syncHold();
    document.dispatchEvent(new CustomEvent<GallerySeekDetail>(GALLERY_SEEK_EVENT, {
      detail: { index: target, direction },
    }));
    setAnnouncement(`Foto ${target + 1} de ${count}: ${state.entries[target].title}`);

    browseTimerRef.current = window.setTimeout((): void => {
      browseTimerRef.current = null;
      // Superseded by another interaction (a tap elsewhere on the strip, a
      // newer browse): that interaction now owns the pin, not this window.
      if (openRef.current !== target) return;
      openRef.current = null;
      setOpenIndex(null);
      syncHold();
    }, GALLERY_BROWSE_HOLD_MS);
  };

  // A tap anywhere outside the strip releases the pin (touch has no leave).
  // The browse controls are part of the strip's surface: activating one must
  // not be mistaken for the outside click it physically is.
  useEffect((): (() => void) => {
    if (openIndex === null) return (): void => {};
    const onDocumentClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (trackRef.current?.contains(target)) return;
      if (navRef.current?.contains(target)) return;
      clearBrowseWindow();
      openRef.current = null;
      setOpenIndex(null);
      syncHold();
    };
    document.addEventListener("click", onDocumentClick);
    return (): void => { document.removeEventListener("click", onDocumentClick); };
  }, [openIndex]);

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

  return (
    <section className="landing-section landing-gallery" id="galeria" data-motion-section data-testid="motion-section">
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Nuestra academia</span>
        <h2>Galería</h2>
      </header>
      {state.kind === "loading" || state.kind === "ready" ? <p className="sr-only">{accessibleStatus}</p> : null}
      {state.kind === "ready" ? (
        <div className="landing-carousel-wrap">
          <ul
            className="landing-carousel"
            id="galeria-track"
            data-carousel
            data-ready="true"
            role="group"
            aria-label="Galería de fotos del club"
            ref={trackRef}
            onMouseEnter={(): void => { hoverRef.current = true; syncHold(); }}
            onMouseLeave={(): void => { hoverRef.current = false; syncHold(); }}
            onFocus={(): void => { focusRef.current = true; syncHold(); }}
            onBlur={(): void => { focusRef.current = false; syncHold(); }}
            onKeyDown={(event): void => {
              // Arrow keys browse on the same terms as the buttons, from
              // wherever inside the strip keyboard focus happens to sit.
              if (event.key === "ArrowRight") {
                event.preventDefault();
                browse("next");
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                browse("prev");
              }
            }}
          >
            {state.run.map(({ entry, clone }, index): React.ReactElement => (
              <li
                key={`${entry.id}:${index}`}
                className={clone ? "landing-slide-clone" : undefined}
                aria-hidden={clone || undefined}
              >
                <figure
                  className={openIndex === index ? "landing-slide is-open" : "landing-slide"}
                  style={{ aspectRatio: `${(state.aspects.get(entry.id) ?? DEFAULT_SLIDE_ASPECT).toFixed(4)}` }}
                  tabIndex={clone ? undefined : 0}
                  onClick={(): void => toggleOpen(index)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset (same pattern as the landing's sponsor logos) */}
                  <img src={entry.imageSrc} alt={entry.description} loading="lazy" draggable={false} />
                  <figcaption className="landing-slide-caption">
                    <span className="landing-slide-title">{entry.title}</span>
                    <span className="landing-slide-description">{entry.description}</span>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
          {state.entries.length > 1 ? (
            <>
              <div className="landing-gallery-nav" role="group" aria-label="Navegar por la galería" ref={navRef}>
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
