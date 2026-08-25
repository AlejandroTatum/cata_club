/**
 * Runtime-oriented guard for the GSAP registration contract that LandingMotion
 * depends on (issue #276 / landing QA).
 *
 * The Chrome audit of a stale QA bundle emitted "Invalid property drawSVG /
 * motionPath ... Missing plugin?" because the deployed JS predated the
 * MotionPathPlugin/DrawSVGPlugin registration. This test exercises the REAL
 * installed gsap package and the EXACT import list LandingMotion uses, then
 * proves the browser-grade warning class is absent for those properties while
 * still firing for a genuinely unregistered one — so the guard both catches
 * the audit's warning and proves it can see that warning at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { SplitText } from "gsap/SplitText";

const missingPluginWarnings = (spy: ReturnType<typeof vi.spyOn>): unknown[][] =>
  spy.mock.calls.filter((args): boolean => args.map(String).join(" ").includes("Missing plugin"));

describe("LandingMotion GSAP plugin registration", (): void => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let path: SVGPathElement;

  beforeEach((): void => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation((): void => {});
    // ScrollTrigger.register calls gsap.matchMedia on registration, and jsdom
    // ships no matchMedia — same stub the LandingPage suite uses.
    vi.stubGlobal("matchMedia", vi.fn((query: string): Partial<MediaQueryList> => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    document.body.appendChild(svg);
  });

  afterEach((): void => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Lifecycle cleanup: any tween created against the probe path must be dead
    // before the next tick, or the ticker renders it and jsdom's missing SVG
    // geometry surfaces as an unhandled MotionPathPlugin error (seen as
    // "Vitest caught 1 unhandled error"). Kill + clear, never suppress globally.
    gsap.killTweensOf(path);
    gsap.set(path, { clearProps: "all" });
    document.body.innerHTML = "";
  });

  it("registers every plugin playRally uses; drawSVG and motionPath never warn 'Missing plugin?'", (): void => {
    // Same list and order as LandingMotion's effect.
    gsap.registerPlugin(ScrollTrigger, Draggable, InertiaPlugin, MotionPathPlugin, DrawSVGPlugin, SplitText);

    // jsdom implements no SVG geometry (getTotalLength/getBBox), so the tweens
    // may throw in plugin init — irrelevant here, only the missing-plugin
    // WARNING class matters. Kill the motion-path tween right away so its
    // render never reaches the ticker (afterEach kill is the backstop).
    let tween: gsap.core.Tween | null = null;
    try {
      gsap.set(path, { drawSVG: "0%" });
      tween = gsap.to(path, {
        motionPath: { path, align: path, alignOrigin: [0.5, 0.5], start: 0, end: 1, autoRotate: false },
        duration: 0.001,
      });
      tween.kill();
    } catch {
      // geometry limitation of the jsdom environment, expected
    }

    expect(missingPluginWarnings(warnSpy)).toEqual([]);

    // Control: a genuinely unregistered plugin property still warns, proving
    // the spy above would have caught the audit's warning had it fired.
    gsap.set(path, { morphSVG: "morph" });
    expect(missingPluginWarnings(warnSpy)).toHaveLength(1);
    expect(warnSpy.mock.calls[0].map(String).join(" ")).toMatch(/morphSVG/);
  });
});