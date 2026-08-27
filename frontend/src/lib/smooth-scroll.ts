/**
 * The page's smooth-scroll engine, and the one way to hold it still.
 *
 * ## Why `overflow: hidden` on the body is not a scroll lock here
 *
 * The landing page mounts Lenis (`LandingMotion`), which cancels the browser's
 * own wheel handling and scrolls the document ITSELF, frame by frame, through
 * `scrollTo`. `document.body.style.overflow = "hidden"` stops the USER from
 * scrolling; it does not stop a script from calling `scrollTo`. So with the
 * CATA-BOT sheet open over the landing, one wheel gesture still took the page
 * from `scrollY 0` to `886` behind it — the lock was real, and Lenis walked
 * straight past it. Under `prefers-reduced-motion: reduce` Lenis never mounts
 * and the same gesture moved nothing, which is what pinned the cause.
 *
 * Lenis's documented answer is `stop()` / `start()`: while stopped it swallows
 * the gesture instead of turning it into a programmatic scroll. This module is
 * the seam that lets a component reach it, because the two live in different
 * trees — Lenis belongs to the landing page, the assistant panel is mounted
 * once in the root layout, and neither can see the other. (`window.lenis` is
 * NOT the instance: Lenis only publishes a small version/telemetry object
 * there, with no `stop` on it.)
 *
 * ## Holds, not a boolean
 *
 * `holdSmoothScroll()` returns the release. Holds are counted, so two overlays
 * open at once cannot hand smooth scrolling back while the other still needs
 * it, and the engine is only restarted if THIS module is what stopped it —
 * anything else that had already stopped Lenis keeps its decision.
 *
 * Surfaces without Lenis (every app page, `/login`) simply have no controller
 * registered: a hold is then a no-op, and the caller's own body lock is the
 * whole story, exactly as before.
 */

/** The slice of a Lenis instance a hold needs. `Lenis` satisfies it as-is. */
export interface SmoothScrollController {
  stop: () => void;
  start: () => void;
  readonly isStopped: boolean;
}

let controller: SmoothScrollController | null = null;
let holds = 0;
/** Whether the engine is stopped BECAUSE of a hold taken here. */
let stoppedByHold = false;

function applyHolds(): void {
  if (!controller) return;
  if (holds > 0) {
    if (!controller.isStopped) {
      controller.stop();
      stoppedByHold = true;
    }
    return;
  }
  if (stoppedByHold) {
    stoppedByHold = false;
    controller.start();
  }
}

/**
 * Publish the page's smooth-scroll engine. Returns the unregister, which the
 * owner calls before destroying the instance.
 *
 * An engine that mounts while a hold is already open is stopped immediately —
 * the landing's Lenis is loaded lazily, so "the sheet was open first" is a
 * real ordering, not a hypothetical one.
 */
export function registerSmoothScroll(next: SmoothScrollController): () => void {
  controller = next;
  stoppedByHold = false;
  applyHolds();
  return (): void => {
    if (controller !== next) return;
    controller = null;
    stoppedByHold = false;
  };
}

/**
 * Hold the page still. Returns the release, which is safe to call twice (an
 * effect cleanup that ran once must not decrement a counter twice).
 */
export function holdSmoothScroll(): () => void {
  holds += 1;
  applyHolds();
  let released = false;
  return (): void => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    applyHolds();
  };
}

/** Test seam: drop the module back to "no engine, no holds" between cases. */
export function resetSmoothScrollForTests(): void {
  controller = null;
  holds = 0;
  stoppedByHold = false;
}
