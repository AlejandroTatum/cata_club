/** @vitest-environment jsdom */

/**
 * The synchronisation contract between the hero's serve ball and the paddle
 * underneath it (issue #640).
 *
 * The paddle is not decoration that happens to sit near the ball: it is the
 * thing that produces the bounce, so the two have to agree on WHEN the hit
 * happens. A paddle whose period drifted from the ball's would still look
 * plausible in a screenshot — it would simply be square to nothing, striking
 * air while the ball was mid-flight — which is why this is asserted as a
 * relationship between the two targets and never as an appearance.
 *
 * These run the REAL timeline `LandingMotion` installs, on real GSAP, and read
 * back the transforms it writes. jsdom has no layout, so where the paddle sits
 * relative to the ball is proved in `tests/e2e/landing.spec.ts` instead; what
 * lives here is the part that is pure choreography and needs no box model.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import gsap from "gsap";
import {
  SERVE_CYCLE_DURATION,
  SERVE_HALF_DURATION,
  SERVE_LIFT_PX,
  SERVE_RECOIL_DEG,
  buildServeTimeline,
} from "@/app/landing/landing-serve";

/**
 * How close to its resting height the ball has to be to count as touching the
 * paddle face. Sampled time can never land exactly on the contact instant, so
 * "in contact" has to be a window; 6px of an 86px flight is the bottom 7% of
 * the arc, which is unambiguously the hit and not the flight.
 */
const CONTACT_PX = 6;

/** How far off square the paddle may be while the ball is on its face. */
const SQUARE_DEG = 3;

/** Reading back exactly what GSAP wrote, as a number in either GSAP version. */
const transformOf = (element: HTMLElement): { y: number; rotation: number } => ({
  y: Number(gsap.getProperty(element, "y")),
  rotation: Number(gsap.getProperty(element, "rotation")),
});

describe("hero serve choreography", (): void => {
  let ball: HTMLElement;
  let paddle: HTMLElement;
  let timeline: gsap.core.Timeline;

  beforeEach((): void => {
    ball = document.createElement("span");
    paddle = document.createElement("span");
    document.body.append(ball, paddle);
  });

  afterEach((): void => {
    timeline?.kill();
    gsap.killTweensOf([ball, paddle]);
    document.body.innerHTML = "";
  });

  it("brings the paddle square to the ball at every impact", (): void => {
    timeline = buildServeTimeline(ball, paddle).pause();

    // Four consecutive cycles, so a period that drifted by a fraction would
    // accumulate into a visible miss rather than hiding inside one tolerance.
    for (let cycle = 0; cycle <= 3; cycle += 1) {
      timeline.totalTime(cycle * SERVE_CYCLE_DURATION);
      const at = `impact ${cycle}`;
      expect(transformOf(ball).y, `ball resting on the face at ${at}`).toBeCloseTo(0, 3);
      expect(transformOf(paddle).rotation, `paddle square at ${at}`).toBeCloseTo(0, 3);
    }
  });

  it("recoils the paddle exactly while the ball is at the top of its flight", (): void => {
    timeline = buildServeTimeline(ball, paddle).pause();
    timeline.totalTime(SERVE_HALF_DURATION);

    expect(transformOf(ball).y).toBeCloseTo(-SERVE_LIFT_PX, 3);
    expect(transformOf(paddle).rotation).toBeCloseTo(-SERVE_RECOIL_DEG, 3);
  });

  it("never lets the two drift apart anywhere in the cycle", (): void => {
    timeline = buildServeTimeline(ball, paddle).pause();

    const SAMPLES = 240;
    let contacts = 0;
    const drifts: string[] = [];

    for (let step = 0; step <= SAMPLES; step += 1) {
      const time = (step / SAMPLES) * SERVE_CYCLE_DURATION * 2;
      timeline.totalTime(time);
      const { y } = transformOf(ball);
      const { rotation } = transformOf(paddle);
      const stamp = `t=${time.toFixed(3)}s ballY=${y.toFixed(2)} rot=${rotation.toFixed(2)}`;

      if (Math.abs(y) <= CONTACT_PX) {
        contacts += 1;
        // The ball is on the face: the face has to be there to meet it.
        if (Math.abs(rotation) > SQUARE_DEG) drifts.push(`struck off square: ${stamp}`);
      } else if (Math.abs(rotation) <= 0.2) {
        // The ball is airborne: a paddle sitting square is a paddle that has
        // stopped following it — the exact shape a desync takes.
        drifts.push(`paddle idle in flight: ${stamp}`);
      }
    }

    expect(drifts).toEqual([]);
    // Guards the assertion above against passing because it never fired.
    expect(contacts).toBeGreaterThanOrEqual(10);
  });

  it("repeats on the ball's own period, so the pair can never fall out of phase", (): void => {
    timeline = buildServeTimeline(ball, paddle).pause();

    expect(timeline.duration()).toBeCloseTo(SERVE_CYCLE_DURATION, 5);
    expect(SERVE_CYCLE_DURATION).toBeCloseTo(SERVE_HALF_DURATION * 2, 5);
    expect(timeline.repeat()).toBe(-1);
  });

  it("still bounces the ball when the paddle is missing", (): void => {
    // The ball predates the paddle and must not become dependent on it: a
    // markup change that dropped the paddle should cost the paddle, not the
    // serve.
    timeline = buildServeTimeline(ball, null).pause();
    timeline.totalTime(SERVE_HALF_DURATION);

    expect(transformOf(ball).y).toBeCloseTo(-SERVE_LIFT_PX, 3);
  });
});
