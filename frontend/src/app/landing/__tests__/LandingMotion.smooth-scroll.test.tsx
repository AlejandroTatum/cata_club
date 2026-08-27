/**
 * The landing's Lenis instance must be reachable from outside the landing.
 *
 * This is the other end of the sheet's scroll lock. `LandingMotion` owns the
 * only Lenis in the product, the CATA-BOT panel is mounted once in the root
 * layout, and neither can see the other — so an overlay that wants the page to
 * hold still can only get there through `src/lib/smooth-scroll.ts`. (Not
 * through `window.lenis`: Lenis publishes a version object there, with no
 * `stop` on it.)
 *
 * Asserted against the REAL Lenis, not a mock, and read from the class Lenis
 * itself writes on `<html>` — `lenis-stopped`. A mocked engine here would only
 * prove that this file's own fake was called.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import LandingMotion from "@/app/landing/LandingMotion";
import { holdSmoothScroll, resetSmoothScrollForTests } from "@/lib/smooth-scroll";

/**
 * gsap's `matchMedia` decides which of LandingMotion's two branches runs, and
 * jsdom answers `false` to every query — which is the reduced-motion branch,
 * the one that never builds a Lenis at all. Motion has to be ON for there to
 * be anything to reach.
 */
function stubMotionEnabled(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("no-preference"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  stubMotionEnabled();
  // Lenis measures its scroll container through a ResizeObserver; jsdom ships
  // none. The measurements are irrelevant here — only stop/start is.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSmoothScrollForTests();
  document.documentElement.className = "";
});

describe("LandingMotion — the page's smooth scroll, published", () => {
  it("lets an overlay hold the page still, and hands it back on release", () => {
    render(<LandingMotion />);
    expect(document.documentElement.classList.contains("lenis")).toBe(true);
    expect(document.documentElement.classList.contains("lenis-stopped")).toBe(false);

    const release = holdSmoothScroll();
    // Lenis's own class: the real instance is stopped, not a stand-in.
    expect(document.documentElement.classList.contains("lenis-stopped")).toBe(true);

    release();
    expect(document.documentElement.classList.contains("lenis-stopped")).toBe(false);
  });

  it("unpublishes the engine when the landing unmounts", () => {
    const { unmount } = render(<LandingMotion />);
    expect(document.documentElement.classList.contains("lenis")).toBe(true);

    unmount();
    // Lenis takes its own classes off the root when it is destroyed.
    expect(document.documentElement.classList.contains("lenis")).toBe(false);

    // Held, not held-and-released: a destroyed instance still published here
    // would be stopped by this call, and `stop()` writes Lenis's classes back
    // onto the root — which is exactly the leak this asserts against.
    holdSmoothScroll();

    expect(document.documentElement.className).toBe("");
  });
});
