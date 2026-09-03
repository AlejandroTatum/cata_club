/**
 * Shared render doubles for tests that mount `LandingPage` (or a slice of it)
 * under jsdom.
 *
 * `next/image`, `LandingMap` and `LandingMotion` all need a stand-in before
 * `LandingPage` renders: `LandingMap` draws a Leaflet canvas jsdom cannot lay
 * out, and `LandingMotion` is GSAP + Lenis, neither of which does anything
 * useful without a real viewport. `landing-image-delivery.test.tsx` and
 * `landing-editorial-symmetry.test.tsx` both need exactly those three mocks
 * plus the same `fetch`/`ResizeObserver`/`matchMedia` stubs — two copies of
 * that block are one duplicated block to a detector that reads tokens rather
 * than intent (the same reasoning `schedule-fixtures.ts` documents for the
 * schedule builders). `LandingPage.test.tsx` keeps its own variant instead of
 * reusing this one: it tracks `LandingMotion`'s mount and strips `sizes` on
 * purpose, and forcing that onto every other caller here would have meant
 * carrying `motionMount` through suites that never touch it.
 *
 * `vi.mock` factories still have to be written in each test file — Vitest
 * only hoists a `vi.mock` call inside the module where it appears — so the
 * few lines that remain there just hand the real work to what is exported
 * below.
 */

import { vi } from "vitest";

/**
 * Stands in for `next/image`. Forwards `sizes`, `loading` and `unoptimized`
 * (as `data-unoptimized`) rather than swallowing them, so a suite asserting
 * on those attributes still can.
 */
export function NextImageDouble({
  priority,
  fill: _fill,
  unoptimized,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean; unoptimized?: boolean }): React.ReactElement {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt ?? ""}
      data-priority={priority ? "true" : undefined}
      data-unoptimized={unoptimized ? "true" : undefined}
      {...props}
    />
  );
}

/** Stands in for `LandingMap`'s Leaflet canvas. */
export function LandingMapDouble(): React.ReactElement {
  return <div aria-label="Mapa de ubicación de Cata Club" />;
}

/** Stands in for `LandingMotion`: no GSAP timeline, no Lenis instance. */
export function LandingMotionDouble(): null {
  return null;
}

/**
 * `LandingPage` mounts a reduced-motion query, a sponsor fetch and a
 * `ResizeObserver`; jsdom provides none of them, and most suites care about
 * none of them, so this stubs each to its quietest useful answer. Call from
 * `beforeEach`; pair with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubLandingGlobals(): void {
  vi.stubGlobal("fetch", vi.fn((): Promise<{ ok: boolean; json: () => Promise<unknown> }> =>
    Promise.resolve({ ok: true, json: async (): Promise<unknown> => [] })));
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("matchMedia", vi.fn((query: string): MediaQueryList => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList)));
}
