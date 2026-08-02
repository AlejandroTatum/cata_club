/**
 * PAGE_RAIL — the one two-column page split.
 *
 * The audit that opened #36 described the student and profile screens as
 * already sharing "the" second-column pattern, and asked for it to be adopted
 * by the admin screens. Read together, they were not sharing anything: the
 * same split was written SIX ways, with FOUR different rail measures.
 *
 * | Screen                      | What it wrote                                              |
 * |-----------------------------|------------------------------------------------------------|
 * | `student/page`              | `grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start` |
 * | `student/attendance/page`   | the same, 340px                                            |
 * | `student/payments/page`     | the same, but 360px                                        |
 * | `profile/page`              | the same, but 380px                                        |
 * | `dashboard/page`            | `grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]` |
 * | `payments/page` (proof)     | `grid gap-5 lg:grid-cols-5` + `lg:col-span-3`              |
 *
 * Nothing was wrong in any one file, which is exactly why it drifted — the
 * same failure mode the filter panel had before #82, and the empty-state
 * surface before #80. Copying one of those six into three admin screens would
 * have shipped the drift rather than the pattern, so the pattern is made one
 * thing here first.
 *
 * ## Why 340px
 *
 * It is the measure two of the four screens already used, the one the
 * dashboard used, and the width `_sistema.css:417` gives the chat panel — the
 * only rail-shaped surface the design system commits to a number. 360 and 380
 * carried no comment and no content that needed them: they are 340 typed
 * twice by hand. Against the 1356px content measure that #72 capped, a 340px
 * rail leaves the main column 996px, which is a reading width rather than a
 * banner.
 *
 * ## Why `gap-page` and not `gap-5`
 *
 * They are both 20px. `page` is the NAME for that 20px — "between first-level
 * blocks of a page" (`tailwind.config.ts:362`) — and a rail split is exactly
 * that, both stacked on a phone and side by side above `lg`. The dashboard's
 * `gap-4` was the odd 16px, and the only reason it looked fine is that no one
 * sees two screens at once.
 *
 * ## What this is, and is not
 *
 * A class string, like `STAT_GRID`, not a component. What drifted was the
 * string; the markup around it is legitimately different per screen —
 * `student/payments` places its three items explicitly so DOM order and
 * reading order agree at both widths, and a component with `main`/`aside`
 * slots could not express that without an escape hatch that would be used on
 * day one.
 *
 * A rail does NOT close vertical emptiness, and #36 assumed it did. It moves
 * content sideways, so it shortens a page that already had that content
 * BELOW. A short admin screen has nothing to move, and its canvas is just as
 * empty with a rail beside it. See the note on Descuentos for what a rail is
 * actually worth there.
 */
export const PAGE_RAIL = "grid gap-page lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start";
