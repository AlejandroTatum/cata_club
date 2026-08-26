/**
 * The geometry rules behind the Valores rally, kept out of `LandingMotion` so
 * they can be asserted without a browser.
 *
 * ## The regression these encode (issue #637)
 *
 * The rally pins the whole Valores section under a ball that scrubs along an
 * SVG guide, lighting value 01 -> 04 as it passes. Pinning freezes the section
 * with its top at the viewport top for the entire scrub, so whatever starts
 * below the fold stays below the fold until the pin releases.
 *
 * Measured on the built page: the section is 711px tall at 1440x900 (fits, the
 * choreography works), 1249px at 390x844, and 884px at 844x390. On both phone
 * viewports values 02-04 were reached — counter at 4/4, `hit` class applied,
 * `dim` cleared — entirely off screen. Nothing in the DOM was wrong, which is
 * why a class assertion or a screenshot of the top of the section would have
 * passed; the visitor simply never saw three of the four values light up.
 *
 * So the section may be pinned only while it fits, and when it does not, the
 * values are reached as they scroll past instead.
 */

/**
 * Scrub progress at which each value is reached while the section is pinned.
 *
 * One entry per value card, strictly ascending: the ball's progress is mapped
 * back to an index by counting how many of these it has passed, so a list that
 * drifted out of step with the cards would strand the tail of them.
 */
export const RALLY_HIT_PROGRESS: readonly number[] = [0.19, 0.42, 0.62, 0.82];

/** How many values the rally choreographs — the `ValueCard`s 01 through 04. */
export const RALLY_VALUE_COUNT = RALLY_HIT_PROGRESS.length;

/**
 * Whether the section can be pinned under the ball at this viewport.
 *
 * A section taller than the viewport cannot: pinned, its lower half is frozen
 * out of sight for the whole scrub. An unmeasured section (height 0, or a
 * viewport with no height) is treated as "cannot" — the unpinned choreography
 * degrades gracefully, a wrong pin hides content.
 */
export function rallyCanPin(sectionHeight: number, viewportHeight: number): boolean {
  if (!(sectionHeight > 0) || !(viewportHeight > 0)) return false;
  return sectionHeight <= viewportHeight;
}

/** The value the ball has reached at `progress`, or -1 before the first hit. */
export function rallyHitIndex(progress: number): number {
  let reached = -1;
  for (let index = 0; index < RALLY_HIT_PROGRESS.length; index += 1) {
    if (progress >= RALLY_HIT_PROGRESS[index]) reached = index;
  }
  return reached;
}

/** A value's box in document coordinates: its top offset and its own height. */
export interface RallyValueBox {
  /** Distance from the top of the document to the value's top edge. */
  top: number;
  height: number;
}

/** Scroll distance kept between one value lighting up and the next. */
export const RALLY_FLOW_MIN_GAP = 100;
/** Margin held back from the fold so a value is never lit flush against it. */
export const RALLY_FLOW_EDGE_INSET = 10;

/** Values are in the same grid row when their top edges agree to the pixel. */
const sameRow = (a: RallyValueBox, b: RallyValueBox): boolean => Math.abs(a.top - b.top) < 1;

/**
 * Where each value's top edge has to reach — in pixels down from the top of the
 * viewport — for that value to become the one the ball is on, when the section
 * scrolls instead of pinning.
 *
 * Every value has a window of scroll positions in which it is FULLY on screen:
 * `viewportHeight - height` pixels wide, from the moment its bottom edge clears
 * the fold to the moment its top edge reaches the top of the viewport. Lighting
 * it anywhere inside that window is what issue #637 is about — outside it, the
 * value is reached where nobody can see it.
 *
 * Two measured facts shape the rule, and both were learned the hard way at
 * 844x390, where the values are a two-column grid:
 *
 *  - 01/02 share a top edge and 03/04 share another, so a single anchor per row
 *    lights both members of a pair at the same scroll position.
 *  - The rows are ~200px apart and each window is only ~218px wide, so the
 *    windows very nearly coincide. Spreading a row proportionally across its
 *    own window (the obvious first answer) left value 02 lit for 9px of scroll
 *    before value 03 took over.
 *
 * So a row's members are anchored from the FAR end of the window inward, one
 * `RALLY_FLOW_MIN_GAP` apart: the first member is lit once it has cleared the
 * fold by `RALLY_FLOW_EDGE_INSET`, each later one exactly a gap after. That is
 * what gives all four
 * an equal, real interval — 100px each at 844x390 — instead of spending the
 * window's slack on the first member of every pair. A value alone in its row
 * (the stacked phone layout) takes the middle of its window instead; it needs
 * no separation from itself.
 *
 * The forward pass then holds the same minimum gap ACROSS rows and clamps every
 * result back into its own window, so the ordering can never invert and no
 * value can be pushed off screen by the one before it. A value taller than the
 * viewport has no window at all: it is anchored at the top of the viewport,
 * which is the most of it that can ever be shown.
 */
export function rallyFlowAnchorsPx(boxes: RallyValueBox[], viewportHeight: number): number[] {
  const anchors: number[] = [];
  let previous = Number.NEGATIVE_INFINITY;

  boxes.forEach((box, index): void => {
    const band = viewportHeight - box.height;
    // Scroll positions at which this value is entirely on screen: `latest` puts
    // its top edge at the top of the viewport, `earliest` its bottom edge on
    // the fold.
    const latest = box.top;
    const earliest = box.top - band;
    if (band <= 0) {
      anchors.push(0);
      previous = latest;
      return;
    }
    const column = boxes.slice(0, index).filter((earlier): boolean => sameRow(earlier, box)).length;
    const columns = boxes.filter((other): boolean => sameRow(other, box)).length;
    const preferred = columns <= 1
      ? band / 2
      : Math.max(0, band - RALLY_FLOW_EDGE_INSET - column * RALLY_FLOW_MIN_GAP);
    const chosen = Math.min(latest, Math.max(earliest, box.top - preferred, previous + RALLY_FLOW_MIN_GAP));
    anchors.push(box.top - chosen);
    previous = chosen;
  });

  return anchors;
}
