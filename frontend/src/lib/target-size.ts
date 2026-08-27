/**
 * The 24x24 CSS-pixel floor of WCAG 2.2 SC 2.5.8 (Target Size, Minimum), as a
 * class every small control can share.
 *
 * ## Why this exists as a constant
 *
 * The project's accessibility target is AA — SC 2.5.8's 24px, not SC 2.5.5's
 * 44px (`docs/ux/objetivo-tactil.md`, and the roster in
 * `lib/__tests__/touch-target-usage.test.ts` guards the separate, deliberate
 * 44px promises). `min-h-[24px]` was already the spelling used for it in
 * `app/login/page.tsx`, `app/student/page.tsx` and `app/student/payments`, but
 * as a literal retyped per control — so nothing connected them, and a control
 * written without it simply had no floor.
 *
 * Issue #707 is what that costs. Inside the Pagos dialog, "Historial de pagos"
 * rendered at 18.8px and "Regularizar deuda" at 23px, while their siblings sat
 * at 26.8px and 27px — not because anyone chose three sizes, but because each
 * button's height fell out of whatever `text-*`/`py-*` pair it happened to
 * carry. Fixing only the two measured controls would have replaced two odd
 * sizes with two different ones; naming the floor once, and applying it to
 * every small control in that dialog, is what makes them a set.
 *
 * ## What it is and is not
 *
 * It is a MINIMUM, not a height: a control whose natural height already clears
 * 24px is unchanged by it, so applying it to a whole family costs nothing
 * visually and prevents the next one from landing under the floor.
 *
 * Height only. Every control that carries this is a text-bearing chip or a
 * full-width row, so width clears 24px by construction — the same reasoning
 * `touch-target-usage.test.ts` documents for measuring only height. An
 * icon-only control needs a square (`h-6 w-6`, as `app/student/enroll` and the
 * login page's toggle already do), not this.
 *
 * Pair it with `items-center` on a flex control, so the extra space is shared
 * above and below the label instead of pushing it to the top.
 */
export const MIN_TARGET_CLASS = "min-h-[24px]";
