/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingMap from "@/app/landing/LandingMap";

/**
 * Lock — issue #709: the map must not be mounted until it is about to be
 * seen.
 *
 * Measured on `main` @ `97ae590`, a single landing load fired **11 requests to
 * third-party hosts before any scrolling at all**: 9 OpenStreetMap tiles and
 * 2 marker PNGs from `unpkg.com`. `#contacto` is at the bottom of the page,
 * so every visitor who never got there still paid for it — and sent their IP
 * to two hosts we do not control.
 *
 * What actually defers the work is the dynamic `import("./MapCanvas")`, which
 * only runs when the dynamic component renders. So that is what this suite
 * counts: the `next/dynamic` mock below increments `loader.calls` when the
 * component it returns is rendered, which is the observable stand-in for
 * "leaflet was loaded and started talking to OpenStreetMap".
 */
const { loader } = vi.hoisted((): { loader: { calls: number } } => ({ loader: { calls: 0 } }));

vi.mock("next/dynamic", (): { default: (load: () => unknown) => () => React.ReactElement } => ({
  default: (load: () => unknown): (() => React.ReactElement) =>
    function DynamicStub(): React.ReactElement {
      loader.calls += 1;
      void load();
      return <div data-testid="map-canvas" />;
    },
}));

vi.mock("@/app/landing/MapCanvas", (): { default: () => React.ReactElement } => ({
  default: (): React.ReactElement => <div />,
}));

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: number;
  options?: IntersectionObserverInit;
}

let observers: ObserverRecord[] = [];

function installIntersectionObserver(): void {
  class FakeIntersectionObserver {
    private readonly record: ObserverRecord;

    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.record = { callback, observed: [], disconnected: 0, options };
      observers.push(this.record);
    }

    observe(element: Element): void {
      this.record.observed.push(element);
    }

    unobserve(): void {}

    disconnect(): void {
      this.record.disconnected += 1;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

/** Fires the observer as the browser would when the placeholder scrolls in. */
function scrollIntoView(record: ObserverRecord): void {
  act((): void => {
    record.callback(
      [{ isIntersecting: true, target: record.observed[0] } as unknown as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

beforeEach((): void => {
  loader.calls = 0;
  observers = [];
  installIntersectionObserver();
});

afterEach((): void => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LandingMap", (): void => {
  it("does not load the map on first render, and holds its box with a placeholder", (): void => {
    render(<LandingMap />);

    expect(loader.calls).toBe(0);
    expect(screen.queryByTestId("map-canvas")).toBeNull();

    // Same `.landing-map` class the real canvas carries, so the swap costs no
    // layout shift — CLS is 0 today and this is what keeps it there.
    const placeholder = screen.getByRole("status");
    expect(placeholder.className).toContain("landing-map");
    expect(placeholder.className).toContain("landing-map-loading");
  });

  it("watches the placeholder itself, with room to load before it is reached", (): void => {
    render(<LandingMap />);

    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([screen.getByRole("status")]);
    expect(observers[0].options?.rootMargin).toBe("200px");
  });

  it("mounts the map the first time the placeholder comes into view", (): void => {
    render(<LandingMap />);
    scrollIntoView(observers[0]);

    expect(loader.calls).toBeGreaterThan(0);
    expect(screen.getByTestId("map-canvas")).toBeInTheDocument();
  });

  it("stops observing once the map is up, and never creates a second observer", (): void => {
    render(<LandingMap />);
    scrollIntoView(observers[0]);

    expect(observers[0].disconnected).toBeGreaterThan(0);
    expect(observers).toHaveLength(1);
  });

  it("mounts immediately where IntersectionObserver does not exist", (): void => {
    vi.stubGlobal("IntersectionObserver", undefined);

    render(<LandingMap />);

    expect(screen.getByTestId("map-canvas")).toBeInTheDocument();
  });
});
