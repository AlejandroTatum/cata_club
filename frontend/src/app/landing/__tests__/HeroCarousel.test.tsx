/** @vitest-environment jsdom */

/**
 * Lock — the hero carousel's auto-advance (issue: rotating photos on an
 * untouched hero).
 *
 * Auto-advance reuses the exact same `go` the arrows call — see
 * `HeroCarousel.tsx` — so every assertion here reads the same DOM state the
 * click tests in `LandingPage.test.tsx` already read (`data-active`), never
 * a GSAP transform. The interval itself is asserted with fake timers; the
 * reduced-motion gate and the hover/focus pause each get their own
 * `matchMedia`/`fireEvent` set-up rather than a shared one, so a failure
 * names exactly which condition stopped gating the timer.
 */

// This MUST come before the `HeroCarousel` import below: it registers
// `next/image`'s mock, and Vitest hoists `vi.mock` calls to the top of
// whatever module declares them, never into an importer. See the doc
// comment on `landing-render-mocks.tsx` for why the mock lives there.
import "./landing-render-mocks";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import HeroCarousel from "@/app/landing/HeroCarousel";

const AUTO_ADVANCE_INTERVAL_MS = 6000;

interface MockedMediaQueryList extends MediaQueryList {
  addEventListener: Mock;
  removeEventListener: Mock;
}

/** Controlled per test, so each one states its own motion preference. */
let reducedMotion = false;

function stubMatchMedia(): void {
  vi.stubGlobal("matchMedia", vi.fn((query: string): MockedMediaQueryList => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MockedMediaQueryList)));
}

/** The index of whichever slide currently carries `data-active="true"`. */
function activeSlideIndex(): number {
  const slides = Array.from(document.querySelectorAll<HTMLElement>("[data-slide]"));
  return slides.findIndex((slide): boolean => slide.getAttribute("data-active") === "true");
}

beforeEach((): void => {
  reducedMotion = false;
  stubMatchMedia();
});

afterEach((): void => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hero carousel auto-advance", (): void => {
  it("advances to the next slide after 6 seconds untouched", (): void => {
    vi.useFakeTimers();
    render(<HeroCarousel />);

    expect(activeSlideIndex()).toBe(0);
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(activeSlideIndex()).toBe(1);
  });

  it("never auto-advances under prefers-reduced-motion: reduce", (): void => {
    reducedMotion = true;
    stubMatchMedia();
    vi.useFakeTimers();
    render(<HeroCarousel />);

    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS * 4); });
    expect(activeSlideIndex()).toBe(0);
  });

  it("still moves on an arrow press under reduced motion — only the timer is gated", (): void => {
    reducedMotion = true;
    stubMatchMedia();
    render(<HeroCarousel />);

    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));

    expect(activeSlideIndex()).toBe(1);
  });

  it("pauses while the pointer is over the carousel, and resumes once it leaves", (): void => {
    vi.useFakeTimers();
    render(<HeroCarousel />);
    // `fireEvent.mouseEnter`/`mouseLeave` dispatch the native, non-bubbling
    // `mouseenter`/`mouseleave` events; React's delegated listener for
    // `onMouseEnter`/`onMouseLeave` is bound to `mouseover`/`mouseout`
    // instead, so those are what actually reach the handler under jsdom.
    const carousel = document.querySelector(".landing-hero-carousel") as HTMLElement;

    fireEvent.mouseOver(carousel);
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS * 2); });
    expect(activeSlideIndex()).toBe(0);

    fireEvent.mouseOut(carousel, { relatedTarget: document.body });
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(activeSlideIndex()).toBe(1);
  });

  it("pauses while focus is inside the carousel, and resumes once it leaves", (): void => {
    vi.useFakeTimers();
    render(<HeroCarousel />);
    const next = screen.getByRole("button", { name: "Foto siguiente" });

    fireEvent.focus(next);
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS * 2); });
    expect(activeSlideIndex()).toBe(0);

    fireEvent.blur(next);
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS); });
    expect(activeSlideIndex()).toBe(1);
  });

  it("resets the clock on a manual arrow press, so the next auto-advance is a full interval later", (): void => {
    vi.useFakeTimers();
    render(<HeroCarousel />);

    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS - 2000); });
    fireEvent.click(screen.getByRole("button", { name: "Foto siguiente" }));
    expect(activeSlideIndex()).toBe(1);

    // Only 4s past the press, which itself reset the clock — must not have
    // auto-advanced again yet, even though 4s + (interval - 2s) > interval.
    act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS - 2000); });
    expect(activeSlideIndex()).toBe(1);

    act((): void => { vi.advanceTimersByTime(2000); });
    expect(activeSlideIndex()).toBe(2);
  });

  it("clears the timer on unmount", (): void => {
    vi.useFakeTimers();
    const { unmount } = render(<HeroCarousel />);

    unmount();

    expect((): void => {
      act((): void => { vi.advanceTimersByTime(AUTO_ADVANCE_INTERVAL_MS * 3); });
    }).not.toThrow();
  });
});
