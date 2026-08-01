/**
 * The icon scale — three steps, each one a type step times 1.2.
 *
 * `size={N}` was written 262 times across 43 files and spent on FOURTEEN
 * distinct sizes: 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 32. Ten
 * of them lived between 10 and 21, which is to say the product offered eleven
 * pixels of range and cut it into ten. Nobody distinguishes a 13px icon from a
 * 14px one; what everybody sees is that the row below it sits half a pixel off
 * the one above.
 *
 * ## Why 1.2, and why these three type steps
 *
 * An icon almost never appears alone: it sits beside a label, inside a button,
 * at the head of a row. So its size is not an independent decision — it is the
 * size of the text it accompanies, scaled by whatever ratio makes the icon read
 * as the same weight as the words.
 *
 * `docs/ux/prototipos/_sistema.css` already answers what that ratio is, three
 * times over, because it declares both the icon and the text of the same
 * component:
 *
 * | Rule | Text | Icon | Ratio |
 * |---|---|---|---|
 * | `.srch` | 12.5px | 15px | 1.20 |
 * | `.btn` | 13px | 15px | 1.15 |
 * | `.nav-i` | 13.5px | 17px | 1.26 |
 *
 * 1.20 is the middle of that range and the only one that lands on whole pixels
 * for more than one type step. Applied to `text-xs` (12.5), `text-base` (15)
 * and `text-lg` (20) it gives 15, 18 and 24 exactly — the only triple of type
 * steps whose 1.2 is integral throughout.
 *
 * That the icon scale is a constant multiple of the type scale is the whole
 * point: it inherits the type scale's own accelerating ratios (1.2 from `sm`
 * to `base`, 1.33 from `base` to `lg`) instead of inventing a second rhythm.
 *
 * ## Choosing a step
 *
 * Read the text the icon sits with, not the icon.
 *
 * | Step | Size | Accompanies |
 * |---|---|---|
 * | `ICON.sm` | 15px | `text-2xs` and `text-xs` — chips, badges, inline notes, table-cell actions, buttons |
 * | `ICON.base` | 18px | `text-sm` and `text-base` — sidebar nav, header controls, row leads |
 * | `ICON.lg` | 24px | `text-lg` and above — the icon of an empty, loading, error or confirmation state |
 *
 * `ICON.lg` is also the WCAG 2.2 SC 2.5.8 target minimum, so an icon-only
 * control that has no other hit area can take it and be compliant by size.
 *
 * ## Writing it
 *
 * ```tsx
 * import { ICON } from "@/lib/icon-size";
 * <Search size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
 * ```
 *
 * A literal — `size={16}` — fails `arbitrary-style-values.test.ts` in CI. So
 * does `size={someNumber}`: on a file that imports `lucide-react` the only
 * expression the lock accepts is one built out of `ICON` steps. That is what
 * keeps the fourteen sizes from growing back one PR at a time.
 *
 * Full rationale: `docs/ux/escala-iconos.md`.
 */

export const ICON = {
  /** 15px. `text-xs` × 1.2. The dense default: chips, badges, buttons, cells. */
  sm: 15,
  /** 18px. `text-base` × 1.2. Interface chrome: nav, header controls, row leads. */
  base: 18,
  /** 24px. `text-lg` × 1.2. Feature marks: empty, loading, error, confirmation. */
  lg: 24,
} as const;

export type IconStep = keyof typeof ICON;

/**
 * The same three steps as a list, spelled the way the lock reports them. It
 * lives here rather than in the test so the scale is declared exactly once.
 */
export const ICON_STEPS: readonly { readonly token: string; readonly value: number }[] = (
  Object.keys(ICON) as IconStep[]
).map((step) => ({ token: `ICON.${step}`, value: ICON[step] }));
