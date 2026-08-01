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
  /** `text-[…]`. Twenty-four hand-picked sizes where the `text-*` scale has ten. */
  typography: [
    "9px",
    "9.5px",
    "10px",
    "10.5px",
    "11px",
    "11.5px",
    "12px",
    "12.5px",
    "13px",
    "13.5px",
    "14px",
    "14.5px",
    "15px",
    "17px",
    "20px",
    "24px",
    "26px",
    "27px",
    "30px",
    "32px",
    "40px",
    "42px",
    "46px",
    "56px",
  ],

  /** `leading-[…]`. Nine ratios, none of which is a `leading-*` step. */
  leading: ["1.12", "1.15", "1.2", "1.25", "1.3", "1.35", "1.45", "1.5", "1.55"],

  /** `tracking-[…]`. Mixed units: the `px` three cannot even scale with the type. */
  tracking: [
    "-0.05em",
    "-0.04em",
    "-0.03em",
    "-0.02em",
    "-0.015em",
    "-0.01em",
    "0.06em",
    "0.1em",
    "0.12em",
    "0.13em",
    "0.2em",
    "-1.5px",
    "-0.5px",
    "2px",
  ],

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
