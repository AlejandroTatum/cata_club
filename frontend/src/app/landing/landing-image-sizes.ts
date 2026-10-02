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
 * Above the mobile breakpoint `.landing-pillars` is `1fr 1fr` with a 72px
 * gap, and each `.landing-pillar` itself now mirrors that split — another
 * `1fr 1fr`, copy left / photo right, with a tighter 32px inner gap — so
 * the photo fills only half of what a whole pillar column used to give it.
 * `.landing-section` pads the row `8.33vw` on each side. At 1440px — one
 * of the reference viewports (1280/1440/1920) this landing is already
 * checked against, see the hero carousel's comment in landing.css — that
 * is ~120px of padding per side, so one pillar is
 * `(1440 - 2*120 - 72) / 2 = 564px` wide, and the photo's own column is
 * `(564 - 32) / 2 ≈ 266px`. This narrowed the slot from the 564px it used
 * to render at when the photo closed the column below the copy instead of
 * beside it — serving the old, wider `sizes` value here would over-request
 * bytes for a box that shrank by more than half.
 *
 * Below the breakpoint the pillar collapses back to one column (copy above,
 * photo below, `.landing-pillar { grid-template-columns: 1fr; }` in the
 * 768px block), so the column itself can reach ~720px, but landing.css caps
 * the photo's own `max-width` at 360px there — close to the ~330-375px the
 * lead (`30ch`) and body (`44ch`) text already max out at, so the photo
 * never outgrows the copy it illustrates. 360px is therefore the true
 * rendered width, not the wider column.
 */
export const MISSION_VISION_PHOTO_SIZES = "(max-width: 768px) 360px, 266px";
