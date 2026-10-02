/**
 * `sizes` strings for the landing photographs that are not part of a carousel.
 *
 * Every width below is expressed in plain pixels, never in `vw`, and that is
 * the load-bearing detail. `next/image` only offers its small `imageSizes`
 * candidates (…, 128, 256, 384) when the `sizes` string contains no `vw`
 * unit; the moment one appears, the candidate ladder starts at the first
 * `deviceSizes` entry, 640. A 227px-wide thumbnail therefore has to describe
 * itself in pixels to be served at 256 instead of 640. `slideSizes` in
 * `landing-gallery.ts` already follows this rule for the gallery, deriving its
 * pixel width from the fixed slide height; this one is width-driven rather
 * than height-driven, so it is derived from the grid instead.
 */

/**
 * `.landing-arrival`, the entrance photograph beside the map. The visit row is
 * `4fr 8fr` above the mobile breakpoint, so at 1920 (about 1600px of content,
 * a 24px gap) it renders near 520px; below it the frame spans the column.
 */
export const ARRIVAL_PHOTO_SIZES = "(max-width: 768px) 768px, 540px";

/** `.landing-footer-photo`, the footer's closing column. */
export const FOOTER_PHOTO_SIZES = "(max-width: 768px) 420px, 360px";

/** `.landing-schedule-photo`, the card's image column (about 40% of it). */
export const SCHEDULE_PHOTO_SIZES = "(max-width: 768px) 420px, 360px";

/**
 * `.landing-pillar-photo`, the Mission/Vision photograph beside each
 * pillar's body copy.
 *
 * Above the mobile breakpoint each `.landing-pillar` is its own full-width
 * row, a `1fr 1fr` split with the photo alternating sides (the second pillar
 * is flipped). `.landing-section` pads the row `8.33vw` on each side, so at
 * 1440px — one of the reference viewports (1280/1440/1920) — a row is
 * `1440 - 2*120 = 1200px` and the photo's own column is `(1200 - 72) / 2 =
 * 564px`; 560 covers it at the narrower desktop widths too.
 *
 * Below the breakpoint the pillar collapses back to one column (copy above,
 * photo below, `.landing-pillar { grid-template-columns: 1fr; }` in the
 * 768px block), so the column itself can reach ~720px, but landing.css caps
 * the photo's own `max-width` at 360px there — close to the ~330-375px the
 * lead (`28ch`) and body (`50ch`) text already max out at, so the photo
 * never outgrows the copy it illustrates. 360px is therefore the true
 * rendered width, not the wider column.
 */
export const MISSION_VISION_PHOTO_SIZES = "(max-width: 768px) 360px, 560px";
