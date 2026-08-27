/**
 * The smooth-scroll hold — the half of the sheet's scroll lock that
 * `overflow: hidden` cannot do.
 *
 * Measured before the fix, at 390x844 on the landing page with the CATA-BOT
 * sheet open: one wheel gesture took `window.scrollY` from 0 to 886 behind it.
 * The body WAS locked; Lenis simply does not scroll the page the way a locked
 * body prevents — it cancels the gesture and calls `scrollTo` itself. These
 * tests pin the coordination that replaced that: holds are counted, only what
 * this module stopped is restarted, and a page with no engine is unaffected.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  holdSmoothScroll,
  registerSmoothScroll,
  resetSmoothScrollForTests,
  type SmoothScrollController,
} from "@/lib/smooth-scroll";

/** A stand-in for Lenis, with the same `stop`/`start`/`isStopped` contract. */
function fakeEngine(): SmoothScrollController & { stops: number; starts: number } {
  return {
    stops: 0,
    starts: 0,
    isStopped: false,
    stop(): void {
      this.stops += 1;
      (this as { isStopped: boolean }).isStopped = true;
    },
    start(): void {
      this.starts += 1;
      (this as { isStopped: boolean }).isStopped = false;
    },
  };
}

afterEach(() => {
  resetSmoothScrollForTests();
});

describe("smooth-scroll holds", () => {
  it("stops the engine while a hold is open and starts it on release", () => {
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    const release = holdSmoothScroll();
    expect(engine.isStopped).toBe(true);

    release();
    expect(engine.isStopped).toBe(false);
    expect(engine.stops).toBe(1);
    expect(engine.starts).toBe(1);
  });

  it("keeps the page held until the LAST hold is released", () => {
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    const first = holdSmoothScroll();
    const second = holdSmoothScroll();
    first();

    expect(engine.isStopped).toBe(true);

    second();
    expect(engine.isStopped).toBe(false);
  });

  it("ignores a release called twice, so one cleanup cannot free another's hold", () => {
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    const first = holdSmoothScroll();
    const second = holdSmoothScroll();
    first();
    first();

    expect(engine.isStopped).toBe(true);
    second();
    expect(engine.isStopped).toBe(false);
  });

  it("stops an engine that mounts while a hold is already open", () => {
    // The landing's Lenis is loaded lazily, so "the sheet opened first" is a
    // real ordering rather than a hypothetical one.
    const release = holdSmoothScroll();
    const engine = fakeEngine();
    registerSmoothScroll(engine);

    expect(engine.isStopped).toBe(true);
    release();
    expect(engine.isStopped).toBe(false);
  });

  it("never starts an engine somebody else had already stopped", () => {
    const engine = fakeEngine();
    engine.stop();
    engine.starts = 0;
    registerSmoothScroll(engine);

    holdSmoothScroll()();

    expect(engine.starts).toBe(0);
    expect(engine.isStopped).toBe(true);
  });

  it("is a no-op on a page with no smooth-scroll engine at all", () => {
    // `/login` and every app page: the caller's own body lock is the whole
    // story there, exactly as before.
    expect(() => holdSmoothScroll()()).not.toThrow();
  });

  it("stops touching an engine once it has unregistered", () => {
    const engine = fakeEngine();
    const unregister = registerSmoothScroll(engine);
    unregister();

    holdSmoothScroll();

    expect(engine.stops).toBe(0);
  });

  it("hands the page back before an engine unregisters mid-hold", () => {
    const engine = fakeEngine();
    const unregister = registerSmoothScroll(engine);
    const release = holdSmoothScroll();
    unregister();
    release();

    // Nothing to start — but the NEXT engine registered must not inherit a
    // hold that was already released.
    const next = fakeEngine();
    registerSmoothScroll(next);
    expect(next.isStopped).toBe(false);
  });

  it("exposes the exact shape a Lenis instance already has", () => {
    // Structural typing is the whole seam: `registerSmoothScroll(lenis)` must
    // compile without an adapter, or the landing would need a wrapper nobody
    // maintains.
    const lenisLike = { stop: vi.fn(), start: vi.fn(), isStopped: false };
    expect(() => registerSmoothScroll(lenisLike)).not.toThrow();
  });
});
