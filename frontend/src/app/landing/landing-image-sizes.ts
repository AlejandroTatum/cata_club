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
 * `.landing-map-inset`, the small photo pinned over the map. Its width is
 * capped outright by landing.css — `min(48%, 220px)` on mobile and
 * `min(42%, 230px)` above it — so these are exact, not upper estimates.
 */
export const MAP_INSET_SIZES = "(max-width: 768px) 220px, 230px";

/**
 * `.landing-pillar-photo`, the Mission/Vision photograph below each
 * pillar's body copy.
 *
 * Above the mobile breakpoint the grid is `.landing-pillars { 1fr 1fr }`
 * with a 72px gap, and `.landing-section` pads the row `8.33vw` on each
 * side. At 1440px — one of the reference viewports (1280/1440/1920) this
 * landing is already checked against, see the hero carousel's comment in
 * landing.css — that is ~120px of padding per side, so one pillar is
 * `(1440 - 2*120 - 72) / 2 = 564px` wide, and the photo fills it.
 *
 * Below the breakpoint the grid drops to one column, so the column itself
 * can reach ~720px, but landing.css caps the photo's own `max-width` at
 * 360px there — close to the ~330-375px the lead (`30ch`) and body
 * (`44ch`) text already max out at, so the photo never outgrows the copy
 * it illustrates. 360px is therefore the true rendered width, not the
 * wider column.
 */
export const MISSION_VISION_PHOTO_SIZES = "(max-width: 768px) 360px, 564px";
