/**
 * The frozen inventory of arbitrary style values — the allowlist behind
 * `arbitrary-style-values.test.ts`.
 *
 * Every entry is an arbitrary value that ALREADY existed under
 * `frontend/src/` the day the lock was installed. These are not approved
 * values; they are measured debt. The lock is green on day one precisely
 * because this list covers all of them, and each migration issue shrinks it.
 *
 * ## How the list shrinks
 *
 * 1. Migrate the uses of one value to the token that replaces it.
 * 2. Delete that line from this file.
 * 3. Run `pnpm test`. Any use left behind is reported with its file and the
 *    token it should be using.
 *
 * Entries are never added. A new entry is exactly what the lock exists to
 * prevent — if a genuinely new value is unavoidable, it gets a name in
 * `tailwind.config.ts` first and stops being arbitrary.
 *
 * Full protocol: `docs/ux/candado-valores-arbitrarios.md`.
 */

/** The six axes the lock watches. */
export type Axis = "typography" | "leading" | "tracking" | "icon" | "shadow" | "breakpoint";

/**
 * Tolerated values per axis, spelled exactly as they appear in the code: the
 * text between the brackets, or the bare number between the braces for `size`.
 *
 * Frozen from `frontend/src/` on 2026-08-01. Sorted by value, not by how many
 * call sites use it — occurrence counts go stale, and the lock reports the
 * live ones anyway.
 */
export const ALLOWLIST: Record<Axis, readonly string[]> = {
  /**
   * `text-[…]`. Empty. The twenty-five hand-picked sizes are all gone.
   *
   * The display band — 18 · 20 · 24 · 26 · 27 · 30 · 32 · 40 · 42 · 46 · 56 —
   * went first: every call site at 18px and above names a step.
   *
   * The body band went next. `13`, `13.5` and `14` collapsed into `sm`
   * (13.5px), and `14.5`, `15` and `17` into `base` (15px): six sizes, 145
   * call sites, one half-pixel cluster less.
   *
   * The dense band followed: `12` and `12.5` collapsed into `xs` (12.5px)
   * across 74 call sites — the single largest cluster of the inventory.
   *
   * The micro band closed it: `9`, `9.5`, `10`, `10.5`, `11` and `11.5` all
   * collapsed into `2xs` (10.5px) across 91 call sites. A step is now the only
   * way to write a font size.
   */
  typography: [],

  /**
   * `leading-[…]`. Empty. Line-height travels with the size step.
   *
   * `1.12` and `1.15` retired with the display band: both were headline
   * line-heights, and `leading-crisp` (1.15) is the step that names them.
   *
   * `1.35` retired with the body band. Its single call site was the toast
   * message, which now takes the 1.5 that `sm` brings.
   *
   * `1.45` retired with the dense band, and so did one of the two `1.5` call
   * sites: the hint box, the toast body and the help escape hatch sit within
   * 0.05 of the 1.5 that `xs` already carries — under a pixel at 12.5px — so
   * they were dropped instead of renamed. The other two kept their value
   * under a name, because a step exists for each case: `1.55` on the FAQ
   * answer is `leading-prose`, and `1.25` on the brand label is
   * `leading-tight`, a factory step that is exactly 1.25.
   *
   * The last three went with the micro band. `1.2` and `1.3` are the two
   * stacked labels of the member card, whose sibling value already rides
   * `leading-tight` (1.25) — they now ride it too, within 0.13px of what they
   * measured. `1.5` was the auth small print, 0.1 from the 1.4 that `2xs`
   * carries, so it was dropped like the other sub-pixel overrides.
   */
  leading: [],

  /**
   * `tracking-[…]`. Empty. Letter-spacing travels with the size step too.
   *
   * The three `px` trackings are gone — they were the ones that could not
   * scale with the type, and all three lived in `AuthShell.tsx`. Two were
   * covered by the tracking a size step already carries and simply vanished;
   * `2px` on a 10px uppercase run is 0.2em, which is `tracking-caps-wide`.
   *
   * `-0.05em`, `-0.04em` and `-0.03em` retired the same way: they are the
   * defaults of `display`, `2xl` and `xl`, and every call site that spelled
   * them out now sits on the step that brings them.
   *
   * `-0.015em` and `-0.02em` retired with the body band. The four `-0.015em`
   * call sites sat 0.005em from the tracking `base` already carries and were
   * dropped; the single `-0.02em` had to keep tightening a tabular figure, so
   * it names `tracking-dense` instead.
   *
   * `0.06em` retired with the dense band. Its single call site is the toast
   * action label, an uppercase run that would close up on the 0em `xs`
   * carries, so it names `tracking-wider` (0.05em) instead of being dropped.
   *
   * The micro band retired the last five. `0.1em`, `0.12em` and `0.13em` were
   * forty-one uppercase micro-labels spread across 0.03em — the exact cluster
   * `2xs`'s own 0.12em exists to end, so the class simply disappears from all
   * of them. `0.2em` on the auth eyebrow does contradict the step and names
   * `tracking-caps-wide`. `-0.01em` on the stat-card unit sat 0.005em from
   * what `sm` carries and was dropped, like the `-0.015em` cluster before it.
   */
  tracking: [],

  /** `size={…}` on a lucide icon. Fourteen sizes, ten of them between 10 and 21. */
  icon: [
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "24",
    "32",
  ],

  /**
   * `shadow-[…]`. `tailwind.config.ts` already names three elevations
   * (`soft`, `card`, `elevated`); these ten are what predates them.
   *
   * The `#131316` rings are the focus indicator that `focus-ring-usage.test.ts`
   * requires — retiring them means moving that pair into the theme, not
   * dropping it. Read that test before touching these five.
   */
  shadow: [
    "0_0_0_1px_theme(colors.coal.DEFAULT)",
    "0_0_0_2px_#FFFFFF,0_0_0_5px_#131316",
    "0_0_0_2px_#FFFFFF,0_0_0_5px_#131316,0_10px_28px_rgba(19,19,22,0.30)",
    "0_0_0_4px_#131316",
    "inset_0_0_0_4px_#131316",
    "0_4px_24px_rgba(0,0,0,0.05)",
    "0_10px_28px_rgba(19,19,22,0.30)",
    "0_12px_40px_rgba(0,0,0,0.5)",
    "0_12px_44px_rgba(0,0,0,0.07)",
    "0_14px_40px_rgba(0,0,0,0.12)",
  ],

  /** `min-[…]`. One off-scale breakpoint, sixteen call sites, all the admin shell. */
  breakpoint: ["980px"],
};
