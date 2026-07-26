/**
 * The focus indicator the assistant's own controls wear.
 *
 * ## Why not the shared `outline-ball`
 *
 * Every other focusable control in the product outlines in `ball` (#FFD600).
 * That works because those controls live on the coal sidebar, where the yellow
 * measures ~11.7:1. It does NOT work for anything that floats over a light
 * surface: #FFD600 against `paper` (#FFFFFF) is 1.42:1 and against `canvas`
 * (#E8E8EE) is 1.30:1 — both far under the 3:1 that WCAG 2.4.11 asks of a
 * focus indicator. The launcher floats over whatever page is underneath it,
 * which in this product is always one of those two light greys, and on the
 * landing can be a dark slab instead. One flat colour cannot pass everywhere.
 *
 * ## The two-tone ring
 *
 * So the indicator carries BOTH extremes: a 2px white band immediately around
 * the control, then a 3px coal band around that. Whatever the control and the
 * page happen to be, one of the two bands is high-contrast against its
 * neighbour, which is exactly the "adjacent colours" test 1.4.11/2.4.11 apply:
 *
 *   · white band vs the coal launcher (#131316) ....... 18.9:1
 *   · coal band vs the white band ..................... 18.9:1
 *   · coal band vs `canvas` (#E8E8EE) ................. 15.4:1
 *   · coal band vs `paper` (#FFFFFF) .................. 18.9:1
 *   · white band vs the landing's coal slabs .......... ≥15:1
 *
 * The shared `ball` token is deliberately left alone — it is correct on the
 * dark rail it was designed for, and re-tinting it is a system-wide change
 * that does not belong to this component.
 *
 * `box-shadow` rather than `outline`: an outline cannot be two colours, and a
 * shadow ring follows the launcher's `rounded-full` geometry for free.
 */

/** Two-tone ring for a control that keeps no resting shadow of its own. */
export const ASSISTANT_FOCUS_RING =
  "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_#FFFFFF,0_0_0_5px_#131316]";

/**
 * The same ring for the floating launcher, which must keep its drop shadow
 * while focused — `box-shadow` is one property, so the resting shadow has to
 * be restated inside the focus value or it disappears on focus.
 */
export const LAUNCHER_FOCUS_RING =
  "focus-visible:outline-none " +
  "focus-visible:shadow-[0_0_0_2px_#FFFFFF,0_0_0_5px_#131316,0_10px_28px_rgba(19,19,22,0.30)]";
