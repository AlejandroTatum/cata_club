/** @vitest-environment jsdom */

/**
 * Locks for the two ways a landing photograph can be delivered badly.
 *
 * 1. A large source rendered into a small box without a `sizes` prop. Next
 *    then builds its srcset from the declared `width` alone and the browser
 *    takes the top bucket: `photo-community.jpeg` shipped 194,016 bytes into
 *    a 227x170 box, and `vision-team-1329.jpg` 172,216 into 226x170.
 * 2. A hero slide the browser never fetches (issue #705). Chromium's
 *    lazy-loader declines the inactive slides because landing.css leaves them
 *    transparent and clipped, so tab 02 revealed an empty frame.
 *
 * The `next/image` mock below deliberately forwards `sizes` and `loading`.
 * The mock in `LandingPage.test.tsx` strips `sizes`, which is precisely why
 * that suite stayed green while three images shipped without one — a lock on
 * an attribute has to let the attribute through.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HeroCarousel from "@/app/landing/HeroCarousel";
import { HERO_PHOTOS } from "@/app/landing/landing-hero-photos";
import LandingPage from "@/app/landing/LandingPage";

vi.mock("next/image", (): { __esModule: boolean; default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean; unoptimized?: boolean }) => React.ReactElement } => ({
  __esModule: true,
  default: ({ priority, fill: _fill, unoptimized, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean; unoptimized?: boolean }): React.ReactElement => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt ?? ""}
      data-priority={priority ? "true" : undefined}
      data-unoptimized={unoptimized ? "true" : undefined}
      {...props}
    />
  ),
}));

vi.mock("@/app/landing/LandingMap", (): { default: () => React.ReactElement } => ({
  default: (): React.ReactElement => <div aria-label="Mapa de ubicación de Cata Club" />,
}));

vi.mock("@/app/landing/LandingMotion", (): { default: () => null } => ({
  default: (): null => null,
}));

beforeEach((): void => {
  // `LandingPage` mounts a reduced-motion query, a sponsor fetch and a
  // `ResizeObserver`; jsdom provides none of them and this suite cares about
  // none of them, so they are stubbed to their quietest useful answer.
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
});

afterEach((): void => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "cancelIdleCallback");
});

/**
 * Above this, a source is far larger than any box on this page and the top
 * srcset bucket is a real cost. Small sources (the 240px palmares thumbnails,
 * the 84px crests) are already proportionate without a `sizes` prop.
 */
const LARGE_SOURCE_WIDTH = 1000;

describe("landing images declare the width they are actually rendered at", (): void => {
  it("gives every large-source landing photo a non-empty sizes prop", (): void => {
    const { container } = render(<LandingPage />);

    const oversized = Array.from(container.querySelectorAll("img")).filter((img): boolean => {
      if (img.dataset.unoptimized === "true") return false;
      return Number(img.getAttribute("width") ?? 0) >= LARGE_SOURCE_WIDTH;
    });

    // Guards the guard: if the landing stops rendering large photos entirely,
    // the loop below would pass vacuously and prove nothing.
    expect(oversized.length).toBeGreaterThanOrEqual(3);

    const withoutSizes = oversized
      .filter((img): boolean => !img.getAttribute("sizes"))
      .map((img): string => img.getAttribute("src") ?? "(no src)");

    expect(withoutSizes).toEqual([]);
  });

  it("keeps the thumbnail sizes free of vw units, which would raise the srcset floor to 640", (): void => {
    const { container } = render(<LandingPage />);

    for (const selector of [".landing-editorial-media img", ".landing-map-inset img"]) {
      const images = Array.from(container.querySelectorAll<HTMLImageElement>(selector));
      expect(images.length).toBeGreaterThan(0);
      for (const img of images) {
        const sizes = img.getAttribute("sizes");
        expect(sizes, `${img.getAttribute("src")} declares no sizes at all`).toBeTruthy();
        expect(sizes ?? "").not.toMatch(/vw/);
      }
    }
  });
});

describe("hero carousel releases every slide to the network (issue #705)", (): void => {
  const slides = (): HTMLImageElement[] =>
    Array.from(document.querySelectorAll<HTMLImageElement>("img[data-slide]"));

  it("never leaves the first slide lazy", (): void => {
    render(<HeroCarousel />);

    expect(slides()[0]).toHaveAttribute("data-priority", "true");
    expect(slides()[0].getAttribute("loading")).not.toBe("lazy");
  });

  it("releases the next slide once the page goes idle", (): void => {
    const idle = vi.fn((callback: () => void): number => {
      callback();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    window.requestIdleCallback = idle as unknown as typeof window.requestIdleCallback;

    render(<HeroCarousel />);

    expect(idle).toHaveBeenCalled();
    expect(slides()[1]).toHaveAttribute("loading", "eager");
  });

  it("falls back to a timer where requestIdleCallback is missing", (): void => {
    vi.useFakeTimers();
    render(<HeroCarousel />);

    expect(slides()[1]).toHaveAttribute("loading", "lazy");
    act((): void => { vi.advanceTimersByTime(2_000); });
    expect(slides()[1]).toHaveAttribute("loading", "eager");
  });

  it("releases every remaining slide on the first interaction with the tabs", (): void => {
    render(<HeroCarousel />);

    // Before any interaction the last slide is still held back, so a visitor
    // who never touches the carousel does not pay for three hero photos.
    expect(slides()[HERO_PHOTOS.length - 1]).toHaveAttribute("loading", "lazy");

    fireEvent.click(screen.getAllByRole("tab")[1]);

    for (const slide of slides().slice(1)) {
      expect(slide).toHaveAttribute("loading", "eager");
    }
  });

  it("releases the remaining slides from keyboard navigation too", (): void => {
    render(<HeroCarousel />);

    fireEvent.keyDown(screen.getAllByRole("tab")[0].parentElement as HTMLElement, { key: "ArrowRight" });

    for (const slide of slides().slice(1)) {
      expect(slide).toHaveAttribute("loading", "eager");
    }
  });
});
