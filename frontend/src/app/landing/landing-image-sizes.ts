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
