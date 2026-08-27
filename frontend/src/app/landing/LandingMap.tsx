"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const MapCanvas = dynamic((): Promise<typeof import("./MapCanvas")> => import("./MapCanvas"), {
  ssr: false,
  loading: (): React.ReactElement => <div className="landing-map landing-map-loading" role="status">Cargando mapa…</div>,
});

/**
 * How far ahead of the viewport the map is allowed to start loading. Enough
 * that a visitor scrolling toward `#contacto` finds tiles already in place,
 * short enough that the map is never fetched for someone who stops at the
 * gallery — the whole point of the gate.
 */
const MAP_PRELOAD_MARGIN = "200px";

/**
 * The map, mounted only once it is about to be seen — see issue #709.
 *
 * `#contacto` sits at the bottom of the landing page, but mounting it eagerly
 * cost every single visitor 9 OpenStreetMap tile requests plus the marker art
 * on first paint, whether or not they ever scrolled that far. Together with
 * the CDN pin that was 11 requests to two third-party hosts on a page load
 * that needed none of them.
 *
 * Deferring the mount does not change the layout: the placeholder below
 * carries the same `.landing-map` class the real canvas does, so it fills the
 * exact same box and the swap shifts nothing (CLS stays 0). It is also the
 * element being observed — no extra wrapper, so no new percentage-height link
 * in the chain that gives the map its height inside `.landing-map-stage`.
 *
 * Where `IntersectionObserver` is missing the map mounts immediately, which is
 * simply today's behaviour: degrading to "loads too early" is the right way
 * round for a section a visitor may well be heading to.
 */
export default function LandingMap(): React.ReactElement {
  const placeholder = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect((): (() => void) => {
    if (inView) return (): void => {};

    const element = placeholder.current;
    if (!element) return (): void => {};

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return (): void => {};
    }

    const observer = new IntersectionObserver(
      (entries): void => {
        if (!entries.some((entry): boolean => entry.isIntersecting)) return;
        // One-shot: once the map is up it must never be torn down, so the
        // observer has nothing left to watch.
        observer.disconnect();
        setInView(true);
      },
      { rootMargin: MAP_PRELOAD_MARGIN },
    );
    observer.observe(element);

    return (): void => observer.disconnect();
  }, [inView]);

  if (inView) return <MapCanvas />;

  return (
    <div ref={placeholder} className="landing-map landing-map-loading" role="status" data-map-placeholder>
      Cargando mapa…
    </div>
  );
}
