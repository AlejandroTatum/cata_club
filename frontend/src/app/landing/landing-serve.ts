/**
 * The hero's serve: a ball bouncing off the club's paddle (issue #640).
 *
 * The ball came first and used to bounce alone, over nothing. Adding the thing
 * that hits it turns one decorative tween into a pair that has to agree, and
 * agreement is the whole feature: a paddle whose period drifted from the ball's
 * would swing at empty air and meet the ball halfway up its flight, which looks
 * broken in a way no still frame reveals.
 *
 * So the choreography lives here rather than inline in `LandingMotion`, for one
 * reason: it can be built against detached nodes and stepped through by its own
 * clock, so `__tests__/landing-serve.test.ts` asserts the phase lock directly
 * instead of inferring it from a screenshot. `LandingMotion` calls exactly this
 * builder, so what the tests step through is what the browser runs.
 *
 * ## Why one timeline instead of two tweens
 *
 * Two independent tweens with matching numbers stay in phase only for as long
 * as nobody edits one of them. Inside a single repeating timeline the pair
 * shares one clock and one period, so the ball's return and the paddle's swing
 * back to square are the same instant by construction — not by two durations
 * that happen to be equal today.
 *
 * Where the pair SITS is a layout fact and belongs to `landing.css`, which
 * anchors both from one origin; it is proved in `tests/e2e/landing.spec.ts`.
 */

import gsap from "gsap";

/** How high the ball rises off the face, in pixels. */
export const SERVE_LIFT_PX = 86;

/**
 * One leg of the flight — up, or down — in seconds.
 *
 * Unchanged from the ball's original solo bounce, together with its
 * `sine.inOut` ease: adding the paddle must not restyle the serve itself.
 */
export const SERVE_HALF_DURATION = 0.56;

/** Rise plus fall: the period of the whole serve, and of the paddle with it. */
export const SERVE_CYCLE_DURATION = SERVE_HALF_DURATION * 2;

/** How far the paddle swings back from square while the ball is up, in degrees. */
export const SERVE_RECOIL_DEG = 18;

/** How far the paddle drops as it swings back, in pixels. */
export const SERVE_DIP_PX = 5;

/**
 * Builds the repeating serve, and starts it.
 *
 * `paddle` is optional on purpose. The ball predates it and is the older half
 * of the composition, so markup that lost the paddle should cost the paddle
 * only — never the serve.
 */
export function buildServeTimeline(
  ball: HTMLElement,
  paddle: HTMLElement | null,
): gsap.core.Timeline {
  // From a known pose, so a re-run after a media-query switch cannot start from
  // whatever transform the previous run happened to stop on.
  gsap.set(ball, { opacity: 1, x: 0, y: 0, rotation: 0 });
  if (paddle) gsap.set(paddle, { x: 0, y: 0, rotation: 0 });

  const timeline = gsap.timeline({ repeat: -1, defaults: { duration: SERVE_HALF_DURATION } });

  timeline
    .to(ball, { y: -SERVE_LIFT_PX, ease: "sine.inOut" }, 0)
    .to(ball, { y: 0, ease: "sine.inOut" }, SERVE_HALF_DURATION);

  if (paddle) {
    /* The paddle carries its own ease — it falls away and recovers on a
       different curve than the ball flies on, so the two read as two objects
       rather than one rigid shape. What it may NOT have is its own timing:
       both legs are `SERVE_HALF_DURATION`, and both eases are symmetric and
       flat at their endpoints, so the paddle is square to the ball through the
       whole contact rather than only at a single unobservable instant. */
    timeline
      .to(paddle, { rotation: -SERVE_RECOIL_DEG, y: SERVE_DIP_PX, ease: "power1.inOut" }, 0)
      .to(paddle, { rotation: 0, y: 0, ease: "power1.inOut" }, SERVE_HALF_DURATION);
  }

  return timeline;
}
