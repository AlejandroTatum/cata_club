/**
 * The geometry rules behind the Valores rally's scroll choreography, kept out
 * of `LandingMotion` so they can be asserted without a browser.
 *
 * ## Why the rally never pins (issue #637's guarantee, #1026's correction)
 *
 * The rally once had a second choreography: on viewports where the section fit
 * (711px of section against 900px of viewport at 1440x900), ScrollTrigger
 * pinned it for +=1900px of scrub while a ball travelled the guide. The pin
 * reserved that distance with transparent spacer padding — so on every viewport
 * taller than the section, the strip below the yellow section showed the page's
 * own near-white background: a blank band sitting there for the whole scrub.
 * #1026's review caught it on screen.
 *
 * The choreography that lights every value while the visitor is actually
 * looking at it never needed the pin — that was #637's real finding: the
 * original bug was values lighting OFF screen, and flowing anchors fix it
 * without holding the section still. So the rally now has ONE choreography,
 * the flowing one: the section scrolls normally — yellow meeting the black
 * trophy wall directly, no spacer, no blank band — and each value is lit as it
 * arrives, anchored inside the scroll window where it is fully on screen (see
 * `rallyFlowAnchorsPx` for the window arithmetic and the measured layouts that
 * shaped it).
 */

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
