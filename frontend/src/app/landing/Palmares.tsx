"use client";

import { useCallback, useEffect, useState, type FocusEvent, type KeyboardEvent } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { ACHIEVEMENT_GROUPS, logroPhotoSrc, PODIO_DIMENSIONS, type AchievementGroup } from "./landing-logros";

const AUTO_ADVANCE_INTERVAL_MS = 10_000;

interface LogroFactProps {
  label: string;
  value?: string;
}

function LogroFact({ label, value }: LogroFactProps): React.ReactElement | null {
  if (!value) return null;
  return (
    <div className="landing-logro-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function nextIndex(current: number, offset: number): number {
  return (current + offset + ACHIEVEMENT_GROUPS.length) % ACHIEVEMENT_GROUPS.length;
}

export default function Palmares(): React.ReactElement {
  const [current, setCurrent] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const selected = ACHIEVEMENT_GROUPS[current];

  useEffect((): (() => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return (): void => {};

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReducedMotion(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return (): void => media.removeEventListener("change", update);
    }
    media.addListener?.(update);
    return (): void => media.removeListener?.(update);
  }, []);

  useEffect((): (() => void) | undefined => {
    if (reducedMotion || paused || hovering || focused) return undefined;
    const timer = window.setInterval((): void => {
      setCurrent((index): number => nextIndex(index, 1));
    }, AUTO_ADVANCE_INTERVAL_MS);
    return (): void => window.clearInterval(timer);
  }, [focused, hovering, paused, reducedMotion, resetVersion]);

  const select = useCallback((index: number): void => {
    setCurrent(index);
    setResetVersion((version): number => version + 1);
  }, []);

  const move = useCallback((offset: number): void => {
    setCurrent((index): number => nextIndex(index, offset));
    setResetVersion((version): number => version + 1);
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = nextIndex(index, 1);
      select(next);
      document.getElementById(`landing-logro-tab-${next}`)?.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const previous = nextIndex(index, -1);
      select(previous);
      document.getElementById(`landing-logro-tab-${previous}`)?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const destination = event.key === "Home" ? 0 : ACHIEVEMENT_GROUPS.length - 1;
      select(destination);
      document.getElementById(`landing-logro-tab-${destination}`)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(index);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <section
      className="landing-section landing-wins"
      id="logros"
      data-motion-section
      data-testid="motion-section"
      aria-label="Logros deportivos"
      aria-roledescription="carousel"
      role="region"
      onMouseEnter={(): void => setHovering(true)}
      onMouseLeave={(): void => setHovering(false)}
      onFocus={(): void => setFocused(true)}
      onBlur={handleBlur}
    >
      <header className="landing-section-header" data-reveal>
        <span className="landing-eyebrow">Nuestra vitrina</span>
        <h2>Logros</h2>
      </header>

      <article
        className="landing-logro"
        id="landing-logro-panel"
        role="group"
        aria-roledescription="slide"
        aria-label={`Logro ${current + 1} de ${ACHIEVEMENT_GROUPS.length}: ${selected.title}`}
        aria-live="polite"
        data-reveal
      >
        <figure className="landing-logro-photo">
          <Image
            src={logroPhotoSrc(selected.photo)}
            alt={`${selected.title} — imagen de referencia provisional`}
            width={PODIO_DIMENSIONS[selected.photo].width}
            height={PODIO_DIMENSIONS[selected.photo].height}
            sizes="(max-width: 768px) 100vw, 42vw"
            loading="lazy"
          />
          <span className="landing-logro-index" aria-hidden="true">
            {String(current + 1).padStart(2, "0")}
          </span>
        </figure>

        <div className="landing-logro-story">
          <p className="landing-logro-kicker">{selected.kicker}</p>
          <h3 className="landing-logro-title">{selected.title}</h3>
          <p>{selected.story}</p>
          <dl className="landing-logro-facts">
            <LogroFact label="Competencia" value={selected.competition} />
            <LogroFact label="Año" value={selected.year} />
            <LogroFact label="Resultado" value={selected.result} />
            <LogroFact label="Sede" value={selected.venue} />
            <LogroFact label="Categorías" value={selected.category} />
            <LogroFact label="Deportistas" value={selected.athletes} />
          </dl>
          <p className="landing-logro-source-note">
            Imágenes de referencia provisionales; no constituyen evidencia de eventos.
          </p>
        </div>

        <div className="landing-logro-controls" aria-label="Controles de logros">
          <span className="landing-logro-position" aria-live="polite">
            {current + 1} / {ACHIEVEMENT_GROUPS.length}
          </span>
          <button type="button" className="landing-logro-control" aria-label="Logro anterior" onClick={(): void => move(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="landing-logro-control landing-logro-control-pause"
            aria-label={paused ? "Reanudar logros" : "Pausar logros"}
            aria-pressed={paused}
            onClick={(): void => {
              setPaused((value): boolean => !value);
              setResetVersion((version): number => version + 1);
            }}
          >
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            <span>{paused ? "Reanudar" : "Pausar"}</span>
          </button>
          <button type="button" className="landing-logro-control" aria-label="Logro siguiente" onClick={(): void => move(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </article>

      <nav className="landing-logro-thumbnails" aria-label="Competencias">
        <div className="landing-logro-tablist" role="tablist" aria-label="Seleccionar competencia">
          {ACHIEVEMENT_GROUPS.map((group: AchievementGroup, index: number): React.ReactElement => (
            <button
              key={group.id}
              id={`landing-logro-tab-${index}`}
              type="button"
              className="landing-logro-tab"
              role="tab"
              aria-selected={index === current}
              aria-current={index === current ? "true" : undefined}
              aria-controls="landing-logro-panel"
              tabIndex={index === current ? 0 : -1}
              onClick={(): void => select(index)}
              onKeyDown={(event): void => handleTabKeyDown(event, index)}
            >
              <span className="landing-logro-tab-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              {/* #1154 / #1159: below 1550px viewport width, the seven tabs
                  sit at their 176px `.landing-logro-tab` floor (7 × 176px +
                  6 × 10px gaps = 1292px, which is what 1550px of viewport
                  yields after the section's 8.33vw gutter on both sides:
                  1550 × 0.8334 ≈ 1292), so the photo still renders at
                  176 − 2×6px padding − 2×1px border = 162px, the same number
                  the CSS card and the carousel test lock in below.
                  Past 1550px the tabs grow with `flex: 1 1 176px` to fill
                  the tablist evenly, so 162px would underestimate the real
                  width and, per `landing-image-sizes.ts`, letting `sizes`
                  fall back to a `vw` unit would jump `next/image` off its
                  small candidate ladder entirely. Instead this branch is
                  pinned in plain pixels to the widest realistic desktop
                  render: at a 1920px reference viewport (Full HD — the
                  largest of next.config's default `deviceSizes` that is a
                  real, common CSS width rather than a 2x/3x pixel-density
                  multiple of it), content width is 1920 × 0.8334 ≈ 1600px,
                  minus 6 × 10px gaps = 1540px, split 7 ways ≈ 220px per tab,
                  minus the same 14px of padding/border ≈ 206px. Wider
                  screens render the photo a little larger than declared —
                  an accepted trade-off, not a defect — rather than the
                  reverse. Change all three numbers (176, 1550, 206) together
                  with the CSS. */}
              <Image
                src={logroPhotoSrc(group.photo)}
                alt=""
                width={PODIO_DIMENSIONS[group.photo].width}
                height={PODIO_DIMENSIONS[group.photo].height}
                sizes="(max-width: 1550px) 162px, 206px"
                loading="lazy"
                aria-hidden="true"
              />
              <span>{group.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </section>
  );
}
