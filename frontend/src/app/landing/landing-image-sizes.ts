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
 * pixel width from the fixed slide height; these two are width-driven rather
 * than height-driven, so they are derived from the grid instead.
 */

/**
 * `.landing-editorial-media`, used by both the Mission and Vision photos.
 *
 * The figure is a quarter of the content column on desktop and grows with the
 * viewport, so each band declares the widest the figure ever gets inside it:
 *
 * | Viewport   | landing.css layout                                  | Widest  |
 * | ---------- | --------------------------------------------------- | ------- |
 * | ≤ 768px    | one column, full content width: `100vw - 48`        |  720px  |
 * | ≤ 1024px   | two columns inside 48px gutters: `25vw - 64`        |  192px  |
 * | ≤ 1420px   | two columns inside 8.33vw gutters: `20.835vw - 40`  |  256px  |
 * | ≤ 2035px   | same rule, further along                            |  384px  |
 * | wider      | same rule, on very large desktops                    |  640px  |
 */
export const EDITORIAL_MEDIA_SIZES =
  "(max-width: 768px) 720px, (max-width: 1024px) 192px, (max-width: 1420px) 256px, (max-width: 2035px) 384px, 640px";

/**
 * `.landing-map-inset`, the small photo pinned over the map. Its width is
 * capped outright by landing.css — `min(48%, 220px)` on mobile and
 * `min(42%, 230px)` above it — so these are exact, not upper estimates.
 */
export const MAP_INSET_SIZES = "(max-width: 768px) 220px, 230px";
