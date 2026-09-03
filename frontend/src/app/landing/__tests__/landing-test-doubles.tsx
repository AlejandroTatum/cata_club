/**
 * Shared render doubles and global stubs for tests that mount `LandingPage`
 * (or a slice of it) under jsdom.
 *
 * `landing-image-delivery.test.tsx`, `landing-editorial-symmetry.test.tsx`
 * and `landing-knowledge-parity.test.tsx` all need the same
 * `fetch`/`ResizeObserver`/`matchMedia` stubs and the same
 * `cleanup`/`vi.unstubAllGlobals` teardown; the first two also need the same
 * `next/image`/`LandingMap`/`LandingMotion` doubles. Two or more copies of
 * any of that are one duplicated block to a detector that reads tokens
 * rather than intent (the same reasoning `schedule-fixtures.ts` documents
 * for the schedule builders).
 *
 * This module holds only the doubles and the plain stub/teardown functions —
 * no `vi.mock` call. `landing-knowledge-parity.test.tsx` needs the stubs but
 * keeps its own `next/image` double (it also mocks `next/link`,
 * `AuthContext` and more, none of which belong here), so it imports only
 * `stubLandingGlobals`/`resetLandingTestEnvironment` from here and nothing
 * would work if importing them ALSO registered mocks this file never asked
 * for. `landing-render-mocks.tsx` is the sibling module that registers the
 * three `vi.mock`s from the doubles exported below, for the two suites that
 * do want the full default set. `LandingPage.test.tsx` keeps its own
 * `next/image`/`LandingMotion` variant regardless: it tracks
 * `LandingMotion`'s mount and strips `sizes` on purpose, and forcing that
 * onto every other caller here would have meant carrying `motionMount`
 * through suites that never touch it.
 */

import { cleanup } from "@testing-library/react";
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
 * `beforeEach`; pair with `resetLandingTestEnvironment()` in `afterEach`.
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

/** The teardown every `stubLandingGlobals()` caller pairs it with. */
export function resetLandingTestEnvironment(): void {
  cleanup();
  vi.unstubAllGlobals();
}
